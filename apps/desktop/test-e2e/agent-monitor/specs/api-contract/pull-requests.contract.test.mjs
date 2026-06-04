// Layer-1 HTTP contract test for the pull-requests router copied into the
// sidecar at apps/desktop/scripts/agent-monitor-pull-requests/pull-requests-route.js

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

test("GET /api/pull-requests returns the captured PR list with total/limit/offset", async () => {
  const res = await fetch(`${baseUrl}/api/pull-requests`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.pull_requests));
  assert.equal(body.total, 3);
  const urls = body.pull_requests.map((p) => p.pr_url).sort();
  assert.deepEqual(urls, [
    "https://github.com/example/fixture-repo-a/pull/42",
    "https://github.com/example/fixture-repo-a/pull/43",
    "https://github.com/example/fixture-repo-c/pull/7",
  ]);
});

test("each PR row exposes the fields the UI renders (repo, branch, harness, title)", async () => {
  const res = await fetch(`${baseUrl}/api/pull-requests`);
  const body = await res.json();
  const fortyTwo = body.pull_requests.find((p) => p.pr_number === 42);
  assert.ok(fortyTwo, "PR #42 should be present");
  assert.equal(fortyTwo.repo_full_name, "example/fixture-repo-a");
  assert.equal(fortyTwo.branch_name, "fix/auth-bug");
  assert.equal(fortyTwo.harness, "claude");
  assert.match(fortyTwo.title, /Fix auth bug/);
  assert.equal(fortyTwo.session_id, "fixture-sess-completed-1");
});

test("PR list contains entries from multiple harnesses (claude + codex)", async () => {
  const res = await fetch(`${baseUrl}/api/pull-requests`);
  const body = await res.json();
  const harnesses = new Set(body.pull_requests.map((p) => p.harness));
  assert.ok(harnesses.has("claude"));
  assert.ok(harnesses.has("codex"));
});

test("PR list contains entries from multiple repos (a + c)", async () => {
  const res = await fetch(`${baseUrl}/api/pull-requests`);
  const body = await res.json();
  const repos = new Set(body.pull_requests.map((p) => p.repo_full_name));
  assert.equal(repos.size, 2);
  assert.ok(repos.has("example/fixture-repo-a"));
  assert.ok(repos.has("example/fixture-repo-c"));
});
