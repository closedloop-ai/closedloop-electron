import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CURRENT_SCHEMA_VERSION, MIGRATIONS } from "./schema.js";
import { createSessionStore } from "./sessions.js";
import { createAgentStore } from "./agents.js";
import { createEventStore } from "./events.js";
import { createDashboardQueries } from "./dashboard.js";
import type { DashboardSummary, SessionRow, AgentRow, EventRow, HookEventPayload } from "./types.js";

export interface AgentDatabase {
  sessions: ReturnType<typeof createSessionStore>;
  agents: ReturnType<typeof createAgentStore>;
  events: ReturnType<typeof createEventStore>;
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
    db.exec(migration);
    db.exec(`PRAGMA user_version = ${v + 1}`);
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
  runMigrations(db);

  const sessions = createSessionStore(db);
  const agents = createAgentStore(db);
  const events = createEventStore(db);
  const dashboard = createDashboardQueries(db);

  return {
    sessions,
    agents,
    events,
    dashboard,
    getSummary: () => dashboard.getSummary(),
    run: (sql: string, ...params: unknown[]) => {
      db.prepare(sql).run(...params as never[]);
    },
    close: () => db.close(),
  };
}
