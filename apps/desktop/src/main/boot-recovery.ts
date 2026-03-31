import { existsSync } from "node:fs";
import { startOutputTailer } from "../server/operations/output-tailer.js";
import {
  registerRecoveredLoop,
  unregisterLoop,
} from "../server/operations/symphony-loop.js";
import { isProcessRunning } from "../server/operations/symphony-utils.js";
import { assertPathAllowed } from "../server/security.js";
import { gatewayLog } from "./gateway-logger.js";
import type { JobStore, LocalJob } from "./job-store.js";
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
      const finalizerDeps: LoopFinalizerDeps = {
        jobStore,
        telemetry,
        assertPathAllowed,
        apiAuthToken: apiKey,
        apiBaseUrl,
        isProcessRunning,
      };

      for (const job of unfinalizedDeadJobs) {
        try {
          await finalizeLoopFromRuntime(job, "boot-recovery", finalizerDeps);
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
      this.reattachLiveJob(job, apiKey, apiBaseUrl);
    }
  }

  private reattachLiveJob(job: LocalJob, apiKey: string, apiBaseUrl: string): void {
    const { jobStore } = this.deps;
    const { loopId, pid } = job;
    if (pid == null) return;

    const effectiveApiBaseUrl = job.apiBaseUrl ?? apiBaseUrl;
    registerRecoveredLoop(loopId, pid);

    if (!isProcessRunning(pid)) {
      unregisterLoop(loopId);
      this.finalizeRecoveredJob(loopId, apiKey, effectiveApiBaseUrl, undefined);
      return;
    }

    let tailer: LiveJobHandle["tailer"] | undefined;
    if (job.jsonlPath && existsSync(job.jsonlPath)) {
      tailer = startOutputTailer(
        job.jsonlPath,
        effectiveApiBaseUrl,
        loopId,
        apiKey,
        job.lastObservedJsonlOffset ?? 0,
        (offset) => {
          const current = jobStore.getByLoopId(loopId);
          if (current) {
            jobStore.upsert({ ...current, lastObservedJsonlOffset: offset });
          }
        },
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
        this.finalizeRecoveredJob(loopId, apiKey, effectiveApiBaseUrl, tailer);
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
        assertPathAllowed,
        apiAuthToken: apiKey,
        apiBaseUrl,
        isProcessRunning,
      };

      try {
        await finalizeLoopFromRuntime(job, "boot-recovery", finalizerDeps);
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
