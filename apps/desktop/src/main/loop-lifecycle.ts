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
 * Returns `null` when no token was provided (graceful absence) and throws
 * an informative `Error` (including `loopId` + `source`, never the token
 * value) when a token was present but resolved to whitespace-only.
 */
export function createGetSessionToken(
  cloudSessionToken: string | undefined,
  loopId: string,
  source: string,
): () => Promise<string | null> {
  return async () => {
    if (cloudSessionToken === undefined || cloudSessionToken === "") {
      return null;
    }
    const trimmed = cloudSessionToken.trim();
    if (trimmed === "") {
      throw new Error(
        `getSessionToken failed for loopId=${loopId}: cloudSessionToken was present ${source} but resolved to an empty string`,
      );
    }
    return trimmed;
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
