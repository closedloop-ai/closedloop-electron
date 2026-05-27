/**
 * @file Unit tests for pr-backfill (FEA-1226 follow-up).
 * Run: node --test apps/desktop/scripts/agent-monitor-pull-requests/__tests__/
 *
 * Validates the standalone PR backfill that closes the
 * `if (existingCount === 0)` gap in the upstream legacy-session import.
 * Uses Node's built-in node:sqlite (DatabaseSync) — same DB surface as
 * pull-request-store.test.js so the suites share conventions.
 *
 * Three invariants from the PR #238 Codex review that this suite asserts:
 *   - A read failure must NOT cache the mtime (else file is permanently skipped).
 *   - A per-draft upsert failure must NOT cache the mtime (same risk).
 *   - A non-ENOENT projects-dir error must surface, not be silently swallowed.
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

/**
 * A fresh in-memory DB with both `pull_requests` and `pr_backfill_seen`
 * tables (ensurePullRequestSchema creates both — the mtime cache lives in
 * the store so all PR-related schema bootstraps in one call).
 */
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

/**
 * Build an fs wrapper that delegates to the real fs except for a single
 * call we want to override. Used to simulate EACCES / EIO without chmod.
 */
function fsWithOverride(overrides) {
  return new Proxy(fs, {
    get(target, prop) {
      if (prop in overrides) return overrides[prop];
      return target[prop];
    },
  });
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
    assert.equal(r.skipped, 0);
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

  test("idempotent — re-running with unchanged mtimes skips files entirely (no rescan)", () => {
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
    assert.equal(first.scanned, 1);
    assert.equal(first.skipped, 0);

    const second = runClaudePrBackfill(db, { projectsDir: root });
    assert.equal(
      second.scanned,
      0,
      "unchanged mtime must skip the file without reading/parsing",
    );
    assert.equal(second.skipped, 1, "should be reported as skipped");
    assert.equal(second.captured, 0);
    assert.equal(second.deduped, 0);
    assert.equal(
      store.countPullRequests(db),
      2,
      "DB row count must not grow on re-runs",
    );
  });

  test("file with bumped mtime is rescanned and captures stay deduped at the SQLite layer", () => {
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

    // Bump the file's mtime to simulate the session being appended to
    // (live Claude session writing more lines while the app was off).
    const filePath = path.join(
      root,
      "-Users-andreweye-fixture",
      "canonical-session-1.jsonl",
    );
    const stat = fs.statSync(filePath);
    const futureTime = new Date(stat.mtimeMs + 60_000);
    fs.utimesSync(filePath, futureTime, futureTime);

    const second = runClaudePrBackfill(db, { projectsDir: root });
    assert.equal(second.scanned, 1, "bumped mtime must trigger a rescan");
    assert.equal(second.skipped, 0);
    assert.equal(second.captured, 0, "deterministic id dedups DB writes");
    assert.equal(second.deduped, 2, "both PRs reported as deduped this time");
    assert.equal(store.countPullRequests(db), 2);
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
    assert.deepEqual(r, {
      captured: 0,
      deduped: 0,
      scanned: 0,
      skipped: 0,
      errors: 0,
    });
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

  test("EACCES on the projects-dir readdirSync is surfaced, not silently swallowed (Codex P2 — exact path)", () => {
    const db = freshDb();
    const eacces = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
    });
    const fakeFs = fsWithOverride({
      readdirSync: () => {
        throw eacces;
      },
    });

    const r = runClaudePrBackfill(db, {
      projectsDir: "/this/path/wont/be/touched",
      fs: fakeFs,
    });
    assert.equal(r.errors, 1, "EACCES from projects-dir read must be counted");
    assert.equal(r.scanned, 0);
    assert.equal(r.captured, 0);
  });

  test("read failure does NOT cache the mtime — next boot retries the file (Codex P1)", () => {
    const root = stageProjectsTree([
      {
        projDir: "-Users-andreweye-projE",
        sessionId: "sess-E",
        fixture: "claude-code-session.jsonl",
      },
    ]);
    const filePath = path.join(
      root,
      "-Users-andreweye-projE",
      "sess-E.jsonl",
    );
    const realFs = fs;

    // First boot: readFileSync throws EACCES → file stays uncached.
    const failingFs = fsWithOverride({
      readFileSync: (p, enc) => {
        if (p === filePath) {
          throw Object.assign(new Error("EACCES: permission denied"), {
            code: "EACCES",
          });
        }
        return realFs.readFileSync(p, enc);
      },
    });
    const db = freshDb();
    const first = runClaudePrBackfill(db, { projectsDir: root, fs: failingFs });
    assert.equal(first.errors, 1, "read failure must be counted");
    assert.equal(first.captured, 0);
    assert.equal(first.scanned, 1);

    // Verify the file was NOT marked seen — the cache must be empty for it.
    const cacheRows = db
      .prepare("SELECT * FROM pr_backfill_seen WHERE session_id = ?")
      .all("sess-E");
    assert.equal(
      cacheRows.length,
      0,
      "a failed read must NOT cache the mtime — else the file is skipped forever",
    );

    // Second boot: real fs, file is readable now → captures land normally.
    const second = runClaudePrBackfill(db, { projectsDir: root });
    assert.equal(second.scanned, 1, "uncached file must be re-attempted");
    assert.equal(second.captured, 2);
    assert.equal(second.errors, 0);
  });

  test("per-draft upsert failure does NOT cache the mtime — next boot retries (Codex P1)", () => {
    const root = stageProjectsTree([
      {
        projDir: "-Users-andreweye-projF",
        sessionId: "sess-F",
        fixture: "claude-code-session.jsonl",
      },
    ]);
    const db = freshDb();

    // Wrap the db.prepare so the upsertPullRequest prepared statement throws,
    // simulating a transient DB error during the per-draft loop. Leave the
    // upsertSeen prepared statement intact so we can prove that — despite
    // upsertSeen still working — the backfill MUST NOT call it after upsert
    // failures. (If it did, the file would be permanently skipped and the
    // dropped PRs would be lost forever.)
    const realPrepare = db.prepare.bind(db);
    const wrappedDb = new Proxy(db, {
      get(target, prop) {
        if (prop === "prepare") {
          return (sql) => {
            const stmt = realPrepare(sql);
            if (sql.startsWith("INSERT INTO pull_requests")) {
              return {
                get: stmt.get.bind(stmt),
                all: stmt.all.bind(stmt),
                run: () => {
                  throw new Error("simulated transient DB error");
                },
              };
            }
            return stmt;
          };
        }
        return target[prop];
      },
    });

    const r = runClaudePrBackfill(wrappedDb, { projectsDir: root });
    assert.equal(r.scanned, 1);
    assert.ok(r.errors >= 1, "at least one upsert failure must be counted");

    // Cache must be empty for this file — fileSucceeded gate must have held.
    const cacheRows = db
      .prepare("SELECT * FROM pr_backfill_seen WHERE session_id = ?")
      .all("sess-F");
    assert.equal(
      cacheRows.length,
      0,
      "an upsert failure must NOT cache the mtime — else the dropped PRs are lost forever",
    );
  });
});

describe("resolveClaudeProjectsDir", () => {
  test("returns a path ending in /projects", () => {
    const p = resolveClaudeProjectsDir();
    assert.equal(path.basename(p), "projects");
  });
});
