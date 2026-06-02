import { existsSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolveAgentMonitorDatabasePath } from "./agent-session-sync-service.js";
import type { AgentDatabase } from "./database/index.js";

// CLOSEDLOOP-TICKET FEA-1501: remove dashboard.db migration adapter after
// backfill completion (FEA-1497 breaking-change discipline contract #2). This one-time
// boot import carries the vendor sidecar's historical sessions/agents/events/
// token usage into the in-process DB, then RENAMES dashboard.db to
// dashboard.db.migrated (not delete) so a downgrade to an older app version can
// still read its data. Remove this adapter + the renamed file once all active
// installs have migrated and no downgrade path is supported.

const MIGRATED_SUFFIX = ".migrated";

interface MigrationResult {
  migrated: boolean;
  sessions: number;
  agents: number;
  events: number;
  tokenRows: number;
}

/**
 * Idempotent one-time migration. No-ops when the vendor dashboard.db is absent
 * or has already been renamed. Each entity insert uses INSERT OR IGNORE keyed
 * on the destination primary key, so re-importing a session that already exists
 * in the in-process DB (e.g. a live session) never clobbers it. Best-effort:
 * any failure is reported via `log` and leaves dashboard.db in place for a
 * later retry rather than throwing into boot.
 */
export function migrateVendorDashboardDb(
  userDataPath: string,
  db: AgentDatabase,
  log: (message: string) => void = () => {},
): MigrationResult {
  const empty: MigrationResult = { migrated: false, sessions: 0, agents: 0, events: 0, tokenRows: 0 };
  const vendorPath = resolveAgentMonitorDatabasePath(userDataPath);
  if (!existsSync(vendorPath) || existsSync(vendorPath + MIGRATED_SUFFIX)) {
    return empty;
  }

  let vendor: DatabaseSync;
  try {
    vendor = new DatabaseSync(vendorPath);
  } catch (error) {
    log(`vendor DB migration: cannot open ${vendorPath}: ${describe(error)}`);
    return empty;
  }

  const result: MigrationResult = { ...empty, migrated: true };
  const conn = db.connection;
  try {
    vendor.exec("PRAGMA busy_timeout = 5000");

    conn.exec("BEGIN IMMEDIATE");
    try {
      result.sessions = copySessions(vendor, conn);
      result.agents = copyAgents(vendor, conn);
      result.events = copyEvents(vendor, conn);
      result.tokenRows = copyTokenUsage(vendor, conn);
      conn.exec("COMMIT");
    } catch (error) {
      conn.exec("ROLLBACK");
      log(`vendor DB migration: import failed, dashboard.db left in place: ${describe(error)}`);
      return empty;
    }
  } finally {
    vendor.close();
  }

  // Rename (not delete) so an older app version can still read its data on
  // downgrade. The WAL/SHM sidecar files are renamed too when present.
  try {
    renameSync(vendorPath, vendorPath + MIGRATED_SUFFIX);
    for (const sidecar of ["-wal", "-shm"]) {
      if (existsSync(vendorPath + sidecar)) {
        renameSync(vendorPath + sidecar, vendorPath + MIGRATED_SUFFIX + sidecar);
      }
    }
  } catch (error) {
    log(`vendor DB migration: imported but could not rename dashboard.db: ${describe(error)}`);
  }

  log(
    `vendor DB migration: imported ${result.sessions} sessions, ${result.agents} agents, ` +
      `${result.events} events, ${result.tokenRows} token rows; renamed dashboard.db -> dashboard.db.migrated`,
  );
  return result;
}

