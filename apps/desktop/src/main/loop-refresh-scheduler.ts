import { gatewayLog } from "./gateway-logger.js";
import type { LoopSchedulerDeps } from "./loop-lifecycle.js";
import { refreshLoopToken } from "./loop-refresh.js";

// ---------------------------------------------------------------------------
// Default refresh skew: 30 minutes in milliseconds
// ---------------------------------------------------------------------------

const DEFAULT_REFRESH_SKEW_MS = 30 * 60 * 1000;

function getRefreshSkewMs(): number {
  const override = process.env.CLOSEDLOOP_TOKEN_REFRESH_SKEW_MS;
  if (override !== undefined) {
    const parsed = parseInt(override, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return DEFAULT_REFRESH_SKEW_MS;
}

// ---------------------------------------------------------------------------
// Per-loop timeout handles
// ---------------------------------------------------------------------------

const timers = new Map<string, NodeJS.Timeout>();

// ---------------------------------------------------------------------------
// Internal: schedule a single tick for the given loop
// ---------------------------------------------------------------------------

function scheduleNextTick(
  loopId: string,
  expiresAt: number,
  deps: LoopSchedulerDeps,
): void {
  const skew = getRefreshSkewMs();
  const delay = Math.max(expiresAt - skew - Date.now(), 0);

  gatewayLog.info(
    "refresh-scheduler",
    `Scheduling proactive refresh for loopId=${loopId} in ${delay}ms (expiresAt=${expiresAt} skew=${skew}ms)`,
  );

  // Clear any existing timer for this loop before scheduling a new one.
  const existing = timers.get(loopId);
  if (existing !== undefined) {
    clearTimeout(existing);
  }

  const handle = setTimeout(() => {
    void onTick(loopId, deps);
  }, delay);

  timers.set(loopId, handle);
}

// ---------------------------------------------------------------------------
// Internal: tick handler
// ---------------------------------------------------------------------------

async function onTick(
  loopId: string,
  deps: LoopSchedulerDeps,
): Promise<void> {
  // Remove the timer handle — it has already fired.
  timers.delete(loopId);

  gatewayLog.info(
    "refresh-scheduler",
    `Proactive refresh tick for loopId=${loopId}`,
  );

  const result = await refreshLoopToken(
    loopId,
    deps.apiBaseUrl,
    deps.getToken,
    deps.loopTokenStore,
  );

  if (!result.success) {
    gatewayLog.warn(
      "refresh-scheduler",
      `Proactive refresh failed for loopId=${loopId}: ${result.error}; not rescheduling`,
    );
    return;
  }

  const { expiresAt } = result.meta;

  if (expiresAt === undefined) {
    // New token is opaque — cannot compute the next refresh time.
    gatewayLog.info(
      "refresh-scheduler",
      `Refresh succeeded for loopId=${loopId} but new token has no expiresAt; not rescheduling`,
    );
    return;
  }

  // Reschedule with the freshly issued token's expiry.
  scheduleNextTick(loopId, expiresAt, deps);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Starts the proactive refresh scheduler for the given loop.
 *
 * If `expiresAt` is undefined (opaque token without a known expiry), proactive
 * scheduling is skipped entirely — the 401-driven refresh path will handle
 * token renewal when the request fails.
 *
 * Calling `start` for a loop that already has a timer replaces the existing
 * schedule.
 */
export function start(
  loopId: string,
  expiresAt: number | undefined,
  deps: LoopSchedulerDeps,
): void {
  if (expiresAt === undefined) {
    gatewayLog.info(
      "refresh-scheduler",
      `Skipping proactive scheduling for loopId=${loopId}: expiresAt unknown (opaque token)`,
    );
    return;
  }

  scheduleNextTick(loopId, expiresAt, deps);
}

/**
 * Cancels the proactive refresh schedule for the given loop.
 * A no-op if the loop has no active timer.
 */
export function stop(loopId: string): void {
  const handle = timers.get(loopId);
  if (handle === undefined) {
    return;
  }
  clearTimeout(handle);
  timers.delete(loopId);
  gatewayLog.info(
    "refresh-scheduler",
    `Stopped proactive refresh scheduler for loopId=${loopId}`,
  );
}

/**
 * Cancels all active proactive refresh schedules.
 * Called during app shutdown to prevent timers from firing after teardown.
 */
export function stopAll(): void {
  for (const [loopId, handle] of timers) {
    clearTimeout(handle);
    gatewayLog.info(
      "refresh-scheduler",
      `Stopped proactive refresh scheduler for loopId=${loopId} (stopAll)`,
    );
  }
  timers.clear();
}
