/**
 * @file pack-store.js
 * @description SQLite persistence for agent-pack inventory: installed packs
 * (`agent_packs`), discovered skills (`skills`), and per-project markers
 * (`project_pack_associations`). All three are pure inventory written by the
 * filesystem scanner; invocation history is sourced from the existing `events`
 * table and never duplicated here (FEA-1224 architectural constraint).
 *
 * Operates on the shared agent-monitor DB handle (better-sqlite3 / compat-sqlite
 * API: prepare().run/get/all, exec). Mirrors the structure of plan-store.js
 * (FEA-1189) with composite-key upserts in place of monotonic versioning.
 *
 * Part of CLOSEDLOOP pack-observability (FEA-1224 / PLN-651, parent PRD-364).
 */
"use strict";

/**
 * Create the three inventory tables if absent. Idempotent — uses
 * `CREATE TABLE IF NOT EXISTS`, no ALTER migrations. Schema is verbatim from
 * the FEA-1224 spec.
 */
function ensurePackSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_packs (
      pack_id      TEXT NOT NULL,
      harness      TEXT NOT NULL,
      install_path TEXT NOT NULL,
      install_kind TEXT NOT NULL CHECK(install_kind IN ('symlink','directory')),
      source_url   TEXT,
      version      TEXT,
      detected_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (pack_id, harness, install_path)
    );

    CREATE TABLE IF NOT EXISTS skills (
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
    );

    CREATE TABLE IF NOT EXISTS project_pack_associations (
      project_path TEXT NOT NULL,
      pack_id      TEXT NOT NULL,
      detected_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (project_path, pack_id)
    );

    CREATE INDEX IF NOT EXISTS idx_skills_pack ON skills(pack_id);
    CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
    CREATE INDEX IF NOT EXISTS idx_agent_packs_pack ON agent_packs(pack_id);
  `);
  // v2 additive migration: `uninstalled_at` tombstone column. When set, the row
  // represents a pack/skill that USED to be installed but isn't anymore — kept
  // around so we can surface "previously installed, last used $DATE, $N tool
  // calls" on catalog cards. The scanner sets this instead of DELETE-ing rows;
  // a future re-install clears it back to NULL.
  for (const [table, col, type] of [
    ["agent_packs", "uninstalled_at", "TEXT"],
    ["skills", "uninstalled_at", "TEXT"],
  ]) {
    try {
      db.prepare(`SELECT ${col} FROM ${table} LIMIT 1`).get();
    } catch {
      try {
        db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
      } catch {
        /* column may already exist via concurrent run — non-fatal */
      }
    }
  }

  // Skill-invocation reads join against the shared `events` table. Keep these
  // indexes best-effort so fresh/test DBs without the upstream tables still
  // boot cleanly.
  for (const sql of [
    "CREATE INDEX IF NOT EXISTS idx_events_type_tool ON events(event_type, tool_name)",
    "CREATE INDEX IF NOT EXISTS idx_events_skill_prompt_lookup ON events(event_type, json_extract(data,'$.prompt'))",
  ]) {
    try {
      db.exec(sql);
    } catch {
      /* upstream table or JSON extension may be unavailable in some tests */
    }
  }
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Upsert one `agent_packs` row keyed on (pack_id, harness, install_path).
 * Updates `last_seen_at` plus the mutable fields (`version`, `source_url`,
 * `install_kind`) but preserves the original `detected_at`.
 */
function upsertPack(db, row) {
  const ts = nowIso();
  db.prepare(
    `INSERT INTO agent_packs
       (pack_id, harness, install_path, install_kind, source_url, version, detected_at, last_seen_at, uninstalled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(pack_id, harness, install_path) DO UPDATE SET
       install_kind   = excluded.install_kind,
       source_url     = COALESCE(excluded.source_url, source_url),
       version        = COALESCE(excluded.version, version),
       last_seen_at   = excluded.last_seen_at,
       uninstalled_at = NULL`,
  ).run(
    row.pack_id,
    row.harness,
    row.install_path,
    row.install_kind,
    row.source_url || null,
    row.version || null,
    ts,
    ts,
  );
}

/**
 * Upsert one `skills` row keyed on `skill_id`. Callers compute `skill_id`
 * deterministically (e.g. sha256 of harness|install_path|name) so re-scans
 * dedupe to the same row.
 */
function upsertSkill(db, row) {
  const ts = nowIso();
  db.prepare(
    `INSERT INTO skills
       (skill_id, pack_id, harness, install_path, name, version, description, source_url, detected_at, last_seen_at, uninstalled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(skill_id) DO UPDATE SET
       pack_id        = excluded.pack_id,
       version        = COALESCE(excluded.version, version),
       description    = COALESCE(excluded.description, description),
       source_url     = COALESCE(excluded.source_url, source_url),
       last_seen_at   = excluded.last_seen_at,
       uninstalled_at = NULL`,
  ).run(
    row.skill_id,
    row.pack_id || null,
    row.harness,
    row.install_path,
    row.name,
    row.version || null,
    row.description || null,
    row.source_url || null,
    ts,
    ts,
  );
}

/**
 * Upsert one `project_pack_associations` row keyed on (project_path, pack_id).
 */
function upsertProjectAssociation(db, row) {
  const ts = nowIso();
  db.prepare(
    `INSERT INTO project_pack_associations
       (project_path, pack_id, detected_at, last_seen_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_path, pack_id) DO UPDATE SET
       last_seen_at = excluded.last_seen_at`,
  ).run(row.project_path, row.pack_id, ts, ts);
}

/**
 * List all packs, collapsed to one row per `pack_id` (the user-facing handle).
 * Includes harness fan-out and skill count.
 */
function listPacks(db) {
  // Installed-inventory reads filter uninstalled_at IS NULL so tombstoned
  // rows (kept for retroactive usage attribution) do NOT surface as
  // currently-installed. Re-installing a tombstoned pack clears
  // uninstalled_at in the upsert path. (shafty PR review P1.)
  // version is NULL when the pack has multiple distinct install versions
  // (e.g. a marketplace pack with several plugins at different versions) —
  // avoids picking one arbitrary value and presenting it as authoritative.
  return db
    .prepare(
      `SELECT
         p.pack_id,
         CASE
           WHEN COUNT(DISTINCT COALESCE(p.version, '')) > 1 THEN NULL
           ELSE MAX(p.version)
         END                                                AS version,
         GROUP_CONCAT(DISTINCT p.harness)                   AS harnesses,
         COUNT(DISTINCT p.harness || '|' || p.install_path) AS install_count,
         MIN(p.detected_at)                                 AS first_detected_at,
         MAX(p.last_seen_at)                                AS last_seen_at,
         (SELECT COUNT(*)
          FROM skills s
          WHERE s.pack_id = p.pack_id
            AND s.uninstalled_at IS NULL)                   AS skill_count
       FROM agent_packs p
       WHERE p.uninstalled_at IS NULL
       GROUP BY p.pack_id
       ORDER BY p.pack_id ASC`,
    )
    .all();
}

/**
 * Get one pack by `pack_id`, returning installs (one row per harness/install
 * path), skills, and project associations. Tombstoned installs are excluded.
 */
function getPack(db, packId) {
  const installs = db
    .prepare(
      `SELECT pack_id, harness, install_path, install_kind, source_url, version,
              detected_at, last_seen_at
       FROM agent_packs
       WHERE pack_id = ?
         AND uninstalled_at IS NULL
       ORDER BY harness ASC, install_path ASC`,
    )
    .all(packId);
  if (!installs.length) return null;

  const skills = listSkillsForPack(db, packId);

  const associations = db
    .prepare(
      `SELECT project_path, pack_id, detected_at, last_seen_at
       FROM project_pack_associations
       WHERE pack_id = ?
       ORDER BY last_seen_at DESC`,
    )
    .all(packId);

  return {
    pack_id: packId,
    version: installs[0].version,
    harnesses: [...new Set(installs.map((i) => i.harness))],
    installs,
    skills,
    associations,
  };
}

function listSkillsForPack(db, packId) {
  return db
    .prepare(
      `SELECT skill_id, pack_id, harness, install_path, name, version, description,
              source_url, detected_at, last_seen_at
       FROM skills
       WHERE pack_id IS ?
         AND uninstalled_at IS NULL
       ORDER BY name ASC, harness ASC`,
    )
    .all(packId);
}

// Shared SQL fragment: extract the skill-name token from a UserPromptSubmit
// event's `data.prompt` field. Claude Code records slash-command invocations
// as UserPromptSubmit events where data.prompt = "/<skill-name> [args...]"
// (no PreToolUse / tool_name='Skill' event is fired). We pull the first
// whitespace-delimited token after the leading slash. Path-like prompts
// (e.g. "/Users/foo/...") are filtered out by requiring the extracted token
// to contain no slash characters.
const SKILL_NAME_FROM_PROMPT_SQL = `
  CASE
    WHEN instr(substr(json_extract(data,'$.prompt'), 2), ' ') > 0
      THEN substr(
        json_extract(data,'$.prompt'),
        2,
        instr(substr(json_extract(data,'$.prompt'), 2), ' ') - 1
      )
    ELSE substr(json_extract(data,'$.prompt'), 2)
  END
`;

const SKILL_INVOCATION_WHERE_SQL = `
  event_type = 'UserPromptSubmit'
  AND json_extract(data,'$.prompt') LIKE '/_%'
`;

/**
 * Cross-pack skills aggregate joined against the existing `events` table for
 * invocation counts. Slash-command invocations are recorded by Claude Code's
 * hook pipeline as `events` rows with `event_type='UserPromptSubmit'` and
 * `data.prompt` of the form `/<skill-name> [args...]` — NOT as
 * `PreToolUse`/`Skill` (those only fire for the tools the skill USES).
 *
 * Aggregation is partitioned by harness (joined from `sessions.harness`) so a
 * pack installed for multiple harnesses (e.g. gstack for Claude AND Codex)
 * reports each install row with its own count rather than attributing every
 * call to every install. `sessions.harness` is the SoT for which harness
 * fired a given hook event — it has been on the schema since the FEA-1132
 * Codex patch (default 'claude' for legacy rows).
 *
 * Also surfaces the most recent `sessions.model` per (skill, harness) so the
 * UI can display the dominant model alongside each row.
 */
function listSkills(db) {
  const rows = db
    .prepare(
      `SELECT
         s.skill_id,
         s.pack_id,
         s.harness,
         s.install_path,
         s.name,
         s.version,
         s.description,
         s.source_url,
         s.detected_at,
         s.last_seen_at,
         COALESCE(inv.invocation_count, 0) AS invocation_count,
         inv.last_invoked_at               AS last_invoked_at
       FROM skills s
       LEFT JOIN (
         SELECT
           ${SKILL_NAME_FROM_PROMPT_SQL.replace(/\bdata\b/g, "e.data")} AS skill_name,
           COALESCE(NULLIF(sess.harness, ''), 'claude')                  AS harness,
           COUNT(*)                                                       AS invocation_count,
           MAX(e.created_at)                                              AS last_invoked_at
         FROM events e
         JOIN sessions sess ON sess.id = e.session_id
         WHERE e.event_type = 'UserPromptSubmit'
           AND json_extract(e.data,'$.prompt') LIKE '/_%'
         GROUP BY skill_name, harness
       ) inv ON inv.skill_name = s.name AND inv.harness = s.harness
       WHERE s.uninstalled_at IS NULL
       ORDER BY s.pack_id IS NULL ASC, s.pack_id ASC, s.name ASC, s.harness ASC`,
    )
    .all();
  return rows;
}

/**
 * Recent invocations for one skill name, joined to `sessions` for session
 * labels, cwd, harness, and model. Pulls from the `events` table only — no
 * parallel invocation storage exists. Same UserPromptSubmit pattern as
 * listSkills. The optional `harness` filter restricts results to a single
 * install row's calls — needed so the Skills page detail panel shows only
 * the calls that match the install row the user clicked on.
 */
function listSkillInvocations(
  db,
  name,
  { limit = 50, offset = 0, harness = null } = {},
) {
  const harnessClause = harness
    ? "AND COALESCE(NULLIF(sess.harness, ''), 'claude') = ?"
    : "";
  const params = [name];
  if (harness) params.push(harness);
  params.push(limit, offset);

  return db
    .prepare(
      `SELECT
         e.id                AS event_id,
         e.session_id,
         e.created_at,
         e.summary,
         e.data,
         sess.name           AS session_name,
         sess.cwd            AS session_cwd,
         COALESCE(NULLIF(sess.harness, ''), 'claude') AS session_harness,
         sess.model          AS session_model
       FROM events e
       JOIN sessions sess ON sess.id = e.session_id
       WHERE e.event_type = 'UserPromptSubmit'
         AND json_extract(e.data,'$.prompt') LIKE '/_%'
         AND (
           CASE
             WHEN instr(substr(json_extract(e.data,'$.prompt'), 2), ' ') > 0
               THEN substr(
                 json_extract(e.data,'$.prompt'),
                 2,
                 instr(substr(json_extract(e.data,'$.prompt'), 2), ' ') - 1
               )
             ELSE substr(json_extract(e.data,'$.prompt'), 2)
           END
         ) = ?
         ${harnessClause}
       ORDER BY e.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params);
}

