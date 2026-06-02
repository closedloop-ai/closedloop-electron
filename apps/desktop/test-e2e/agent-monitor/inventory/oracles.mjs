// Oracle functions: compute expected values from the fixture SQLite DB.
//
// EVERY ORACLE is a pure function (DatabaseSync, opts) => number | { ... }
// that queries the DB and returns the value the UI/API is supposed to show.
//
// Rules:
//   - Oracles MUST NOT call the parsers or the sidecar. They are the ground
//     truth that those layers are audited against.
//   - Oracles MUST be deterministic for a given DB state.
//   - Oracles SHOULD be expressible as a single SQL query whenever possible;
//     keep JS to the minimum needed to shape the return value.
//   - If an oracle disagrees with the rendered UI or API output, the result
//     is a triage decision — not automatically a failing test. See
//     audit-runner.mjs for the comparison logic.

/**
 * @typedef {import("node:sqlite").DatabaseSync} DatabaseSync
 */

/**
 * Returns the count of all sessions in the DB.
 * @param {DatabaseSync} db
 */
export function dashboard_total_sessions(db) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM sessions").get();
  return Number(row.n);
}

/**
 * Sessions with status='active'.
 * @param {DatabaseSync} db
 */
export function dashboard_active_sessions(db) {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM sessions WHERE status = 'active'")
    .get();
  return Number(row.n);
}

/**
 * Main agents (type='main') currently working.
 * The Dashboard's "Active Agents" tile reads stats.active_agents, which the
 * sidecar computes from main agents only.
 * @param {DatabaseSync} db
 */
export function dashboard_active_agents(db) {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM agents WHERE type = 'main' AND status = 'working'",
    )
    .get();
  return Number(row.n);
}

/**
 * Subagents in working state for sessions whose main agent is also active.
 * Mirrors the Dashboard's `allSubagents.filter(a => a.status === "working")`
 * derivation. The Dashboard scopes subagents to sessions of active mains —
 * which means we must filter by session, not just by agent status.
 * @param {DatabaseSync} db
 */
export function dashboard_active_subagents(db) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM agents sub
       WHERE sub.type = 'subagent'
         AND sub.status = 'working'
         AND sub.session_id IN (
           SELECT session_id FROM agents
           WHERE type = 'main' AND status = 'working'
         )`,
    )
    .get();
  return Number(row.n);
}

/**
 * Total subagents (any status) for sessions whose main agent is active.
 * Renders as the trend "{n} total" beneath the Active Subagents tile.
 * @param {DatabaseSync} db
 */
export function dashboard_total_subagents_for_active(db) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM agents sub
       WHERE sub.type = 'subagent'
         AND sub.session_id IN (
           SELECT session_id FROM agents
           WHERE type = 'main' AND status = 'working'
         )`,
    )
    .get();
  return Number(row.n);
}

/**
 * Events created today. "Today" = local-day window computed from a UTC
 * `now` and a tz_offset (in minutes, JS convention: positive west of UTC).
 *
 * The sidecar computes events_today using strftime('%Y-%m-%d', created_at)
 * matched against the same local day. We replicate that here so the oracle
 * stays parallel to the implementation while remaining independent code.
 *
 * @param {DatabaseSync} db
 * @param {{ tzOffsetMinutes?: number, now?: Date }} [opts]
 */
export function dashboard_events_today(db, opts = {}) {
  const tzOffsetMinutes = opts.tzOffsetMinutes ?? 0;
  const now = opts.now ?? new Date();
  const shifted = new Date(now.getTime() - tzOffsetMinutes * 60_000);
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  const localDay = `${yyyy}-${mm}-${dd}`;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM events
       WHERE substr(created_at, 1, 10) = ?`,
    )
    .get(localDay);
  return Number(row.n);
}

/**
 * Total events across all sessions.
 * @param {DatabaseSync} db
 */
export function dashboard_total_events(db) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM events").get();
  return Number(row.n);
}

/**
 * Total cost = sum over token_usage rows of:
 *   (input_tokens * input_per_mtok
 *    + output_tokens * output_per_mtok
 *    + cache_read_tokens * cache_read_per_mtok
 *    + cache_write_tokens * cache_write_per_mtok) / 1_000_000
 *
 * Joined to model_pricing by exact model match. Rows with no matching
 * model_pricing entry contribute zero — the same fail-open behavior the
 * sidecar should use (verify this in triage if the API disagrees).
 *
 * The oracle does the math in plain SQL with REAL columns; floating-point
 * noise is on the order of 1e-12, far below the cent rounding the UI uses.
 *
 * @param {DatabaseSync} db
 */
export function dashboard_total_cost(db) {
  // Include baseline_* columns so this oracle stays consistent with
  // cost_breakdown_by_model_map and session_cost_by_id. The upstream
  // pricing route also uses (input_tokens + baseline_input) — re-imports
  // can produce nonzero baseline values, and a fixture with baselines
  // would otherwise make oracle-vs-oracle comparisons disagree.
  // See PR #246 review comment from @thadeusb @ oracles.mjs:152.
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(
         (tu.input_tokens       + tu.baseline_input)       * mp.input_per_mtok       / 1000000.0
       + (tu.output_tokens      + tu.baseline_output)      * mp.output_per_mtok      / 1000000.0
       + (tu.cache_read_tokens  + tu.baseline_cache_read)  * mp.cache_read_per_mtok  / 1000000.0
       + (tu.cache_write_tokens + tu.baseline_cache_write) * mp.cache_write_per_mtok / 1000000.0
       ), 0) AS total
       FROM token_usage tu
       LEFT JOIN model_pricing mp
         ON mp.model_pattern = tu.model`,
    )
    .get();
  return Number(row.total);
}

