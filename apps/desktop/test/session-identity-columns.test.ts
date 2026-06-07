import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { openAgentDatabase } from "../src/main/database/index.js";
import { createLifecycle, type HookData } from "../src/main/database/lifecycle.js";
import { CURRENT_SCHEMA_VERSION } from "../src/main/database/schema.js";
import { loadSyncedSessions } from "../src/main/agent-session-sync-service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "cl-identity-"));
  const db = openAgentDatabase(path.join(dir, "agent-dashboard.sqlite"));
  return { db, dir };
}

function cleanup(db: ReturnType<typeof openAgentDatabase>, dir: string) {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// T-1.1: Schema migration adds user_id and organization_id columns
// ---------------------------------------------------------------------------

test("schema v6 migration adds user_id and organization_id columns to sessions", () => {
  const { db, dir } = makeTmpDb();
  try {
    assert.ok(CURRENT_SCHEMA_VERSION >= 6, "schema includes the v6 identity-column migration");

    // Verify columns exist by inserting a row with user_id/organization_id
    db.connection.exec(`
      INSERT INTO sessions (id, name, status, cwd, model, started_at, updated_at, harness, user_id, organization_id)
      VALUES ('test-1', 'test', 'active', '/work', NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'claude', 'u-123', 'org-456')
    `);
    const row = db.connection.prepare("SELECT user_id, organization_id FROM sessions WHERE id = 'test-1'").get() as {
      user_id: string | null;
      organization_id: string | null;
    };
    assert.equal(row.user_id, "u-123");
    assert.equal(row.organization_id, "org-456");
  } finally {
    cleanup(db, dir);
  }
});

test("schema v6 columns are nullable (pre-signup sessions)", () => {
  const { db, dir } = makeTmpDb();
  try {
    db.connection.exec(`
      INSERT INTO sessions (id, name, status, cwd, model, started_at, updated_at, harness)
      VALUES ('test-2', 'test', 'active', '/work', NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'claude')
    `);
    const row = db.connection.prepare("SELECT user_id, organization_id FROM sessions WHERE id = 'test-2'").get() as {
      user_id: string | null;
      organization_id: string | null;
    };
    assert.equal(row.user_id, null, "user_id is null for pre-signup sessions");
    assert.equal(row.organization_id, null, "organization_id is null for pre-signup sessions");
  } finally {
    cleanup(db, dir);
  }
});

test("schema v6 indexes on user_id and organization_id exist", () => {
  const { db, dir } = makeTmpDb();
  try {
    const indexes = db.connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sessions'")
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);
    assert.ok(indexNames.includes("idx_sessions_user_id"), "user_id index exists");
    assert.ok(indexNames.includes("idx_sessions_organization_id"), "organization_id index exists");
  } finally {
    cleanup(db, dir);
  }
});

// ---------------------------------------------------------------------------
// T-1.2: Session store exposes userId and organizationId
// ---------------------------------------------------------------------------

test("session store toRow maps user_id and organization_id to camelCase", () => {
  const { db, dir } = makeTmpDb();
  try {
    db.connection.exec(`
      INSERT INTO sessions (id, name, status, cwd, model, started_at, updated_at, harness, user_id, organization_id)
      VALUES ('s-store', 'store test', 'active', '/work', NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'claude', 'u-abc', 'org-xyz')
    `);
    db.connection.exec(`
      INSERT INTO agents (id, session_id, name, type, status, started_at, updated_at)
      VALUES ('s-store-main', 's-store', 'main', 'main', 'working', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `);
    const session = db.sessions.getById("s-store");
    assert.ok(session);
    assert.equal(session.userId, "u-abc");
    assert.equal(session.organizationId, "org-xyz");
  } finally {
    cleanup(db, dir);
  }
});

test("session store toRow returns null for missing identity columns", () => {
  const { db, dir } = makeTmpDb();
  try {
    db.connection.exec(`
      INSERT INTO sessions (id, name, status, cwd, model, started_at, updated_at, harness)
      VALUES ('s-no-id', 'no identity', 'active', '/work', NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'claude')
    `);
    const session = db.sessions.getById("s-no-id");
    assert.ok(session);
    assert.equal(session.userId, null);
    assert.equal(session.organizationId, null);
  } finally {
    cleanup(db, dir);
  }
});

// ---------------------------------------------------------------------------
// T-1.3: Lifecycle stamps userId/organizationId on session creation
// ---------------------------------------------------------------------------

test("lifecycle stamps user_id and organization_id from getUserIdentity", () => {
  const { db, dir } = makeTmpDb();
  try {
    const lifecycle = createLifecycle(db.connection, {
      tokenUsage: db.tokenUsage,
      detectBillingMode: () => "api",
      extractTranscript: () => null,
      getUserIdentity: () => ({ userId: "u-lifecycle", organizationId: "org-lifecycle" }),
    });
    lifecycle.processEvent("SessionStart", { session_id: "s-ident", cwd: "/work" } as HookData, "claude");

    const row = db.connection.prepare("SELECT user_id, organization_id FROM sessions WHERE id = 's-ident'").get() as {
      user_id: string | null;
      organization_id: string | null;
    };
    assert.equal(row.user_id, "u-lifecycle");
    assert.equal(row.organization_id, "org-lifecycle");
  } finally {
    cleanup(db, dir);
  }
});