/**
 * Collect per-pack detection-path patterns from three sources:
 *   1. `agent_packs.install_path` — current AND tombstoned installs.
 *   2. `project_pack_associations.project_path` — per-project installs like
 *      BMad's `_bmad/` directory.
 *   3. `pack_catalog.detection_patterns` (optional) — seeded fuzzy patterns
 *      for packs invoked via plugins-cache or other path shapes that don't
 *      have a formal install row. Catches packs that were used but never
 *      formally installed in `agent_packs`.
 *
 * Returns Map<pack_id, string[]>.
 */
function collectPackPaths(db) {
  const out = new Map();
  function add(pack_id, p) {
    if (!pack_id || typeof p !== "string" || !p) return;
    if (!out.has(pack_id)) out.set(pack_id, new Set());
    out.get(pack_id).add(p);
  }
  for (const row of db
    .prepare(
      "SELECT pack_id, install_path FROM agent_packs WHERE install_path IS NOT NULL",
    )
    .all()) {
    add(row.pack_id, row.install_path);
  }
  for (const row of db
    .prepare(
      "SELECT pack_id, project_path FROM project_pack_associations WHERE project_path IS NOT NULL",
    )
    .all()) {
    add(row.pack_id, row.project_path);
  }
  // detection_patterns is on the catalog table — may not exist in legacy/test
  // environments. try/catch keeps this best-effort.
  try {
    for (const row of db
      .prepare(
        "SELECT pack_id, detection_patterns FROM pack_catalog WHERE detection_patterns IS NOT NULL",
      )
      .all()) {
      let patterns;
      try {
        patterns = JSON.parse(row.detection_patterns);
      } catch {
        continue;
      }
      if (!Array.isArray(patterns)) continue;
      for (const p of patterns) add(row.pack_id, p);
    }
  } catch {
    /* pack_catalog table missing — non-fatal */
  }
  // Convert Set values to arrays so callers can map over them.
  const result = new Map();
  for (const [k, v] of out) result.set(k, Array.from(v));
  return result;
}

