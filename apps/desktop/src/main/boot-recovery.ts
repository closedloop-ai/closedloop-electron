import {
  getCloudLoopStatus,
  type CloudLoopStatus,
} from "../server/operations/loop-http.js";
import { startOutputTailer } from "../server/operations/output-tailer.js";
import { refreshLoopTokenSingleflight } from "./loop-refresh.js";
import {
  cleanupAdditionalWorktreesWithDefaultProvider,
  registerRecoveredLoop,
  unregisterLoop,
} from "../server/operations/symphony-loop.js";
import { isProcessRunning } from "../server/operations/symphony-utils.js";
import { gatewayLog } from "./gateway-logger.js";
import { isTerminalJobStatus, type JobStore, type LocalJob } from "./job-store.js";
import type { LoopTokenStore } from "./loop-token-store.js";
import {
  finalizeLoopFromRuntime,
  makeHeartbeatFinalizeFn,
  type LoopFinalizerDeps,
} from "./loop-finalizer.js";
import type { TelemetryEmitter } from "./telemetry-protocol.js";
import { LoopSchedulerContext } from "./loop-scheduler-context.js";
import { classifyLoopStatus, type TerminalReason } from "./loop-status-classifier.js";

export interface BootRecoveryDeps {
  jobStore: JobStore;
  telemetry: TelemetryEmitter;
  getApiKey: () => string | null;
  getApiOrigin: () => string;
  getAllowedDirectories?: () => string[];
  loopTokenStore: LoopTokenStore;
  /** Instance-scoped scheduler context. Defaults to a new LoopSchedulerContext when omitted. */
  schedulers?: LoopSchedulerContext;
}

interface LiveJobHandle {
  loopId: string;
  tailer?: { stop: () => void; flush: () => Promise<void> };
  watcherId: ReturnType<typeof setInterval>;
}

const DEFAULT_WATCHER_POLL_MS = 3000;
const MAX_RECOVERY_ATTEMPTS = 3;

/**
 * Maps a `CloudLoopStatus` union onto the HTTP status input expected by
 * {@link classifyLoopStatus}: 401 for `unauthorized`, the carried status for
 * `error`, and null otherwise (the classifier reads the `kind` string for the
 * timed_out/active cases).
 */
function cloudStatusToHttp(result: CloudLoopStatus): number | null {
  if (result.kind === "unauthorized") return 401;
  if (result.kind === "error") return result.status ?? null;
  return null;
}

/** Human-readable fragment for the UNKNOWN finalization message. */
function terminalReasonMessage(reason: TerminalReason): string {
  switch (reason) {
    case "unauthorized":
      return "unauthorized after token refresh";
    case "not_found":
      return "HTTP 404";
    case "gone":
      return "HTTP 410";
    case "timed_out":
      return "timed out";
  }
}

export class BootRecoveryService implements Disposable {
  private readonly deps: BootRecoveryDeps;
  private readonly schedulers: LoopSchedulerContext;
  private liveHandles: LiveJobHandle[] = [];
  private readonly backgroundTasks = new Set<Promise<void>>();
  private deadJobFinalizationTask: Promise<void> | null = null;
  // Prevents new recovery work and stops background watchers after shutdown begins.
  private disposed = false;

  constructor(deps: BootRecoveryDeps) {
    this.deps = deps;
    this.schedulers = deps.schedulers ?? new LoopSchedulerContext();
  }

