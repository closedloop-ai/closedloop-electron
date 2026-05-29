/**
 * @file token-cost.ts
 * @description Desktop-main (ESM) TWIN of the agent-monitor sidecar's canonical
 * token-cost engine (`scripts/agent-monitor-cost/cost-pricing.js`). Same logic,
 * same provider-aware input convention, same RAW-passthrough of library prices.
 *
 * ── Why a twin instead of one shared file ────────────────────────────────────
 * The two cost paths run in different module systems that cannot cleanly share
 * one source file:
 *   • This module runs in desktop-main, which is `type:module` (ESM) and is the
 *     ONLY cost path that must work when the sidecar process is disabled — so it
 *     cannot depend on the sidecar's generated CommonJS tree.
 *   • `cost-pricing.js` runs inside the generated agent-monitor sidecar, a
 *     `type:commonjs` tree that is materialized/copied at build time and is NOT
 *     staged into the packaged desktop-main module path.
 * A parity test (`test/token-cost.test.ts`) imports BOTH and asserts byte-equal
 * numeric output across a fixture matrix so the twins cannot drift.
 *
 * ── Core principle (identical to the CJS engine) ─────────────────────────────
 * TRUST THE LIBRARY. genai-prices is the single source of truth for model
 * rates. This module never overrides, clamps, asserts, or rewrites any price it
 * returns. Its only job is to feed correct INPUTS.
 *
 * ── The input-token convention ───────────────────────────────────────────────
 * genai-prices treats `Usage.input_tokens` as the GRAND TOTAL prompt size
 * (uncached + cache_read + cache_write); internally it derives
 *   uncached = input_tokens - cache_read_tokens - cache_write_tokens
 * and throws if that goes negative. The two providers report raw input
 * differently and the dashboard DB preserves each harness's convention:
 *   • Anthropic (Claude Code): DB `input` is FRESH/uncached; cache_read and
 *     cache_write are SEPARATE additive fields → grand total is the sum.
 *   • OpenAI / others (Codex etc.): DB `input` is the TOTAL prompt and cached
 *     tokens are a SUBSET of it → `input` passes through unchanged (adding cache
 *     would double-charge the cached portion — the v1 overcharge bug).
 * This mirrors genai-prices' own `extractUsage`, verified by the parity test.
 */
import { calcPrice, findProvider } from "@pydantic/genai-prices";

/**
 * Provider ids whose API reports `input_tokens` as FRESH (uncached) with cache
 * counts as SEPARATE additive fields — so the genai-prices grand total is
 * `input + cacheRead + cacheWrite`. Every other provider reports `input_tokens`
 * as the TOTAL (cache is a subset), so `input` passes through unchanged.
 *
 * Anthropic is currently the only additive-cache provider in genai-prices' data.
 * Kept byte-identical to `CACHE_ADDITIVE_PROVIDERS` in cost-pricing.js; the
 * parity test fails if the two sets ever diverge.
 */
export const CACHE_ADDITIVE_PROVIDERS: ReadonlySet<string> = new Set([
  "anthropic",
]);

/** One not-priced reason, surfaced so callers can render "—" deliberately. */
export type TokenCostNotPricedReason =
  | "unknown_model"
  | "no_match"
  | "compute_error";

export interface TokenCostInput {
  /** Model id as stored in the dashboard DB. */
  model: string;
  /** Provider-native input count (see the input-token convention above). */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Optional historical pricing date for timestamped costing. */
  timestamp?: Date;
}

export interface TokenCostResult {
  priced: boolean;
  provider: string | null;
  costUsd: number | null;
  inputCostUsd: number | null;
  outputCostUsd: number | null;
  /** null when priced; otherwise the not-priced reason. */
  reason: TokenCostNotPricedReason | null;
}

type Counts = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

/** Coerce a possibly-null/undefined/string DB token count to a finite number. */
function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function notPriced(
  reason: TokenCostNotPricedReason,
  provider: string | null = null,
): TokenCostResult {
  return {
    priced: false,
    provider,
    costUsd: null,
    inputCostUsd: null,
    outputCostUsd: null,
    reason,
  };
}

/**
 * Resolve the provider id for a model id, defensively (findProvider can throw
 * on malformed input). Returns null when the model is unknown.
 */
function resolveProviderId(model: string): string | null {
  try {
    const provider = findProvider({ modelId: model });
    return provider ? provider.id : null;
  } catch {
    return null;
  }
}

/**
 * Build the canonical genai-prices `Usage` from the DB's per-harness counts,
 * applying the provider-aware input convention described in the file header.
 */
export function buildUsage(
  providerId: string | null,
  counts: Counts,
): {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
} {
  const additive =
    providerId != null && CACHE_ADDITIVE_PROVIDERS.has(providerId);
  return {
    input_tokens: additive
      ? counts.input + counts.cacheRead + counts.cacheWrite
      : counts.input,
    output_tokens: counts.output,
    cache_read_tokens: counts.cacheRead,
    cache_write_tokens: counts.cacheWrite,
  };
}

/**
 * Compute the USD cost for one (model, token-counts) row. Library values are
 * returned UNCHANGED (no rounding/clamping). When not priced, `reason` is one
 * of "unknown_model" | "no_match" | "compute_error".
 */
export function computeTokenCost(input: TokenCostInput): TokenCostResult {
  const model = typeof input.model === "string" ? input.model : "";
  if (model.length === 0) {
    return notPriced("unknown_model");
  }

  const counts: Counts = {
    input: toCount(input.inputTokens),
    output: toCount(input.outputTokens),
    cacheRead: toCount(input.cacheReadTokens),
    cacheWrite: toCount(input.cacheWriteTokens),
  };

  const providerId = resolveProviderId(model);
  const usage = buildUsage(providerId, counts);
  const options =
    input.timestamp instanceof Date
      ? { timestamp: input.timestamp }
      : undefined;

  let result;
  try {
    result = calcPrice(usage, model, options);
  } catch {
    // calcPrice throws on genuinely inconsistent input (e.g. negative uncached).
    // Never crash the cost path — surface as not-priced so the caller can show
    // "—" rather than a wrong number or an exception.
    return notPriced("compute_error", providerId);
  }

  if (!result) {
    // Library found no matching model/provider → not priced.
    return notPriced("no_match", providerId);
  }

  return {
    priced: true,
    provider: result.provider?.id ?? providerId,
    costUsd: result.total_price,
    inputCostUsd: result.input_price,
    outputCostUsd: result.output_price,
    reason: null,
  };
}
