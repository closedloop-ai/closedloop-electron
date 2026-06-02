// Layer-1 HTTP contract test: spawns the real sidecar against the fixture DB
// and asserts the JSON shape the UI consumes. Mounts the actual generated
// routes, so a field rename in apps/desktop/scripts/agent-monitor-packs/*.js
// (or the upstream routes copied over them) will fail here before the
// matching Playwright UI test fails.

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

test("GET /api/packs returns one row per installed pack_id", async () => {
  const res = await fetch(`${baseUrl}/api/packs`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.items), "items is an array");
  const ids = body.items.map((p) => p.pack_id).sort();
  assert.deepEqual(ids, [
    "fixture-pack-alpha",
    "fixture-pack-beta",
    "fixture-pack-gamma",
  ]);
});

test("GET /api/packs surfaces install_count, skill_count, harnesses per pack", async () => {
  const res = await fetch(`${baseUrl}/api/packs`);
  const body = await res.json();
  const byId = Object.fromEntries(body.items.map((p) => [p.pack_id, p]));

  // alpha: 1 install (claude), 2 skills
  assert.equal(byId["fixture-pack-alpha"].install_count, 1);
  assert.equal(byId["fixture-pack-alpha"].skill_count, 2);
  assert.equal(byId["fixture-pack-alpha"].harnesses, "claude");

  // beta: 2 installs (claude + codex), 1 skill, multi-harness comma-joined
  assert.equal(byId["fixture-pack-beta"].install_count, 2);
  assert.equal(byId["fixture-pack-beta"].skill_count, 1);
  const betaHarnesses = byId["fixture-pack-beta"].harnesses.split(",").sort();
  assert.deepEqual(betaHarnesses, ["claude", "codex"]);

  // gamma: 1 install, 0 skills (zero-skill rendering surface)
  assert.equal(byId["fixture-pack-gamma"].install_count, 1);
  assert.equal(byId["fixture-pack-gamma"].skill_count, 0);
});

test("GET /api/packs/:id returns pack detail with installs[] and skills[]", async () => {
  const res = await fetch(`${baseUrl}/api/packs/fixture-pack-alpha`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.pack_id, "fixture-pack-alpha");
  assert.ok(Array.isArray(body.installs));
  assert.equal(body.installs.length, 1);
  assert.equal(body.installs[0].harness, "claude");
  assert.ok(Array.isArray(body.skills));
  assert.equal(body.skills.length, 2);
  const skillNames = body.skills.map((s) => s.name).sort();
  assert.deepEqual(skillNames, ["alpha-skill-one", "alpha-skill-two"]);
});

test("GET /api/packs/:id 404s for an unknown pack", async () => {
  const res = await fetch(`${baseUrl}/api/packs/does-not-exist-anywhere`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.match(body.error?.message || "", /not found/i);
});

test("GET /api/packs/:id/skills lists only that pack's skills", async () => {
  const res = await fetch(`${baseUrl}/api/packs/fixture-pack-beta/skills`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].name, "beta-skill-one");
  assert.equal(body.items[0].pack_id, "fixture-pack-beta");
});
