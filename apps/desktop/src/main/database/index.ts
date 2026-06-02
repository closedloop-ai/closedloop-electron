import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CURRENT_SCHEMA_VERSION, MIGRATIONS } from "./schema.js";
import { createSessionStore } from "./sessions.js";
import { createAgentStore } from "./agents.js";
import { createEventStore } from "./events.js";
import { createTokenUsageStore } from "./token-usage.js";
import { createDashboardQueries } from "./dashboard.js";
import type { DashboardSummary } from "./types.js";

export interface AgentDatabase {
  /**
   * The underlying single shared connection. All in-process access — hook
   * writes (lifecycle), IPC reads, the cloud relay, and cost reconciliation —
   * goes through this one connection. node:sqlite `DatabaseSync` is synchronous
   * and the main process is single-threaded, so a single connection eliminates
   * cross-connection contention by construction (FEA-1497 Phase 1).
   */
  connection: DatabaseSync;
  sessions: ReturnType<typeof createSessionStore>;
  agents: ReturnType<typeof createAgentStore>;
  events: ReturnType<typeof createEventStore>;
  tokenUsage: ReturnType<typeof createTokenUsageStore>;
  dashboard: ReturnType<typeof createDashboardQueries>;
  getSummary: () => DashboardSummary;
  run: (sql: string, ...params: unknown[]) => void;
  close: () => void;
}

function runMigrations(db: DatabaseSync): void {
  const currentVersion = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;

  for (let v = currentVersion; v < CURRENT_SCHEMA_VERSION; v++) {
    const migration = MIGRATIONS[v];
    if (!migration) {
      throw new Error(`Missing migration for version ${v} → ${v + 1}`);
    }
    // Apply the migration DDL and the user_version bump atomically so a crash
    // mid-migration rolls back both — the next boot then re-runs the step
    // cleanly instead of finding a half-applied schema at the old version.
    db.exec("BEGIN");
    try {
      db.exec(migration);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore rollback failure */
      }
      throw error;
    }
  }
}

export function openAgentDatabase(dbPath: string): AgentDatabase {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  // Defensive: even though all access is single-connection + synchronous, a
  // busy_timeout guards against any future second handle (e.g. a worker thread).
  db.exec("PRAGMA busy_timeout=5000");
  runMigrations(db);

  const sessions = createSessionStore(db);
  const agents = createAgentStore(db);
  const events = createEventStore(db);
  const tokenUsage = createTokenUsageStore(db);
  const dashboard = createDashboardQueries(db);

  return {
    connection: db,
    sessions,
    agents,
    events,
    tokenUsage,
    dashboard,
    getSummary: () => dashboard.getSummary(),
    run: (sql: string, ...params: unknown[]) => {
      db.prepare(sql).run(...params as never[]);
    },
    close: () => db.close(),
  };
}
