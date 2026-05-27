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
  // Forward-only plumbing (FEA-1392): no call site populates this yet, so the
  // `X-Session-Token` heartbeat header is not sent and cloud loop revival is not
  // active. A real cloud session-token source must be wired into both heartbeat
  // call sites (symphony-loop.ts, boot-recovery.ts) before revival works end-to-end.
  getSessionToken?: () => Promise<string | null>;
  loopTokenStore: LoopTokenStore;
}

/**
 * Reads an env var as a non-negative integer millisecond value.
 * Returns `defaultMs` when the var is absent or not a valid non-negative integer.
 */
export function parseEnvMs(envVar: string, defaultMs: number): number {
  const override = process.env[envVar];
  if (override !== undefined) {
    const parsed = parseInt(override, 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  return defaultMs;
}
