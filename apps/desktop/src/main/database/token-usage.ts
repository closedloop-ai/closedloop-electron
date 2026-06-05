import type { DatabaseSync } from "node:sqlite";
import type { TokenUsageRow } from "./types.js";

/** Cumulative per-model token counts from the current transcript segment. */
export interface TokenUsageCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Token-usage repository for the in-process DB (FEA-1497 Phase 1).
 *
 * The standard columns (`input_tokens` etc.) hold the **effective reconciled
 * total** per (session, model) and are what every reader (dashboard analytics,
 * the cloud relay, cost reconciliation) reads directly — with NO baseline
 * arithmetic. The internal `raw_*` columns hold the last transcript-segment
 * cumulative and exist ONLY to reconcile compaction: when a transcript is
 * compaction-rewritten the cumulative counts drop, and we must add the new
 * segment on top of the prior effective total rather than overwrite it.
 *
 * For a new cumulative R vs the previously-seen raw cumulative `raw`:
 *   - R >= raw  → same segment grew; add the delta (R - raw).
 *   - R <  raw  → transcript was compacted/rewritten; the prior segment is
 *                 already fully counted, so add the whole new segment (R).
 * Equivalent to the vendor's `baseline_*` scheme, but the effective total lives
 * in the columns readers consume so they need no `+ baseline_*` math.
 */
export function createTokenUsageStore(db: DatabaseSync) {
  const replaceStmt = db.prepare(`
    INSERT INTO token_usage (
      session_id, model,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      raw_input, raw_output, raw_cache_read, raw_cache_write,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, model) DO UPDATE SET
      input_tokens = input_tokens + (CASE WHEN excluded.raw_input < raw_input
        THEN excluded.raw_input ELSE excluded.raw_input - raw_input END),
      output_tokens = output_tokens + (CASE WHEN excluded.raw_output < raw_output
        THEN excluded.raw_output ELSE excluded.raw_output - raw_output END),
      cache_read_tokens = cache_read_tokens + (CASE WHEN excluded.raw_cache_read < raw_cache_read
        THEN excluded.raw_cache_read ELSE excluded.raw_cache_read - raw_cache_read END),
      cache_write_tokens = cache_write_tokens + (CASE WHEN excluded.raw_cache_write < raw_cache_write
        THEN excluded.raw_cache_write ELSE excluded.raw_cache_write - raw_cache_write END),
      raw_input = excluded.raw_input,
      raw_output = excluded.raw_output,
      raw_cache_read = excluded.raw_cache_read,
      raw_cache_write = excluded.raw_cache_write,
      updated_at = excluded.updated_at
  `);

  const getBySessionStmt = db.prepare(`
    SELECT session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
    FROM token_usage WHERE session_id = ? ORDER BY model ASC
  `);

  function toRow(raw: Record<string, unknown>): TokenUsageRow {
    return {
      sessionId: raw.session_id as string,
      model: raw.model as string,
      inputTokens: (raw.input_tokens as number) ?? 0,
      outputTokens: (raw.output_tokens as number) ?? 0,
      cacheReadTokens: (raw.cache_read_tokens as number) ?? 0,
      cacheWriteTokens: (raw.cache_write_tokens as number) ?? 0,
    };
  }

  return {
    /**
     * Record the current cumulative per-model counts, reconciling against any
     * prior segment. Skips no-op all-zero rows so an idle transcript never
     * creates an empty (session, model) entry.
     */
    replace(sessionId: string, model: string, counts: TokenUsageCounts, now: string): void {
      if (
        counts.input === 0 &&
        counts.output === 0 &&
        counts.cacheRead === 0 &&
        counts.cacheWrite === 0
      ) {
        return;
      }
      replaceStmt.run(
        sessionId,
        model,
        counts.input,
        counts.output,
        counts.cacheRead,
        counts.cacheWrite,
        counts.input,
        counts.output,
        counts.cacheRead,
        counts.cacheWrite,
        now,
        now,
      );
    },

    getBySession(sessionId: string): TokenUsageRow[] {
      return (getBySessionStmt.all(sessionId) as Record<string, unknown>[]).map(toRow);
    },
  };
}