/**
 * Main agents (type='main') with status in (working, waiting). The Dashboard
 * "Active Agents" section card-list combines working+waiting mains in the
 * RENDERED UI — but covering that requires two API calls. For single-endpoint
 * audits, use `dashboard_active_main_agents_working_only` to match scope.
 * @param {DatabaseSync} db
 */
export function dashboard_active_main_agents(db) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM agents
       WHERE type = 'main' AND status IN ('working', 'waiting')`,
    )
    .get();
  return Number(row.n);
}

/**
 * Main agents (type='main') currently working — used by audits that hit
 * `/api/agents?status=working` exactly so the oracle and endpoint scopes
 * match. The Dashboard's "Active Agents" SECTION renders working+waiting,
 * but the API audit can only assert one endpoint at a time; use this
 * oracle for the working endpoint and pair it with a separate waiting
 * audit once we add `/api/agents?status=waiting` to the manifest.
 * @param {DatabaseSync} db
 */
export function dashboard_active_main_agents_working_only(db) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM agents
       WHERE type = 'main' AND status = 'working'`,
    )
    .get();
  return Number(row.n);
}

/**
 * Map of oracle name → function. The audit runner looks up by name from
 * manifest.json so adding a new tile means adding a manifest row + a function
 * here. Nothing in test code needs to change.
 */
// ============================================================================
// Dashboard Health tab oracles (route /, tab=Health, endpoints
// /api/settings/info and /api/workflows). Server-runtime metrics (uptime,
// memory, CPU) are NOT log-derived and are deliberately out of scope here.
// ============================================================================

/** /api/settings/info.db.counts.sessions */
export function db_counts_sessions(db) {
  return dashboard_total_sessions(db);
}

/** /api/settings/info.db.counts.agents — total of any type */
export function db_counts_agents(db) {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM agents`).get();
  return Number(row.n);
}

/** /api/settings/info.db.counts.events */
export function db_counts_events(db) {
  return dashboard_total_events(db);
}

/** workflow.compaction.totalCompactions — agents with subagent_type='compaction' */
export function workflow_total_compactions(db) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM agents WHERE subagent_type = 'compaction'`,
    )
    .get();
  return Number(row.n);
}

