// Per-model cost-breakdown audit + daily_costs probe.
//
// Likely surfaces:
//   - FEA-1418 propagating per-model (every opus-4-7 row shows 3x understated cost)
//   - FEA-1422 in daily_costs (string-comparison date bucketing)
//   - New bugs: matched_rule mis-attribution, missing model in breakdown

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import {
  makeTempDbPath,
  reseedPacksAndSkills,
  seedFixtureDb,
} from "../../helpers/seed-fixture-db.mjs";
import { launchSidecar } from "../../helpers/launch-sidecar.mjs";
import { cost_breakdown_by_model_map } from "../../inventory/oracles.mjs";
import { compareNumeric, openDb } from "../../inventory/audit-runner.mjs";

let sidecar;
let cleanupDb;
let baseUrl;
let dbPath;

before(async () => {
  const tmp = makeTempDbPath();
  cleanupDb = tmp.cleanup;
  dbPath = tmp.dbPath;
  seedFixtureDb(dbPath);
  sidecar = await launchSidecar({ dbPath });
  reseedPacksAndSkills(dbPath);
  baseUrl = sidecar.baseUrl;
});

after(async () => {
  await sidecar.stop();
  cleanupDb();
});

test("/api/pricing/cost.breakdown — per-model cost matches oracle (will surface FEA-1418 per model)", async () => {
  const res = await fetch(`${baseUrl}/api/pricing/cost?tz_offset=0`);
  const body = await res.json();
  const breakdown = body.breakdown || [];

  const db = openDb(dbPath);
  try {
    const oracleMap = cost_breakdown_by_model_map(db);
    const failures = [];

    for (const apiRow of breakdown) {
      const model = apiRow.model;
      const apiCost = Number(apiRow.cost ?? 0);
      const oracleCost = Number(oracleMap[model] ?? 0);
      const cmp = compareNumeric(apiCost, oracleCost, { eps: 0.005 });
      if (!cmp.ok) {
        failures.push({
          model,
          matched_rule: apiRow.matched_rule,
          apiCost,
          oracleCost,
          reason: cmp.reason,
        });
      }
    }

    assert.deepEqual(
      failures,
      [],
      `pricing breakdown disagreements:\n` +
        failures
          .map(
            (f) =>
              `  ${f.model} (matched_rule=${f.matched_rule}): api=$${f.apiCost.toFixed(6)} oracle=$${f.oracleCost.toFixed(6)}`,
          )
          .join("\n"),
    );
  } finally {
    db.close();
  }
});

test("/api/pricing/cost.daily_costs — every daily entry is positive and dates are unique", async () => {
  // Sanity-check on daily_costs structure. Real bucketing audit needs an
  // event-on-today fixture (see FEA-1422). For now we just sanity-check
  // shape and uniqueness.
  const res = await fetch(`${baseUrl}/api/pricing/cost?tz_offset=0`);
  const body = await res.json();
  const dailyCosts = body.daily_costs || [];

  // Every entry should have a date and a cost
  for (const row of dailyCosts) {
    assert.ok(row.date, "daily_costs row missing date");
    assert.ok(typeof row.cost === "number", "daily_costs row missing numeric cost");
    assert.ok(row.cost >= 0, `daily_costs negative cost for ${row.date}: ${row.cost}`);
  }

  // Dates should be unique
  const dates = dailyCosts.map((r) => r.date);
  const uniqueDates = new Set(dates);
  assert.equal(
    uniqueDates.size,
    dates.length,
    `daily_costs has duplicate dates: ${dates.join(", ")}`,
  );
});

test("/api/pricing/cost.total_cost equals SUM of breakdown costs (internal consistency)", async () => {
  // The total_cost scalar should equal the sum of breakdown[i].cost. If they
  // disagree, one of the two is computed differently than the other.
  const res = await fetch(`${baseUrl}/api/pricing/cost?tz_offset=0`);
  const body = await res.json();
  const total = Number(body.total_cost ?? 0);
  const sumOfBreakdown = (body.breakdown || []).reduce(
    (s, r) => s + Number(r.cost ?? 0),
    0,
  );
  const cmp = compareNumeric(total, sumOfBreakdown, { eps: 0.001 });
  assert.ok(
    cmp.ok,
    `total_cost (${total}) ≠ SUM(breakdown.cost) (${sumOfBreakdown.toFixed(6)}). One of them is computed differently — internal consistency violated.`,
  );
});
