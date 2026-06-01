import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "./schema.js";
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
  close: () => void;
}

export function openAgentDatabase(dbPath: string): AgentDatabase {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(SCHEMA_SQL);

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
    close: () => db.close(),
  };
}
