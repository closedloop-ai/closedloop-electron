/**
 * @file pack-store.ts
 * @description PGlite persistence for agent-pack inventory: installed packs
 * (`agent_packs`), discovered skills (`skills`), and per-project markers
 * (`project_pack_associations`). All three are pure inventory written by the
 * filesystem scanner; invocation history is sourced from the existing `events`
 * table and never duplicated here (FEA-1224 architectural constraint).
 *
 * Operates on the shared PGlite DB handle (async query API). Mirrors the
 * structure of the original CJS pack-store.js with composite-key upserts in
 * place of monotonic versioning.
 *
 * Schema lives in pglite.ts PGLITE_SCHEMA — no ensurePackSchema() here.
 *
 * Part of CLOSEDLOOP pack-observability (FEA-1224 / PLN-651, parent PRD-364).
 */

import type { Results } from "@electric-sql/pglite";
import type {
  InstalledPack,
  InstalledPackDetail,
  SkillInvocation,
  SkillWithInvocations,
} from "../../shared/agent-db-contract.js";

type DbClient = {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<Results<T>>;
};

function nowIso(): string {
  return new Date().toISOString();
}

// ────────────────────────────────────────────────────────────────────────────
// Upserts
// ────────────────────────────────────────────────────────────────────────────

/**
 * Upsert one `agent_packs` row keyed on (pack_id, harness, install_path).
 * Updates `last_seen_at` plus the mutable fields (`version`, `source_url`,
 * `install_kind`) but preserves the original `detected_at`.
 */
export async function upsertPack(
  db: DbClient,
  row: {
    pack_id: string;
    harness: string;
    install_path: string;
    install_kind: string;
    source_url?: string | null;
    version?: string | null;
  },
): Promise<void> {
  const ts = nowIso();
  await db.query(
    `INSERT INTO agent_packs
       (pack_id, harness, install_path, install_kind, source_url, version, detected_at, last_seen_at, uninstalled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
     ON CONFLICT(pack_id, harness, install_path) DO UPDATE SET
       install_kind   = excluded.install_kind,
       source_url     = COALESCE(excluded.source_url, agent_packs.source_url),
       version        = COALESCE(excluded.version, agent_packs.version),
       last_seen_at   = excluded.last_seen_at,
       uninstalled_at = NULL`,
    [
      row.pack_id,
      row.harness,
      row.install_path,
      row.install_kind,
      row.source_url || null,
      row.version || null,
      ts,
      ts,
    ],
  );
}

/**
 * Upsert one `skills` row keyed on `skill_id`. Callers compute `skill_id`
 * deterministically (e.g. sha256 of harness|install_path|name) so re-scans
 * dedupe to the same row.
 */
export async function upsertSkill(
  db: DbClient,
  row: {
    skill_id: string;
    pack_id?: string | null;
    harness: string;
    install_path: string;
    name: string;
    version?: string | null;
    description?: string | null;
    source_url?: string | null;
  },
): Promise<void> {
  const ts = nowIso();
  await db.query(
    `INSERT INTO skills
       (skill_id, pack_id, harness, install_path, name, version, description, source_url, detected_at, last_seen_at, uninstalled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL)
     ON CONFLICT(skill_id) DO UPDATE SET
       pack_id        = excluded.pack_id,
       version        = COALESCE(excluded.version, skills.version),
       description    = COALESCE(excluded.description, skills.description),
       source_url     = COALESCE(excluded.source_url, skills.source_url),
       last_seen_at   = excluded.last_seen_at,
       uninstalled_at = NULL`,
    [
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
    ],
  );
}

/**
 * Upsert one `project_pack_associations` row keyed on (project_path, pack_id).
 */
