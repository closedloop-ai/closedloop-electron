// PackDetail per-pack drill-in audit. For every fixture pack, call
// /api/packs/:packId and verify installs/skills/associations array lengths
// match the DB counts.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import {
  makeTempDbPath,
  reseedPacksAndSkills,
  seedFixtureDb,
} from "../../helpers/seed-fixture-db.mjs";
import { launchSidecar } from "../../helpers/launch-sidecar.mjs";
import { pack_detail_counts_by_id } from "../../inventory/oracles.mjs";
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

async function fixturePackIds() {
  const res = await fetch(`${baseUrl}/api/packs`);
  const body = await res.json();
  const list = body.items || (Array.isArray(body) ? body : []);
  return [
    ...new Set(
      list
        .map((p) => p.pack_id)
        .filter((id) => String(id).startsWith("fixture-")),
    ),
  ];
}

test("/api/packs/:packId — per-pack installs/skills/associations match oracle", async () => {
  const ids = await fixturePackIds();
  assert.ok(ids.length > 0, "expected at least one fixture pack");

  const db = openDb(dbPath);
  try {
    const failures = [];
    for (const pid of ids) {
      const res = await fetch(`${baseUrl}/api/packs/${encodeURIComponent(pid)}`);
      assert.equal(
        res.status,
        200,
        `GET /api/packs/${pid} returned ${res.status}`,
      );
      const body = await res.json();
      const expected = pack_detail_counts_by_id(db, { packId: pid });

      const checks = [
        ["installs.length", (body.installs || []).length, expected.installs],
        ["skills.length", (body.skills || []).length, expected.skills],
        // associations may be undefined when the table doesn't exist; tolerate
        ...(expected.associations > 0 || Array.isArray(body.associations)
          ? [["associations.length", (body.associations || []).length, expected.associations]]
          : []),
      ];

      for (const [field, apiVal, oracleVal] of checks) {
        const cmp = compareNumeric(Number(apiVal), Number(oracleVal));
        if (!cmp.ok) {
          failures.push({
            packId: pid,
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
      `PackDetail per-pack disagreements:\n` +
        failures
          .map(
            (f) =>
              `  ${f.packId} ${f.field}: api=${f.apiVal} oracle=${f.oracleVal}`,
          )
          .join("\n"),
    );
  } finally {
    db.close();
  }
});