/**
 * Retroactive pack-usage attribution from the existing `events` table.
 * See `collectPackPaths()` for which path sources are joined.
 *
 * Returns one row per pack_id with: tool-call count, distinct sessions,
 * first/last used timestamps. Includes tombstoned (uninstalled) packs so they
 * still surface as "previously installed, used N times" on the catalog grid.
 */
function listPackUsage(db) {
  const byPack = collectPackPaths(db);
  if (byPack.size === 0) return [];

  const out = [];
  for (const [packId, packPaths] of byPack) {
    const likeClauses = packPaths.map(() => "e.data LIKE ?").join(" OR ");
    const likeParams = packPaths.map((p) => `%${p}%`);
    const row = db
      .prepare(
        `SELECT
           COUNT(*)                     AS tool_calls,
           COUNT(DISTINCT e.session_id) AS sessions,
           MIN(e.created_at)            AS first_used_at,
           MAX(e.created_at)            AS last_used_at
         FROM events e
         WHERE ${likeClauses}`,
      )
      .get(...likeParams);
    if (row && row.tool_calls > 0) {
      out.push({ pack_id: packId, ...row });
    }
  }
  return out;
}

/**
 * Per-session usage rollup for one pack. Powers the "Used in N sessions"
 * table on the Pack detail page. Each row is one session whose events touched
 * one or more of the pack's detection paths (see `collectPackPaths()`).
 *
 * Sorted by last activity in that session, descending.
 *
 * @returns {Array<{
 *   session_id: string,
 *   session_name: string | null,
 *   session_cwd: string | null,
 *   session_harness: string,
 *   session_model: string | null,
 *   session_started_at: string | null,
 *   tool_calls: number,
 *   first_used_at: string,
 *   last_used_at: string
 * }>}
 */
