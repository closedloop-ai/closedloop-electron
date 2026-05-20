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
       (pack_id, harness, install_path, install_kind, source_url, version, detected_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(pack_id, harness, install_path) DO UPDATE SET
       install_kind = excluded.install_kind,
       source_url   = COALESCE(excluded.source_url, source_url),
       version      = COALESCE(excluded.version, version),
       last_seen_at = excluded.last_seen_at`,
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
       (skill_id, pack_id, harness, install_path, name, version, description, source_url, detected_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(skill_id) DO UPDATE SET
       pack_id      = excluded.pack_id,
       version      = COALESCE(excluded.version, version),
       description  = COALESCE(excluded.description, description),
       source_url   = COALESCE(excluded.source_url, source_url),
       last_seen_at = excluded.last_seen_at`,
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
  return db
    .prepare(
      `SELECT
         p.pack_id,
         MAX(p.version)                                     AS version,
         GROUP_CONCAT(DISTINCT p.harness)                   AS harnesses,
         COUNT(DISTINCT p.harness || '|' || p.install_path) AS install_count,
         MIN(p.detected_at)                                 AS first_detected_at,
         MAX(p.last_seen_at)                                AS last_seen_at,
         (SELECT COUNT(*) FROM skills s WHERE s.pack_id = p.pack_id) AS skill_count
       FROM agent_packs p
       GROUP BY p.pack_id
       ORDER BY p.pack_id ASC`,
    )
    .all();
}

/**
 * Get one pack by `pack_id`, returning installs (one row per harness/install
 * path), skills, and project associations.
 */
function getPack(db, packId) {
  const installs = db
    .prepare(
      `SELECT pack_id, harness, install_path, install_kind, source_url, version,
              detected_at, last_seen_at
       FROM agent_packs
       WHERE pack_id = ?
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
           ${SKILL_NAME_FROM_PROMPT_SQL} AS skill_name,
           COUNT(*)                       AS invocation_count,
           MAX(created_at)                AS last_invoked_at
         FROM events
         WHERE ${SKILL_INVOCATION_WHERE_SQL}
         GROUP BY skill_name
       ) inv ON inv.skill_name = s.name
       ORDER BY s.pack_id IS NULL ASC, s.pack_id ASC, s.name ASC`,
    )
    .all();
  return rows;
}

/**
 * Recent invocations for one skill name, joined to `sessions` for session
 * labels/cwd. Pulls from the `events` table only — no parallel invocation
 * storage exists. Same UserPromptSubmit pattern as listSkills.
 */
function listSkillInvocations(db, name, { limit = 50, offset = 0 } = {}) {
  return db
    .prepare(
      `SELECT
         e.id           AS event_id,
         e.session_id,
         e.created_at,
         e.summary,
         e.data,
         s.name         AS session_name,
         s.cwd          AS session_cwd
       FROM events e
       LEFT JOIN sessions s ON s.id = e.session_id
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
       ORDER BY e.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(name, limit, offset);
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
};
