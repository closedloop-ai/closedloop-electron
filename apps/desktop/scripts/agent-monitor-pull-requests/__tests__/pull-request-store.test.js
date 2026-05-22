/**
 * @file Unit tests for pull-request-store (FEA-1226).
 * Run: node --test apps/desktop/scripts/agent-monitor-pull-requests/__tests__/
 *
 * Uses Node's built-in node:sqlite (DatabaseSync) — its prepare/run/get/all/exec
 * surface matches the better-sqlite3 / compat-sqlite API the store targets.
 */
"use strict";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const store = require("../pull-request-store");

/** A fresh in-memory DB with the pull_requests schema + a minimal sessions table. */
function freshDb() {
  const db = new DatabaseSync(":memory:");
  // listSessionsWithPullRequests LEFT JOINs sessions — provide the columns it reads.
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, name TEXT, started_at TEXT, cwd TEXT
    );
  `);
  store.ensurePullRequestSchema(db);
  return db;
}

function pr(overrides) {
  return Object.assign(
    {
      externalSessionId: "sess-1",
      prUrl: "https://github.com/loopco/desktop/pull/100",
      prNumber: 100,
      repoFullName: "loopco/desktop",
      branchName: "feat/x",
      headSha: null,
      title: null,
      harness: "claude-code",
    },
    overrides,
  );
}

describe("ensurePullRequestSchema", () => {
  test("is idempotent — safe to call twice", () => {
    const db = freshDb();
    store.ensurePullRequestSchema(db);
    assert.equal(store.countPullRequests(db), 0);
  });
});

describe("upsertPullRequest", () => {
  test("inserts a new PR and reports created", () => {
    const db = freshDb();
    const r = store.upsertPullRequest(db, pr());
    assert.equal(r.created, true);
    assert.equal(store.countPullRequests(db), 1);
  });

  test("re-upserting the same (harness, session, url) dedups to one row", () => {
    const db = freshDb();
    store.upsertPullRequest(db, pr());
    const r = store.upsertPullRequest(db, pr());
    assert.equal(r.created, false);
    assert.equal(store.countPullRequests(db), 1);
  });

  test("the same PR url in a different session is a distinct row", () => {
    const db = freshDb();
    store.upsertPullRequest(db, pr({ externalSessionId: "sess-1" }));
    store.upsertPullRequest(db, pr({ externalSessionId: "sess-2" }));
    assert.equal(store.countPullRequests(db), 2);
  });

  test("a re-upsert backfills branch / headSha / title when newly known", () => {
    const db = freshDb();
    store.upsertPullRequest(db, pr({ branchName: null, headSha: null, title: null }));
    store.upsertPullRequest(db, pr({ branchName: "feat/x", headSha: "abc1234", title: "Add X" }));
    const row = store.listPullRequests(db)[0];
    assert.equal(row.branch_name, "feat/x");
    assert.equal(row.head_sha, "abc1234");
    assert.equal(row.title, "Add X");
  });
});

describe("listPullRequests", () => {
  test("returns newest-first and supports session / repo filters", () => {
    const db = freshDb();
    store.upsertPullRequest(db, pr({ prUrl: "https://github.com/loopco/desktop/pull/1", prNumber: 1, observedAt: "2020-01-01T00:00:00.000Z" }));
    store.upsertPullRequest(db, pr({ prUrl: "https://github.com/loopco/api/pull/2", prNumber: 2, repoFullName: "loopco/api", observedAt: "2030-01-01T00:00:00.000Z" }));
    const all = store.listPullRequests(db);
    assert.equal(all.length, 2);
    assert.equal(all[0].pr_number, 2, "newest-first");
    assert.equal(store.listPullRequests(db, { repo: "loopco/api" }).length, 1);
    assert.equal(store.listPullRequests(db, { sessionId: "sess-1" }).length, 2);
    assert.equal(store.listPullRequests(db, { sessionId: "nope" }).length, 0);
  });
});

describe("listSessionsWithPullRequests", () => {
  test("groups one row per session, joins session name, nests the PRs", () => {
    const db = freshDb();
    db.prepare(`INSERT INTO sessions (id, name, started_at, cwd) VALUES (?,?,?,?)`)
      .run("sess-1", "My Session", "2026-05-01T00:00:00.000Z", "/work/desktop");
    store.upsertPullRequest(db, pr({ externalSessionId: "sess-1", prUrl: "https://github.com/loopco/desktop/pull/1", prNumber: 1 }));
    store.upsertPullRequest(db, pr({ externalSessionId: "sess-1", prUrl: "https://github.com/loopco/desktop/pull/2", prNumber: 2 }));
    store.upsertPullRequest(db, pr({ externalSessionId: "sess-2", prUrl: "https://github.com/loopco/api/pull/9", prNumber: 9 }));

    const rows = store.listSessionsWithPullRequests(db);
    assert.equal(rows.length, 2);
    const s1 = rows.find((r) => r.session_id === "sess-1");
    assert.equal(s1.session_name, "My Session");
    assert.equal(s1.pr_count, 2);
    assert.equal(s1.pull_requests.length, 2);
    assert.equal(store.countSessionsWithPullRequests(db), 2);
  });

  test("a PR whose session was never imported still appears (null session fields)", () => {
    const db = freshDb();
    store.upsertPullRequest(db, pr({ externalSessionId: "orphan" }));
    const rows = store.listSessionsWithPullRequests(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].session_name, null);
    assert.equal(rows[0].pr_count, 1);
  });
});

describe("sessionIdsWithPullRequests / counts", () => {
  test("reports per-session PR counts and distinct repos", () => {
    const db = freshDb();
    store.upsertPullRequest(db, pr({ externalSessionId: "s1", prUrl: "https://github.com/loopco/desktop/pull/1", prNumber: 1 }));
    store.upsertPullRequest(db, pr({ externalSessionId: "s1", prUrl: "https://github.com/loopco/api/pull/2", prNumber: 2, repoFullName: "loopco/api" }));
    store.upsertPullRequest(db, pr({ externalSessionId: "s2", prUrl: "https://github.com/loopco/desktop/pull/3", prNumber: 3 }));
    const ids = store.sessionIdsWithPullRequests(db);
    assert.equal(ids.length, 2);
    assert.equal(ids.find((x) => x.session_id === "s1").c, 2);
    assert.equal(store.countRepos(db), 2);
  });
});
