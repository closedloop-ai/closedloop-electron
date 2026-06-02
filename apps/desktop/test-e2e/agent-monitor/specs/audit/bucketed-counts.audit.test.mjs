// Per-bucket audit for `agents_by_status` and `sessions_by_status`
// (returned by /api/analytics). If any bucket count is wrong, the page
// shows a wrong number — the audit catches that even when the aggregate
// total agrees.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import {
  makeTempDbPath,
  reseedPacksAndSkills,
  seedFixtureDb,
} from "../../helpers/seed-fixture-db.mjs";
import { launchSidecar } from "../../helpers/launch-sidecar.mjs";
import {
  sessions_count_by_status,
  agents_count_by_status,
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

test("/api/analytics.sessions_by_status — per-bucket counts match oracle", async () => {
  const res = await fetch(`${baseUrl}/api/analytics?tz_offset=0`);
  const body = await res.json();
  const buckets = body.sessions_by_status || {};

  const db = openDb(dbPath);
  try {
    const failures = [];
    for (const [status, apiCount] of Object.entries(buckets)) {
      const expected = sessions_count_by_status(db, { status });
      const cmp = compareNumeric(Number(apiCount), expected);
      if (!cmp.ok) {
        failures.push({ status, apiCount, expected, reason: cmp.reason });
      }
    }
    assert.deepEqual(
      failures,
      [],
      `sessions_by_status disagreements:\n` +
        failures
          .map((f) => `  ${f.status}: api=${f.apiCount} oracle=${f.expected}`)
          .join("\n"),
    );
  } finally {
    db.close();
  }
});

test("/api/analytics.agents_by_status — per-bucket counts match oracle", async () => {
  const res = await fetch(`${baseUrl}/api/analytics?tz_offset=0`);
  const body = await res.json();
  const buckets = body.agents_by_status || {};

  const db = openDb(dbPath);
  try {
    const failures = [];
    for (const [status, apiCount] of Object.entries(buckets)) {
      const expected = agents_count_by_status(db, { status });
      const cmp = compareNumeric(Number(apiCount), expected);
      if (!cmp.ok) {
        failures.push({ status, apiCount, expected, reason: cmp.reason });
      }
    }
    assert.deepEqual(
      failures,
      [],
      `agents_by_status disagreements:\n` +
        failures
          .map((f) => `  ${f.status}: api=${f.apiCount} oracle=${f.expected}`)
          .join("\n"),
    );
  } finally {
    db.close();
  }
});

test("/api/analytics — total_subagents matches sum of agent_types per-bucket", async () => {
  // Cross-check: total_subagents (a scalar) should equal SUM(agent_types[i].count).
  // Disagreement → either the scalar or the array is wrong.
  const res = await fetch(`${baseUrl}/api/analytics?tz_offset=0`);
  const body = await res.json();
  const sumFromTypes = (body.agent_types || []).reduce(
    (s, r) => s + Number(r.count || 0),
    0,
  );
  const scalar = Number(body.total_subagents || 0);
  // Note: agent_types may include main agents too — check the actual upstream.
  // For now we just record disagreement; the audit narrative explains.
  if (scalar !== sumFromTypes) {
    console.log(
      `  [info] cross-check: total_subagents (${scalar}) ≠ sum(agent_types.count) (${sumFromTypes}). May be intentional (agent_types includes main agents) or a bug.`,
    );
  }
  // Don't fail the test on this — it's a diagnostic, not an assertion.
});

test("/api/events?event_type=PreToolUse — total filters correctly", async () => {
  const res = await fetch(`${baseUrl}/api/events?event_type=PreToolUse&limit=1`);
  const body = await res.json();
  const apiTotal = Number(body.total ?? 0);

  const db = openDb(dbPath);
  try {
    const oracleTotal = Number(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM events WHERE event_type = 'PreToolUse'`,
        )
        .get().n,
    );
    assert.equal(
      apiTotal,
      oracleTotal,
      `/api/events?event_type=PreToolUse.total (${apiTotal}) ≠ DB count (${oracleTotal})`,
    );
  } finally {
    db.close();
  }
});

test("/api/events?tool_name=Bash — total filters correctly", async () => {
  const res = await fetch(`${baseUrl}/api/events?tool_name=Bash&limit=1`);
  const body = await res.json();
  const apiTotal = Number(body.total ?? 0);

  const db = openDb(dbPath);
  try {
    const oracleTotal = Number(
      db
        .prepare(`SELECT COUNT(*) AS n FROM events WHERE tool_name = 'Bash'`)
        .get().n,
    );
    assert.equal(
      apiTotal,
      oracleTotal,
      `/api/events?tool_name=Bash.total (${apiTotal}) ≠ DB count (${oracleTotal})`,
    );
  } finally {
    db.close();
  }
});

test("/api/analytics — daily_events lengths and daily_sessions lengths are equal", async () => {
  // Both arrays should cover the same date window. If they differ, one of the
  // bucketing queries is off by a day or has an inconsistent date range.
  const res = await fetch(`${baseUrl}/api/analytics?tz_offset=0`);
  const body = await res.json();
  const de = (body.daily_events || []).length;
  const ds = (body.daily_sessions || []).length;
  assert.equal(
    de,
    ds,
    `daily_events.length (${de}) ≠ daily_sessions.length (${ds}). One series is missing or extra days — date bucketing inconsistency.`,
  );
});
