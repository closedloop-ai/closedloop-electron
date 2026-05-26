// Layer-1 HTTP contract test for the dashboard-tile endpoints. These are
// served by the upstream agent-dashboard package, but they are the API surface
// the UI reads — and a behavior change there (or in the build patch chain)
// would silently break the Dashboard view.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import {
  makeTempDbPath,
  reseedPacksAndSkills,
  seedFixtureDb,
} from "../../helpers/seed-fixture-db.mjs";
import { launchSidecar } from "../../helpers/launch-sidecar.mjs";

let sidecar;
let cleanupDb;
let baseUrl;

before(async () => {
  const tmp = makeTempDbPath();
  cleanupDb = tmp.cleanup;
  seedFixtureDb(tmp.dbPath);
  sidecar = await launchSidecar({ dbPath: tmp.dbPath });
  reseedPacksAndSkills(tmp.dbPath);
  baseUrl = sidecar.baseUrl;
});

after(async () => {
  await sidecar.stop();
  cleanupDb();
});

test("GET /api/stats matches fixture session/agent counts", async () => {
  const res = await fetch(`${baseUrl}/api/stats?tz_offset=0`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.total_sessions, 5);
  assert.equal(body.active_sessions, 2);
  assert.equal(body.total_agents, 6);
  assert.equal(body.active_agents, 2);
  assert.equal(body.sessions_by_status.active, 2);
  assert.equal(body.sessions_by_status.completed, 2);
  assert.equal(body.sessions_by_status.error, 1);
  assert.equal(body.agents_by_status.working, 2);
});

test("GET /api/sessions returns all 5 fixture sessions", async () => {
  const res = await fetch(`${baseUrl}/api/sessions?limit=50`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const list = Array.isArray(body) ? body : body.sessions || body.items;
  assert.ok(Array.isArray(list), "sessions list is an array");
  const fixtureIds = list
    .map((s) => s.id)
    .filter((id) => id.startsWith("fixture-sess-"))
    .sort();
  assert.deepEqual(fixtureIds, [
    "fixture-sess-active-1",
    "fixture-sess-active-2",
    "fixture-sess-completed-1",
    "fixture-sess-completed-2",
    "fixture-sess-error-1",
  ]);
});

test("GET /api/agents?status=working returns the 2 working fixture agents", async () => {
  const res = await fetch(`${baseUrl}/api/agents?status=working&limit=20`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.agents));
  const fixtureWorking = body.agents.filter((a) =>
    a.session_id.startsWith("fixture-sess-"),
  );
  assert.equal(fixtureWorking.length, 2);
  const sessIds = fixtureWorking.map((a) => a.session_id).sort();
  assert.deepEqual(sessIds, [
    "fixture-sess-active-1",
    "fixture-sess-active-2",
  ]);
});

test("GET /api/pricing/cost?tz_offset=0 returns cost breakdown by model", async () => {
  const res = await fetch(`${baseUrl}/api/pricing/cost?tz_offset=0`);
  assert.equal(res.status, 200);
  const body = await res.json();
  // Schema check — actual numbers depend on the dashboard's pricing math.
  // What we care about: the response surface is stable.
  assert.ok(
    "total_cost" in body || "total" in body || "by_model" in body,
    `cost response should expose total/by_model; got keys: ${Object.keys(body).join(", ")}`,
  );
});