function copySessions(vendor: DatabaseSync, conn: DatabaseSync): number {
  const rows = vendor
    .prepare(
      `SELECT id, name, status, cwd, model, started_at, updated_at, ended_at,
              awaiting_input_since, metadata, harness, billing_mode
       FROM sessions`,
    )
    .all() as Record<string, unknown>[];
  const insert = conn.prepare(
    `INSERT OR IGNORE INTO sessions
       (id, name, status, cwd, model, started_at, updated_at, ended_at,
        awaiting_input_since, metadata, harness, billing_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    insert.run(
      r.id as string,
      (r.name as string) ?? null,
      (r.status as string) ?? "completed",
      (r.cwd as string) ?? null,
      (r.model as string) ?? null,
      (r.started_at as string) ?? null,
      (r.updated_at as string) ?? null,
      (r.ended_at as string) ?? null,
      (r.awaiting_input_since as string) ?? null,
      (r.metadata as string) ?? null,
      (r.harness as string) ?? null,
      (r.billing_mode as string) ?? null,
    );
  }
  return rows.length;
}

function copyAgents(vendor: DatabaseSync, conn: DatabaseSync): number {
  const rows = vendor
    .prepare(
      `SELECT id, session_id, name, type, subagent_type, status, task, current_tool,
              started_at, updated_at, ended_at, awaiting_input_since, parent_agent_id, metadata
       FROM agents`,
    )
    .all() as Record<string, unknown>[];
  const insert = conn.prepare(
    `INSERT OR IGNORE INTO agents
       (id, session_id, name, type, subagent_type, status, task, current_tool,
        started_at, updated_at, ended_at, awaiting_input_since, parent_agent_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // The new schema enforces a FK to sessions(id) with foreign_keys=ON, and the
  // vendor `agents` table has no such FK — so it can hold rows whose session was
  // pruned. INSERT OR IGNORE does NOT swallow a FK-constraint failure (it
  // throws), which would abort the whole migration, so explicitly skip orphans
  // by checking against the sessions just imported.
  const validSessionIds = new Set(
    (conn.prepare("SELECT id FROM sessions").all() as { id: string }[]).map((row) => row.id),
  );
  let copied = 0;
  for (const r of rows) {
    if (!validSessionIds.has(r.session_id as string)) {
      continue;
    }
    insert.run(
      r.id as string,
      r.session_id as string,
      (r.name as string) ?? null,
      (r.type as string) ?? null,
      (r.subagent_type as string) ?? null,
      (r.status as string) ?? "completed",
      (r.task as string) ?? null,
      (r.current_tool as string) ?? null,
      (r.started_at as string) ?? null,
      (r.updated_at as string) ?? null,
      (r.ended_at as string) ?? null,
      (r.awaiting_input_since as string) ?? null,
      (r.parent_agent_id as string) ?? null,
      (r.metadata as string) ?? null,
    );
    copied += 1;
  }
  return copied;
}

function copyEvents(vendor: DatabaseSync, conn: DatabaseSync): number {
  const rows = vendor
    .prepare(
      `SELECT session_id, agent_id, event_type, tool_name, summary, data, created_at FROM events`,
    )
    .all() as Record<string, unknown>[];
  const insert = conn.prepare(
    `INSERT OR IGNORE INTO events
       (id, session_id, agent_id, event_type, tool_name, summary, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    // Vendor event ids are autoincrement integers; the new schema uses TEXT
    // ids, so mint a fresh uuid. The one-shot rename guarantees no re-import.
    insert.run(
      randomUUID(),
      r.session_id as string,
      (r.agent_id as string) ?? null,
      (r.event_type as string) ?? "unknown",
      (r.tool_name as string) ?? null,
      (r.summary as string) ?? null,
      (r.data as string) ?? null,
      (r.created_at as string) ?? null,
    );
  }
  return rows.length;
}

function copyTokenUsage(vendor: DatabaseSync, conn: DatabaseSync): number {
  // The vendor schema stores effective counts as `raw + baseline_*`; collapse
  // them into the in-process effective columns and seed raw_* to match.
  let rows: Record<string, unknown>[];
  try {
    rows = vendor
      .prepare(
        `SELECT session_id, model,
                input_tokens + baseline_input AS input_tokens,
                output_tokens + baseline_output AS output_tokens,
                cache_read_tokens + baseline_cache_read AS cache_read_tokens,
                cache_write_tokens + baseline_cache_write AS cache_write_tokens
         FROM token_usage`,
      )
      .all() as Record<string, unknown>[];
  } catch {
    // Pre-baseline vendor schema: read the plain columns directly.
    rows = vendor
      .prepare(
        `SELECT session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
         FROM token_usage`,
      )
      .all() as Record<string, unknown>[];
  }
  const insert = conn.prepare(
    `INSERT OR IGNORE INTO token_usage
       (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        raw_input, raw_output, raw_cache_read, raw_cache_write, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    const input = num(r.input_tokens);
    const output = num(r.output_tokens);
    const cacheRead = num(r.cache_read_tokens);
    const cacheWrite = num(r.cache_write_tokens);
    insert.run(
      r.session_id as string,
      r.model as string,
      input,
      output,
      cacheRead,
      cacheWrite,
      input,
      output,
      cacheRead,
      cacheWrite,
      null,
      null,
    );
  }
  return rows.length;
}

function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