/** workflow.stats.successRate — completed / (completed + error) * 100, or 100 if no finished agents */
export function workflow_success_rate(db) {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM agents WHERE status = 'completed') AS completed,
         (SELECT COUNT(*) FROM agents WHERE status = 'error') AS errored`,
    )
    .get();
  const finished = Number(row.completed) + Number(row.errored);
  if (finished === 0) return 100;
  return Number(((Number(row.completed) / finished) * 100).toFixed(1));
}

/** workflow.stats.totalSessions — same as dashboard_total_sessions */
export function workflow_total_sessions(db) {
  return dashboard_total_sessions(db);
}
/** workflow.stats.totalAgents — total agents of any type */
export function workflow_total_agents(db) {
  return db_counts_agents(db);
}
/** workflow.stats.totalSubagents — same as analytics_total_subagents */
export function workflow_total_subagents(db) {
  return analytics_total_subagents(db);
}
/** workflow.stats.avgSubagents — totalSubagents / totalSessions, .toFixed(1), 0 if no sessions */
export function workflow_avg_subagents(db) {
  const total = workflow_total_subagents(db);
  const sessions = workflow_total_sessions(db);
  if (sessions === 0) return 0;
  return Number((total / sessions).toFixed(1));
}
/** workflow.stats.avgCompactions — totalCompactions / totalSessions, .toFixed(1) */
export function workflow_avg_compactions(db) {
  const total = workflow_total_compactions(db);
  const sessions = workflow_total_sessions(db);
  if (sessions === 0) return 0;
  return Number((total / sessions).toFixed(1));
}
/** workflow.stats.avgDurationSec — Math.round(sum(ended-started seconds)/count) over ENDED sessions */
export function workflow_avg_duration_sec(db) {
  const rows = db
    .prepare(
      `SELECT started_at, ended_at FROM sessions WHERE ended_at IS NOT NULL`,
    )
    .all();
  if (rows.length === 0) return 0;
  let total = 0;
  for (const r of rows) {
    total += (new Date(r.ended_at) - new Date(r.started_at)) / 1000;
  }
  return Math.round(total / rows.length);
}
/** workflow.stats.avgDepth — average max-depth per session over the recursive agent tree */
export function workflow_avg_depth(db) {
  const rows = db
    .prepare(
      `WITH RECURSIVE agent_depth AS (
         SELECT id, session_id, parent_agent_id, 0 AS depth FROM agents WHERE parent_agent_id IS NULL
         UNION ALL
         SELECT a.id, a.session_id, a.parent_agent_id, ad.depth + 1
         FROM agents a JOIN agent_depth ad ON a.parent_agent_id = ad.id
       )
       SELECT session_id, MAX(depth) AS max_depth FROM agent_depth GROUP BY session_id`,
    )
    .all();
  if (rows.length === 0) return 0;
  const sum = rows.reduce((s, r) => s + Number(r.max_depth), 0);
  return Number((sum / rows.length).toFixed(1));
}

/** workflow.toolFlow.toolCounts.length — distinct tools that appear in events */
export function workflow_tool_counts_length(db) {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT tool_name) AS n
       FROM events
       WHERE tool_name IS NOT NULL`,
    )
    .get();
  return Number(row.n);
}

/** workflow.effectiveness.length — distinct subagent types (excluding compaction noise per upstream code) */
export function workflow_effectiveness_length(db) {
  // Upstream: SELECT subagent_type ... WHERE type = 'subagent' GROUP BY subagent_type
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT subagent_type) AS n
       FROM agents
       WHERE type = 'subagent' AND subagent_type IS NOT NULL`,
    )
    .get();
  return Number(row.n);
}

/**
 * Count of distinct tool_names across ALL events (any event_type). Used by
 * /api/events/facets.tool_names.length — drives the Tools page list.
 *
 * Distinct from analytics_distinct_tools_count, which only counts PreToolUse.
 * If these two diverge it's interesting — would mean PostToolUse events
 * mention tools that PreToolUse doesn't.
 * @param {DatabaseSync} db
 */
export function events_facets_tool_names_length(db) {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT tool_name) AS n
       FROM events
       WHERE tool_name IS NOT NULL`,
    )
    .get();
  return Number(row.n);
}

/** /api/plans.total — count of plans rows */
export function plans_total(db) {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM plans`).get();
    return Number(row.n);
  } catch {
    return 0;
  }
}

/** Distinct subagent_types — drives SubAgents page card count */
export function subagents_distinct_types(db) {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT subagent_type) AS n
       FROM agents
       WHERE type = 'subagent' AND subagent_type IS NOT NULL`,
    )
    .get();
  return Number(row.n);
}

/** Total events visible to the ActivityFeed (all events) */
export function activityfeed_total_events(db) {
  return dashboard_total_events(db);
}

/** Sessions in a given status — for KanbanBoard columns. */
export function sessions_count_by_status(db, opts) {
  if (!opts?.status) throw new Error("sessions_count_by_status requires opts.status");
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM sessions WHERE status = ?`)
    .get(opts.status);
  return Number(row.n);
}

/** Agents in a given status — for KanbanBoard columns. */
export function agents_count_by_status(db, opts) {
  if (!opts?.status) throw new Error("agents_count_by_status requires opts.status");
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM agents WHERE status = ?`)
    .get(opts.status);
  return Number(row.n);
}

// Frozen-status oracles so manifest can bind structural assertions without
// needing opts injection.
export function agents_count_working(db) {
  return agents_count_by_status(db, { status: "working" });
}
export function agents_count_waiting(db) {
  return agents_count_by_status(db, { status: "waiting" });
}
export function agents_count_completed(db) {
  return agents_count_by_status(db, { status: "completed" });
}
export function agents_count_error(db) {
  return agents_count_by_status(db, { status: "error" });
}

