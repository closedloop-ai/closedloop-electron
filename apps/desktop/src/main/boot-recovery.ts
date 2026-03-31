import path from "node:path";
import { startOutputTailer } from "../server/operations/output-tailer.js";
import {
  registerRecoveredLoop,
  unregisterLoop,
} from "../server/operations/symphony-loop.js";
import { isProcessRunning } from "../server/operations/symphony-utils.js";
import { gatewayLog } from "./gateway-logger.js";
import type { JobStore, LocalJob } from "./job-store.js";
import { readPersistedLoopAuthToken } from "./loop-auth-token.js";
import {
  finalizeLoopFromRuntime,
  type LoopFinalizerDeps,
} from "./loop-finalizer.js";
import type { TelemetryEmitter } from "./telemetry-protocol.js";

export interface BootRecoveryDeps {
  jobStore: JobStore;
  telemetry: TelemetryEmitter;
  getApiKey: () => string | null;
  getApiOrigin: () => string;
}

interface LiveJobHandle {
  loopId: string;
  tailer?: { stop: () => void; flush: () => Promise<void> };
  watcherId: ReturnType<typeof setInterval>;
}

const WATCHER_POLL_MS = 3000;

/**
 * Resolve the loop auth token from the persisted on-disk file, falling back
 * to the gateway API key as a last resort.
 */
function resolveLoopAuthToken(
  job: LocalJob,
  fallbackApiKey: string,
): string {
  const persisted = readPersistedLoopAuthToken(job.claudeWorkDir);
  if (persisted) {
    gatewayLog.info(
      "boot-recovery",
      `Token source for loopId=${job.loopId}: PERSISTED`,
    );
    return persisted;
  }

  gatewayLog.warn(
    "boot-recovery",
    `Token source for loopId=${job.loopId}: FALLBACK (gateway API key — NOT a runner token!)`,
  );
  return fallbackApiKey;
}

/**
 * Backfill job metadata paths that live-loop startup persists but older app
 * versions may not have saved.  Returns the updated job (or the original if
 * nothing changed).  Persists to JobStore only when at least one field was
 * derived so subsequent polls/enrichments see them immediately.
 */
function backfillJobPaths(job: LocalJob, jobStore: JobStore): LocalJob {
  if (!job.claudeWorkDir) return job;

  const patches: Partial<LocalJob> = {};
  if (!job.jsonlPath) {
    patches.jsonlPath = path.join(job.claudeWorkDir, "claude-output.jsonl");
  }
  if (!job.statePath) {
    patches.statePath = path.join(job.claudeWorkDir, "state.json");
  }
  if (!job.logPath) {
    patches.logPath = path.join(job.claudeWorkDir, "symphony-loop.log");
  }

  if (Object.keys(patches).length === 0) return job;

  const updated: LocalJob = {
    ...job,
    ...patches,
    updatedAt: new Date().toISOString(),
  };
  jobStore.upsert(updated);
  return updated;
}

export class BootRecoveryService {
  private readonly deps: BootRecoveryDeps;
  private liveHandles: LiveJobHandle[] = [];
  private disposed = false;

  constructor(deps: BootRecoveryDeps) {
    this.deps = deps;
  }

