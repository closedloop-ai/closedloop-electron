export const CURRENT_SCHEMA_VERSION = 6;

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

  // Version 1 → 2: add indexes for analytics query performance
  `
CREATE INDEX IF NOT EXISTS idx_events_tool_name ON events(tool_name) WHERE tool_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_session_tool ON events(session_id, created_at) WHERE tool_name IS NOT NULL;
`,

  // Version 2 → 3: covering indexes for aggregate queries on large tables
  `
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_tool_created ON events(created_at, tool_name) WHERE tool_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(type);
CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_agent_id) WHERE parent_agent_id IS NOT NULL;
`,

  // Version 3 → 4 (FEA-1497 Phase 1): make token_usage the in-process write target.
  // Reshape token_usage to a (session_id, model) upsert target carrying the
  // *effective* reconciled totals in the standard columns plus internal
  // write-time raw_* accumulators (last transcript-segment cumulative) used only
  // to detect compaction-driven token resets. Readers (dashboard + cloud relay)
  // read the standard columns directly with NO baseline arithmetic. The table was
  // never INSERTed prior to v4 and this branch is unreleased, so the reshape is a
  // safe drop+recreate. Also add sessions.billing_mode (stamped at ingest from the
  // shared billing-mode detector) so the relay can read it from the in-process DB.
  `
DROP TABLE IF EXISTS token_usage;

CREATE TABLE IF NOT EXISTS token_usage (
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
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT,
  PRIMARY KEY (session_id, model)
);

CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);

ALTER TABLE sessions ADD COLUMN billing_mode TEXT;
`,

  // Version 4 -> 5: index session ordering/filtering for the heavy explorer views.
  `
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status_started_at ON sessions(status, started_at DESC);
`,

  // Version 5 -> 6 (FEA-1548 Phase 1): multi-tenant identity columns.
  // Nullable because sessions created before account signup have no user/org
  // context. Backfilled when the user creates an account and joins an org.
  `
ALTER TABLE sessions ADD COLUMN user_id TEXT;
ALTER TABLE sessions ADD COLUMN organization_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_organization_id ON sessions(organization_id) WHERE organization_id IS NOT NULL;
`,
];