/** Per-model token totals — keyed by model. Returns
 * { [model]: { input_tokens, output_tokens, cache_read_tokens, cache_write_tokens } }.
 * Mirrors what /api/workflows.modelDelegation.tokensByModel must produce.
 */
export function tokens_by_model_map(db) {
  const rows = db
    .prepare(
      `SELECT
         model,
         COALESCE(SUM(input_tokens + baseline_input), 0)       AS input_tokens,
         COALESCE(SUM(output_tokens + baseline_output), 0)     AS output_tokens,
         COALESCE(SUM(cache_read_tokens + baseline_cache_read), 0) AS cache_read_tokens,
         COALESCE(SUM(cache_write_tokens + baseline_cache_write), 0) AS cache_write_tokens
       FROM token_usage
       WHERE model IS NOT NULL
       GROUP BY model`,
    )
    .all();
  const out = {};
  for (const r of rows) {
    out[r.model] = {
      input_tokens: Number(r.input_tokens),
      output_tokens: Number(r.output_tokens),
      cache_read_tokens: Number(r.cache_read_tokens),
      cache_write_tokens: Number(r.cache_write_tokens),
    };
  }
  return out;
}

/**
 * Tool-to-tool transitions counted as INVOCATION→INVOCATION. The matching
 * upstream query joins on any next event with a tool_name, which lets a
 * PostToolUse row sneak in and either (a) form a `(X, X)` self-loop where
 * the PostUse of X immediately follows the PreUse of X or (b) double-count
 * when a PostUse sits between two real invocations.
 *
 * Oracle returns map keyed by `source||target`.
 */
export function tool_transitions_map(db) {
  const rows = db
    .prepare(
      `SELECT e1.tool_name AS source, e2.tool_name AS target, COUNT(*) AS n
       FROM events e1
       JOIN events e2
         ON e2.session_id = e1.session_id
        AND e2.id = (
          SELECT MIN(e3.id) FROM events e3
          WHERE e3.session_id = e1.session_id
            AND e3.id > e1.id
            AND e3.tool_name IS NOT NULL
            AND e3.event_type = 'PreToolUse'
        )
       WHERE e1.tool_name IS NOT NULL
         AND e1.event_type = 'PreToolUse'
         AND e2.tool_name IS NOT NULL
       GROUP BY e1.tool_name, e2.tool_name`,
    )
    .all();
  const out = {};
  for (const r of rows) out[`${r.source}||${r.target}`] = Number(r.n);
  return out;
}

/** workflow.concurrency.aggregateLanes.length — distinct agent types ("Main Agent" + subagent_types) appearing in ENDED sessions. */
export function workflow_concurrency_lanes_length(db) {
  // Mirrors the upstream key-building logic: lane.type === 'main' → 'Main Agent',
  // else subagent_type || 'unknown'. But only for agents in ENDED sessions.
  const rows = db
    .prepare(
      `SELECT DISTINCT
         CASE WHEN a.type = 'main' THEN 'Main Agent'
              ELSE COALESCE(a.subagent_type, 'unknown')
         END AS lane_name
       FROM agents a
       JOIN sessions s ON a.session_id = s.id
       WHERE s.ended_at IS NOT NULL`,
    )
    .all();
  return rows.length;
}

