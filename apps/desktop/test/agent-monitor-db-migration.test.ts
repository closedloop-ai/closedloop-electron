import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { openAgentDatabase } from "../src/main/database/index.js";
import { migrateVendorDashboardDb } from "../src/main/agent-monitor-db-migration.js";
import { loadMeteredUsageRows, reconciliationCutoffIso } from "../src/main/reconciliation-worker.js";

function makeWorkspace() {
  const userData = mkdtempSync(path.join(tmpdir(), "cl-migrate-"));
  return {
    userData,
    vendorPath: path.join(userData, "agent-monitor", "dashboard.db"),
    cleanup() {
      rmSync(userData, { recursive: true, force: true });
    },
  };
}

/** Seed a vendor-shape dashboard.db (baseline_* columns) with one session. */
function seedVendorDb(vendorPath: string): void {
  mkdirSync(path.dirname(vendorPath), { recursive: true });
  const db = new DatabaseSync(vendorPath);
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, name TEXT, status TEXT, cwd TEXT, model TEXT,
      started_at TEXT, updated_at TEXT, ended_at TEXT, awaiting_input_since TEXT, metadata TEXT,
      harness TEXT, billing_mode TEXT);
    CREATE TABLE agents (id TEXT PRIMARY KEY, session_id TEXT, name TEXT, type TEXT, subagent_type TEXT,
      status TEXT, task TEXT, current_tool TEXT, started_at TEXT, updated_at TEXT, ended_at TEXT,
      awaiting_input_since TEXT, parent_agent_id TEXT, metadata TEXT);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, agent_id TEXT,
      event_type TEXT, tool_name TEXT, summary TEXT, data TEXT, created_at TEXT);
    CREATE TABLE token_usage (session_id TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER,
      cache_read_tokens INTEGER, cache_write_tokens INTEGER, baseline_input INTEGER, baseline_output INTEGER,
      baseline_cache_read INTEGER, baseline_cache_write INTEGER, PRIMARY KEY (session_id, model));
  `);
  db.prepare(`INSERT INTO sessions (id, name, status, started_at, updated_at, harness, billing_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run("vend-1", "Vendor session", "completed", "2026-05-20T10:00:00Z", "2026-05-20T10:05:00Z", "claude", "api");
  db.prepare(`INSERT INTO agents (id, session_id, name, type, status, started_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run("vend-1-main", "vend-1", "main", "main", "completed", "2026-05-20T10:00:00Z", "2026-05-20T10:05:00Z");
  db.prepare(`INSERT INTO events (session_id, agent_id, event_type, tool_name, created_at)
    VALUES (?, ?, ?, ?, ?)`).run("vend-1", "vend-1-main", "PreToolUse", "Bash", "2026-05-20T10:01:00Z");
  db.prepare(`INSERT INTO token_usage (session_id, model, input_tokens, output_tokens, cache_read_tokens,
    cache_write_tokens, baseline_input, baseline_output, baseline_cache_read, baseline_cache_write)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run("vend-1", "claude-opus-4-5", 1000, 200, 50, 10, 500, 100, 25, 5);
  db.close();
}

test("boot migration imports vendor dashboard.db (baseline->effective) and renames it", () => {
  const ws = makeWorkspace();
  try {
    seedVendorDb(ws.vendorPath);
    const db = openAgentDatabase(path.join(ws.userData, "agent-dashboard.sqlite"));

    const result = migrateVendorDashboardDb(ws.userData, db);
    assert.equal(result.migrated, true);
    assert.equal(result.sessions, 1);
    assert.equal(result.agents, 1);
    assert.equal(result.events, 1);
    assert.equal(result.tokenRows, 1);

    const session = db.sessions.getById("vend-1");
    assert.ok(session, "vendor session imported");
    assert.equal(session!.billingMode, "api");
    assert.equal(session!.harness, "claude");

    const tokens = db.tokenUsage.getBySession("vend-1");
    assert.equal(tokens.length, 1);
    // Effective = raw + baseline (1000+500, 200+100, 50+25, 10+5).
    assert.equal(tokens[0].inputTokens, 1500);
    assert.equal(tokens[0].outputTokens, 300);
    assert.equal(tokens[0].cacheReadTokens, 75);
    assert.equal(tokens[0].cacheWriteTokens, 15);

    assert.equal(db.agents.getBySession("vend-1").length, 1);

    // Renamed, not deleted (downgrade safety).
    assert.equal(existsSync(ws.vendorPath), false, "dashboard.db removed from original path");
    assert.equal(existsSync(ws.vendorPath + ".migrated"), true, "dashboard.db.migrated present");

    db.close();
  } finally {
    ws.cleanup();
  }
});

test("boot migration is idempotent: a second run no-ops once renamed", () => {
  const ws = makeWorkspace();
  try {
    seedVendorDb(ws.vendorPath);
    const db = openAgentDatabase(path.join(ws.userData, "agent-dashboard.sqlite"));
    migrateVendorDashboardDb(ws.userData, db);
    const second = migrateVendorDashboardDb(ws.userData, db);
    assert.equal(second.migrated, false, "no dashboard.db left to migrate");
    assert.equal(db.sessions.getAll().length, 1, "no duplicate import");
    db.close();
  } finally {
    ws.cleanup();
  }
});

test("boot migration no-ops when there is no vendor dashboard.db", () => {
  const ws = makeWorkspace();
  try {
    const db = openAgentDatabase(path.join(ws.userData, "agent-dashboard.sqlite"));
    const result = migrateVendorDashboardDb(ws.userData, db);
    assert.equal(result.migrated, false);
    db.close();
  } finally {
    ws.cleanup();
  }
});

test("cost reconciliation reads the real v4 schema with no baseline columns (no 'no such column')", () => {
  // The plan-challenge blocker: after the cutover the reconciliation worker
  // reads the in-process DB. Assert loadMeteredUsageRows works against the REAL
  // openAgentDatabase v4 schema (which has no baseline_* columns) and returns
  // the effective metered rows.
  const ws = makeWorkspace();
  try {
    const db = openAgentDatabase(path.join(ws.userData, "agent-dashboard.sqlite"));
    db.connection
      .prepare(`INSERT INTO sessions (id, status, started_at, updated_at, harness, billing_mode)
        VALUES (?, 'completed', ?, ?, 'claude', 'api')`)
      .run("s1", "2026-05-20T10:00:00Z", "2026-05-20T10:05:00Z");
    db.tokenUsage.replace("s1", "claude-opus-4-5", { input: 1500, output: 300, cacheRead: 75, cacheWrite: 15 }, "2026-05-20T10:05:00Z");

    const cutoff = reconciliationCutoffIso(new Date("2026-05-28T00:00:00Z"), 35);
    const rows = loadMeteredUsageRows(db.connection, cutoff);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sessionId, "s1");
    assert.equal(rows[0].billingMode, "api");
    assert.equal(rows[0].inputTokens, 1500);
    db.close();
  } finally {
    ws.cleanup();
  }
});
