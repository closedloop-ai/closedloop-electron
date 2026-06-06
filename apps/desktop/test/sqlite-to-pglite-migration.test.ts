import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  cleanupExpiredSqliteBackups,
  migrateSqliteToPglite,
  resolvePgliteDataDir,
} from "../src/main/database/sqlite-to-pglite-migration.js";
import { prepareAgentDashboardDatabaseStartup } from "../src/main/agent-dashboard-database-startup.js";

function makeTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "cl-pglite-migration-"));
}

function seedSqlite(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        name TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        cwd TEXT,
        model TEXT,
        started_at TEXT,
        updated_at TEXT,
        ended_at TEXT,
        awaiting_input_since TEXT,
        metadata TEXT,
        harness TEXT,
        billing_mode TEXT,
        user_id TEXT,
        organization_id TEXT
      );

      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        name TEXT,
        type TEXT,
        subagent_type TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        task TEXT,
        current_tool TEXT,
        started_at TEXT,
        updated_at TEXT,
        ended_at TEXT,
        awaiting_input_since TEXT,
        parent_agent_id TEXT,
        metadata TEXT,
        user_id TEXT,
        organization_id TEXT
      );

      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        agent_id TEXT,
        event_type TEXT NOT NULL,
        tool_name TEXT,
        summary TEXT,
        data TEXT,
        created_at TEXT,
        user_id TEXT,
        organization_id TEXT
      );

      CREATE TABLE token_usage (
        session_id TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        raw_input INTEGER NOT NULL DEFAULT 0,
        raw_output INTEGER NOT NULL DEFAULT 0,
        raw_cache_read INTEGER NOT NULL DEFAULT 0,
        raw_cache_write INTEGER NOT NULL DEFAULT 0,
        created_at TEXT,
        updated_at TEXT,
        user_id TEXT,
        organization_id TEXT,
        PRIMARY KEY (session_id, model)
      );
    `);
    db.prepare(`
      INSERT INTO sessions (
        id, name, status, cwd, model, started_at, updated_at, harness,
        billing_mode, user_id, organization_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "session-1",
      "Migration fixture",
      "completed",
      "/repo",
      "claude-sonnet-4-6",
      "2026-06-01T00:00:00.000Z",
      "2026-06-01T00:01:00.000Z",
      "claude",
      "api",
      "user-1",
      "org-1",
    );
    db.prepare(`
      INSERT INTO agents (
        id, session_id, name, type, status, started_at, updated_at, user_id, organization_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "session-1-main",
      "session-1",
      "main",
      "main",
      "completed",
      "2026-06-01T00:00:00.000Z",
      "2026-06-01T00:01:00.000Z",
      "user-1",
      "org-1",
    );
    db.prepare(`
      INSERT INTO events (
        id, session_id, agent_id, event_type, tool_name, summary, data,
        created_at, user_id, organization_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "event-1",
      "session-1",
      "session-1-main",
      "PreToolUse",
      "Bash",
      "Ran command",
      "{\"ok\":true}",
      "2026-06-01T00:00:30.000Z",
      "user-1",
      "org-1",
    );
    db.prepare(`
      INSERT INTO token_usage (
        session_id, model, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, raw_input, raw_output, raw_cache_read,
        raw_cache_write, created_at, updated_at, user_id, organization_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "session-1",
      "claude-sonnet-4-6",
      100,
      20,
      5,
      1,
      100,
      20,
      5,
      1,
      "2026-06-01T00:00:00.000Z",
      "2026-06-01T00:01:00.000Z",
      "user-1",
      "org-1",
    );
  } finally {
    db.close();
  }
}

test("migrateSqliteToPglite copies rows, preserves attribution columns, and renames SQLite to .bak", async () => {
  const dir = makeTempDir();
  try {
    const sqlitePath = path.join(dir, "agent-dashboard.sqlite");
    seedSqlite(sqlitePath);

    const result = await migrateSqliteToPglite({ sqlitePath });

    assert.equal(result.status, "migrated");
    assert.equal(existsSync(sqlitePath), false, "SQLite source should be renamed");
    assert.equal(existsSync(`${sqlitePath}.bak`), true, "SQLite backup should remain");
    assert.deepEqual(result.status === "migrated" ? result.rowCounts : {}, {
      sessions: 1,
      agents: 1,
      events: 1,
      token_usage: 1,
    });

    const pg = await PGlite.create(resolvePgliteDataDir(sqlitePath));
    try {
      const sessions = await pg.query<{
        id: string;
        user_id: string | null;
        organization_id: string | null;
      }>("SELECT id, user_id, organization_id FROM sessions");
      assert.deepEqual(sessions.rows, [
        { id: "session-1", user_id: "user-1", organization_id: "org-1" },
      ]);

      const tokenUsage = await pg.query<{ input_tokens: number; output_tokens: number }>(
        "SELECT input_tokens, output_tokens FROM token_usage",
      );
      assert.deepEqual(tokenUsage.rows, [{ input_tokens: 100, output_tokens: 20 }]);
    } finally {
      await pg.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("migrateSqliteToPglite returns failed and leaves SQLite intact when PGlite initialization fails", async () => {
  const dir = makeTempDir();
  try {
    const sqlitePath = path.join(dir, "agent-dashboard.sqlite");
    const pgliteDataDir = path.join(dir, "not-a-directory");
    seedSqlite(sqlitePath);
    writeFileSync(pgliteDataDir, "blocks PGlite directory creation");

    const result = await migrateSqliteToPglite({ sqlitePath, pgliteDataDir });

    assert.equal(result.status, "failed");
    assert.equal(existsSync(sqlitePath), true, "SQLite source must remain usable");
    assert.equal(existsSync(`${sqlitePath}.bak`), false, "failed migration must not create backup");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("migrateSqliteToPglite skips when only the retained SQLite backup remains", async () => {
  const dir = makeTempDir();
  try {
    const sqlitePath = path.join(dir, "agent-dashboard.sqlite");
    writeFileSync(`${sqlitePath}.bak`, "backup");

    const result = await migrateSqliteToPglite({ sqlitePath });

    assert.equal(result.status, "skipped");
    assert.equal(result.status === "skipped" ? result.reason : "", "already_migrated");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prepareAgentDashboardDatabaseStartup leaves SQLite live for the SQLite backend", async () => {
  const dir = makeTempDir();
  try {
    const sqlitePath = path.join(dir, "agent-dashboard.sqlite");
    seedSqlite(sqlitePath);

    const result = await prepareAgentDashboardDatabaseStartup({
      userDataPath: dir,
      backend: "sqlite",
    });

    assert.equal(result.backend, "sqlite");
    assert.equal(existsSync(sqlitePath), true, "SQLite runtime must keep its live DB");
    assert.equal(existsSync(`${sqlitePath}.bak`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prepareAgentDashboardDatabaseStartup migrates before selecting the PGlite backend", async () => {
  const dir = makeTempDir();
  try {
    const sqlitePath = path.join(dir, "agent-dashboard.sqlite");
    seedSqlite(sqlitePath);

    const result = await prepareAgentDashboardDatabaseStartup({
      userDataPath: dir,
      backend: "pglite",
    });

    assert.equal(result.backend, "pglite");
    assert.equal(result.migration.status, "migrated");
    assert.equal(existsSync(sqlitePath), false);
    assert.equal(existsSync(`${sqlitePath}.bak`), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prepareAgentDashboardDatabaseStartup falls back to SQLite when PGlite migration fails", async () => {
  const dir = makeTempDir();
  try {
    const sqlitePath = path.join(dir, "agent-dashboard.sqlite");
    const pgliteDataDir = resolvePgliteDataDir(sqlitePath);
    seedSqlite(sqlitePath);
    writeFileSync(pgliteDataDir, "blocks PGlite directory creation");

    const result = await prepareAgentDashboardDatabaseStartup({
      userDataPath: dir,
      backend: "pglite",
    });

    assert.equal(result.backend, "sqlite");
    assert.equal(result.migration?.status, "failed");
    assert.equal(existsSync(sqlitePath), true, "fallback keeps SQLite live");
    assert.equal(existsSync(`${sqlitePath}.bak`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cleanupExpiredSqliteBackups deletes backups once the 30 day safety window has elapsed", async () => {
  const dir = makeTempDir();
  try {
    const sqlitePath = path.join(dir, "agent-dashboard.sqlite");
    const backupPath = `${sqlitePath}.bak`;
    writeFileSync(backupPath, "backup");
    const old = new Date("2026-01-01T00:00:00.000Z");
    utimesSync(backupPath, old, old);

    const removed = await cleanupExpiredSqliteBackups(
      sqlitePath,
      new Date("2026-02-01T00:00:00.000Z"),
    );

    assert.equal(removed, 1);
    assert.equal(existsSync(backupPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
