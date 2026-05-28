// Layer-1 audit: every manifest tile whose endpoint exposes a single numeric
// field is asserted against its oracle on the fixture DB.
//
// **Table-driven across ALL screens in the manifest.** Adding a tile means
// adding a manifest row + (if needed) a new oracle function. No new test
// code anywhere.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import {
  makeTempDbPath,
  reseedPacksAndSkills,
  seedFixtureDb,
} from "../../helpers/seed-fixture-db.mjs";
import { launchSidecar } from "../../helpers/launch-sidecar.mjs";
import { loadManifest } from "../../inventory/manifest-loader.mjs";
import {
  computeOracle,
  compareNumeric,
  getField,
  openDb,
} from "../../inventory/audit-runner.mjs";

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

const manifest = loadManifest();
const endpointCache = new Map();

async function fetchOnce(endpointWithQuery) {
  if (endpointCache.has(endpointWithQuery)) {
    return endpointCache.get(endpointWithQuery);
  }
  const url = `${baseUrl}${endpointWithQuery}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${endpointWithQuery} -> ${res.status}`);
  }
  const body = await res.json();
  endpointCache.set(endpointWithQuery, body);
  return body;
}

function buildEndpointUrl(row) {
  if (!row.endpoint || row.endpoint === "derived") return null;
  if (row.endpoint === "/api/stats") return "/api/stats?tz_offset=0";
  if (row.endpoint === "/api/analytics") return "/api/analytics?tz_offset=0";
  if (row.endpoint === "/api/pricing/totalCost") {
    return "/api/pricing/cost?tz_offset=0";
  }
  return row.endpoint;
}

// One test per tile.
for (const row of manifest.tiles) {
  const url = buildEndpointUrl(row);
  if (!url) continue; // derived/UI-only tiles

  test(`${row.screen} · ${row.id} (${row.endpoint}.${row.endpoint_field})`, async () => {
    const body = await fetchOnce(url);
    const apiValue = getField(body, row.endpoint_field);
    assert.notEqual(
      apiValue,
      undefined,
      `field "${row.endpoint_field}" missing in response from ${url}`,
    );

    const db = openDb(dbPath);
    try {
      const { expected } = computeOracle(row, db, { tzOffsetMinutes: 0 });
      const result = compareNumeric(Number(apiValue), Number(expected));
      assert.ok(
        result.ok,
        `\n` +
          `  manifest id: ${row.id}\n` +
          `  screen:      ${row.screen}${row.tab ? " · " + row.tab : ""}\n` +
          `  endpoint:    GET ${url}\n` +
          `  field:       ${row.endpoint_field}\n` +
          `  api value:   ${JSON.stringify(apiValue)}\n` +
          `  oracle:      ${row.oracle} -> ${expected}\n` +
          `  reason:      ${result.reason}\n` +
          `  bug_ref:     ${row.bug_ref ?? "(none yet — file one)"}\n`,
      );
    } finally {
      db.close();
    }
  });
}

// Structural assertions (list-length checks)
for (const row of manifest.structural) {
  if (!row.endpoint || row.endpoint === "derived") continue;
  test(`structural · ${row.screen} · ${row.id} (${row.endpoint} length)`, async () => {
    const url = row.endpoint.startsWith("/") ? row.endpoint : `/${row.endpoint}`;
    const body = await fetchOnce(url);
    const list = Array.isArray(body)
      ? body
      : body.agents || body.sessions || body.events || body.items ||
        body.skills || body.packs || body.pricing;
    assert.ok(Array.isArray(list), `expected a list response from ${url}`);

    const db = openDb(dbPath);
    try {
      const { expected } = computeOracle(row, db);
      // Filter to fixture rows only. The DB shape uses different id columns
      // depending on the table — id (sessions/agents), session_id (events,
      // PRs), skill_id (skills), pack_id (agent_packs). Pull the first
      // "fixture-"-prefixed value off any id-shaped field.
      const fixtureRows = list.filter((r) => {
        for (const k of ["id", "session_id", "skill_id", "pack_id"]) {
          if (r[k] && String(r[k]).startsWith("fixture-")) return true;
        }
        return false;
      });
      const result = compareNumeric(fixtureRows.length, Number(expected));
      assert.ok(
        result.ok,
        `\n  ${row.id}: list length ${fixtureRows.length}, oracle ${expected}`,
      );
    } finally {
      db.close();
    }
  });
}
