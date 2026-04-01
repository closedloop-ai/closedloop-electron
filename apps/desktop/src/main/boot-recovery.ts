import { startOutputTailer } from "../server/operations/output-tailer.js";
import {
  registerRecoveredLoop,
  unregisterLoop,
} from "../server/operations/symphony-loop.js";
import { isProcessRunning } from "../server/operations/symphony-utils.js";
import { gatewayLog } from "./gateway-logger.js";
import type { JobStore, LocalJob } from "./job-store.js";
import type { LoopTokenStore } from "./loop-token-store.js";
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
  loopTokenStore: LoopTokenStore;
}

interface LiveJobHandle {
  loopId: string;
  tailer?: { stop: () => void; flush: () => Promise<void> };
  watcherId: ReturnType<typeof setInterval>;
}

const DEFAULT_WATCHER_POLL_MS = 3000;
const MAX_RECOVERY_ATTEMPTS = 3;

export class BootRecoveryService {
  private readonly deps: BootRecoveryDeps;
  private liveHandles: LiveJobHandle[] = [];
  private readonly backgroundTasks = new Set<Promise<void>>();
  private deadJobFinalizationTask: Promise<void> | null = null;
  // Prevents new recovery work and stops background watchers after shutdown begins.
  private disposed = false;

  constructor(deps: BootRecoveryDeps) {
    this.deps = deps;
  }

  async run(deadJobs: LocalJob[]): Promise<void> {
    if (this.disposed) return;
    await this.finalizeDeadJobs(deadJobs);
    await this.reattachLiveJobs();
  }

