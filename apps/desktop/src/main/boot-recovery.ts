/**
 * BootRecoveryService: re-attach to Symphony loop processes that were alive
 * (or died) while the Electron app was not running.
 *
 * Two recovery paths:
 *   1. Dead-job finalization  — for jobs whose processes died while the app
 *      was down. reconcileJobStore() already moved these to terminal status;
 *      this service calls finalizeLoopFromRuntime on each one that hasn't been
 *      fully finalized yet (idempotency timestamps gate each step).
 *
 *   2. Live-job re-attachment — for jobs whose processes are still running.
 *      Re-starts the output tailer so live activity continues streaming to the
 *      API, registers the loop for cancellation, then starts a poll-based exit
 *      watcher. When the process dies the watcher flushes the tailer and calls
 *      finalizeLoopFromRuntime("boot-recovery").
 *
 * Auth: uses ApiKeyStore.getApiKey() — the same credential the cloud relay
 * authenticates with — rather than persisting per-loop tokens to disk.
 */

import { existsSync } from "node:fs";
import { finalizeLoopFromRuntime, type LoopFinalizerDeps } from "./loop-finalizer.js";
import { gatewayLog } from "./gateway-logger.js";
import type { JobStore, LocalJob } from "./job-store.js";
import type { TelemetryEmitter } from "./telemetry-protocol.js";
import { startOutputTailer } from "../server/operations/output-tailer.js";
import {
  registerRecoveredLoop,
  unregisterLoop,
} from "../server/operations/symphony-loop.js";
import { assertPathAllowed } from "../server/security.js";
import { isProcessRunning } from "../server/operations/symphony-utils.js";

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface BootRecoveryDeps {
  jobStore: JobStore;
  telemetry: TelemetryEmitter;
  getApiKey: () => string | null;
  getApiOrigin: () => string;
}

// ---------------------------------------------------------------------------
// Internal watcher state
// ---------------------------------------------------------------------------

interface LiveJobHandle {
  loopId: string;
  tailer: { stop: () => void; flush: () => Promise<void> };
  watcherId: ReturnType<typeof setInterval>;
}

// ---------------------------------------------------------------------------
// Watcher poll interval (ms)
// ---------------------------------------------------------------------------

const WATCHER_POLL_MS = 3000;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class BootRecoveryService {
  private readonly deps: BootRecoveryDeps;
  private liveHandles: LiveJobHandle[] = [];
  private disposed = false;

  constructor(deps: BootRecoveryDeps) {
    this.deps = deps;
  }

  /**
   * Run all boot-recovery steps. Call once from app.boot() after
   * reconcileJobStore() has resolved dead-job statuses.
   *
   * @param deadJobs  Jobs returned by reconcileJobStore() — processes that
   *                  died while the app was down, now in terminal status.
   */
  async run(deadJobs: LocalJob[]): Promise<void> {
    if (this.disposed) return;

    const { jobStore, telemetry, getApiKey, getApiOrigin } = this.deps;
    const apiKey = getApiKey();
    const apiBaseUrl = getApiOrigin();

    // ------------------------------------------------------------------
    // Path 1: finalize dead jobs
    // ------------------------------------------------------------------
    const unfinalizedDead = deadJobs.filter((j) => !j.finalStatusPersistedAt);

    if (unfinalizedDead.length > 0 && (!apiKey || !apiBaseUrl)) {
      gatewayLog.warn(
        "boot-recovery",
        `Skipping finalization of ${unfinalizedDead.length} dead job(s) — API key or origin not configured`,
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
      for (const job of unfinalizedDead) {
        try {
          await finalizeLoopFromRuntime(job, "boot-recovery", finalizerDeps);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          gatewayLog.warn(
            "boot-recovery",
            `Failed to finalize loopId=${job.loopId}: ${msg}`,
          );
        }
      }
    }

    // ------------------------------------------------------------------
    // Path 2: re-attach to live jobs
    // ------------------------------------------------------------------
    const liveJobs = jobStore
      .listRunning()
      .filter((j) => j.pid != null && isProcessRunning(j.pid));

    if (liveJobs.length === 0) return;

    if (!apiKey || !apiBaseUrl) {
      gatewayLog.warn(
        "boot-recovery",
        `Skipping re-attachment of ${liveJobs.length} live job(s) — API key or origin not configured`,
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

    const effectiveApiBase = job.apiBaseUrl ?? apiBaseUrl;

    // Register for cancellation so the kill endpoint can reach this process.
    registerRecoveredLoop(loopId, pid);

    // Guard: re-check liveness before starting watcher (process may have
    // died in the window between listRunning() and now).
    if (!isProcessRunning(pid)) {
      unregisterLoop(loopId);
      this.finalizeRecoveredJob(loopId, apiKey, effectiveApiBase, undefined);
      return;
    }

    // Start output tailer if we have a jsonl file to tail.
    let tailer: LiveJobHandle["tailer"] | undefined;
    if (job.jsonlPath && existsSync(job.jsonlPath)) {
      tailer = startOutputTailer(
        job.jsonlPath,
        effectiveApiBase,
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

    // Poll for process exit.
    const watcherId = setInterval(() => {
      if (this.disposed) {
        clearInterval(watcherId);
        return;
      }
      if (!isProcessRunning(pid)) {
        clearInterval(watcherId);
        this.liveHandles = this.liveHandles.filter((h) => h.loopId !== loopId);
        unregisterLoop(loopId);
        this.finalizeRecoveredJob(loopId, apiKey, effectiveApiBase, tailer);
      }
    }, WATCHER_POLL_MS);

    if (tailer) {
      this.liveHandles.push({ loopId, tailer, watcherId });
    }

    gatewayLog.info(
      "boot-recovery",
      `Re-attached to live loopId=${loopId} pid=${pid}` +
        (job.jsonlPath ? " (tailer started)" : " (no jsonlPath — tailer skipped)"),
    );
  }

  private finalizeRecoveredJob(
    loopId: string,
    apiKey: string,
    apiBaseUrl: string,
    tailer: LiveJobHandle["tailer"] | undefined,
  ): void {
    const { jobStore, telemetry } = this.deps;

    const finalize = async () => {
      if (tailer) {
        try {
          await tailer.flush();
        } catch {
          // Best effort — don't block finalization
        }
      }

      const job = jobStore.getByLoopId(loopId);
      if (!job) {
        gatewayLog.warn(
          "boot-recovery",
          `Exit watcher fired for loopId=${loopId} but job not found in store`,
        );
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
        const msg = err instanceof Error ? err.message : String(err);
        gatewayLog.warn(
          "boot-recovery",
          `Finalization after exit failed for loopId=${loopId}: ${msg}`,
        );
      }
    };

    finalize().catch(() => {});
  }

  /** Stop all active watchers and tailers. Call from app shutdown. */
  dispose(): void {
    this.disposed = true;
    for (const handle of this.liveHandles) {
      clearInterval(handle.watcherId);
      handle.tailer.stop();
    }
    this.liveHandles = [];
  }
}