function listPackSessions(db, packId, { limit = 25, offset = 0 } = {}) {
  const byPack = collectPackPaths(db);
  const packPaths = byPack.get(packId);
  if (!packPaths || packPaths.length === 0) return [];

  const likeClauses = packPaths.map(() => "e.data LIKE ?").join(" OR ");
  const likeParams = packPaths.map((p) => `%${p}%`);

  return db
    .prepare(
      `SELECT
         e.session_id,
         sess.name                                    AS session_name,
         sess.cwd                                     AS session_cwd,
         COALESCE(NULLIF(sess.harness, ''), 'claude') AS session_harness,
         sess.model                                   AS session_model,
         sess.started_at                              AS session_started_at,
         COUNT(*)                                     AS tool_calls,
         MIN(e.created_at)                            AS first_used_at,
         MAX(e.created_at)                            AS last_used_at
       FROM events e
       JOIN sessions sess ON sess.id = e.session_id
       WHERE ${likeClauses}
       GROUP BY e.session_id
       ORDER BY last_used_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...likeParams, limit, offset);
}

/** Total count of sessions matching listPackSessions (for pagination UIs). */
function countPackSessions(db, packId) {
  const byPack = collectPackPaths(db);
  const packPaths = byPack.get(packId);
  if (!packPaths || packPaths.length === 0) return 0;
  const likeClauses = packPaths.map(() => "e.data LIKE ?").join(" OR ");
  const likeParams = packPaths.map((p) => `%${p}%`);
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT e.session_id) AS n
       FROM events e
       WHERE ${likeClauses}`,
    )
    .get(...likeParams);
  return row ? row.n : 0;
}

module.exports = {
  ensurePackSchema,
  upsertPack,
  upsertSkill,
  upsertProjectAssociation,
  listPacks,
  getPack,
  listSkillsForPack,
  listSkills,
  listSkillInvocations,
  listPackUsage,
  listPackSessions,
  countPackSessions,
  collectPackPaths,
};
