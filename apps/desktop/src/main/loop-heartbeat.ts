import { postLoopHeartbeat } from "../server/operations/loop-http.js";
import { gatewayLog } from "./gateway-logger.js";
import type { LoopSchedulerDeps } from "./loop-lifecycle.js";
import {
  isEndpointDisabled,
  markEndpointDisabled,
} from "./loop-404-gate.js";

// ---------------------------------------------------------------------------
// Default heartbeat interval: 30 minutes in milliseconds
// ---------------------------------------------------------------------------

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000;

export function getHeartbeatIntervalMs(): number {
  const override = process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS;
  if (override !== undefined) {
    const parsed = parseInt(override, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return DEFAULT_HEARTBEAT_INTERVAL_MS;
}

// ---------------------------------------------------------------------------
// Subset of LoopSchedulerDeps the heartbeat needs.
// ---------------------------------------------------------------------------

export type HeartbeatDeps = Pick<LoopSchedulerDeps, "apiBaseUrl" | "getToken">;

// ---------------------------------------------------------------------------
// Shared tick logic (exported so LoopSchedulerContext can reuse it)
// ---------------------------------------------------------------------------

/**
 * Runs one heartbeat tick. `stopFn` is called when the endpoint returns 404
 * so the caller can cancel whichever timer handle owns this loop — either the
 * module-level scheduler or an instance-scoped LoopSchedulerContext.
 */
export async function runHeartbeatTick(
  loopId: string,
  deps: HeartbeatDeps,
  stopFn: () => void,
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

  if (result.kind === "auth") {
    gatewayLog.warn(
      "loop-heartbeat",
      `Skipping heartbeat for loopId=${loopId}: no token available`,
    );
    return;
  }

  if (result.kind === "http" && result.status === 404) {
    gatewayLog.warn(
      "loop-heartbeat",
      `Heartbeat endpoint returned 404 for loopId=${loopId}; disabling endpoint and stopping scheduler`,
    );
    markEndpointDisabled(apiBaseUrl, heartbeatPath);
    stopFn();
    return;
  }

  if (result.kind === "http") {
    gatewayLog.warn(
      "loop-heartbeat",
      `Heartbeat for loopId=${loopId} returned HTTP ${result.status}`,
    );
    return;
  }

  // network / timeout
  gatewayLog.error(
    "loop-heartbeat",
    `Heartbeat for loopId=${loopId} failed: ${result.error}`,
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
 */
export function sendHeartbeatNow(loopId: string, deps: HeartbeatDeps): void {
  void runHeartbeatTick(loopId, deps, () => {});
}