test("lifecycle stamps null identity when getUserIdentity returns null", () => {
  const { db, dir } = makeTmpDb();
  try {
    const lifecycle = createLifecycle(db.connection, {
      tokenUsage: db.tokenUsage,
      detectBillingMode: () => "api",
      extractTranscript: () => null,
      getUserIdentity: () => null,
    });
    lifecycle.processEvent("SessionStart", { session_id: "s-anon", cwd: "/work" } as HookData, "claude");

    const row = db.connection.prepare("SELECT user_id, organization_id FROM sessions WHERE id = 's-anon'").get() as {
      user_id: string | null;
      organization_id: string | null;
    };
    assert.equal(row.user_id, null);
    assert.equal(row.organization_id, null);
  } finally {
    cleanup(db, dir);
  }
});

test("lifecycle stamps null identity when getUserIdentity is not provided", () => {
  const { db, dir } = makeTmpDb();
  try {
    const lifecycle = createLifecycle(db.connection, {
      tokenUsage: db.tokenUsage,
      detectBillingMode: () => "api",
      extractTranscript: () => null,
      // getUserIdentity intentionally omitted
    });
    lifecycle.processEvent("SessionStart", { session_id: "s-noget", cwd: "/work" } as HookData, "claude");

    const row = db.connection.prepare("SELECT user_id, organization_id FROM sessions WHERE id = 's-noget'").get() as {
      user_id: string | null;
      organization_id: string | null;
    };
    assert.equal(row.user_id, null);
    assert.equal(row.organization_id, null);
  } finally {
    cleanup(db, dir);
  }
});

// ---------------------------------------------------------------------------
// T-1.4: Sync payload includes userId and organizationId
// ---------------------------------------------------------------------------

test("loadSyncedSessions includes userId and organizationId in payload", () => {
  const { db, dir } = makeTmpDb();
  try {
    db.connection.exec(`
      INSERT INTO sessions (id, name, status, cwd, model, started_at, updated_at, harness, billing_mode, user_id, organization_id)
      VALUES ('s-sync', 'sync test', 'completed', '/work', 'claude-3.5-sonnet', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z', 'claude', 'api', 'u-sync-1', 'org-sync-1')
    `);

    const sessions = loadSyncedSessions(db.connection, ["s-sync"]);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].userId, "u-sync-1");
    assert.equal(sessions[0].organizationId, "org-sync-1");
  } finally {
    cleanup(db, dir);
  }
});

test("loadSyncedSessions omits userId/organizationId for pre-signup sessions", () => {
  const { db, dir } = makeTmpDb();
  try {
    db.connection.exec(`
      INSERT INTO sessions (id, name, status, cwd, model, started_at, updated_at, harness, billing_mode)
      VALUES ('s-sync-anon', 'anon test', 'completed', '/work', 'claude-3.5-sonnet', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z', 'claude', 'api')
    `);

    const sessions = loadSyncedSessions(db.connection, ["s-sync-anon"]);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].userId, undefined);
    assert.equal(sessions[0].organizationId, undefined);
  } finally {
    cleanup(db, dir);
  }
});

// ---------------------------------------------------------------------------
// Schema upgrade path: existing v5 database upgrades to v6 without data loss
// ---------------------------------------------------------------------------

test("v5 → v6 upgrade preserves existing session data", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cl-upgrade-"));
  const dbPath = path.join(dir, "agent-dashboard.sqlite");

  // Create a v5 database manually
  const rawDb = new DatabaseSync(dbPath);
  rawDb.exec(`
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
      billing_mode TEXT
    );
    INSERT INTO sessions (id, name, status, cwd, started_at, updated_at, harness, billing_mode)
    VALUES ('pre-upgrade', 'old session', 'completed', '/old', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 'claude', 'api');
    PRAGMA user_version = 5;
  `);
  // Create the other required tables for the migration path
  rawDb.exec(`
    CREATE TABLE agents (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, name TEXT, type TEXT, subagent_type TEXT, status TEXT NOT NULL DEFAULT 'running', task TEXT, current_tool TEXT, started_at TEXT, updated_at TEXT, ended_at TEXT, awaiting_input_since TEXT, parent_agent_id TEXT, metadata TEXT);
    CREATE TABLE events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, agent_id TEXT, event_type TEXT NOT NULL, tool_name TEXT, summary TEXT, data TEXT, created_at TEXT);
    CREATE TABLE token_usage (session_id TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0, raw_input INTEGER NOT NULL DEFAULT 0, raw_output INTEGER NOT NULL DEFAULT 0, raw_cache_read INTEGER NOT NULL DEFAULT 0, raw_cache_write INTEGER NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT, PRIMARY KEY (session_id, model));
  `);
  rawDb.close();

  // Now open via the production path which should run the v6 migration
  const db = openAgentDatabase(dbPath);
  try {
    const version = (db.connection.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    assert.equal(version, CURRENT_SCHEMA_VERSION, "schema upgraded to the current version");

    // Verify pre-existing session still has all its data
    const session = db.sessions.getById("pre-upgrade");
    assert.ok(session);
    assert.equal(session.name, "old session");
    assert.equal(session.status, "completed");
    assert.equal(session.cwd, "/old");
    assert.equal(session.harness, "claude");
    // New columns should be null for pre-existing sessions
    assert.equal(session.userId, null);
    assert.equal(session.organizationId, null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
