import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CAUSE_HINT_EXPLANATIONS,
  classifyReconciliationCause,
} from "../src/main/reconciliation-cause-hint.js";
import { microCentsFromInt } from "../src/main/cost-math.js";

const mc = microCentsFromInt;

describe("reconciliation-cause-hint.classifyReconciliationCause", () => {
  test("returns null when drift is within tolerance", () => {
    assert.equal(
      classifyReconciliationCause({
        vendor: "anthropic",
        localMicroCents: mc(100),
        vendorMicroCents: mc(102),
        driftPct: 2,
      }),
      null,
    );
  });

  test("returns null when drift is exactly at 5% threshold", () => {
    assert.equal(
      classifyReconciliationCause({
        vendor: "anthropic",
        localMicroCents: mc(95),
        vendorMicroCents: mc(100),
        driftPct: 5,
      }),
      null,
    );
  });

  test("trial_credit_applied when vendor is zero but local is non-zero", () => {
    assert.equal(
      classifyReconciliationCause({
        vendor: "openai",
        localMicroCents: mc(100),
        vendorMicroCents: mc(0),
        driftPct: null,
      }),
      "trial_credit_applied",
    );
  });

  test("cache_write_1h_unmodeled when token_type contains ephemeral_1h", () => {
    assert.equal(
      classifyReconciliationCause({
        vendor: "anthropic",
        localMicroCents: mc(50),
        vendorMicroCents: mc(150),
        driftPct: 66.7,
        tokenType: "cache_creation.ephemeral_1h_input_tokens",
      }),
      "cache_write_1h_unmodeled",
    );
  });

  test("batch_api_discount when vendor ≈ local / 2 AND service_tier=batch", () => {
    assert.equal(
      classifyReconciliationCause({
        vendor: "anthropic",
        localMicroCents: mc(200),
        vendorMicroCents: mc(100),
        driftPct: -100,
        serviceTier: "batch",
      }),
      "batch_api_discount",
    );
  });

  test("M7: Rule 2b does NOT fire on standard-tier Anthropic with 50% ratio (model_alias_mismatch instead)", () => {
    // Pre-M7 bug: Rule 2b fired for ALL Anthropic rows in the 40-60% ratio
    // band regardless of serviceTier — misclassifying a standard-tier row
    // with a 50% local-vs-vendor ratio as batch_api_discount. After M7, the
    // guard requires serviceTier !== "standard". A 50% ratio on standard
    // tier means vendor ≈ local / 2, which falls back to model_alias_mismatch
    // (|drift| > 50%) because the magnitude is consistent with hitting a
    // different SKU (e.g. Sonnet billed at Opus rates).
    //
    // Microcent magnitudes deliberately larger than 100 (the trial-credit
    // rounding threshold) so Rule 5 doesn't claim the row.
    assert.equal(
      classifyReconciliationCause({
        vendor: "anthropic",
        localMicroCents: mc(2_000_000),
        vendorMicroCents: mc(1_000_000),
        driftPct: -100,
        serviceTier: "standard",
      }),
      "model_alias_mismatch",
    );
  });

  test("M7: Rule 2b DOES fire on Anthropic with missing serviceTier in 50% band", () => {
    // The unknown-tier path is the legit use of Rule 2b — vendor breakdowns
    // don't always include service_tier, so we still want to catch a
    // batch-shaped 50% ratio when we have no other signal.
    assert.equal(
      classifyReconciliationCause({
        vendor: "anthropic",
        localMicroCents: mc(2_000_000),
        vendorMicroCents: mc(1_000_000),
        driftPct: -100,
        // serviceTier intentionally omitted
      }),
      "batch_api_discount",
    );
  });

  test("M7: Rule 2a still fires on explicit batch tier (unchanged)", () => {
    // Regression guard — fixing 2b must not regress 2a's explicit batch path.
    assert.equal(
      classifyReconciliationCause({
        vendor: "anthropic",
        localMicroCents: mc(2_000_000),
        vendorMicroCents: mc(1_000_000),
        driftPct: -100,
        serviceTier: "batch",
      }),
      "batch_api_discount",
    );
  });

  test("priority_tier_premium when vendor > local AND description mentions priority", () => {
    assert.equal(
      classifyReconciliationCause({
        vendor: "anthropic",
        localMicroCents: mc(100),
        vendorMicroCents: mc(150),
        driftPct: 33.3,
        descriptionGroup: "Claude Opus Usage - Priority Tier",
      }),
      "priority_tier_premium",
    );
  });

  test("server_side_tool_use when cost_type=web_search", () => {
    assert.equal(
      classifyReconciliationCause({
        vendor: "anthropic",
        localMicroCents: mc(0),
        vendorMicroCents: mc(50),
        driftPct: 100,
        costType: "web_search",
      }),
      "server_side_tool_use",
    );
  });

  test("server_side_tool_use when cost_type=code_execution", () => {
    assert.equal(
      classifyReconciliationCause({
        vendor: "anthropic",
        localMicroCents: mc(0),
        vendorMicroCents: mc(50),
        driftPct: 100,
        costType: "code_execution",
      }),
      "server_side_tool_use",
    );
  });

  test("model_alias_mismatch on >50% drift with no other signal", () => {
    assert.equal(
      classifyReconciliationCause({
        vendor: "openai",
        localMicroCents: mc(100),
        vendorMicroCents: mc(300),
        driftPct: 66.7,
      }),
      "model_alias_mismatch",
    );
  });

  test("unknown when drift exceeds threshold but no rule matches", () => {
    assert.equal(
      classifyReconciliationCause({
        vendor: "openai",
        localMicroCents: mc(100),
        vendorMicroCents: mc(108),
        driftPct: 7.4,
      }),
      "unknown",
    );
  });

  test("every hint key has a human-readable explanation", () => {
    const keys: (keyof typeof CAUSE_HINT_EXPLANATIONS)[] = [
      "cache_write_1h_unmodeled",
      "batch_api_discount",
      "priority_tier_premium",
      "server_side_tool_use",
      "trial_credit_applied",
      "model_alias_mismatch",
      "unknown",
    ];
    for (const k of keys) {
      assert.ok(CAUSE_HINT_EXPLANATIONS[k].length > 0, `missing explanation for ${k}`);
    }
  });
});