export async function upsertProjectAssociation(
  db: DbClient,
  row: { project_path: string; pack_id: string },
): Promise<void> {
  const ts = nowIso();
  await db.query(
    `INSERT INTO project_pack_associations
       (project_path, pack_id, detected_at, last_seen_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(project_path, pack_id) DO UPDATE SET
       last_seen_at = excluded.last_seen_at`,
    [row.project_path, row.pack_id, ts, ts],
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Reads
// ────────────────────────────────────────────────────────────────────────────

interface PackListRow extends Record<string, unknown> {
  pack_id: string;
  version: string | null;
  harnesses: string | null;
  install_count: number;
  first_detected_at: string;
  last_seen_at: string;
  skill_count: number;
}

function splitHarnesses(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return value.split(",").filter(Boolean);
}

function toInstalledPack(row: PackListRow): InstalledPack {
  return {
    packId: row.pack_id,
    harnesses: splitHarnesses(row.harnesses),
    installs: [],
    skillCount: row.skill_count,
    lastSeenAt: row.last_seen_at,
  };
}

function toInstalledPackInstall(row: PackInstallRow): InstalledPack["installs"][number] {
  return {
    harness: row.harness,
    installPath: row.install_path,
    installKind: row.install_kind,
    sourceUrl: row.source_url,
    version: row.version,
    detectedAt: row.detected_at,
    lastSeenAt: row.last_seen_at,
  };
}

function toInstalledPackDetail(
  packId: string,
  installs: PackInstallRow[],
  skills: SkillRow[],
  associations: ProjectAssociationRow[],
): InstalledPackDetail {
  const sortedLastSeenTimes = installs
    .map((install) => install.last_seen_at)
    .filter((value): value is string => typeof value === "string")
    .sort();
  const lastSeenAt = sortedLastSeenTimes.length > 0
    ? sortedLastSeenTimes[sortedLastSeenTimes.length - 1]!
    : null;

  return {
    packId,
    harnesses: [...new Set(installs.map((install) => install.harness))],
    installs: installs.map(toInstalledPackInstall),
    skillCount: skills.length,
    lastSeenAt,
    skills: skills.map((skill) => ({
      skillId: skill.skill_id,
      name: skill.name,
      version: skill.version,
      description: skill.description,
      harness: skill.harness,
    })),
    associations: associations.map((association) => ({
      projectPath: association.project_path,
      detectedAt: association.detected_at,
      lastSeenAt: association.last_seen_at,
    })),
  };
}

function toSkillWithInvocations(row: SkillWithInvocationsRow): SkillWithInvocations {
  return {
    skillId: row.skill_id,
    packId: row.pack_id,
    name: row.name,
    harness: row.harness,
    description: row.description,
    invocationCount: row.invocation_count,
    lastUsedAt: row.last_invoked_at,
  };
}

function toSkillInvocation(row: SkillInvocationRow): SkillInvocation {
  return {
    eventId: row.event_id,
    sessionId: row.session_id,
    sessionName: row.session_name,
    harness: row.session_harness,
    model: row.session_model,
    createdAt: row.created_at,
  };
}

function likeContainsLiteral(value: string): string {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

/**
 * List all packs, collapsed to one row per `pack_id` (the user-facing handle).
 * Includes harness fan-out and skill count.
 *
 * Installed-inventory reads filter uninstalled_at IS NULL so tombstoned
 * rows (kept for retroactive usage attribution) do NOT surface as
 * currently-installed. Re-installing a tombstoned pack clears
 * uninstalled_at in the upsert path.
 *
 * version is NULL when the pack has multiple distinct install versions
 * (e.g. a marketplace pack with several plugins at different versions) --
 * avoids picking one arbitrary value and presenting it as authoritative.
 */
export async function listPacks(db: DbClient): Promise<InstalledPack[]> {
  const result = await db.query<PackListRow>(
    `SELECT
       p.pack_id,
       CASE
         WHEN COUNT(DISTINCT COALESCE(p.version, '')) > 1 THEN NULL
         ELSE MAX(p.version)
       END                                                AS version,
       string_agg(DISTINCT p.harness, ',')                AS harnesses,
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
  );
  return result.rows.map(toInstalledPack);
}

interface PackInstallRow extends Record<string, unknown> {
  pack_id: string;
  harness: string;
  install_path: string;
  install_kind: string;
  source_url: string | null;
  version: string | null;
  detected_at: string;
  last_seen_at: string;
}

interface SkillRow extends Record<string, unknown> {
  skill_id: string;
  pack_id: string | null;
  harness: string;
  install_path: string;
  name: string;
  version: string | null;
  description: string | null;
  source_url: string | null;
  detected_at: string;
  last_seen_at: string;
}

interface ProjectAssociationRow extends Record<string, unknown> {
  project_path: string;
  pack_id: string;
  detected_at: string;
  last_seen_at: string;
}

/**
 * Get one pack by `pack_id`, returning installs (one row per harness/install
 * path), skills, and project associations. Tombstoned installs are excluded.
 */
export async function getPack(
  db: DbClient,
  packId: string,
): Promise<InstalledPackDetail | null> {
  const installResult = await db.query<PackInstallRow>(
    `SELECT pack_id, harness, install_path, install_kind, source_url, version,
            detected_at, last_seen_at
     FROM agent_packs
     WHERE pack_id = $1
       AND uninstalled_at IS NULL
     ORDER BY harness ASC, install_path ASC`,
    [packId],
  );
  const installs = installResult.rows;
  if (!installs.length) return null;

  const skills = await listSkillsForPack(db, packId);

  const assocResult = await db.query<ProjectAssociationRow>(
    `SELECT project_path, pack_id, detected_at, last_seen_at
     FROM project_pack_associations
     WHERE pack_id = $1
     ORDER BY last_seen_at DESC`,
    [packId],
  );

  return toInstalledPackDetail(packId, installs, skills, assocResult.rows);
}

export async function listSkillsForPack(
  db: DbClient,
  packId: string,
): Promise<SkillRow[]> {
  const result = await db.query<SkillRow>(
    `SELECT skill_id, pack_id, harness, install_path, name, version, description,
            source_url, detected_at, last_seen_at
     FROM skills
     WHERE pack_id IS NOT DISTINCT FROM $1
       AND uninstalled_at IS NULL
     ORDER BY name ASC, harness ASC`,
    [packId],
  );
  return result.rows;
}

// ────────────────────────────────────────────────────────────────────────────
// Skill invocation queries
// ────────────────────────────────────────────────────────────────────────────

// Shared SQL fragment: extract the skill-name token from a UserPromptSubmit
// event's `data` field (stored as TEXT, cast to jsonb). Claude Code records
// slash-command invocations as UserPromptSubmit events where
// data->'prompt' = "/<skill-name> [args...]" (no PreToolUse / tool_name='Skill'
// event is fired). We pull the first whitespace-delimited token after the
// leading slash. Path-like prompts (e.g. "/Users/foo/...") are filtered out
// by requiring the extracted token to contain no slash characters.
//
// PG equivalent of the SQLite `instr / substr / json_extract` pattern:
//   - json_extract(data,'$.prompt') → (data::jsonb->>'prompt')
//   - instr(x, y)                   → position(y in x)
//   - substr(x, a, b)               → substring(x from a for b)
function skillNameFromPromptSql(tableAlias: string): string {
  const prompt = `(${tableAlias}.data::jsonb->>'prompt')`;
  const tail = `substring(${prompt} from 2)`; // strip leading '/'
  return `
  CASE
    WHEN position(' ' in ${tail}) > 0
      THEN substring(${tail} from 1 for position(' ' in ${tail}) - 1)
    ELSE ${tail}
  END`;
}

interface SkillWithInvocationsRow extends SkillRow {
  invocation_count: number;
  last_invoked_at: string | null;
}

/**
 * Cross-pack skills aggregate joined against the existing `events` table for
 * invocation counts. Slash-command invocations are recorded by Claude Code's
 * hook pipeline as `events` rows with `event_type='UserPromptSubmit'` and
 * `data.prompt` of the form `/<skill-name> [args...]` -- NOT as
 * `PreToolUse`/`Skill` (those only fire for the tools the skill USES).
 *
 * Aggregation is partitioned by harness (joined from `sessions.harness`) so a
 * pack installed for multiple harnesses (e.g. gstack for Claude AND Codex)
 * reports each install row with its own count rather than attributing every
 * call to every install. `sessions.harness` is the SoT for which harness
 * fired a given hook event -- it has been on the schema since the FEA-1132
 * Codex patch (default 'claude' for legacy rows).
 */
export async function listSkills(db: DbClient): Promise<SkillWithInvocations[]> {
  const result = await db.query<SkillWithInvocationsRow>(
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
       COALESCE(inv.invocation_count, 0)::int AS invocation_count,
       inv.last_invoked_at                     AS last_invoked_at
     FROM skills s
     LEFT JOIN (
       SELECT
         ${skillNameFromPromptSql("e")} AS skill_name,
         COALESCE(NULLIF(sess.harness, ''), 'claude')  AS harness,
         COUNT(*)::int                                  AS invocation_count,
         MAX(e.created_at)                              AS last_invoked_at
       FROM events e
       JOIN sessions sess ON sess.id = e.session_id
       WHERE e.event_type = 'UserPromptSubmit'
         AND (e.data::jsonb->>'prompt') LIKE '/_%'
       GROUP BY skill_name, harness
     ) inv ON inv.skill_name = s.name AND inv.harness = s.harness
     WHERE s.uninstalled_at IS NULL
     ORDER BY (s.pack_id IS NULL) ASC, s.pack_id ASC, s.name ASC, s.harness ASC`,
  );
  return result.rows.map(toSkillWithInvocations);
}

interface SkillInvocationRow extends Record<string, unknown> {
  event_id: string;
  session_id: string;
  created_at: string;
  summary: string | null;
  data: string | null;
  session_name: string | null;
  session_cwd: string | null;
  session_harness: string;
  session_model: string | null;
}

/**
 * Recent invocations for one skill name, joined to `sessions` for session
 * labels, cwd, harness, and model. Pulls from the `events` table only -- no
 * parallel invocation storage exists. Same UserPromptSubmit pattern as
 * listSkills. The optional `harness` filter restricts results to a single
 * install row's calls -- needed so the Skills page detail panel shows only
 * the calls that match the install row the user clicked on.
 */
export async function listSkillInvocations(
  db: DbClient,
  name: string,
  {
    limit = 50,
    offset = 0,
    harness = null as string | null,
  } = {},
): Promise<SkillInvocation[]> {
  const harnessClause = harness
    ? "AND COALESCE(NULLIF(sess.harness, ''), 'claude') = $2"
    : "";

  const params: unknown[] = [name];
  if (harness) params.push(harness);
  // limit and offset positions depend on whether harness is present
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  params.push(limit, offset);

  const prompt = `(e.data::jsonb->>'prompt')`;
  const tail = `substring(${prompt} from 2)`;

  const result = await db.query<SkillInvocationRow>(
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
       AND ${prompt} LIKE '/_%'
       AND (
         CASE
           WHEN position(' ' in ${tail}) > 0
             THEN substring(${tail} from 1 for position(' ' in ${tail}) - 1)
           ELSE ${tail}
         END
       ) = $1
       ${harnessClause}
     ORDER BY e.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );
  return result.rows.map(toSkillInvocation);
}

// ────────────────────────────────────────────────────────────────────────────
// Pack path collection & usage attribution
// ────────────────────────────────────────────────────────────────────────────

/**
 * Collect per-pack detection-path patterns from three sources:
 *   1. `agent_packs.install_path` -- current AND tombstoned installs.
 *   2. `project_pack_associations.project_path` -- per-project installs like
 *      BMad's `_bmad/` directory.
 *   3. `pack_catalog.detection_patterns` (optional) -- seeded fuzzy patterns
 *      for packs invoked via plugins-cache or other path shapes that don't
 *      have a formal install row. Catches packs that were used but never
 *      formally installed in `agent_packs`.
 *
 * Returns Map<pack_id, string[]>.
 */
export async function collectPackPaths(
  db: DbClient,
): Promise<Map<string, string[]>> {
  const out = new Map<string, Set<string>>();

  function add(pack_id: string | null, p: unknown): void {
    if (!pack_id || typeof p !== "string" || !p) return;
    if (!out.has(pack_id)) out.set(pack_id, new Set());
    out.get(pack_id)!.add(p);
  }

  const installRows = await db.query<{
    pack_id: string;
    install_path: string;
  }>(
    "SELECT pack_id, install_path FROM agent_packs WHERE install_path IS NOT NULL",
  );
  for (const row of installRows.rows) {
    add(row.pack_id, row.install_path);
  }

  const assocRows = await db.query<{
    pack_id: string;
    project_path: string;
  }>(
    "SELECT pack_id, project_path FROM project_pack_associations WHERE project_path IS NOT NULL",
  );
  for (const row of assocRows.rows) {
    add(row.pack_id, row.project_path);
  }

  // detection_patterns is on the catalog table -- may not exist in legacy/test
  // environments. try/catch keeps this best-effort.
  try {
    const catalogRows = await db.query<{
      pack_id: string;
      detection_patterns: unknown;
    }>(
      "SELECT pack_id, detection_patterns FROM pack_catalog WHERE detection_patterns IS NOT NULL",
    );
    for (const row of catalogRows.rows) {
      // detection_patterns is JSONB in PGlite, so it comes back as a parsed
      // value (array) rather than a string that needs JSON.parse.
      let patterns: unknown[];
      if (Array.isArray(row.detection_patterns)) {
        patterns = row.detection_patterns;
      } else if (typeof row.detection_patterns === "string") {
        try {
          patterns = JSON.parse(row.detection_patterns);
        } catch {
          continue;
        }
        if (!Array.isArray(patterns)) continue;
      } else {
        continue;
      }
      for (const p of patterns) add(row.pack_id, p);
    }
  } catch {
    /* pack_catalog table missing -- non-fatal */
  }

  // Convert Set values to arrays so callers can map over them.
  const result = new Map<string, string[]>();
  for (const [k, v] of out) result.set(k, Array.from(v));
  return result;
}

interface PackUsageRow extends Record<string, unknown> {
  pack_id: string;
  tool_calls: number;
  sessions: number;
  first_used_at: string;
  last_used_at: string;
}

/**
 * Retroactive pack-usage attribution from the existing `events` table.
 * See `collectPackPaths()` for which path sources are joined.
 *
 * Returns one row per pack_id with: tool-call count, distinct sessions,
 * first/last used timestamps. Includes tombstoned (uninstalled) packs so they
 * still surface as "previously installed, used N times" on the catalog grid.
 */
export async function listPackUsage(db: DbClient): Promise<PackUsageRow[]> {
  const byPack = await collectPackPaths(db);
  if (byPack.size === 0) return [];

  const out: PackUsageRow[] = [];
  for (const [packId, packPaths] of byPack) {
    const likeClauses = packPaths.map((_, i) => `e.data LIKE $${i + 1} ESCAPE '\\'`).join(" OR ");
    const likeParams = packPaths.map(likeContainsLiteral);
    const result = await db.query<{
      tool_calls: number;
      sessions: number;
      first_used_at: string;
      last_used_at: string;
    }>(
      `SELECT
         COUNT(*)::int                   AS tool_calls,
         COUNT(DISTINCT e.session_id)::int AS sessions,
         MIN(e.created_at)               AS first_used_at,
         MAX(e.created_at)               AS last_used_at
       FROM events e
       WHERE ${likeClauses}`,
      likeParams,
    );
    const row = result.rows[0] ?? null;
    if (row && row.tool_calls > 0) {
      out.push({ pack_id: packId, ...row });
    }
  }
  return out;
}

interface PackSessionRow extends Record<string, unknown> {
  session_id: string;
  session_name: string | null;
  session_cwd: string | null;
  session_harness: string;
  session_model: string | null;
  session_started_at: string | null;
  tool_calls: number;
  first_used_at: string;
  last_used_at: string;
}

/**
 * Per-session usage rollup for one pack. Powers the "Used in N sessions"
 * table on the Pack detail page. Each row is one session whose events touched
 * one or more of the pack's detection paths (see `collectPackPaths()`).
 *
 * Sorted by last activity in that session, descending.
 */
export async function listPackSessions(
  db: DbClient,
  packId: string,
  { limit = 25, offset = 0 } = {},
): Promise<PackSessionRow[]> {
  const byPack = await collectPackPaths(db);
  const packPaths = byPack.get(packId);
  if (!packPaths || packPaths.length === 0) return [];

  const likeClauses = packPaths.map((_, i) => `e.data LIKE $${i + 1} ESCAPE '\\'`).join(" OR ");
  const likeParams: unknown[] = packPaths.map(likeContainsLiteral);

  const limitIdx = likeParams.length + 1;
  const offsetIdx = likeParams.length + 2;
  likeParams.push(limit, offset);

  const result = await db.query<PackSessionRow>(
    `SELECT
       e.session_id,
       sess.name                                    AS session_name,
       sess.cwd                                     AS session_cwd,
       COALESCE(NULLIF(sess.harness, ''), 'claude') AS session_harness,
       sess.model                                   AS session_model,
       sess.started_at                              AS session_started_at,
       COUNT(*)::int                                AS tool_calls,
       MIN(e.created_at)                            AS first_used_at,
       MAX(e.created_at)                            AS last_used_at
     FROM events e
     JOIN sessions sess ON sess.id = e.session_id
     WHERE ${likeClauses}
     GROUP BY e.session_id, sess.name, sess.cwd, sess.harness, sess.model, sess.started_at
     ORDER BY last_used_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    likeParams,
  );
  return result.rows;
}

/** Total count of sessions matching listPackSessions (for pagination UIs). */
export async function countPackSessions(
  db: DbClient,
  packId: string,
): Promise<number> {
  const byPack = await collectPackPaths(db);
  const packPaths = byPack.get(packId);
  if (!packPaths || packPaths.length === 0) return 0;

  const likeClauses = packPaths.map((_, i) => `e.data LIKE $${i + 1} ESCAPE '\\'`).join(" OR ");
  const likeParams = packPaths.map(likeContainsLiteral);

  const result = await db.query<{ n: number }>(
    `SELECT COUNT(DISTINCT e.session_id)::int AS n
     FROM events e
     WHERE ${likeClauses}`,
    likeParams,
  );
  const row = result.rows[0] ?? null;
  return row ? row.n : 0;
}