/** workflow.complexity (scatter rows) — length = number of sessions with at least 1 agent. */
export function workflow_complexity_length(db) {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT s.id) AS n
       FROM sessions s
       JOIN agents a ON a.session_id = s.id`,
    )
    .get();
  return Number(row.n);
}

/** Per-pack stats: returns { installs, skills, associations } counts for a pack_id. */
export function pack_detail_counts_by_id(db, opts) {
  if (!opts?.packId) throw new Error("pack_detail_counts_by_id requires opts.packId");
  const pid = opts.packId;
  const installs = Number(
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM agent_packs WHERE pack_id = ? AND uninstalled_at IS NULL`,
      )
      .get(pid).n,
  );
  const skills = Number(
    db
      .prepare(`SELECT COUNT(*) AS n FROM skills WHERE pack_id = ?`)
      .get(pid).n,
  );
  let associations = 0;
  try {
    associations = Number(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM project_pack_associations WHERE pack_id = ?`,
        )
        .get(pid).n,
    );
  } catch {
    // project_pack_associations may not exist in older schemas
  }
  return { installs, skills, associations };
}

/** Per-session stats: returns the full shape of /api/sessions/:id/stats agents+tokens block. */
export function session_stats_by_id(db, opts) {
  if (!opts?.sessionId) throw new Error("session_stats_by_id requires opts.sessionId");
  const sid = opts.sessionId;
  const total_events = Number(
    db.prepare(`SELECT COUNT(*) AS n FROM events WHERE session_id = ?`).get(sid).n,
  );
  const error_count = Number(
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM events WHERE session_id = ? AND event_type = 'Error'`,
      )
      .get(sid).n,
  );
  const agentsTotal = Number(
    db.prepare(`SELECT COUNT(*) AS n FROM agents WHERE session_id = ?`).get(sid).n,
  );
  const agentsMain = Number(
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM agents WHERE session_id = ? AND type = 'main'`,
      )
      .get(sid).n,
  );
  const agentsSubagent = Number(
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM agents WHERE session_id = ? AND type = 'subagent'`,
      )
      .get(sid).n,
  );
  const agentsCompaction = Number(
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM agents WHERE session_id = ? AND subagent_type = 'compaction'`,
      )
      .get(sid).n,
  );
  const t = db
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens + baseline_input), 0)       AS input_tokens,
         COALESCE(SUM(output_tokens + baseline_output), 0)     AS output_tokens,
         COALESCE(SUM(cache_read_tokens + baseline_cache_read), 0) AS cache_read_tokens,
         COALESCE(SUM(cache_write_tokens + baseline_cache_write), 0) AS cache_write_tokens
       FROM token_usage WHERE session_id = ?`,
    )
    .get(sid);
  return {
    total_events,
    error_count,
    agents: {
      total: agentsTotal,
      main: agentsMain,
      subagent: agentsSubagent,
      compaction: agentsCompaction,
    },
    tokens: {
      input_tokens: Number(t.input_tokens),
      output_tokens: Number(t.output_tokens),
      cache_read_tokens: Number(t.cache_read_tokens),
      cache_write_tokens: Number(t.cache_write_tokens),
    },
  };
}

/**
 * mainModels — per-session-model breakdown of MAIN-agent counts and
 * sessions. Mirrors the upstream SQL:
 *   COUNT(DISTINCT a.id) AS agent_count,
 *   COUNT(DISTINCT s.id) AS session_count
 *   FROM agents a JOIN sessions s ON a.session_id = s.id
 *   WHERE a.type = 'main' AND s.model IS NOT NULL
 *   GROUP BY s.model
 * Returns { [model]: { agent_count, session_count } }.
 */
export function workflow_main_models_map(db) {
  const rows = db
    .prepare(
      `SELECT s.model,
              COUNT(DISTINCT a.id) AS agent_count,
              COUNT(DISTINCT s.id) AS session_count
       FROM agents a
       JOIN sessions s ON a.session_id = s.id
       WHERE a.type = 'main' AND s.model IS NOT NULL
       GROUP BY s.model`,
    )
    .all();
  const out = {};
  for (const r of rows) {
    out[r.model] = {
      agent_count: Number(r.agent_count),
      session_count: Number(r.session_count),
    };
  }
  return out;
}

/** Per-model cost map. Returns { [model]: cost } using the SAME per-row pricing formula as dashboard_total_cost. */
export function cost_breakdown_by_model_map(db) {
  const rows = db
    .prepare(
      `SELECT
         tu.model,
         COALESCE(SUM(
           (tu.input_tokens       + tu.baseline_input)       * mp.input_per_mtok       / 1000000.0
         + (tu.output_tokens      + tu.baseline_output)      * mp.output_per_mtok      / 1000000.0
         + (tu.cache_read_tokens  + tu.baseline_cache_read)  * mp.cache_read_per_mtok  / 1000000.0
         + (tu.cache_write_tokens + tu.baseline_cache_write) * mp.cache_write_per_mtok / 1000000.0
         ), 0) AS cost
       FROM token_usage tu
       LEFT JOIN model_pricing mp ON mp.model_pattern = tu.model
       WHERE tu.model IS NOT NULL
       GROUP BY tu.model`,
    )
    .all();
  const out = {};
  for (const r of rows) out[r.model] = Number(r.cost);
  return out;
}

/** Per-subagent-type effectiveness map. Returns { [subagent_type]: {total, completed, errors, sessions} } */
export function subagent_effectiveness_map(db) {
  const rows = db
    .prepare(
      `SELECT
         subagent_type,
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
         COUNT(DISTINCT session_id) AS sessions
       FROM agents
       WHERE type = 'subagent' AND subagent_type IS NOT NULL
       GROUP BY subagent_type`,
    )
    .all();
  const out = {};
  for (const r of rows) {
    out[r.subagent_type] = {
      total: Number(r.total),
      completed: Number(r.completed),
      errors: Number(r.errors),
      sessions: Number(r.sessions),
    };
  }
  return out;
}