  async run(deadJobs: LocalJob[]): Promise<void> {
    if (this.disposed) return;

    const { jobStore, telemetry, getApiKey, getApiOrigin } = this.deps;
    const apiKey = getApiKey();
    const apiBaseUrl = getApiOrigin();

    const unfinalizedDeadJobs = deadJobs.filter((job) => !job.finalStatusPersistedAt);
    if (unfinalizedDeadJobs.length > 0 && (!apiKey || !apiBaseUrl)) {
      gatewayLog.warn(
        "boot-recovery",
        `Skipping ${unfinalizedDeadJobs.length} dead loop finalization(s): missing API config`,
      );
    } else if (apiKey && apiBaseUrl) {
      for (const job of unfinalizedDeadJobs) {
        try {
          const authToken = resolveLoopAuthToken(job, apiKey);
          await finalizeLoopFromRuntime(job, "boot-recovery", {
            jobStore,
            telemetry,
            apiAuthToken: authToken,
            apiBaseUrl,
            isProcessRunning,
          });
        } catch (err) {
          gatewayLog.warn(
            "boot-recovery",
            `Dead loop finalization failed for loopId=${job.loopId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    const liveJobs = jobStore
      .listRunning()
      .filter((job) => job.pid != null && isProcessRunning(job.pid));

    if (liveJobs.length === 0) {
      return;
    }
    if (!apiKey || !apiBaseUrl) {
      gatewayLog.warn(
        "boot-recovery",
        `Skipping ${liveJobs.length} live loop reattach(es): missing API config`,
      );
      return;
    }

    for (const job of liveJobs) {
      await this.reattachLiveJob(job, apiKey, apiBaseUrl);
    }
  }

  private async reattachLiveJob(job: LocalJob, apiKey: string, apiBaseUrl: string): Promise<void> {
    const { jobStore } = this.deps;
    const { loopId, pid } = job;
    if (pid == null) return;

    const effectiveApiBaseUrl = job.apiBaseUrl ?? apiBaseUrl;
    const loopAuthToken = resolveLoopAuthToken(job, apiKey);
    registerRecoveredLoop(loopId, pid);

    const enrichedJob = backfillJobPaths(job, jobStore);
    gatewayLog.info(
      "boot-recovery",
      `Reattaching live loop loopId=${loopId} pid=${pid}`,
    );

    if (!isProcessRunning(pid)) {
      unregisterLoop(loopId);
      this.finalizeRecoveredJob(loopId, loopAuthToken, effectiveApiBaseUrl, undefined);
      return;
    }

    let tailer: LiveJobHandle["tailer"] | undefined;
    if (enrichedJob.jsonlPath) {
      gatewayLog.info(
        "boot-recovery",
        `Starting output tailer for loopId=${loopId} jsonlPath=${enrichedJob.jsonlPath} offset=${enrichedJob.lastObservedJsonlOffset ?? 0} api=${effectiveApiBaseUrl}`,
      );
      tailer = startOutputTailer(
        enrichedJob.jsonlPath,
        effectiveApiBaseUrl,
        loopId,
        loopAuthToken,
        enrichedJob.lastObservedJsonlOffset ?? 0,
        (offset) => {
          const current = jobStore.getByLoopId(loopId);
          if (current) {
            jobStore.upsert({ ...current, lastObservedJsonlOffset: offset });
          }
        },
      );
    } else {
      gatewayLog.warn(
        "boot-recovery",
        `Cannot start output tailer for loopId=${loopId}: no jsonlPath (claudeWorkDir=${enrichedJob.claudeWorkDir ?? "none"})`,
      );
    }

    const watcherId = setInterval(() => {
      if (this.disposed) {
        clearInterval(watcherId);
        return;
      }
      if (!isProcessRunning(pid)) {
        clearInterval(watcherId);
        this.liveHandles = this.liveHandles.filter((value) => value.loopId !== loopId);
        unregisterLoop(loopId);
        this.finalizeRecoveredJob(loopId, loopAuthToken, effectiveApiBaseUrl, tailer);
      }
    }, WATCHER_POLL_MS);

    this.liveHandles.push({ loopId, tailer, watcherId });
  }

  private finalizeRecoveredJob(
    loopId: string,
    apiKey: string,
    apiBaseUrl: string,
    tailer: LiveJobHandle["tailer"] | undefined,
  ): void {
    const { jobStore, telemetry } = this.deps;

    const run = async () => {
      if (tailer) {
        try {
          await tailer.flush();
        } catch {
          // best effort
        }
      }

      const job = jobStore.getByLoopId(loopId);
      if (!job) {
        gatewayLog.warn("boot-recovery", `loopId=${loopId} missing from JobStore`);
        return;
      }

      const finalizerDeps: LoopFinalizerDeps = {
        jobStore,
        telemetry,
        apiAuthToken: apiKey,
        apiBaseUrl,
        isProcessRunning,
      };

      try {
        await finalizeLoopFromRuntime(job, "boot-recovery", finalizerDeps);
        gatewayLog.info(
          "boot-recovery",
          `Finalized recovered loop loopId=${loopId}`,
        );
      } catch (err) {
        gatewayLog.warn(
          "boot-recovery",
          `Recovered loop finalization failed for loopId=${loopId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };

    run().catch(() => {});
  }

  dispose(): void {
    this.disposed = true;
    for (const handle of this.liveHandles) {
      clearInterval(handle.watcherId);
      handle.tailer?.stop();
    }
    this.liveHandles = [];
  }
}
