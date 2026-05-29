/**
 * Cause-hint classifier for FEA-1435 reconciliation drift.
 *
 * Returns a single hint key when |drift_pct| > 5%. Hints are evaluated in the
 * documented order — the first matching rule wins. Each hint is a stable key,
 * not free text; the UI surfaces a human-readable explanation from a TS map
 * (see {@link CAUSE_HINT_EXPLANATIONS}).
 */

import type { MicroCents } from "./cost-math.js";

export type ReconciliationCauseHint =
  | "cache_write_1h_unmodeled"
  | "batch_api_discount"
  | "priority_tier_premium"
  | "server_side_tool_use"
  | "trial_credit_applied"
  | "model_alias_mismatch"
  | "unknown";

export interface CauseHintInputs {
  vendor: "anthropic" | "openai";
  localMicroCents: MicroCents;
  vendorMicroCents: MicroCents;
  driftPct: number | null;
  /** Anthropic's `description` group (e.g. "Cache Creation 1h"). */
  descriptionGroup?: string | null;
  /** Anthropic's `cost_type` (e.g. "tokens", "web_search", "code_execution"). */
  costType?: string | null;
  /** Anthropic's `service_tier` ("standard" / "batch"). */
  serviceTier?: string | null;
  /** Anthropic's `token_type` (e.g. "cache_creation.ephemeral_1h_input_tokens"). */
  tokenType?: string | null;
}

const DRIFT_THRESHOLD_PCT = 5;
const BATCH_RATIO_LOWER = 0.4;
const BATCH_RATIO_UPPER = 0.6;

/**
 * Classifies the most plausible cause of drift. Returns null when |drift| is
 * within tolerance — callers should not surface a hint in that case.
 */
export function classifyReconciliationCause(
  inputs: CauseHintInputs,
): ReconciliationCauseHint | null {
  const { driftPct, localMicroCents, vendorMicroCents } = inputs;
  if (driftPct === null) {
    // Vendor is zero but local is non-zero — strongest signal of trial credits
    // being applied at the vendor (we billed for it; vendor said free).
    if ((localMicroCents as number) > 0) {
      return "trial_credit_applied";
    }
    return null;
  }
  if (Math.abs(driftPct) <= DRIFT_THRESHOLD_PCT) {
    return null;
  }

  const local = localMicroCents as number;
  const vendor = vendorMicroCents as number;

  // Rule 1 — 1h ephemeral cache writes are NOT modeled by the live pricing
  // path, so vendor > local AND the description/token type calls out the 1h
  // bucket.
  const desc = (inputs.descriptionGroup ?? "").toLowerCase();
  const tokenType = (inputs.tokenType ?? "").toLowerCase();
  if (
    vendor > local &&
    (tokenType.includes("ephemeral_1h") || desc.includes("1h"))
  ) {
    return "cache_write_1h_unmodeled";
  }

  // Rule 2 — Anthropic batch service tier applies a ~50% discount.
  if (inputs.serviceTier === "batch" && vendor > 0 && local > 0) {
    const ratio = vendor / local;
    if (ratio >= BATCH_RATIO_LOWER && ratio <= BATCH_RATIO_UPPER) {
      return "batch_api_discount";
    }
  }
  // Anthropic-side independent batch check (e.g. when serviceTier isn't passed)
  if (inputs.vendor === "anthropic" && vendor > 0 && local > 0) {
    const ratio = vendor / local;
    if (ratio >= BATCH_RATIO_LOWER && ratio <= BATCH_RATIO_UPPER) {
      return "batch_api_discount";
    }
  }

  // Rule 3 — Anthropic priority tier billed at a premium.
  if (inputs.vendor === "anthropic" && vendor > local) {
    if (
      desc.includes("priority") ||
      (inputs.serviceTier && inputs.serviceTier !== "standard" && inputs.serviceTier !== "batch")
    ) {
      return "priority_tier_premium";
    }
  }

  // Rule 4 — server-side tool use (web search / code execution) priced
  // separately by the vendor; the live local-estimate path doesn't model
  // these as billable rows.
  const costType = (inputs.costType ?? "").toLowerCase();
  if (
    costType === "web_search" ||
    costType === "code_execution" ||
    desc.includes("web_search") ||
    desc.includes("code_execution")
  ) {
    return "server_side_tool_use";
  }

  // Rule 5 — vendor ≈ 0 but local > 0 (caught above when driftPct === null,
  // but vendor can also be a tiny positive value due to rounding).
  if (vendor < local && Math.abs(vendor) <= 100 && local > 0) {
    return "trial_credit_applied";
  }

  // Rule 6 — model alias mismatch. We surface this as a fallback when none of
  // the structured signals fire but the magnitude of drift is consistent with
  // hitting a different SKU.
  if (Math.abs(driftPct) > 50) {
    return "model_alias_mismatch";
  }

  return "unknown";
}

/**
 * Human-readable explanations for each hint key. Kept in TS rather than the DB
 * so they ship with the renderer without a round-trip.
 */
export const CAUSE_HINT_EXPLANATIONS: Record<ReconciliationCauseHint, string> = {
  cache_write_1h_unmodeled:
    "Vendor billed for 1-hour ephemeral cache writes that our live cost model doesn't currently price separately.",
  batch_api_discount:
    "Vendor billed roughly half of the local estimate — consistent with the Batch API 50% discount.",
  priority_tier_premium:
    "Vendor billed above the local estimate — consistent with Anthropic's priority service tier.",
  server_side_tool_use:
    "Vendor billed for server-side tool use (web search or code execution) that the live estimator doesn't model as a billable line.",
  trial_credit_applied:
    "Vendor billed approximately zero while the local estimate is non-zero — trial credits or promotional discounts likely applied at the vendor.",
  model_alias_mismatch:
    "Large drift with no other structured signal — local pricing may be using a different model SKU than the vendor (e.g. aliased to a Sonnet rate while the vendor billed at Opus rates).",
  unknown:
    "Drift exceeds the 5% tolerance band but matches no known cause pattern. Investigation needed.",
};
