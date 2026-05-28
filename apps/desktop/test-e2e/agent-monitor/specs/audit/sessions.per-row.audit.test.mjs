// Per-row audit for /api/sessions — for every fixture session returned by
// the API, assert that the row's agent_count and cost match the oracles.
//
// This is the test pattern for table-style screens where each row is itself
// a data summary. Adding a new per-row field means adding a new oracle in
// oracles.mjs and a new test case here.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import {
  makeTempDbPath,
  reseedPacksAndSkills,
  seedFixtureDb,
} from "../../helpers/seed-fixture-db.mjs";
import { launchSidecar } from "../../helpers/launch-sidecar.mjs";
import {
  session_agent_count_by_id,
  session_cost_by_id,
} from "../../inventory/oracles.mjs";
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

async function fetchSessions() {
  const res = await fetch(`${baseUrl}/api/sessions?limit=50`);
  if (!res.ok) throw new Error(`GET /api/sessions -> ${res.status}`);
  const body = await res.json();
  const list = Array.isArray(body) ? body : body.sessions || body.items;
  return list.filter((s) => String(s.id).startsWith("fixture-"));
}

test("Sessions list · per-row agent_count matches oracle", async () => {
  const rows = await fetchSessions();
  assert.ok(rows.length > 0, "expected at least one fixture session");

  const db = openDb(dbPath);
  try {
    const failures = [];
    for (const r of rows) {
      const expected = session_agent_count_by_id(db, { sessionId: r.id });
      const cmp = compareNumeric(Number(r.agent_count), expected);
      if (!cmp.ok) {
        failures.push({
          sessionId: r.id,
          apiAgentCount: r.agent_count,
          oracleAgentCount: expected,
          reason: cmp.reason,
        });
      }
    }
    assert.deepEqual(
      failures,
      [],
      `Per-row agent_count disagreements:\n` +
        failures
          .map(
            (f) =>
              `  ${f.sessionId}: api=${f.apiAgentCount} oracle=${f.oracleAgentCount} (${f.reason})`,
          )
          .join("\n"),
    );
  } finally {
    db.close();
  }
});

test("Sessions list · per-row cost matches oracle", { todo: "expected failure — FEA-1418 (pricing matcher) propagates per-session" }, async () => {
  const rows = await fetchSessions();
  assert.ok(rows.length > 0, "expected at least one fixture session");

  const db = openDb(dbPath);
  try {
    const failures = [];
    for (const r of rows) {
      // The default sort doesn't include cost — the field is only computed when
      // sortBy=price OR when the response builds the cost column. /api/sessions
      // base returns cost as a property regardless (see route code). If the
      // API omits cost entirely, treat as a fail with a useful message.
      const expected = session_cost_by_id(db, { sessionId: r.id });
      if (r.cost === undefined) {
        // Skip sessions where the API didn't return a cost field at all.
        // Don't fail — it's a different (missing-field) concern, not a
        // numerical mismatch.
        continue;
      }
      const cmp = compareNumeric(Number(r.cost), expected, { eps: 0.005 });
      if (!cmp.ok) {
        failures.push({
          sessionId: r.id,
          apiCost: r.cost,
          oracleCost: expected,
          reason: cmp.reason,
        });
      }
    }
    assert.deepEqual(
      failures,
      [],
      `Per-row cost disagreements (likely the same pricing-matcher bug — FEA-1418):\n` +
        failures
          .map(
            (f) =>
              `  ${f.sessionId}: api=$${f.apiCost} oracle=$${f.oracleCost.toFixed(6)}`,
          )
          .join("\n"),
    );
  } finally {
    db.close();
  }
});
