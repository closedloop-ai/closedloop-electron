import {
  getCloudLoopStatus,
  persistRevivalToken,
  postLoopHeartbeat,
  type CloudLoopStatus,
  type LoopHttpResult,
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
import type { DesktopPopSigner } from "./desktop-pop.js";
import type { DesktopPopUnavailableReporter } from "./desktop-pop-sign-utils.js";
import type { LoopTokenStore } from "./loop-token-store.js";
import {
  finalizeLoopFromRuntime,
  makeHeartbeatFinalizeFn,
  type LoopFinalizerDeps,
} from "./loop-finalizer.js";
import type { TelemetryEmitter } from "./telemetry-protocol.js";
import { LoopSchedulerContext } from "./loop-scheduler-context.js";
import {
  classifyLoopStatus,
  type ClassifierProvenanceContext,
  type TerminalReason,
} from "./loop-status-classifier.js";

export interface BootRecoveryDeps {
  jobStore: JobStore;
  telemetry: TelemetryEmitter;
  getApiKey: () => string | null;
  getApiOrigin: () => string;
  getAllowedDirectories?: () => string[];
  loopTokenStore: LoopTokenStore;
  /** Instance-scoped scheduler context. Defaults to a new LoopSchedulerContext when omitted. */
  schedulers?: LoopSchedulerContext;
  /**
   * Optional PoP signing deps for heartbeat revival authentication (AC-005).
   * When present, threaded into startHeartbeat and registerSleep so boot-recovered
   * loops attach X-Desktop-* PoP headers and use the managed-key Authorization
   * fallback when the runner JWT is unavailable.
   */
  getApiKeyProvenance?: () => import("./api-key-store.js").ApiKeyProvenance | null;
  signDesktopRequest?: DesktopPopSigner;
  onDesktopPopUnavailable?: DesktopPopUnavailableReporter;
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
        // timed_out was already persisted as terminal (TIMED_OUT) inside
        // reconcileCloudLoopStatus, so skip the UNKNOWN finalization below.
        // Every other reconcile outcome — including a cloud-reported "active"
        // status — still finalizes here: the local runner PID is already dead,
        // so the loop must be finalized as UNKNOWN regardless of what the cloud
        // believes (see the AC-007 regression test).
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

  /**
   * Builds a ClassifierProvenanceContext from the current deps.
   * Returns undefined when provenance deps are absent, which preserves
   * the existing 401-is-always-terminal behavior.
   */
  private buildProvenanceContext(): ClassifierProvenanceContext | undefined {
    const { getApiKeyProvenance, signDesktopRequest } = this.deps;
    if (!getApiKeyProvenance) return undefined;
    const provenance = getApiKeyProvenance();
    if (!provenance) return undefined;
    return {
      provenance,
      popAvailable: signDesktopRequest != null,
    };
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
    // Pass provenance context so DESKTOP_MANAGED loops with PoP can attempt
    // revival before being classified terminal (PLN-757).
    const provenanceCtx = this.buildProvenanceContext();
    const disposition = classifyLoopStatus(
      cloudStatusToHttp(result),
      result.kind,
      provenanceCtx,
    );

    // PLN-757: For DESKTOP_MANAGED loops, attempt PoP heartbeat revival before
    // giving up. The managed-key PoP heartbeat can revive a loop whose runner
    // JWT was rejected (401) — classifyLoopStatus only returns pop_fallback for
    // the 401 case — returning a fresh runner JWT, the boot-path analog of
    // PLN-740's live revival. (timed_out is classified terminal first and never
    // reaches this path.)
    if (disposition.kind === "pop_fallback") {
      const popResult = await this.attemptPopHeartbeatRevival(job, apiBaseUrl);

      if (popResult?.success) {
        // PoP heartbeat succeeded — the loop is alive. Return "active" so the
        // caller (reattachLiveJob or finalizeDeadJobs) treats it as live.
        return { kind: "active" };
      }

      if (popResult && !popResult.success) {
        // PoP heartbeat returned an error. Re-classify to determine the reason.
        const heartbeatHttpStatus = popResult.kind === "http" ? popResult.status : null;
        const heartbeatDisposition = classifyLoopStatus(heartbeatHttpStatus, null);

        if (heartbeatDisposition.kind === "terminal") {
          this.finalizeAsTerminal(job, heartbeatDisposition.reason);
          return result;
        }
        // Transient PoP error — fall through to finalize as unauthorized since
        // we already exhausted the JWT-only path and the PoP path was inconclusive.
      }

      // The PoP heartbeat returned a transient/inconclusive error — finalize as
      // unauthorized terminal (the JWT path already failed and the PoP path
      // could not confirm liveness). popResult is non-null here: pop_fallback is
      // only dispatched when signDesktopRequest is present, so
      // attemptPopHeartbeatRevival cannot have returned null.
      this.finalizeAsTerminal(job, "unauthorized");
      return result;
    }

    if (disposition.kind === "terminal") {
      this.finalizeAsTerminal(job, disposition.reason);
    }
    return result;
  }

  /**
   * Attempts a PoP heartbeat revival for a DESKTOP_MANAGED loop.
   * On success, persists the revival token to the loop token store (AC-003).
   * Returns the LoopHttpResult, or null if PoP deps are missing.
   */
  private async attemptPopHeartbeatRevival(
    job: LocalJob,
    apiBaseUrl: string,
  ): Promise<LoopHttpResult | null> {
    const {
      getApiKey,
      getApiKeyProvenance,
      signDesktopRequest,
      onDesktopPopUnavailable,
      loopTokenStore,
    } = this.deps;

    // getApiKey is a required, always-present BootRecoveryDeps field; only the
    // optional signDesktopRequest gates PoP revival.
    if (!signDesktopRequest) return null;

    gatewayLog.info(
      "boot-recovery",
      `Attempting PoP heartbeat revival for loopId=${job.loopId}`,
    );

    const popResult = await postLoopHeartbeat(
      apiBaseUrl,
      job.loopId,
      {
        getToken: () => loopTokenStore.getLoopTokenString(job.loopId),
        // Supply getTokenMeta so a stale/rejected JWT is detected via expiresAt
        // and the auth ladder reaches the managed-key fallback (matching the
        // live path at boot-recovery.ts getTokenMeta usage).
        getTokenMeta: () => loopTokenStore.getLoopToken(job.loopId),
        getApiKey,
        getApiKeyProvenance,
        signDesktopRequest,
        onDesktopPopUnavailable,
      },
    );

    // T-2.2: Persist the revival token if the heartbeat revived the loop.
    // Shared with the live heartbeat path via persistRevivalToken (SSOT).
    if (persistRevivalToken(loopTokenStore, job.loopId, popResult)) {
      gatewayLog.info(
        "boot-recovery",
        `PoP heartbeat revived loopId=${job.loopId}; adopting new runner token`,
      );
    }

    return popResult;
  }

  /**
   * Shared terminal finalization logic extracted from reconcileCloudLoopStatus.
   * Persists the terminal status and deletes the loop token.
   */
  private finalizeAsTerminal(job: LocalJob, reason: TerminalReason): void {
    const current = this.deps.jobStore.getByLoopId(job.loopId) ?? job;
    const now = new Date().toISOString();
    // timed_out persists an explicit TIMED_OUT with its own message; every
    // other terminal reason (unauthorized/404/410) finalizes as UNKNOWN.
    const finalized =
      reason === "timed_out"
        ? {
            status: "TIMED_OUT" as const,
            liveActivity: "Loop timed out — restart from the loop list.",
          }
        : {
            status: "UNKNOWN" as const,
            liveActivity: `Boot recovery: loop terminated server-side (${terminalReasonMessage(reason)})`,
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
    // Do NOT pass provenance context here: reconcileCloudLoopStatus already
    // consumed the PoP fallback opportunity (T-2.4). If it revived the loop,
    // the result is "active" (live). If it failed, it already finalized as
    // terminal. Passing provenance again would re-trigger pop_fallback on the
    // same unauthorized result that reconcile already handled.
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
      loopTokenStore: this.deps.loopTokenStore,
      // Thread PoP fields for heartbeat revival auth (AC-005).
      getApiKey: this.deps.getApiKey,
      getApiKeyProvenance: this.deps.getApiKeyProvenance,
      signDesktopRequest: this.deps.signDesktopRequest,
      onDesktopPopUnavailable: this.deps.onDesktopPopUnavailable,
      // Supply getTokenMeta for proactive JWT-expiry detection (T-1.4 / AC-011).
      getTokenMeta: () => this.deps.loopTokenStore.getLoopToken(loopId),
      jobStore: this.deps.jobStore,
      // Pass the process liveness checker for T-1.5 process-alive guard.
      isProcessRunning,
      // Canonical telemetry so the process-alive suppression event is observable.
      telemetry: this.deps.telemetry,
      finalizeFn: makeHeartbeatFinalizeFn(
        {
          jobStore: this.deps.jobStore,
          telemetry: this.deps.telemetry,
          getToken,
          apiBaseUrl: effectiveApiBaseUrl,
          isProcessRunning,
          getAllowedDirectories: this.deps.getAllowedDirectories ?? (() => []),
          loopTokenStore: this.deps.loopTokenStore,
          cleanupAdditionalWorktrees: cleanupAdditionalWorktreesWithDefaultProvider,
          schedulers: this.schedulers,
        },
        "boot-recovery",
      ),
    });

    this.schedulers.registerSleep(loopId, {
      apiBaseUrl: effectiveApiBaseUrl,
      getToken,
      loopTokenStore: this.deps.loopTokenStore,
      // Thread PoP deps into registerSleep so the sleep-recovery heartbeat on
      // system wake fires with PoP headers (SEC-002 / AC-005).
      getApiKey: this.deps.getApiKey,
      getApiKeyProvenance: this.deps.getApiKeyProvenance,
      signDesktopRequest: this.deps.signDesktopRequest,
      onDesktopPopUnavailable: this.deps.onDesktopPopUnavailable,
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