  async run(deadJobs: LocalJob[]): Promise<void> {
    if (this.disposed) return;
    await this.finalizeDeadJobs(deadJobs);
    await this.reattachLiveJobs();
    this.sweepOrphanedTokens();
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

    const {
      jobStore,
      telemetry,
      getApiKey,
      getApiOrigin,
      loopTokenStore,
    } = this.deps;
    const getAllowedDirectories = this.deps.getAllowedDirectories ?? (() => []);
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
        if (!loopTokenStore.getLoopToken(job.loopId)) {
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
        const reconcileResult = await this.reconcileCloudLoopStatus(job, apiBaseUrl);
        if (reconcileResult.kind === "timed_out") {
          continue;
        }
        jobStore.upsert({
          ...job,
          recoveryAttempts: attempts + 1,
          finalizationSource: "boot-recovery",
          liveActivity: "Boot recovery replaying finalization after restart",
          updatedAt: new Date().toISOString(),
        });
        const outcome = await finalizeLoopFromRuntime(job, "boot-recovery", {
          jobStore,
          telemetry,
          getToken: () => loopTokenStore.getLoopTokenString(job.loopId),
          apiBaseUrl,
          isProcessRunning,
          getAllowedDirectories,
          loopTokenStore,
          cleanupAdditionalWorktrees: cleanupAdditionalWorktreesWithDefaultProvider,
          schedulers: this.schedulers,
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

  private async reconcileCloudLoopStatus(
    job: LocalJob,
    apiBaseUrl: string,
  ): Promise<CloudLoopStatus> {
    const { loopTokenStore } = this.deps;
    const getToken = () => loopTokenStore.getLoopTokenString(job.loopId);

    let result = await getCloudLoopStatus(apiBaseUrl, job.loopId, getToken);

    // On 401, refresh the loop token exactly once (singleflight-coalesced) and
    // retry. getToken closes over the store, so the retry picks up the new
    // token automatically once the refresh has written it.
    if (result.kind === "unauthorized") {
      const refresh = await refreshLoopTokenSingleflight(
        job.loopId,
        apiBaseUrl,
        getToken,
        loopTokenStore,
      );
      if (refresh.success) {
        result = await getCloudLoopStatus(apiBaseUrl, job.loopId, getToken);
      }
    }

    // Determine if the result is terminal via the shared classifier (SSOT), so
    // this path interprets 401/404/410/timed_out identically to reattachLiveJob
    // below. Map the CloudLoopStatus union onto the classifier's HTTP input.
    const disposition = classifyLoopStatus(
      cloudStatusToHttp(result),
      result.kind,
    );

    if (disposition.kind === "terminal") {
      const current = this.deps.jobStore.getByLoopId(job.loopId) ?? job;
      const now = new Date().toISOString();
      // timed_out persists an explicit TIMED_OUT with its own message; every
      // other terminal reason (unauthorized/404/410) finalizes as UNKNOWN.
      const finalized =
        disposition.reason === "timed_out"
          ? {
              status: "TIMED_OUT" as const,
              liveActivity: "Loop timed out — restart from the loop list.",
            }
          : {
              status: "UNKNOWN" as const,
              liveActivity: `Boot recovery: loop terminated server-side (${terminalReasonMessage(disposition.reason)})`,
            };
      this.deps.jobStore.upsert({
        ...current,
        ...finalized,
        completedAt: now,
        updatedAt: now,
        cloudFinalizedAt: now,
      });
      this.deps.loopTokenStore.deleteLoopToken(job.loopId);
    }
    return result;
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
      this.finalizeRecoveredJob(loopId, () => this.deps.loopTokenStore.getLoopTokenString(loopId), effectiveApiBaseUrl, undefined);
      return;
    }

    const reconcileResult = await this.reconcileCloudLoopStatus(job, effectiveApiBaseUrl);
    const disposition = classifyLoopStatus(
      cloudStatusToHttp(reconcileResult),
      reconcileResult.kind,
    );

    if (disposition.kind === "terminal") {
      // reconcileCloudLoopStatus already persisted the terminal status,
      // set cloudFinalizedAt, and deleted the loop token for all terminal
      // cases (timed_out, unauthorized, 404, 410). Tear down schedulers
      // and skip reattach.
      this.schedulers.teardownLoop(loopId);
      gatewayLog.warn(
        "boot-recovery",
        `Skipping live reattach for loopId=${loopId}: terminal disposition (${disposition.reason})`,
      );
      return;
    }

    if (disposition.kind === "transient") {
      // Transient error (5xx or network): cloud might come back.
      // Do a conservative reattach; the next heartbeat cycle will re-classify.
      gatewayLog.warn(
        "boot-recovery",
        `Transient error during reconcile for loopId=${loopId} (${disposition.reason}): reattaching conservatively`,
      );
    }

    registerRecoveredLoop(loopId, pid);
    const latest = jobStore.getByLoopId(loopId);
    if (latest) {
      jobStore.upsert({
        ...latest,
        liveActivity: "Boot recovery reattached after desktop restart",
        updatedAt: new Date().toISOString(),
      });
    }

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
        () => this.deps.loopTokenStore.getLoopTokenString(loopId),
        job.lastObservedJsonlOffset ?? 0,
        (offset) => {
          const current = jobStore.getByLoopId(loopId);
          if (current) {
            jobStore.upsert({ ...current, lastObservedJsonlOffset: offset });
          }
        },
        job.claudeWorkDir,
        this.deps.loopTokenStore,
      );
    } else {
      gatewayLog.warn(
        "boot-recovery",
        `Cannot start output tailer for loopId=${loopId}: no jsonlPath (claudeWorkDir=${job.claudeWorkDir ?? "none"})`,
      );
    }

    const getToken = () => this.deps.loopTokenStore.getLoopTokenString(loopId);

    const loopTokenMeta = this.deps.loopTokenStore.getLoopToken(loopId);
    this.schedulers.startRefresh(loopId, loopTokenMeta?.expiresAt, {
      apiBaseUrl: effectiveApiBaseUrl,
      getToken,
      loopTokenStore: this.deps.loopTokenStore,
    });

    this.schedulers.startHeartbeat(loopId, {
      apiBaseUrl: effectiveApiBaseUrl,
      getToken,
      jobStore: this.deps.jobStore,
      finalizeFn: makeHeartbeatFinalizeFn({
        jobStore: this.deps.jobStore,
        telemetry: this.deps.telemetry,
        getToken,
        apiBaseUrl: effectiveApiBaseUrl,
        isProcessRunning,
        getAllowedDirectories: this.deps.getAllowedDirectories ?? (() => []),
        loopTokenStore: this.deps.loopTokenStore,
        cleanupAdditionalWorktrees: cleanupAdditionalWorktreesWithDefaultProvider,
        schedulers: this.schedulers,
      }),
    });

    this.schedulers.registerSleep(loopId, {
      apiBaseUrl: effectiveApiBaseUrl,
      getToken,
      loopTokenStore: this.deps.loopTokenStore,
    });

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
        this.schedulers.teardownLoop(loopId);
        this.finalizeRecoveredJob(loopId, () => this.deps.loopTokenStore.getLoopTokenString(loopId), effectiveApiBaseUrl, tailer);
      }
    }, watcherPollMs);

    this.liveHandles.push({ loopId, tailer, watcherId });
  }

  private finalizeRecoveredJob(
    loopId: string,
    getToken: () => string | null,
    apiBaseUrl: string,
    tailer: LiveJobHandle["tailer"] | undefined,
  ): void {
    const { jobStore, telemetry, loopTokenStore } = this.deps;
    const getAllowedDirectories = this.deps.getAllowedDirectories ?? (() => []);

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

      jobStore.upsert({
        ...job,
        finalizationSource: "boot-recovery",
        liveActivity: "Boot recovery took ownership of finalization",
        updatedAt: new Date().toISOString(),
      });

      const finalizerDeps: LoopFinalizerDeps = {
        jobStore,
        telemetry,
        getToken,
        apiBaseUrl,
        isProcessRunning,
        getAllowedDirectories,
        loopTokenStore,
        cleanupAdditionalWorktrees: cleanupAdditionalWorktreesWithDefaultProvider,
        schedulers: this.schedulers,
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

  [Symbol.dispose](): void {
    this.disposed = true;
    for (const handle of this.liveHandles) {
      clearInterval(handle.watcherId);
      handle.tailer?.stop();
      this.schedulers.teardownLoop(handle.loopId);
    }
    this.liveHandles = [];
    this.schedulers[Symbol.dispose]();
  }

  private sweepOrphanedTokens(): void {
    const { jobStore, loopTokenStore } = this.deps;
    const tokenLoopIds = loopTokenStore.listLoopIds();
    for (const loopId of tokenLoopIds) {
      const job = jobStore.getByLoopId(loopId);
      if (!job || (isTerminalJobStatus(job.status) && job.cloudFinalizedAt)) {
        loopTokenStore.deleteLoopToken(loopId);
      }
    }
  }

  private trackBackgroundTask(task: Promise<void>): Promise<void> {
    this.backgroundTasks.add(task);
    void task.finally(() => {
      this.backgroundTasks.delete(task);
    });
    return task;
  }
}
