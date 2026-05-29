/**
 * FEA-1433: verify the generated sidecar's per-row priced flag.
 *
 * The sidecar Sessions list relies on `pricing.calculateCost` returning a
 * `breakdown` array whose `matched_rule` is `null` exactly when no
 * `model_pricing` row matches the model id. That is the foundation for the
 * `calculateSessionCostFea1433` wrapper (injected by
 * `apps/desktop/scripts/build-agent-monitor.mjs`), which then nulls out the
 * row-level `cost` so the Sessions UI can render a tooltip pointing at
 * Settings → Pricing.
 *
 * If a future upstream bump silently drops `matched_rule` from the breakdown
 * shape, this test fails before the dashboard ships a row of fake $0.00
 * costs.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const generatedPricingPath = path.join(
  __dirname,
  "..",
  ".generated",
  "agent-monitor",
  "server",
  "routes",
  "pricing.js",
);

test("FEA-1433: generated pricing.calculateCost emits matched_rule=null for unpriced rows", { skip: !existsSync(generatedPricingPath) }, () => {
  // Use createRequire so we can pull in the CJS-shaped generated module from
  // ESM test code. The generated tree is materialized by `pnpm build:agent-monitor`;
  // skip the test when the tree has not been generated yet so a fresh
  // checkout's lint/typecheck still passes before build runs.
  const requireFromHere = createRequire(import.meta.url);
  const pricing = requireFromHere(generatedPricingPath) as {
    calculateCost: (
      tokenRows: Array<{
        model: string;
        input_tokens: number;
        output_tokens: number;
        cache_read_tokens: number;
        cache_write_tokens: number;
      }>,
      pricingRules: Array<{
        model_pattern: string;
        input_per_mtok: number;
        output_per_mtok: number;
        cache_read_per_mtok: number;
        cache_write_per_mtok: number;
      }>,
    ) => {
      total_cost: number;
      breakdown: Array<{
        model: string;
        cost: number;
        matched_rule: string | null;
      }>;
    };
  };

  const result = pricing.calculateCost(
    [
      {
        model: "claude-opus-4-7",
        input_tokens: 1_000_000,
        output_tokens: 500_000,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
      },
      {
        model: "custom-vendor-x",
        input_tokens: 999,
        output_tokens: 999,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
      },
    ],
    [
      {
        model_pattern: "claude-opus-4-7%",
        input_per_mtok: 15,
        output_per_mtok: 75,
        cache_read_per_mtok: 0,
        cache_write_per_mtok: 0,
      },
    ],
  );

  // The Opus row is priced — matched_rule is the pattern string.
  const opus = result.breakdown.find((b) => b.model === "claude-opus-4-7");
  assert.ok(opus, "Opus breakdown row missing");
  assert.equal(opus!.matched_rule, "claude-opus-4-7%");
  assert.equal(opus!.cost, 52.5);

  // The unknown model row is unpriced — matched_rule is null. This null is
  // what the sessions.js patch keys on to set row.cost = null + populate
  // unpriced_models. A regression here means the diagnostic em-dash silently
  // becomes "$0.00".
  const unknown = result.breakdown.find((b) => b.model === "custom-vendor-x");
  assert.ok(unknown, "Unknown-model breakdown row missing");
  assert.equal(unknown!.matched_rule, null);
});
