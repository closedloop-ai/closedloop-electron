import { postLoopHeartbeat } from "../server/operations/loop-http.js";
import { gatewayLog } from "./gateway-logger.js";
import { parseEnvMs, type LoopSchedulerDeps } from "./loop-lifecycle.js";
import {
  isEndpointDisabled,
  markEndpointDisabled,
} from "./loop-404-gate.js";
import type { JobStore, LocalJob } from "./job-store.js";
import { classifyLoopStatus } from "./loop-status-classifier.js";

// ---------------------------------------------------------------------------
// Default heartbeat interval: 30 minutes in milliseconds
// ---------------------------------------------------------------------------

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000;

export const getHeartbeatIntervalMs = (): number =>
  parseEnvMs("CLOSEDLOOP_HEARTBEAT_INTERVAL_MS", DEFAULT_HEARTBEAT_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Subset of LoopSchedulerDeps the heartbeat needs.
// ---------------------------------------------------------------------------

export type HeartbeatDeps = Pick<LoopSchedulerDeps, "apiBaseUrl" | "getToken"> & {
  /**
   * Reference to the job store for reading the local job record by loopId.
   * Used by the heartbeat tick to look up a job before passing it to
   * `finalizeFn` on a terminal server signal.
   */
  jobStore: JobStore;
  /**
   * Callback invoked to terminalize a local job when the heartbeat receives a
   * terminal server signal (401, 404, 410). Passed as a callback rather than
   * importing `loop-finalizer` directly to avoid a circular import.
   *
   * @param job - The local job record to finalize.
   * @param targetStatus - The terminal status to assign: "TIMED_OUT" for
   *   explicit timed-out signals, "UNKNOWN" for all other terminal signals.
   */
  finalizeFn: (job: LocalJob, targetStatus: "TIMED_OUT" | "UNKNOWN") => Promise<void>;
};

// ---------------------------------------------------------------------------
// Shared tick logic (exported so LoopSchedulerContext can reuse it)
// ---------------------------------------------------------------------------

/**
 * Runs one heartbeat tick. `stopFn` is called when the endpoint returns a
 * terminal signal (404, 401, 410) so the caller can cancel whichever timer
 * handle owns this loop — either the module-level scheduler or an
 * instance-scoped LoopSchedulerContext.
 *
 * On a terminal signal the local job is finalized via `deps.finalizeFn`.
 * Transient signals (5xx, network errors) are logged and not finalized.
 */
export async function runHeartbeatTick(
  loopId: string,
  deps: HeartbeatDeps,
  stopFn: () => void,
  options: { suppressEndpointDisableOn404?: boolean } = {},
): Promise<void> {
  const { apiBaseUrl } = deps;
  const heartbeatPath = `/loops/${loopId}/heartbeat`;

  if (isEndpointDisabled(apiBaseUrl, heartbeatPath)) {
    gatewayLog.info(
      "loop-heartbeat",
      `Skipping heartbeat for loopId=${loopId}: endpoint is disabled (prior 404)`,
    );
    return;
  }

  gatewayLog.info(
    "loop-heartbeat",
    `Issuing heartbeat for loopId=${loopId}`,
  );

  const result = await postLoopHeartbeat(apiBaseUrl, loopId, deps.getToken);

  if (result.success) {
    gatewayLog.info(
      "loop-heartbeat",
      `Heartbeat succeeded for loopId=${loopId}`,
    );
    return;
  }

  // Map the LoopHttpResult to classifier inputs.
  // - "auth" kind means getToken() returned null: treat as HTTP 401 (the
  //   token refresh scheduler runs alongside heartbeat, so a missing token
  //   at this point means the server cleared the loop tokens).
  // - "network" / "timeout" kinds carry no HTTP status (null → transient).
  // - "http" kind carries an explicit HTTP status code.
  let httpStatus: number | null = null;
  if (result.kind === "auth") {
    httpStatus = 401;
  } else if (result.kind === "http") {
    httpStatus = result.status;
  }

  const disposition = classifyLoopStatus(httpStatus, null);

  if (disposition.kind === "transient") {
    if (result.kind === "http") {
      gatewayLog.warn(
        "loop-heartbeat",
        `Heartbeat for loopId=${loopId} returned HTTP ${result.status} (transient); will retry`,
      );
    } else {
      gatewayLog.error(
        "loop-heartbeat",
        `Heartbeat for loopId=${loopId} failed: ${result.error} (transient); will retry`,
      );
    }
    return;
  }

  if (disposition.kind === "terminal") {
    // 404-specific side effect: disable the endpoint so future ticks skip the
    // round trip while finalization completes. Suppressed for callers that do
    // not own finalization (e.g. the one-shot resume heartbeat): the gate is a
    // process-wide latch keyed on (apiBaseUrl, heartbeatPath), so setting it
    // here would short-circuit the real scheduler's next tick before it can
    // finalize the job.
    if (disposition.reason === "not_found" && !options.suppressEndpointDisableOn404) {
      markEndpointDisabled(apiBaseUrl, heartbeatPath);
    }

    const terminalStatus: "TIMED_OUT" | "UNKNOWN" =
      disposition.reason === "timed_out" ? "TIMED_OUT" : "UNKNOWN";

    gatewayLog.warn(
      "loop-heartbeat",
      `Heartbeat for loopId=${loopId} received terminal signal (${disposition.reason}); finalizing job as ${terminalStatus}`,
    );

    const job = deps.jobStore.getByLoopId(loopId);
    if (job !== undefined) {
      await deps.finalizeFn(job, terminalStatus);
    } else {
      gatewayLog.warn(
        "loop-heartbeat",
        `Heartbeat terminal signal for loopId=${loopId}: no local job found, skipping finalization`,
      );
    }

    stopFn();
    return;
  }

  // disposition.kind === "live" — unexpected for a non-success result, but
  // log and continue rather than terminalizing.
  gatewayLog.warn(
    "loop-heartbeat",
    `Heartbeat for loopId=${loopId} received non-success result classified as live; continuing`,
  );
}

/**
 * Sends an immediate heartbeat for the given loop, bypassing any scheduled
 * interval. Uses the same 404-gate and error-handling logic as the scheduled
 * tick. Errors are logged and never thrown (fire-and-forget safe).
 *
 * Intended for callers that need to issue a heartbeat outside the normal
 * schedule — for example, immediately after a system sleep/wake resume.
 *
 * No scheduler ownership: this one-shot fetch holds no timer handle and has
 * nothing to dispose. The `stopFn` passed to `runHeartbeatTick` is a no-op
 * because there is no scheduled interval to cancel on a 404.
 *
 * Because this path does not own a job store or finalizer, it must not trip
 * the process-wide 404-gate on a terminal `not_found` signal — doing so would
 * short-circuit the owning heartbeat scheduler's next tick before it can
 * finalize the job. `suppressEndpointDisableOn404` leaves the gate open so the
 * real scheduler can still observe the 404 and finalize.
 */
export function sendHeartbeatNow(loopId: string, deps: HeartbeatDeps): void {
  void runHeartbeatTick(loopId, deps, () => {}, {
    suppressEndpointDisableOn404: true,
  });
}
