# Triage: `dashboard.monitor.total_cost` — pricing pattern silently overridden

**Found by:** Phase 0.5 audit (FEA-1415 / PLN-738), first run
**Tile:** Total Cost on Dashboard Monitor tab
**Severity assessment (for CEO):** likely **product-relevant**, not just a test artifact — see "Why this matters in production" below

## The disagreement

| layer | value |
|---|---|
| Oracle on fixture DB (`dashboard_total_cost`) | **$0.169125** |
| Sidecar API (`GET /api/pricing/cost?tz_offset=0` → `total_cost`) | **$0.0604** |
| Delta | **$0.108725 (64% high) vs API** |

The legacy `dashboard.contract.test.mjs` only schema-checks this endpoint (asserts a key exists), so this disagreement has been silently shippable.

## Root cause (mechanically)

In `node_modules/.../agent-dashboard/server/db.js` (line ~152, `DEFAULT_PRICING`):

```js
const DEFAULT_PRICING = [
  ["claude-opus-4-7%", "Claude Opus 4.7", 5, 25, 0.5, 6.25],
  ...
];
```

On startup the sidecar runs:
```js
"INSERT OR IGNORE INTO model_pricing (model_pattern, ...) VALUES (?, ...)"
```

The fixture row uses **pattern `claude-opus-4-7`** (no trailing `%`). The default row uses **pattern `claude-opus-4-7%`** (different string, so `INSERT OR IGNORE` doesn't skip — both rows land in the DB).

In `agent-dashboard/server/routes/pricing.js`:

```js
const sortedRules = [...pricingRules].sort(
  (a, b) => b.model_pattern.length - a.model_pattern.length
);
for (const row of tokenRows) {
  const rule = sortedRules.find((p) => {
    const pattern = p.model_pattern.replace(/%/g, ".*");
    return new RegExp("^" + pattern + "$").test(row.model);
  });
  // … apply rule.input_per_mtok etc.
}
```

Patterns are sorted **by length descending** and the **first regex match wins**. Since `claude-opus-4-7%` (length 16) sorts before `claude-opus-4-7` (length 15), and the regex `^claude-opus-4-7.*$` matches the model `claude-opus-4-7`, the **wildcard pattern's rates** are applied — not the more specific exact match.

Per-row math with the wildcard rates (5/25/0.5/6.25) matches the API's $0.0604; with the fixture rates (15/75/1.5/18.75) it matches the oracle's $0.169125.

## Why this matters in production (not just in tests)

This isn't only a test fixture quirk. It exposes a **user-visible misbehavior** in how the dashboard handles manual pricing edits:

1. A user opens Settings → Pricing and adds a row for `claude-opus-4-7` with their negotiated/custom rate.
2. The dashboard reboots. The startup top-up sees no existing row with pattern `claude-opus-4-7%` (only `claude-opus-4-7` exists) and inserts the default at its rate.
3. From that point forward, **the wildcard default silently outranks the user's exact entry** because `calculateCost` sorts by length descending.

That's a UX bug worth filing — silent override of explicit user pricing — independent of the test scenario.

## Recommended fixes (ranked)

1. **Best — fix the matcher to prefer exact matches over wildcard matches**, regardless of length. Sort key should be `(hasWildcard ? 0 : 1, -length)` so an exact-match rule wins over an equal-or-longer wildcard rule.
2. **Acceptable — change `INSERT OR IGNORE`'s uniqueness key** to also collide on the unwildcarded suffix (e.g., index on `replace(model_pattern, '%', '')`) so the user's specific row prevents the default from being inserted at all.
3. **Test-only workaround** — update fixture `model_pricing` patterns to include a trailing `%` so they exactly equal the default pattern and `INSERT OR IGNORE` skips the default. This silences the test but ships the bug.

## What the CEO needs to decide

- File a bug feature `RELATES_TO FEA-1415` against the **agent-dashboard upstream** (Claude-Code-Agent-Monitor on GitHub) for the matcher behavior. We patch it via the build patch chain in `scripts/build-agent-monitor.mjs` until upstream merges.
- For the Phase 0.5 audit: leave the test asserting the **oracle value** (`$0.169125`). Once the matcher is fixed, the API will start agreeing with the oracle and the test stays green. Until then, the test stays red and announces the bug — which is the point.

## Linked artifacts

- Manifest row: `apps/desktop/test-e2e/agent-monitor/inventory/manifest.json` → `dashboard.monitor.total_cost`
- Oracle: `apps/desktop/test-e2e/agent-monitor/inventory/oracles.mjs` → `dashboard_total_cost`
- Bug feature in closedloop: **[FEA-1418 — BUG: agent-monitor pricing matcher silently overrides exact-match user entries with wildcard defaults](https://app.closedloop.ai/closedloop-ai/features/FEA-1418)** (filed in Andrew's Backlog; linked RELATES_TO FEA-1415)
