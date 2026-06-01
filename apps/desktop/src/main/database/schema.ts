export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Each migration runs against the DB when user_version < CURRENT_SCHEMA_VERSION.
 * Index 0 = migration from version 0 → 1 (initial schema), etc.
 */
export const MIGRATIONS: string[] = [
  // Version 0 → 1: initial schema
  `
CREATE TABLE IF NOT EXISTS sessions (
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
  harness TEXT
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
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
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_agents_session_id ON agents(session_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT,
  event_type TEXT NOT NULL,
  tool_name TEXT,
  summary TEXT,
  data TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_agent_id ON events(agent_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);

CREATE TABLE IF NOT EXISTS token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);
`,
];