/** Per-tool counts. Returns { [tool_name]: count } over PreToolUse events. */
export function tool_counts_map(db) {
  const rows = db
    .prepare(
      `SELECT tool_name, COUNT(*) AS n
       FROM events
       WHERE event_type = 'PreToolUse' AND tool_name IS NOT NULL
       GROUP BY tool_name`,
    )
    .all();
  const out = {};
  for (const r of rows) out[r.tool_name] = Number(r.n);
  return out;
}

/** /api/pricing list length (= row count in model_pricing). */
export function pricing_rules_count(db) {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM model_pricing`).get();
    return Number(row.n);
  } catch {
    return 0;
  }
}

/** /api/events/facets.event_types.length — distinct event_type values */
export function events_facets_event_types_length(db) {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT event_type) AS n
       FROM events
       WHERE event_type IS NOT NULL`,
    )
    .get();
  return Number(row.n);
}

/** workflow.modelDelegation.tokensByModel.length — distinct models in token_usage */
export function workflow_models_length(db) {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT model) AS n
       FROM token_usage
       WHERE model IS NOT NULL`,
    )
    .get();
  return Number(row.n);
}

/** workflow.compaction.tokensRecovered — sum of all baseline tokens across token_usage */
export function workflow_tokens_recovered(db) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(baseline_input + baseline_output + baseline_cache_read + baseline_cache_write), 0) AS total
       FROM token_usage`,
    )
    .get();
  return Number(row.total);
}

/** workflow.compaction.sessionsWithCompactions — distinct sessions with ≥1 compaction subagent */
export function workflow_sessions_with_compactions(db) {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT session_id) AS n FROM agents WHERE subagent_type = 'compaction'`,
    )
    .get();
  return Number(row.n);
}

/** workflow.errorPropagation.errorRate — sessions_with_errors / total_sessions * 100 */
export function workflow_error_rate(db) {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM sessions) AS total_sessions,
         (SELECT COUNT(*) FROM sessions WHERE status = 'error') AS error_sessions`,
    )
    .get();
  const total = Number(row.total_sessions);
  if (total === 0) return 0;
  return Number(((Number(row.error_sessions) / total) * 100).toFixed(1));
}

// ============================================================================
// Pull Requests screen oracles (route /pull-requests)
// ============================================================================

/** Count of pull_requests rows. Endpoint /api/pull-requests/stats.pull_requests */
export function pull_requests_total(db) {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM pull_requests`).get();
  return Number(row.n);
}

/** Distinct sessions that produced ≥1 PR. */
export function pull_requests_sessions_with_pr(db) {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT session_id) AS n FROM pull_requests WHERE session_id IS NOT NULL`,
    )
    .get();
  return Number(row.n);
}

/** Distinct repos across all PRs. */
export function pull_requests_repos(db) {
  const row = db
    .prepare(`SELECT COUNT(DISTINCT repo_full_name) AS n FROM pull_requests`)
    .get();
  return Number(row.n);
}

// ============================================================================
// Packs / Skills oracles
// ============================================================================

/** Count of agent_packs rows that aren't tombstoned. */
export function packs_installed_count(db) {
  // The pack-scanner uses uninstalled_at to soft-delete; live rows have NULL.
  // Some schemas may not have that column — fall back to plain COUNT(*).
  try {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM agent_packs WHERE uninstalled_at IS NULL`)
      .get();
    return Number(row.n);
  } catch {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM agent_packs`).get();
    return Number(row.n);
  }
}

/** Distinct pack_ids — what the user sees as "installed packs". */
export function packs_distinct_pack_ids(db) {
  const row = db
    .prepare(`SELECT COUNT(DISTINCT pack_id) AS n FROM agent_packs`)
    .get();
  return Number(row.n);
}

/** Count of skills rows. */
export function skills_total(db) {
  try {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM skills WHERE uninstalled_at IS NULL`)
      .get();
    return Number(row.n);
  } catch {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM skills`).get();
    return Number(row.n);
  }
}

// ============================================================================
// Sessions screen oracles (route /sessions, endpoint /api/sessions)
// These are per-row aggregates — the audit calls the oracle for each
// session_id returned by the API.
// ============================================================================

