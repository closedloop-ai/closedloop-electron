// Shared test helpers for agent-session-sync-service tests.
//
// Extracted from `agent-session-sync-service.test.ts` (PR #258 review,
// thadeusb): the same `createServiceTestDatabase` + `flushAgentSessionSync`
// were verbatim-duplicated into the FEA-1461 rate-limit-deadletter test
// file. CLAUDE.md flags this exact pattern as a `tests|duplication`
// learned-mistake — the duplicated schema setup drifts silently the next
// time the agent-monitor tables change.
//
// Anything new that needs a sandbox dashboard.db + a sync-loop flush goes
// here, not into a second copy in a new test file.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Materialize a tmp dashboard.db with the full agent-monitor schema the
 * sync service expects to read against. Returns the open DatabaseSync — the
 * caller is responsible for `db.close()` at end-of-test.
 *
 * The schema is intentionally explicit rather than reused from the
 * production migration code, so a future migration is forced to update
 * this helper alongside it (the test failure that follows is the desired
 * forcing function).
 */
export function createAgentMonitorTestDatabase(rootDir: string): DatabaseSync {
  const userDataDir = path.join(rootDir, "user-data");
  mkdirSync(path.join(userDataDir, "agent-monitor"), { recursive: true });
  const db = new DatabaseSync(
    path.join(userDataDir, "agent-monitor", "dashboard.db"),
  );
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      name TEXT,
      status TEXT NOT NULL,
      cwd TEXT,
      model TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      ended_at TEXT,
      awaiting_input_since TEXT,
      metadata TEXT,
      harness TEXT NOT NULL,
      billing_mode TEXT NOT NULL DEFAULT 'unknown'
    );
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      subagent_type TEXT,
      status TEXT NOT NULL,
      task TEXT,
      current_tool TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      ended_at TEXT,
      awaiting_input_since TEXT,
      parent_agent_id TEXT,
      metadata TEXT
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      agent_id TEXT,
      event_type TEXT NOT NULL,
      tool_name TEXT,
      summary TEXT,
      data TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE token_usage (
      session_id TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      baseline_input INTEGER NOT NULL DEFAULT 0,
      baseline_output INTEGER NOT NULL DEFAULT 0,
      baseline_cache_read INTEGER NOT NULL DEFAULT 0,
      baseline_cache_write INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE model_pricing (
      model_pattern TEXT PRIMARY KEY,
      input_per_mtok REAL NOT NULL DEFAULT 0,
      output_per_mtok REAL NOT NULL DEFAULT 0,
      cache_read_per_mtok REAL NOT NULL DEFAULT 0,
      cache_write_per_mtok REAL NOT NULL DEFAULT 0
    );
  `);
  return db;
}

/**
 * Insert a sessions row with sensible defaults for fields the sync-service
 * tests don't typically care about (name, cwd, harness). Pass overrides
 * via the optional fields.
 */
export function insertTestSessionRow(
  db: DatabaseSync,
  session: {
    id: string;
    startedAt: string;
    updatedAt: string;
    status?: string;
    harness?: string;
    cwd?: string | null;
    billingMode?: string;
  },
): void {
  db.prepare(`
    INSERT INTO sessions (
      id, name, status, cwd, model, started_at, updated_at, ended_at,
      awaiting_input_since, metadata, harness, billing_mode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id,
    session.id,
    session.status ?? "active",
    session.cwd ?? "/home/user/Work",
    null,
    session.startedAt,
    session.updatedAt,
    null,
    null,
    null,
    session.harness ?? "claude",
    session.billingMode ?? "unknown",
  );
}

/**
 * Drain the microtask + macrotask queues so any pending sync-service work
 * scheduled via `Promise.resolve()` chains or `setImmediate` has a chance
 * to settle before the test continues. Mirrors the pattern used across the
 * sync-service test suite.
 */
export async function flushAgentSessionSync(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}
