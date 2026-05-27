CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    name TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','error','abandoned')),
    cwd TEXT,
    model TEXT,
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ended_at TEXT,
    metadata TEXT
  , updated_at TEXT NOT NULL DEFAULT '', awaiting_input_since TEXT, harness TEXT NOT NULL DEFAULT 'claude');
CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'main' CHECK(type IN ('main','subagent')),
    subagent_type TEXT,
    status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('working','waiting','completed','error')),
    task TEXT,
    current_tool TEXT,
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ended_at TEXT,
    parent_agent_id TEXT,
    metadata TEXT, updated_at TEXT NOT NULL DEFAULT '', awaiting_input_since TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_agent_id) REFERENCES agents(id) ON DELETE SET NULL
  );
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    agent_id TEXT,
    event_type TEXT NOT NULL,
    tool_name TEXT,
    summary TEXT,
    data TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
  );
CREATE TABLE token_usage (
    session_id TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT 'unknown',
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0, baseline_input INTEGER NOT NULL DEFAULT 0, baseline_output INTEGER NOT NULL DEFAULT 0, baseline_cache_read INTEGER NOT NULL DEFAULT 0, baseline_cache_write INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, model),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
CREATE TABLE model_pricing (
    model_pattern TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    input_per_mtok REAL NOT NULL DEFAULT 0,
    output_per_mtok REAL NOT NULL DEFAULT 0,
    cache_read_per_mtok REAL NOT NULL DEFAULT 0,
    cache_write_per_mtok REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
CREATE TABLE push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
CREATE TABLE dashboard_runs (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    mode TEXT NOT NULL,
    cwd TEXT NOT NULL,
    model TEXT,
    permission_mode TEXT,
    effort TEXT,
    resume_session_id TEXT,
    prompt_preview TEXT,
    status TEXT NOT NULL,
    exit_code INTEGER,
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ended_at TEXT
  );
CREATE INDEX idx_agents_session ON agents(session_id);
CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_events_session ON events(session_id);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_created ON events(created_at DESC);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_started ON sessions(started_at DESC);
CREATE INDEX idx_events_session_type ON events(session_id, event_type);
CREATE INDEX idx_agents_session_type ON agents(session_id, type);
CREATE INDEX idx_dashboard_runs_started ON dashboard_runs(started_at DESC);
CREATE INDEX idx_dashboard_runs_session ON dashboard_runs(session_id);
CREATE INDEX idx_sessions_status_updated ON sessions(status, updated_at DESC);
CREATE INDEX idx_sessions_harness ON sessions(harness);
CREATE TABLE plans (
      id TEXT PRIMARY KEY,
      organization_id TEXT,
      title TEXT,
      current_version_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft','proposed','approved','rejected','superseded','archived')),
      source TEXT NOT NULL DEFAULT 'captured'
        CHECK(source IN ('captured','imported','human','generated')),
      capture_method TEXT
        CHECK(capture_method IN ('log','hook','api','file','import','manual')),
      harness TEXT,
      created_from_session_id TEXT,
      created_from_event_id TEXT,
      plan_key TEXT,
      file_path TEXT,
      source_log_path TEXT,
      needs_confirmation INTEGER NOT NULL DEFAULT 0,
      confidence REAL,
      sync_state TEXT NOT NULL DEFAULT 'local_only'
        CHECK(sync_state IN ('local_only','metadata_synced','full_synced','excluded')),
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
CREATE TABLE plan_versions (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      content_markdown TEXT NOT NULL,
      content_json TEXT,
      content_sha256 TEXT NOT NULL,
      author_type TEXT NOT NULL DEFAULT 'agent'
        CHECK(author_type IN ('human','agent','imported')),
      author_user_id TEXT,
      source_session_id TEXT,
      source_event_ref TEXT,
      capture_method TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(plan_id, version_number),
      FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
    );
CREATE INDEX idx_plans_session ON plans(created_from_session_id);
CREATE INDEX idx_plans_needs_confirmation ON plans(needs_confirmation);
CREATE INDEX idx_plans_updated ON plans(updated_at DESC);
CREATE INDEX idx_plan_versions_plan ON plan_versions(plan_id);
CREATE UNIQUE INDEX idx_plans_session_key
      ON plans(created_from_session_id, plan_key);
CREATE TABLE agent_packs (
      pack_id      TEXT NOT NULL,
      harness      TEXT NOT NULL,
      install_path TEXT NOT NULL,
      install_kind TEXT NOT NULL CHECK(install_kind IN ('symlink','directory')),
      source_url   TEXT,
      version      TEXT,
      detected_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), uninstalled_at TEXT,
      PRIMARY KEY (pack_id, harness, install_path)
    );
CREATE TABLE skills (
      skill_id     TEXT PRIMARY KEY,
      pack_id      TEXT,
      harness      TEXT NOT NULL,
      install_path TEXT NOT NULL,
      name         TEXT NOT NULL,
      version      TEXT,
      description  TEXT,
      source_url   TEXT,
      detected_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    , uninstalled_at TEXT);
CREATE TABLE project_pack_associations (
      project_path TEXT NOT NULL,
      pack_id      TEXT NOT NULL,
      detected_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (project_path, pack_id)
    );
CREATE INDEX idx_skills_pack ON skills(pack_id);
CREATE INDEX idx_skills_name ON skills(name);
CREATE INDEX idx_agent_packs_pack ON agent_packs(pack_id);
CREATE INDEX idx_events_type_tool ON events(event_type, tool_name);
CREATE INDEX idx_events_skill_prompt_lookup ON events(event_type, json_extract(data,'$.prompt'));
CREATE TABLE pack_catalog (
      pack_id            TEXT PRIMARY KEY,
      display_name       TEXT NOT NULL,
      category           TEXT,
      github_url         TEXT NOT NULL,
      description        TEXT,
      description_live   TEXT,
      harnesses          TEXT,
      install_commands   TEXT,
      uninstall_commands TEXT,
      install_notes      TEXT,
      placeholder_reason TEXT,
      verified           INTEGER NOT NULL DEFAULT 0,
      readme_excerpt     TEXT,
      readme_fetched_at  TEXT,
      stars              INTEGER,
      forks              INTEGER,
      last_release       TEXT,
      last_fetched_at    TEXT,
      seed_version       INTEGER NOT NULL DEFAULT 1
    , pin_order INTEGER, contents TEXT, contents_cache TEXT, contents_fetched_at TEXT, upstream_github_url TEXT, marketplace_url TEXT, detection_patterns TEXT, harness_agnostic INTEGER, project_scoped INTEGER, single_install INTEGER, post_install TEXT);
CREATE TABLE pack_catalog_history (
      pack_id    TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      stars      INTEGER,
      forks      INTEGER,
      PRIMARY KEY (pack_id, fetched_at)
    );
CREATE TABLE pack_install_runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      pack_id     TEXT NOT NULL,
      harness     TEXT NOT NULL,
      command     TEXT NOT NULL,
      exit_code   INTEGER,
      started_at  TEXT NOT NULL,
      ended_at    TEXT,
      stdout_tail TEXT,
      stderr_tail TEXT
    );
CREATE INDEX idx_pack_catalog_history_pack
      ON pack_catalog_history(pack_id, fetched_at DESC);
CREATE INDEX idx_pack_install_runs_pack
      ON pack_install_runs(pack_id, started_at DESC);
CREATE INDEX idx_pack_install_runs_inflight
      ON pack_install_runs(pack_id, ended_at);
CREATE TABLE pull_requests (
      id              TEXT PRIMARY KEY,
      session_id      TEXT,
      pr_url          TEXT NOT NULL,
      pr_number       INTEGER NOT NULL,
      repo_full_name  TEXT NOT NULL,
      branch_name     TEXT,
      head_sha        TEXT,
      title           TEXT,
      harness         TEXT NOT NULL,
      observed_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
CREATE INDEX idx_pull_requests_session
      ON pull_requests(session_id);
CREATE INDEX idx_pull_requests_repo
      ON pull_requests(repo_full_name, pr_number);
CREATE INDEX idx_pull_requests_observed
      ON pull_requests(observed_at DESC);