/**
 * Count of agents (any type) for a given session_id.
 * Endpoint: /api/sessions returns rows with `agent_count` per session.
 * @param {DatabaseSync} db
 * @param {{ sessionId: string }} opts
 */
export function session_agent_count_by_id(db, opts) {
  if (!opts?.sessionId) throw new Error("session_agent_count_by_id requires opts.sessionId");
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM agents WHERE session_id = ?`)
    .get(opts.sessionId);
  return Number(row.n);
}

/**
 * Per-session cost using the SAME formula as dashboard_total_cost, but
 * scoped to one session. Mirrors what the Sessions page renders in the cost
 * column (and what /api/pricing/cost/:sessionId returns).
 * @param {DatabaseSync} db
 * @param {{ sessionId: string }} opts
 */
export function session_cost_by_id(db, opts) {
  if (!opts?.sessionId) throw new Error("session_cost_by_id requires opts.sessionId");
  // Baselines included — consistent with dashboard_total_cost and
  // cost_breakdown_by_model_map. See PR #246 review @ oracles.mjs:152.
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(
         (tu.input_tokens       + tu.baseline_input)       * mp.input_per_mtok       / 1000000.0
       + (tu.output_tokens      + tu.baseline_output)      * mp.output_per_mtok      / 1000000.0
       + (tu.cache_read_tokens  + tu.baseline_cache_read)  * mp.cache_read_per_mtok  / 1000000.0
       + (tu.cache_write_tokens + tu.baseline_cache_write) * mp.cache_write_per_mtok / 1000000.0
       ), 0) AS total
       FROM token_usage tu
       LEFT JOIN model_pricing mp ON mp.model_pattern = tu.model
       WHERE tu.session_id = ?`,
    )
    .get(opts.sessionId);
  return Number(row.total);
}

// ============================================================================
// Analytics screen oracles (route /analytics, endpoint /api/analytics)
// ============================================================================

/**
 * Sum of input tokens across all token_usage rows.
 * Endpoint field: analytics.tokens.total_input
 * @param {DatabaseSync} db
 */
export function analytics_tokens_total_input(db) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(input_tokens + baseline_input), 0) AS n
       FROM token_usage`,
    )
    .get();
  return Number(row.n);
}

/**
 * Sum of output tokens across all token_usage rows.
 * Endpoint field: analytics.tokens.total_output
 * @param {DatabaseSync} db
 */
export function analytics_tokens_total_output(db) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(output_tokens + baseline_output), 0) AS n
       FROM token_usage`,
    )
    .get();
  return Number(row.n);
}

/**
 * Sum of cache_read tokens across all token_usage rows.
 * Endpoint field: analytics.tokens.total_cache_read
 * @param {DatabaseSync} db
 */
export function analytics_tokens_total_cache_read(db) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cache_read_tokens + baseline_cache_read), 0) AS n
       FROM token_usage`,
    )
    .get();
  return Number(row.n);
}

/**
 * Sum of cache_write tokens across all token_usage rows.
 * Endpoint field: analytics.tokens.total_cache_write
 * @param {DatabaseSync} db
 */
export function analytics_tokens_total_cache_write(db) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cache_write_tokens + baseline_cache_write), 0) AS n
       FROM token_usage`,
    )
    .get();
  return Number(row.n);
}

/**
 * Average events per session = total_events / total_sessions (0 if no sessions).
 * Endpoint field: analytics.avg_events_per_session
 * @param {DatabaseSync} db
 */
export function analytics_avg_events_per_session(db) {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM events) * 1.0 AS evt,
         (SELECT COUNT(*) FROM sessions) * 1.0 AS sess`,
    )
    .get();
  const sess = Number(row.sess);
  if (sess === 0) return 0;
  return Number(row.evt) / sess;
}

/**
 * Count of subagent rows.
 * Endpoint field: analytics.total_subagents
 * @param {DatabaseSync} db
 */
export function analytics_total_subagents(db) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM agents WHERE type = 'subagent'`,
    )
    .get();
  return Number(row.n);
}

/**
 * The Analytics overview block returns the SAME numbers as /api/stats:
 * total_sessions / active_sessions / total_agents / active_agents /
 * total_events. We expose oracles for each so cross-endpoint disagreements
 * (which would be a bug — two endpoints, same DB, must agree) surface.
 *
 * For these, the existing dashboard_* oracles are correct — we just re-export
 * with analytics_* names so manifest authors don't have to know about the
 * cross-endpoint coupling.
 */
