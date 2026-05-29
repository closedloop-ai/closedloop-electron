// SessionDetail per-session drill-in audit. For every fixture session, call
// /api/sessions/:id/stats and check every numeric field against an oracle
// computed from the DB scoped to that session_id.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import {
  makeTempDbPath,
  reseedPacksAndSkills,
  seedFixtureDb,
} from "../../helpers/seed-fixture-db.mjs";
import { launchSidecar } from "../../helpers/launch-sidecar.mjs";
import { session_stats_by_id } from "../../inventory/oracles.mjs";
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

async function fixtureSessionIds() {
  const res = await fetch(`${baseUrl}/api/sessions?limit=50`);
  const body = await res.json();
  const list = Array.isArray(body) ? body : body.sessions || body.items || [];
  return list
    .map((s) => s.id)
    .filter((id) => String(id).startsWith("fixture-"));
}

test("/api/sessions/:id/stats — per-session numeric fields match oracle", async () => {
  const ids = await fixtureSessionIds();
  assert.ok(ids.length > 0, "expected at least one fixture session");

  const db = openDb(dbPath);
  try {
    const failures = [];
    for (const sid of ids) {
      const res = await fetch(`${baseUrl}/api/sessions/${sid}/stats`);
      assert.equal(
        res.status,
        200,
        `GET /api/sessions/${sid}/stats returned ${res.status}`,
      );
      const body = await res.json();
      const expected = session_stats_by_id(db, { sessionId: sid });

      const checks = [
        ["total_events", body.total_events, expected.total_events],
        ["error_count", body.error_count, expected.error_count],
        ["agents.total", body.agents?.total, expected.agents.total],
        ["agents.main", body.agents?.main, expected.agents.main],
        ["agents.subagent", body.agents?.subagent, expected.agents.subagent],
        ["agents.compaction", body.agents?.compaction, expected.agents.compaction],
        ["tokens.input_tokens", body.tokens?.input_tokens, expected.tokens.input_tokens],
        ["tokens.output_tokens", body.tokens?.output_tokens, expected.tokens.output_tokens],
        ["tokens.cache_read_tokens", body.tokens?.cache_read_tokens, expected.tokens.cache_read_tokens],
        ["tokens.cache_write_tokens", body.tokens?.cache_write_tokens, expected.tokens.cache_write_tokens],
      ];

      for (const [field, apiVal, oracleVal] of checks) {
        const cmp = compareNumeric(Number(apiVal ?? 0), Number(oracleVal ?? 0));
        if (!cmp.ok) {
          failures.push({
            sessionId: sid,
            field,
            apiVal,
            oracleVal,
            reason: cmp.reason,
          });
        }
      }
    }

    assert.deepEqual(
      failures,
      [],
      `SessionDetail per-session disagreements (${failures.length} across ${ids.length} sessions):\n` +
        failures
          .map(
            (f) =>
              `  ${f.sessionId} ${f.field}: api=${f.apiVal} oracle=${f.oracleVal}`,
          )
          .join("\n"),
    );
  } finally {
    db.close();
  }
});
