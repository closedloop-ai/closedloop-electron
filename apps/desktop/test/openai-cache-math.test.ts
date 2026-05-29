/**
 * FEA-1432 — vendor-specific cache pricing math.
 *
 * Pins the end-to-end behavior of three rules:
 *   1. OpenAI rows (gpt-*, fallback `gpt-codex%`) carry cache_write = 0 and
 *      cache_write_1h = 0. Any cache_write_tokens posted against an OpenAI
 *      model must contribute $0 to the estimated cost.
 *   2. Anthropic 1-hour cache write tokens (cache_write_1h_tokens) are billed
 *      at the 1h column (input × 2.0 on the default pricing rows).
 *   3. The gpt-codex fallback row is shape-conformant after FEA-1432.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateTokenUsageCostUsd } from "../src/main/agent-session-sync-service.js";

const builderUrl = new URL(
  "../scripts/build-agent-monitor.mjs",
  import.meta.url,
).href;

type PricingRow7 = [
  string,
  string,
  number,
  number,
  number,
  number,
  number,
];

type BuilderModule = {
  loadHostDefaultPricing: () => PricingRow7[];
};

async function loadBuilder(): Promise<BuilderModule> {
  return (await import(builderUrl)) as BuilderModule;
}

type ServicePricingRow = {
  model_pattern: string;
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok: number;
  cache_write_per_mtok: number;
  cache_write_1h_per_mtok: number;
};

function toServiceRow(row: PricingRow7): ServicePricingRow {
  return {
    model_pattern: row[0],
    input_per_mtok: row[2],
    output_per_mtok: row[3],
    cache_read_per_mtok: row[4],
    cache_write_per_mtok: row[5],
    cache_write_1h_per_mtok: row[6],
  };
}

test("gpt-codex% fallback row has cache_write = 0 and cache_write_1h = 0", async () => {
  const { loadHostDefaultPricing } = await loadBuilder();
  const rows = loadHostDefaultPricing();
  const codex = rows.find((r) => r[0] === "gpt-codex%");
  assert.ok(codex, "gpt-codex% must be present in HOST_ONLY_OVERRIDES");
  // Tuple shape: [pattern, name, input, output, cache_read, cache_write, cache_write_1h]
  assert.equal(codex![5], 0, "cache_write (5-min) must be 0 for OpenAI");
  assert.equal(codex![6], 0, "cache_write_1h must be 0 for OpenAI");
  // Sanity: cache_read at 50% of input.
  assert.equal(codex![4], codex![2] * 0.5);
});

test("OpenAI cache_write_tokens contribute $0 to the estimated cost", async () => {
  const { loadHostDefaultPricing } = await loadBuilder();
  const pricingRows = loadHostDefaultPricing().map(toServiceRow);
  // Construct a usage event with positive cache_write_tokens against
  // gpt-codex. Pre-FEA-1432 this would have billed 1000 * 1.25 / 1e6 = $0.00125
  // at the old surcharge; post-FEA-1432 it must be $0.
  const usage = {
    session_id: "test",
    model: "gpt-codex-fallback-xyz", // matches gpt-codex% LIKE
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 1_000_000, // 1M tokens
    cache_write_1h_tokens: 500_000,
  };
  const cost = estimateTokenUsageCostUsd(usage, pricingRows);
  assert.equal(
    cost,
    0,
    `OpenAI cache_write must contribute $0; got ${cost}. Cache surcharge must not be reintroduced.`,
  );
});

test("Anthropic cache_write_1h_tokens are billed at input × 2.0", async () => {
  const { loadHostDefaultPricing } = await loadBuilder();
  const pricingRows = loadHostDefaultPricing().map(toServiceRow);
  // FEA-1431-bugfix: Anthropic re-priced Opus 4.5+ down to $5/Mtok input.
  // The 1h cache write tier = input × 2.0 = $10/Mtok for Opus 4.7.
  // (Source: https://platform.claude.com/docs/en/about-claude/pricing)
  const opus = pricingRows.find((r) => r.model_pattern === "claude-opus-4-7%");
  assert.ok(opus);
  assert.equal(opus!.cache_write_1h_per_mtok, 10);

  // 100,000 cache_write_1h tokens at $10/Mtok = $1.00.
  const usage = {
    session_id: "test",
    model: "claude-opus-4-7",
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cache_write_1h_tokens: 100_000,
  };
  const cost = estimateTokenUsageCostUsd(usage, pricingRows);
  assert.equal(
    cost,
    1.0,
    `Anthropic 1h cache writes must be billed at input × 2.0; got ${cost}`,
  );
});

test("Cost compute sums all 5 components — input + output + cache_read + cache_write_5min + cache_write_1h", async () => {
  // Synthetic pricing row to isolate arithmetic.
  const pricingRows: ServicePricingRow[] = [
    {
      model_pattern: "synthetic-anthropic%",
      input_per_mtok: 10, // $10/Mtok
      output_per_mtok: 50, // $50/Mtok
      cache_read_per_mtok: 1, // $1/Mtok
      cache_write_per_mtok: 12.5, // 5-min: input × 1.25
      cache_write_1h_per_mtok: 20, // 1h: input × 2.0
    },
  ];
  const usage = {
    session_id: "test",
    model: "synthetic-anthropic",
    input_tokens: 100_000, // 100K × $10/M = $1.00
    output_tokens: 50_000, // 50K × $50/M = $2.50
    cache_read_tokens: 200_000, // 200K × $1/M = $0.20
    cache_write_tokens: 80_000, // 80K × $12.5/M = $1.00
    cache_write_1h_tokens: 25_000, // 25K × $20/M = $0.50
  };
  const cost = estimateTokenUsageCostUsd(usage, pricingRows);
  // Total: 1.00 + 2.50 + 0.20 + 1.00 + 0.50 = 5.20
  assert.equal(cost, 5.2);
});

test("Missing cache_write_1h_tokens defaults to 0 — backward compat with v1 token rows", async () => {
  // Simulate a v1-shaped token usage row that does not carry the 1h field at
  // all. Cost compute must treat the missing field as 0, not throw.
  const pricingRows: ServicePricingRow[] = [
    {
      model_pattern: "claude-test%",
      input_per_mtok: 10,
      output_per_mtok: 0,
      cache_read_per_mtok: 0,
      cache_write_per_mtok: 12.5,
      cache_write_1h_per_mtok: 20,
    },
  ];
  // No cache_write_1h_tokens field.
  const usage = {
    session_id: "test",
    model: "claude-test",
    input_tokens: 100_000,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  };
  const cost = estimateTokenUsageCostUsd(usage, pricingRows);
  // 100K × $10/M = $1.00 — the missing 1h field contributes nothing.
  assert.equal(cost, 1.0);
});