export function analytics_overview_total_sessions(db) {
  return dashboard_total_sessions(db);
}
export function analytics_overview_active_sessions(db) {
  return dashboard_active_sessions(db);
}
export function analytics_overview_total_agents(db) {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM agents`).get();
  return Number(row.n);
}
export function analytics_overview_active_agents(db) {
  return dashboard_active_agents(db);
}
export function analytics_overview_total_events(db) {
  return dashboard_total_events(db);
}

/**
 * Sessions grouped by status. Returns { active, completed, error, abandoned }
 * with zeros for absent buckets. The API returns sessions_by_status as
 * Record<string, number>.
 * @param {DatabaseSync} db
 */
export function analytics_sessions_by_status(db) {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM sessions GROUP BY status`,
    )
    .all();
  const buckets = { active: 0, completed: 0, error: 0, abandoned: 0 };
  for (const r of rows) buckets[r.status] = Number(r.n);
  return buckets;
}

/**
 * Agents grouped by status. Returns { working, waiting, completed, error }
 * with zeros for absent buckets.
 * @param {DatabaseSync} db
 */
export function analytics_agents_by_status(db) {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM agents GROUP BY status`,
    )
    .all();
  const buckets = { working: 0, waiting: 0, completed: 0, error: 0 };
  for (const r of rows) buckets[r.status] = Number(r.n);
  return buckets;
}

/**
 * Count of distinct tools used across event_type='PreToolUse' events.
 * Used by the "tools used" tile and the tool_usage array length.
 * @param {DatabaseSync} db
 */
export function analytics_distinct_tools_count(db) {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT tool_name) AS n
       FROM events
       WHERE event_type = 'PreToolUse' AND tool_name IS NOT NULL`,
    )
    .get();
  return Number(row.n);
}

/**
 * Total count of tool invocations (PreToolUse events).
 * @param {DatabaseSync} db
 */
export function analytics_total_tool_invocations(db) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM events
       WHERE event_type = 'PreToolUse' AND tool_name IS NOT NULL`,
    )
    .get();
  return Number(row.n);
}

export const oracles = {
  dashboard_total_sessions,
  dashboard_active_sessions,
  dashboard_active_agents,
  dashboard_active_subagents,
  dashboard_total_subagents_for_active,
  dashboard_events_today,
  dashboard_total_events,
  dashboard_total_cost,
  dashboard_active_main_agents,
  dashboard_active_main_agents_working_only,
  // Dashboard Health tab
  db_counts_sessions,
  db_counts_agents,
  db_counts_events,
  workflow_total_compactions,
  workflow_success_rate,
  workflow_error_rate,
  workflow_tokens_recovered,
  workflow_sessions_with_compactions,
  // Tools (Tools page → /api/events/facets)
  events_facets_tool_names_length,
  events_facets_event_types_length,
  // Plans / SubAgents / ActivityFeed / KanbanBoard / Settings
  plans_total,
  subagents_distinct_types,
  activityfeed_total_events,
  sessions_count_by_status,
  agents_count_by_status,
  agents_count_working,
  agents_count_waiting,
  agents_count_completed,
  agents_count_error,
  pricing_rules_count,
  tokens_by_model_map,
  tool_counts_map,
  tool_transitions_map,
  subagent_effectiveness_map,
  cost_breakdown_by_model_map,
  workflow_main_models_map,
  session_stats_by_id,
  pack_detail_counts_by_id,
  workflow_concurrency_lanes_length,
  workflow_complexity_length,
  // Workflows
  workflow_total_sessions,
  workflow_total_agents,
  workflow_total_subagents,
  workflow_avg_subagents,
  workflow_avg_compactions,
  workflow_avg_duration_sec,
  workflow_avg_depth,
  workflow_tool_counts_length,
  workflow_effectiveness_length,
  workflow_models_length,
  // Sessions
  session_agent_count_by_id,
  session_cost_by_id,
  // Pull Requests
  pull_requests_total,
  pull_requests_sessions_with_pr,
  pull_requests_repos,
  // Packs / Skills
  packs_installed_count,
  packs_distinct_pack_ids,
  skills_total,
  // Analytics
  analytics_tokens_total_input,
  analytics_tokens_total_output,
  analytics_tokens_total_cache_read,
  analytics_tokens_total_cache_write,
  analytics_avg_events_per_session,
  analytics_total_subagents,
  analytics_overview_total_sessions,
  analytics_overview_active_sessions,
  analytics_overview_total_agents,
  analytics_overview_active_agents,
  analytics_overview_total_events,
  analytics_sessions_by_status,
  analytics_agents_by_status,
  analytics_distinct_tools_count,
  analytics_total_tool_invocations,
};
