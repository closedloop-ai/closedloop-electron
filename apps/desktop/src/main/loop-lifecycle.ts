/**
 * Shared lifecycle types for loop schedulers.
 *
 * Provides the canonical dependency interface consumed by every per-loop
 * scheduler in `LoopSchedulerContext` (heartbeat, refresh, sleep recovery).
 * Per-loop timer storage and teardown live on `LoopSchedulerContext` —
 * there is no longer any module-level registry.
 */

import type { LoopTokenStore } from "./loop-token-store.js";

/**
 * Shared dependency interface for per-loop scheduler entries.
 * Heartbeat, refresh, and sleep-recovery all need the same three fields, so
 * a single canonical type avoids drift.
 */
export interface LoopSchedulerDeps {
  apiBaseUrl: string;
  getToken: () => string | null;
  loopTokenStore: LoopTokenStore;
}
