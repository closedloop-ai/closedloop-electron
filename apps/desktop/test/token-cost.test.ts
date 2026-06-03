/**
 * @file token-cost.test.ts
 * @description Correctness tests for the first-party token-cost engine
 * (`src/shared/token-cost.ts`). FEA-1503 removed the vendor CJS twin
 * (`scripts/agent-monitor-cost/cost-pricing.js`); the first-party engine is now
 * the single source of truth, so this exercises it directly.
 *
 * It pins a handful of known dollar values (against the pinned
 * @pydantic/genai-prices version) and verifies CACHE_ADDITIVE_PROVIDERS matches
 * the library's OWN extractUsage summing behavior — so if a future library
 * version changes which providers report cache additively, this test fails and
 * we update the Set deliberately rather than silently misprice.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractUsage, findProvider } from "@pydantic/genai-prices";
import {
  buildUsage as buildUsageTwin,
  CACHE_ADDITIVE_PROVIDERS as ADDITIVE_TWIN,
  computeTokenCost as computeTokenCostTwin,
  type TokenCostInput,
} from "../src/shared/token-cost.js";

// Fixture matrix exercising every code path: provider-aware normalization,
// cache combos, unpriced models, empty model, zero/negative/string coercion,
// and timestamped historical pricing.
const FIXTURES: Array<{ name: string; input: TokenCostInput }> = [
  {
    name: "anthropic fresh input only",
    input: {
      model: "claude-opus-4-5",
      inputTokens: 1000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  },
  {
    name: "anthropic with cache (additive grand total)",
    input: {
      model: "claude-opus-4-5",
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 500,
      cacheWriteTokens: 300,
    },
  },
  {
    name: "openai total input (cache is a subset)",
    input: {
      model: "gpt-4.1",
      inputTokens: 1000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  },
  {
    name: "openai with cache subset + output",
    input: {
      model: "gpt-4.1",
      inputTokens: 1025,
      outputTokens: 510,
      cacheReadTokens: 255,
      cacheWriteTokens: 100,
    },
  },
  {
    name: "unknown model (no_match)",
    input: {
      model: "totally-made-up-model-xyz",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 25,
      cacheWriteTokens: 10,
    },
  },
  {
    name: "empty model (unknown_model)",
    input: {
      model: "",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  },
  {
    name: "all zero tokens",
    input: {
      model: "claude-opus-4-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  },
  {
    name: "negative + NaN-ish counts are coerced to zero",
    input: {
      model: "claude-opus-4-5",
      inputTokens: -50,
      outputTokens: Number.NaN,
      cacheReadTokens: -10,
      cacheWriteTokens: 0,
    },
  },
  {
    name: "timestamped historical pricing",
    input: {
      model: "claude-opus-4-5",
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      timestamp: new Date("2026-01-15T00:00:00.000Z"),
    },
  },
];

test("computeTokenCost returns a well-formed result across the fixture matrix", () => {
  for (const { name, input } of FIXTURES) {
    const result = computeTokenCostTwin(input);
    assert.equal(typeof result.priced, "boolean", `priced shape for: ${name}`);
    if (result.priced) {
      assert.equal(typeof result.costUsd, "number", `costUsd for: ${name}`);
      assert.ok(
        (result.costUsd ?? -1) >= 0,
        `costUsd non-negative for: ${name}`,
      );
    } else {
      assert.equal(result.costUsd, null, `unpriced costUsd null for: ${name}`);
      assert.ok(
        typeof result.reason === "string" && result.reason.length > 0,
        `unpriced reason for: ${name}`,
      );
    }
  }
});

test("known dollar values against the pinned genai-prices version", () => {
  // claude-opus-4-5 input rate is $5/Mtok → 1000 input = $0.005.
  const opusFresh = computeTokenCostTwin({
    model: "claude-opus-4-5",
    inputTokens: 1000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  assert.equal(opusFresh.priced, true);
  assert.equal(opusFresh.provider, "anthropic");
  assert.equal(opusFresh.costUsd, 0.005);

  // Anthropic cache is ADDITIVE: grand total input_tokens = 1000 + 500 + 300 =
  // 1800 (uncached 1000 @ $5, cache_read 500 @ $0.5, cache_write 300 @ $6.25).
  const opusCache = computeTokenCostTwin({
    model: "claude-opus-4-5",
    inputTokens: 1000,
    outputTokens: 0,
    cacheReadTokens: 500,
    cacheWriteTokens: 300,
  });
  assert.equal(opusCache.priced, true);
  assert.equal(opusCache.costUsd, 0.007125);

  // gpt-4.1 input rate is $2/Mtok → 1000 input = $0.002. OpenAI input is the
  // TOTAL, so no cache is added.
  const gptFresh = computeTokenCostTwin({
    model: "gpt-4.1",
    inputTokens: 1000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  assert.equal(gptFresh.priced, true);
  assert.equal(gptFresh.provider, "openai");
  assert.equal(gptFresh.costUsd, 0.002);

  // The exact mix surfaced by the sync-service load test.
  const gptMix = computeTokenCostTwin({
    model: "gpt-4.1",
    inputTokens: 1025,
    outputTokens: 510,
    cacheReadTokens: 255,
    cacheWriteTokens: 100,
  });
  assert.equal(gptMix.priced, true);
  assert.equal(gptMix.costUsd, 0.0057475);
});

test("unpriced models surface a typed reason, never a wrong number", () => {
  const unknown = computeTokenCostTwin({
    model: "totally-made-up-model-xyz",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  assert.deepEqual(unknown, {
    priced: false,
    provider: null,
    costUsd: null,
    inputCostUsd: null,
    outputCostUsd: null,
    reason: "no_match",
  });

  const empty = computeTokenCostTwin({
    model: "",
    inputTokens: 100,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  assert.equal(empty.priced, false);
  assert.equal(empty.reason, "unknown_model");
});

test("buildUsage applies the provider-aware input convention", () => {
  const counts = { input: 1000, output: 0, cacheRead: 500, cacheWrite: 300 };

  // Anthropic → additive grand total.
  assert.equal(
    (buildUsageTwin("anthropic", counts) as { input_tokens: number }).input_tokens,
    1800,
  );
  // OpenAI → input passes through (cache is a subset).
  assert.equal(
    (buildUsageTwin("openai", counts) as { input_tokens: number }).input_tokens,
    1000,
  );
  // Unknown provider (null) → treated as inclusive (pass-through), the safe
  // default that never double-charges.
  assert.equal(
    (buildUsageTwin(null, counts) as { input_tokens: number }).input_tokens,
    1000,
  );
});

test("CACHE_ADDITIVE_PROVIDERS matches the library's own extractUsage summing", () => {
  // Anthropic: extractUsage SUMS input + cache → additive, so it MUST be in the
  // set. Raw input_tokens is fresh; cache fields are separate/additive.
  const anthropic = findProvider({ modelId: "claude-opus-4-5" });
  assert.ok(anthropic, "anthropic provider should resolve");
  const anthropicExtract = extractUsage(
    anthropic,
    {
      usage: {
        input_tokens: 1000,
        output_tokens: 0,
        cache_read_input_tokens: 500,
        cache_creation_input_tokens: 300,
      },
    },
    "default",
  );
  assert.equal(
    anthropicExtract.usage.input_tokens,
    1800,
    "anthropic extractUsage should SUM cache into input_tokens",
  );
  assert.ok(ADDITIVE_TWIN.has("anthropic"), "anthropic sums → must be additive");

  // OpenAI: extractUsage does NOT sum (cached is a subset of input) → inclusive,
  // so it MUST NOT be in the set.
  const openai = findProvider({ modelId: "gpt-4.1" });
  assert.ok(openai, "openai provider should resolve");
  const openaiExtract = extractUsage(
    openai,
    {
      usage: {
        input_tokens: 1000,
        output_tokens: 0,
        input_tokens_details: { cached_tokens: 500 },
      },
    },
    "responses",
  );
  assert.equal(
    openaiExtract.usage.input_tokens,
    1000,
    "openai extractUsage should NOT sum cache into input_tokens",
  );
  assert.ok(!ADDITIVE_TWIN.has("openai"), "openai does not sum → must be inclusive");
});
