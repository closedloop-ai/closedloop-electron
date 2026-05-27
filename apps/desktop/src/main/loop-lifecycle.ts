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
  getSessionToken?: () => Promise<string | null>;
  loopTokenStore: LoopTokenStore;
}

/**
 * Creates a `getSessionToken` closure for use in heartbeat scheduler deps.
 *
 * Returns the trimmed token when one is present, and `null` for any absent
 * or empty/whitespace-only value (graceful absence — an expected outcome, so
 * it is signalled in the return value rather than by throwing). Incoming
 * request tokens are already trimmed and length-bounded at the gateway
 * boundary (`parseCloudSessionToken` in `symphony-loop-request.ts`); the
 * `trim()` here also normalizes persisted tokens read back on boot recovery.
 */
export function createGetSessionToken(
  cloudSessionToken: string | undefined,
): () => Promise<string | null> {
  return async () => {
    const trimmed = cloudSessionToken?.trim();
    return trimmed !== undefined && trimmed !== "" ? trimmed : null;
  };
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
