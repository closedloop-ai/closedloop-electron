/**
 * @file Unit tests for pr-backfill (FEA-1226 follow-up).
 * Run: node --test apps/desktop/scripts/agent-monitor-pull-requests/__tests__/
 *
 * Validates the standalone PR backfill that closes the
 * `if (existingCount === 0)` gap in the upstream legacy-session import.
 * Uses Node's built-in node:sqlite (DatabaseSync) — same DB surface as
 * pull-request-store.test.js so the suites share conventions.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const store = require("../pull-request-store");
const { runClaudePrBackfill, resolveClaudeProjectsDir } = require("../pr-backfill");

const FIXTURES = path.join(__dirname, "fixtures");

/** A fresh in-memory DB with the pull_requests schema. */
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

/**
 * Stage a fake `~/.claude/projects/<projDir>/<sessionId>.jsonl` tree from
 * one or more (projDir, sessionId, fixtureName) triples, returning the root
 * directory. The fixture's path.basename(filePath, ".jsonl") IS the session
 * id the backfill pins captures to.
 */
function stageProjectsTree(entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prbackfill-"));
  for (const { projDir, sessionId, fixture } of entries) {
    const dir = path.join(root, projDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(
      path.join(FIXTURES, fixture),
      path.join(dir, `${sessionId}.jsonl`),
    );
  }
  return root;
}

describe("runClaudePrBackfill", () => {
  test("captures PRs from a staged projects tree and pins them to the file's session id", () => {
    const root = stageProjectsTree([
      {
        projDir: "-Users-andreweye-fixture",
        sessionId: "canonical-session-1",
        fixture: "claude-code-session.jsonl",
      },
    ]);
    const db = freshDb();

    const r = runClaudePrBackfill(db, { projectsDir: root });

    assert.equal(r.scanned, 1, "should scan the one staged session file");
    assert.equal(r.errors, 0, "no errors expected");
    assert.equal(r.captured, 2, "claude-code-session.jsonl yields 2 PR rows");
    assert.equal(r.deduped, 0);

    const rows = store.listPullRequests(db, { limit: 50 });
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(
        row.session_id,
        "canonical-session-1",
        "captured rows must FK-pin to the file's session id",
      );
      assert.equal(row.harness, "claude-code");
    }
  });

  test("is idempotent — re-running upserts dedup into 0 new captures", () => {
    const root = stageProjectsTree([
      {
        projDir: "-Users-andreweye-fixture",
        sessionId: "canonical-session-1",
        fixture: "claude-code-session.jsonl",
      },
    ]);
    const db = freshDb();

    const first = runClaudePrBackfill(db, { projectsDir: root });
    assert.equal(first.captured, 2);

    const second = runClaudePrBackfill(db, { projectsDir: root });
    assert.equal(second.scanned, 1);
    assert.equal(second.captured, 0, "second run should capture nothing new");
    assert.equal(second.deduped, 2, "both PRs should be reported as deduped");
    assert.equal(
      store.countPullRequests(db),
      2,
      "DB row count must not grow on re-runs",
    );
  });

  test("walks multiple project dirs", () => {
    const root = stageProjectsTree([
      {
        projDir: "-Users-andreweye-projA",
        sessionId: "sess-A",
        fixture: "claude-code-session.jsonl",
      },
      {
        projDir: "-Users-andreweye-projB",
        sessionId: "sess-B",
        fixture: "claude-code-session.jsonl",
      },
    ]);
    const db = freshDb();

    const r = runClaudePrBackfill(db, { projectsDir: root });
    assert.equal(r.scanned, 2);
    assert.equal(r.captured, 4, "2 PRs per fixture × 2 sessions");

    const sessIds = new Set(
      store.listPullRequests(db, { limit: 50 }).map((r) => r.session_id),
    );
    assert.deepEqual([...sessIds].sort(), ["sess-A", "sess-B"]);
  });

  test("ignores subagents/ subdirectories (no .jsonl at top level there)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prbackfill-sub-"));
    const projDir = path.join(root, "-Users-andreweye-projC");
    fs.mkdirSync(projDir, { recursive: true });
    // Top-level session file — should be scanned.
    fs.copyFileSync(
      path.join(FIXTURES, "claude-code-session.jsonl"),
      path.join(projDir, "sess-C.jsonl"),
    );
    // Subagent JSONL under <sessId>/subagents/ — should NOT be scanned
    // (matches importSession's single-sourceLogPath behavior).
    const subDir = path.join(projDir, "sess-C", "subagents");
    fs.mkdirSync(subDir, { recursive: true });
    fs.copyFileSync(
      path.join(FIXTURES, "claude-code-session.jsonl"),
      path.join(subDir, "agent-xyz.jsonl"),
    );

    const db = freshDb();
    const r = runClaudePrBackfill(db, { projectsDir: root });

    assert.equal(
      r.scanned,
      1,
      "subagent JSONL must not be counted as a scanned session",
    );
    assert.equal(r.captured, 2);
  });

  test("missing projects dir returns zero counts without throwing", () => {
    const db = freshDb();
    const r = runClaudePrBackfill(db, {
      projectsDir: path.join(os.tmpdir(), "prbackfill-does-not-exist-xyz"),
    });
    assert.deepEqual(r, { captured: 0, deduped: 0, scanned: 0, errors: 0 });
    assert.equal(store.countPullRequests(db), 0);
  });

  test("non-fixture / non-PR JSONLs are scanned but yield no captures", () => {
    const root = stageProjectsTree([
      {
        projDir: "-Users-andreweye-negatives",
        sessionId: "neg-sess",
        fixture: "negatives.jsonl",
      },
    ]);
    const db = freshDb();

    const r = runClaudePrBackfill(db, { projectsDir: root });
    assert.equal(r.scanned, 1);
    assert.equal(r.captured, 0, "negatives fixture must NOT produce captures");
    assert.equal(r.errors, 0);
  });
});

describe("resolveClaudeProjectsDir", () => {
  test("returns a path ending in /projects", () => {
    const p = resolveClaudeProjectsDir();
    assert.equal(path.basename(p), "projects");
  });
});