  async reattachLiveJobs(): Promise<void> {
    if (this.disposed) return;

    const { jobStore, getApiKey, getApiOrigin } = this.deps;
    const apiKey = getApiKey();
    const apiBaseUrl = getApiOrigin();
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
      await this.reattachLiveJob(job, apiBaseUrl);
    }
  }

  startDeadJobFinalization(deadJobs: LocalJob[]): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    if (this.deadJobFinalizationTask) {
      return this.deadJobFinalizationTask;
    }
    const task = this.trackBackgroundTask(this.finalizeDeadJobs(deadJobs));
    this.deadJobFinalizationTask = task;
    void task.finally(() => {
      if (this.deadJobFinalizationTask === task) {
        this.deadJobFinalizationTask = null;
      }
    });
    return task;
  }

  async quiesce(timeoutMs: number): Promise<void> {
    const pending = [...this.backgroundTasks];
    if (pending.length === 0) {
      return;
    }
    await Promise.race([
      Promise.allSettled(pending).then(() => undefined),
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
  }

  private async finalizeDeadJobs(deadJobs: LocalJob[]): Promise<void> {
    if (this.disposed) return;

    const { jobStore, telemetry, getApiKey, getApiOrigin, loopTokenStore } = this.deps;
    const apiKey = getApiKey();
    const apiBaseUrl = getApiOrigin();
    const recoveryCandidates = this.buildRecoveryCandidates(deadJobs);
    if (recoveryCandidates.length > 0 && (!apiKey || !apiBaseUrl)) {
      gatewayLog.warn(
        "boot-recovery",
        `Skipping ${recoveryCandidates.length} dead loop finalization(s): missing API config`,
      );
      return;
    }
    if (!apiKey || !apiBaseUrl) {
      return;
    }
    for (const candidate of recoveryCandidates) {
      if (this.disposed) {
        return;
      }
      const job = jobStore.getByLoopId(candidate.loopId) ?? candidate;
      const attempts = job.recoveryAttempts ?? 0;
      if (attempts >= MAX_RECOVERY_ATTEMPTS) {
        this.markRecoveryGiveUp(job, `Exceeded retry cap (${MAX_RECOVERY_ATTEMPTS})`);
        loopTokenStore.deleteLoopToken(job.loopId);
        continue;
      }
      try {
        const authToken = loopTokenStore.getLoopToken(job.loopId);
        if (!authToken) {
          gatewayLog.warn(
            "boot-recovery",
            `Skipping dead loop finalization: missing loop token for loopId=${job.loopId} (phase=dead-finalization)`,
          );
          continue;
        }
        gatewayLog.info(
          "boot-recovery",
          `Token source for loopId=${job.loopId}: LOOP_TOKEN_STORE`,
        );
        jobStore.upsert({
          ...job,
          recoveryAttempts: attempts + 1,
          updatedAt: new Date().toISOString(),
        });
        const outcome = await finalizeLoopFromRuntime(job, "boot-recovery", {
          jobStore,
          telemetry,
          apiAuthToken: authToken,
          apiBaseUrl,
          isProcessRunning,
          loopTokenStore,
        });
        if (!outcome.cloudFinalized && outcome.retryableFailure) {
          const latest = jobStore.getByLoopId(job.loopId);
          if ((latest?.recoveryAttempts ?? 0) >= MAX_RECOVERY_ATTEMPTS) {
            this.markRecoveryGiveUp(job, `Exceeded retry cap (${MAX_RECOVERY_ATTEMPTS})`);
            loopTokenStore.deleteLoopToken(job.loopId);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.markRecoveryFailure(job, message);
        gatewayLog.warn(
          "boot-recovery",
          `Dead loop finalization failed for loopId=${job.loopId}: ${message}`,
        );
      }
    }
  }

  private buildRecoveryCandidates(deadJobs: LocalJob[]): LocalJob[] {
    const { jobStore } = this.deps;
    const byLoopId = new Map<string, LocalJob>();
    for (const job of deadJobs) {
      byLoopId.set(job.loopId, job);
    }
    for (const terminalJob of jobStore.listCompleted()) {
      if (terminalJob.finalStatusPersistedAt && !terminalJob.cloudFinalizedAt) {
        byLoopId.set(terminalJob.loopId, terminalJob);
      }
    }
    return [...byLoopId.values()].filter((job) => {
      if (job.cloudFinalizedAt) {
        return false;
      }
      return (job.recoveryAttempts ?? 0) < MAX_RECOVERY_ATTEMPTS;
    });
  }

  private markRecoveryFailure(job: LocalJob, error: string): void {
    const { jobStore } = this.deps;
    const current = jobStore.getByLoopId(job.loopId) ?? job;
    jobStore.upsert({
      ...current,
      lastRecoveryError: error,
      updatedAt: new Date().toISOString(),
    });
  }

  private markRecoveryGiveUp(job: LocalJob, error: string): void {
    const { jobStore } = this.deps;
    const current = jobStore.getByLoopId(job.loopId) ?? job;
    jobStore.upsert({
      ...current,
      lastRecoveryError: error,
      updatedAt: new Date().toISOString(),
      cloudFinalizedAt: current.cloudFinalizedAt ?? new Date().toISOString(),
    });
  }

  private async reattachLiveJob(job: LocalJob, apiBaseUrl: string): Promise<void> {
    const { jobStore } = this.deps;
    const { loopId, pid } = job;
    if (pid == null) return;

    const effectiveApiBaseUrl = job.apiBaseUrl ?? apiBaseUrl;
    const loopAuthToken = this.deps.loopTokenStore.getLoopToken(loopId);
    if (!loopAuthToken) {
      gatewayLog.warn(
        "boot-recovery",
        `Skipping live loop reattach: missing loop token for loopId=${loopId} (phase=live-reattach)`,
      );
      return;
    }
    gatewayLog.info(
      "boot-recovery",
      `Token source for loopId=${loopId}: LOOP_TOKEN_STORE`,
    );

    // TOCTOU guard: process was alive when liveJobs was built, but may have exited since.
    if (!isProcessRunning(pid)) {
      this.finalizeRecoveredJob(loopId, loopAuthToken, effectiveApiBaseUrl, undefined);
      return;
    }

    registerRecoveredLoop(loopId, pid);

    gatewayLog.info(
      "boot-recovery",
      `Reattaching live loop loopId=${loopId} pid=${pid}`,
    );

    let tailer: LiveJobHandle["tailer"] | undefined;
    if (job.jsonlPath) {
      gatewayLog.info(
        "boot-recovery",
        `Starting output tailer for loopId=${loopId} jsonlPath=${job.jsonlPath} offset=${job.lastObservedJsonlOffset ?? 0} api=${effectiveApiBaseUrl}`,
      );
      // `onOffset` is replay-safe (framed + delivered when a POST is required); see output-tailer.
      tailer = startOutputTailer(
        job.jsonlPath,
        effectiveApiBaseUrl,
        loopId,
        loopAuthToken,
        job.lastObservedJsonlOffset ?? 0,
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
        `Cannot start output tailer for loopId=${loopId}: no jsonlPath (claudeWorkDir=${job.claudeWorkDir ?? "none"})`,
      );
    }

    const watcherPollMs =
      Number(process.env.CLOSEDLOOP_WATCHER_POLL_MS) || DEFAULT_WATCHER_POLL_MS;
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
    }, watcherPollMs);

    this.liveHandles.push({ loopId, tailer, watcherId });
  }

  private finalizeRecoveredJob(
    loopId: string,
    loopAuthToken: string,
    apiBaseUrl: string,
    tailer: LiveJobHandle["tailer"] | undefined,
  ): void {
    const { jobStore, telemetry, loopTokenStore } = this.deps;

    const run = async () => {
      if (this.disposed) {
        return;
      }
      if (tailer) {
        try {
          await tailer.flush();
        } catch {
          // best effort
        }
      }
      if (this.disposed) {
        return;
      }

      const job = jobStore.getByLoopId(loopId);
      if (!job) {
        gatewayLog.warn("boot-recovery", `loopId=${loopId} missing from JobStore`);
        return;
      }

      const finalizerDeps: LoopFinalizerDeps = {
        jobStore,
        telemetry,
        apiAuthToken: loopAuthToken,
        apiBaseUrl,
        isProcessRunning,
        loopTokenStore,
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

    void this.trackBackgroundTask(run()).catch(() => {});
  }

  dispose(): void {
    this.disposed = true;
    for (const handle of this.liveHandles) {
      clearInterval(handle.watcherId);
      handle.tailer?.stop();
    }
    this.liveHandles = [];
  }

  private trackBackgroundTask(task: Promise<void>): Promise<void> {
    this.backgroundTasks.add(task);
    void task.finally(() => {
      this.backgroundTasks.delete(task);
    });
    return task;
  }
}
