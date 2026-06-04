/**
 * @file cost-pricing.js
 * @description Canonical token-cost engine for the agent-monitor sidecar
 * (CommonJS). Wraps `@pydantic/genai-prices` — the single source of truth for
 * model rates — and converts the dashboard DB's per-harness token counts into
 * the canonical `Usage` shape the library expects, then returns the library's
 * computed price UNCHANGED.
 *
 * CLOSEDLOOP FEA-1431. Replaces the deleted hand-maintained pricing table +
 * override pipeline (HOST_DEFAULT_PRICING / model_pricing-based calculateCost),
 * which double-charged cached OpenAI tokens (the v1 overcharge bug — see the
 * "input convention" note below).
 *
 * ── Core principle ──────────────────────────────────────────────────────────
 * TRUST THE LIBRARY. This module never overrides, clamps, asserts, or rewrites
 * any rate or price genai-prices returns. Its ONLY job is to feed correct
 * INPUTS. If a rate is wrong, it is fixed upstream (or by bumping the pinned
 * library version) — never patched locally.
 *
 * ── The input-token convention (the crux of correctness) ─────────────────────
 * genai-prices treats `Usage.input_tokens` as the GRAND TOTAL prompt size
 * (uncached + cache_read + cache_write); internally it derives
 *   uncached = input_tokens - cache_read_tokens - cache_write_tokens
 * and throws if that goes negative.
 *
 * But the two providers report raw input differently, and the dashboard DB
 * faithfully preserves whichever convention each harness ingested:
 *   • Anthropic (Claude Code harness): the API's `input_tokens` is FRESH /
 *     uncached; cache_read / cache_write are SEPARATE, additive fields. The DB
 *     stores `input` = fresh. So the grand total = input + cacheRead + cacheWrite.
 *   • OpenAI / others (Codex etc.): the API's `input_tokens` is the TOTAL prompt
 *     and cached tokens are a SUBSET of it. The DB stores `input` = total. So
 *     the grand total = input (cache must NOT be added — doing so double-charges
 *     the cached portion, which was the v1 overcharge bug).
 *
 * This is exactly what genai-prices' own `extractUsage` does (verified against
 * the library: Anthropic raw {input:1000,cache_read:500,cache_write:300} →
 * canonical input_tokens 1800; OpenAI raw {input:1000, cached:500} → canonical
 * input_tokens 1000). We mirror that behavior here, keyed on the model's
 * provider, so the conversion stays consistent with the library's source of
 * truth rather than a local guess. A parity test asserts this Set matches the
 * library's actual extractUsage summing behavior so drift is caught loudly.
 */
"use strict";

const { calcPrice, findProvider } = require("@pydantic/genai-prices");

/**
 * Provider ids whose API reports `input_tokens` as FRESH (uncached) with cache
 * counts as SEPARATE additive fields — so the genai-prices grand total is
 * `input + cacheRead + cacheWrite`. Every other provider reports `input_tokens`
 * as the TOTAL (cache is a subset), so `input` passes through unchanged.
 *
 * Anthropic is currently the only provider in genai-prices' data that uses the
 * additive (separate cache_creation/cache_read) convention. This Set is
 * verified against the library's own extractUsage in the parity test; if a
 * future genai-prices version adds another additive-cache provider, that test
 * fails so we update this Set deliberately.
 */
const CACHE_ADDITIVE_PROVIDERS = new Set(["anthropic"]);

/** Coerce a possibly-null/undefined/string DB token count to a finite number. */
function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function notPriced(reason, provider = null) {
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
function resolveProviderId(model) {
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
function buildUsage(providerId, counts) {
  const additive = providerId != null && CACHE_ADDITIVE_PROVIDERS.has(providerId);
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
 * Compute the USD cost for one (model, token-counts) row.
 *
 * @param {object} input
 * @param {string} input.model              Model id as stored in the DB.
 * @param {number} input.inputTokens        Provider-native input count (see header).
 * @param {number} input.outputTokens
 * @param {number} input.cacheReadTokens
 * @param {number} input.cacheWriteTokens
 * @param {Date}   [input.timestamp]        Optional historical pricing date.
 * @returns {{
 *   priced: boolean,
 *   provider: string|null,
 *   costUsd: number|null,
 *   inputCostUsd: number|null,
 *   outputCostUsd: number|null,
 *   reason: string|null,
 * }} Library values are returned UNCHANGED (no rounding/clamping). `reason` is
 *    one of "unknown_model" | "no_match" | "compute_error" when not priced.
 */
function computeTokenCost(input) {
  const model = input && typeof input.model === "string" ? input.model : "";
  if (model.length === 0) {
    return notPriced("unknown_model");
  }

  const counts = {
    input: toCount(input.inputTokens),
    output: toCount(input.outputTokens),
    cacheRead: toCount(input.cacheReadTokens),
    cacheWrite: toCount(input.cacheWriteTokens),
  };

  const providerId = resolveProviderId(model);
  const usage = buildUsage(providerId, counts);
  const options =
    input.timestamp instanceof Date ? { timestamp: input.timestamp } : undefined;

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
    provider: (result.provider && result.provider.id) || providerId,
    costUsd: result.total_price,
    inputCostUsd: result.input_price,
    outputCostUsd: result.output_price,
    reason: null,
  };
}

module.exports = {
  computeTokenCost,
  CACHE_ADDITIVE_PROVIDERS,
  // Exported for the parity test only.
  buildUsage,
};
