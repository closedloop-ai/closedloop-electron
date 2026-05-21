/**
 * Shared lifecycle helpers and types for loop schedulers.
 *
 * Consolidates the repeated stop-refresh + stop-heartbeat + unregister-sleep
 * pattern into a single call site so all teardown paths stay in sync, and
 * provides the canonical dependency interface shared across loop scheduler
 * modules (refresh-scheduler, sleep-recovery).
 */

import type { LoopTokenStore } from "./loop-token-store.js";
import * as loopRefreshScheduler from "./loop-refresh-scheduler.js";
import * as loopHeartbeat from "./loop-heartbeat.js";
import * as loopSleepRecovery from "./loop-sleep-recovery.js";

/**
 * Shared dependency interface for per-loop scheduler modules
 * (refresh-scheduler, sleep-recovery). Both modules need the same three
 * fields, so a single canonical type avoids drift.
 */
export interface LoopSchedulerDeps {
  apiBaseUrl: string;
  getToken: () => string | null;
  loopTokenStore: LoopTokenStore;
}

/**
 * Tears down all per-loop schedulers (refresh, heartbeat, sleep recovery).
 * Safe to call multiple times for the same loopId -- each module is a no-op
 * when the loop has no active timer or registration.
 */
export function teardownLoopSchedulers(loopId: string): void {
  loopRefreshScheduler.stop(loopId);
  loopHeartbeat.stop(loopId);
  loopSleepRecovery.unregisterLoop(loopId);
}
