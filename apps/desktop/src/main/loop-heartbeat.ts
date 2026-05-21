import { gatewayLog } from "./gateway-logger.js";
import {
  isEndpointDisabled,
  markEndpointDisabled,
} from "./loop-404-gate.js";

// ---------------------------------------------------------------------------
// Default heartbeat interval: 30 minutes in milliseconds
// ---------------------------------------------------------------------------

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000;

function getHeartbeatIntervalMs(): number {
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
// Per-loop interval handles
// ---------------------------------------------------------------------------

const timers = new Map<string, NodeJS.Timeout>();

// ---------------------------------------------------------------------------
// Internal: tick handler (fire-and-forget)
// ---------------------------------------------------------------------------

async function onTick(
  loopId: string,
  apiBaseUrl: string,
  getToken: () => string | null,
): Promise<void> {
  const heartbeatPath = `/loops/${loopId}/heartbeat`;

  if (isEndpointDisabled(apiBaseUrl, heartbeatPath)) {
    gatewayLog.info(
      "loop-heartbeat",
      `Skipping heartbeat for loopId=${loopId}: endpoint is disabled (prior 404)`,
    );
    return;
  }

  const token = getToken();
  if (token === null) {
    gatewayLog.warn(
      "loop-heartbeat",
      `Skipping heartbeat for loopId=${loopId}: no token available`,
    );
    return;
  }

  const url = `${apiBaseUrl}${heartbeatPath}`;

  try {
    gatewayLog.info(
      "loop-heartbeat",
      `Issuing heartbeat for loopId=${loopId}`,
    );

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (response.status === 404) {
      gatewayLog.warn(
        "loop-heartbeat",
        `Heartbeat endpoint returned 404 for loopId=${loopId}; disabling endpoint and stopping scheduler`,
      );
      markEndpointDisabled(apiBaseUrl, heartbeatPath);
      stop(loopId);
      return;
    }

    if (!response.ok) {
      gatewayLog.warn(
        "loop-heartbeat",
        `Heartbeat for loopId=${loopId} returned HTTP ${response.status}`,
      );
      return;
    }

    gatewayLog.info(
      "loop-heartbeat",
      `Heartbeat succeeded for loopId=${loopId}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    gatewayLog.error(
      "loop-heartbeat",
      `Heartbeat for loopId=${loopId} failed: ${message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sends an immediate heartbeat for the given loop, bypassing the scheduler
 * interval. Uses the same 404-gate and error-handling logic as the scheduled
 * tick. Errors are logged and never thrown (fire-and-forget safe).
 *
 * Intended for callers that need to issue a heartbeat outside the normal
 * schedule — for example, immediately after a system sleep/wake resume.
 */
export function sendHeartbeatNow(
  loopId: string,
  apiBaseUrl: string,
  getToken: () => string | null,
): void {
  void onTick(loopId, apiBaseUrl, getToken);
}

/**
 * Starts the per-loop heartbeat scheduler for the given loop.
 *
 * Issues a POST to `/loops/:id/heartbeat` on the configured interval (default
 * 30 minutes, overridable via CLOSEDLOOP_HEARTBEAT_INTERVAL_MS). Errors are
 * logged and never thrown. A 404 response disables the endpoint for the
 * lifetime of the process and stops the scheduler for that loop.
 *
 * Calling `start` for a loop that already has an active timer replaces the
 * existing schedule.
 */
export function start(
  loopId: string,
  apiBaseUrl: string,
  getToken: () => string | null,
): void {
  const interval = getHeartbeatIntervalMs();

  gatewayLog.info(
    "loop-heartbeat",
    `Starting heartbeat scheduler for loopId=${loopId} (interval=${interval}ms)`,
  );

  // Cancel any existing timer for this loop before replacing it.
  const existing = timers.get(loopId);
  if (existing !== undefined) {
    clearInterval(existing);
  }

  const handle = setInterval(() => {
    void onTick(loopId, apiBaseUrl, getToken);
  }, interval);

  timers.set(loopId, handle);
}

/**
 * Cancels the heartbeat scheduler for the given loop.
 * A no-op if the loop has no active timer.
 */
export function stop(loopId: string): void {
  const handle = timers.get(loopId);
  if (handle === undefined) {
    return;
  }
  clearInterval(handle);
  timers.delete(loopId);
  gatewayLog.info(
    "loop-heartbeat",
    `Stopped heartbeat scheduler for loopId=${loopId}`,
  );
}

/**
 * Cancels all active heartbeat schedulers.
 * Called during app shutdown to prevent timers from firing after teardown.
 */
export function stopAll(): void {
  for (const [loopId, handle] of timers) {
    clearInterval(handle);
    gatewayLog.info(
      "loop-heartbeat",
      `Stopped heartbeat scheduler for loopId=${loopId} (stopAll)`,
    );
  }
  timers.clear();
}
