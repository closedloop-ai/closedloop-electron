/**
 * @file catalog-store.ts
 * @description PGlite persistence for the Agent Pack Catalog (FEA-1314 /
 * PLN-657). Three tables: `pack_catalog` (curated packs + live GitHub
 * stats), `pack_catalog_history` (append-only star/fork samples for the
 * sparkline), `pack_install_runs` (audit log for install/uninstall
 * subprocess executions). All operate on the shared PGlite DB handle.
 *
 * Catalog entries join against the FEA-1224 `agent_packs` table on
 * `pack_id` to derive installed status — keep pack_id strings aligned with
 * what the scanner writes (gstack, bmad-method, etc.).
 *
 * Schema lives in pglite.ts PGLITE_SCHEMA — no ensureCatalogSchema() here.
 *
 * Part of CLOSEDLOOP pack-observability (FEA-1314 / PLN-657, builds on
 * FEA-1224).
 */

import type { Results } from "@electric-sql/pglite";
import type {
  CatalogContentItem,
  CatalogContentsConfig,
  CatalogEntry,
  InstallRunRecord,
} from "../../shared/agent-db-contract.js";

/** Minimal subset of PgliteClient / PgliteExecutor used by catalog-store. */
type DbClient = {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<Results<T>>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface CatalogRow extends Record<string, unknown> {
  pack_id: string;
  display_name: string;
  category: string | null;
  github_url: string;
  marketplace_url: string | null;
  description: string | null;
  description_live: string | null;
  harnesses: string[] | null;
  install_commands: Record<string, unknown> | null;
  uninstall_commands: Record<string, unknown> | null;
  install_notes: string | null;
  placeholder_reason: string | null;
  verified: boolean;
  readme_excerpt: string | null;
  readme_fetched_at: string | null;
  stars: number | null;
  forks: number | null;
  last_release: string | null;
  last_fetched_at: string | null;
  seed_version: number;
  pin_order: number | null;
  contents: Record<string, unknown> | null;
  contents_cache: unknown[] | null;
  contents_fetched_at: string | null;
  detection_patterns: string[] | null;
  harness_agnostic: boolean;
  project_scoped: boolean;
  single_install: boolean;
  post_install: Record<string, unknown> | null;
  // Derived via subquery joins:
  installed_harnesses: string | null;
  installed_skill_count: number | null;
  uninstalled_at: string | null;
}

interface HistoryRow extends Record<string, unknown> {
  fetched_at: string;
  stars: number | null;
  forks: number | null;
}

interface InstallRunRow extends Record<string, unknown> {
  id: number;
  pack_id: string;
  harness: string | null;
  action: string;
  command: string | null;
  exit_code: number | null;
  started_at: string;
  ended_at: string | null;
  stdout_tail: string | null;
  stderr_tail: string | null;
}

interface SeedVersionRow extends Record<string, unknown> {
  pack_id: string;
  seed_version: number;
}

interface PackUsage {
  tool_calls: number;
  sessions: number;
  first_used_at: string;
  last_used_at: string;
}

interface SeedPack {
  pack_id: string;
  display_name: string;
  github_url: string;
  category?: string | null;
  marketplace_url?: string | null;
  description?: string | null;
  harnesses?: string[] | null;
  install_commands?: Record<string, unknown> | null;
  uninstall_commands?: Record<string, unknown> | null;
  install_notes?: string | null;
  placeholder_reason?: string | null;
  verified?: boolean;
  pin_order?: number | null;
  contents?: Record<string, unknown> | null;
  detection_patterns?: string[] | null;
  harness_agnostic?: boolean;
  project_scoped?: boolean;
  single_install?: boolean;
  post_install?: Record<string, unknown> | null;
}

interface SeedDoc {
  seed_version?: number;
  packs: SeedPack[];
}

// ---------------------------------------------------------------------------
// Usage attribution (best-effort)
// ---------------------------------------------------------------------------

/**
 * Compute pack usage attribution from the existing `events` table — works
 * retroactively on already-imported sessions.
 *
 * Returns Map<pack_id, { tool_calls, sessions, first_used_at, last_used_at }>.
 *
 * TODO: Wire up to the first-party pack-store's listPackUsage once ported.
 */
async function loadUsageMap(
  _db: DbClient,
): Promise<Map<string, PackUsage>> {
  // pack-store with listPackUsage is not yet ported to the first-party app.
  // Return an empty map until the dependency is available.
  return new Map();
}

function stringRecordOrNull(
  value: Record<string, unknown> | null,
): Record<string, string> | null {
  if (!value) {
    return null;
  }
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

function catalogContentsOrNull(
  value: Record<string, unknown> | null,
): CatalogContentsConfig | null {
  if (!value || typeof value.type !== "string") {
    return null;
  }
  return { ...value, type: value.type };
}

function isCatalogContentItem(value: unknown): value is CatalogContentItem {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const item = value as { name?: unknown; type?: unknown };
  return typeof item.name === "string" && typeof item.type === "string";
}

function catalogContentItemsOrNull(value: unknown[] | null): CatalogContentItem[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.filter(isCatalogContentItem);
}

function splitInstalledHarnesses(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return value.split(",").filter(Boolean);
}

function toHistoryEntry(row: HistoryRow): CatalogEntry["history"][number] {
  return {
    fetchedAt: row.fetched_at,
    stars: row.stars ?? 0,
    forks: row.forks ?? 0,
  };
}

function toCatalogEntry(
  row: CatalogRow,
  {
    history = [],
    usage = null,
  }: {
    history?: CatalogEntry["history"];
    usage?: PackUsage | null;
  } = {},
): CatalogEntry {
  return {
    packId: row.pack_id,
    displayName: row.display_name,
    category: row.category,
    githubUrl: row.github_url,
    marketplaceUrl: row.marketplace_url,
    description: row.description,
    descriptionLive: row.description_live,
    harnesses: row.harnesses ?? [],
    installCommands: stringRecordOrNull(row.install_commands),
    uninstallCommands: stringRecordOrNull(row.uninstall_commands),
    installNotes: row.install_notes,
    placeholderReason: row.placeholder_reason,
    verified: row.verified,
    readmeExcerpt: row.readme_excerpt,
    stars: row.stars,
    forks: row.forks,
    lastRelease: row.last_release,
    seedVersion: row.seed_version,
    pinOrder: row.pin_order,
    contents: catalogContentsOrNull(row.contents),
    contentsCache: catalogContentItemsOrNull(row.contents_cache),
    detectionPatterns: row.detection_patterns,
    harnessAgnostic: row.harness_agnostic,
    projectScoped: row.project_scoped,
    singleInstall: row.single_install,
    postInstall: row.post_install,
    installedHarnesses: splitInstalledHarnesses(row.installed_harnesses),
    skillCount: row.installed_skill_count ?? 0,
    usageCount: usage?.tool_calls ?? 0,
    history,
  };
}

function toInstallRunRecord(row: InstallRunRow): InstallRunRecord {
  return {
    id: row.id,
    packId: row.pack_id,
    harness: row.harness,
    action: row.action,
    command: row.command,
    exitCode: row.exit_code,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    stdoutTail: row.stdout_tail,
    stderrTail: row.stderr_tail,
  };
}

// ---------------------------------------------------------------------------
// Seed upsert
// ---------------------------------------------------------------------------

/**
 * Apply the seed JSON to `pack_catalog`. Each row's `seed_version` is
 * compared against the seed's top-level `seed_version`; rows whose stored
 * seed_version is lower (or absent) are upserted. Higher stored seed_versions
 * are left alone (assume a newer seed was previously applied — don't roll
 * back).
 *
 * Live fields (stars, forks, description_live, last_fetched_at) are NEVER
 * touched by this function — they're owned by the fetcher.
 */
export async function upsertCatalogSeed(
  db: DbClient,
  seedDoc: SeedDoc | null | undefined,
): Promise<{ inserted: number; updated: number; skipped: number }> {
  if (!seedDoc || !Array.isArray(seedDoc.packs)) {
    return { inserted: 0, updated: 0, skipped: 0 };
  }
  const seedVersion = Number.isInteger(seedDoc.seed_version)
    ? seedDoc.seed_version!
    : 1;
  const stats = { inserted: 0, updated: 0, skipped: 0 };

  for (const pack of seedDoc.packs) {
    if (!pack || !pack.pack_id || !pack.display_name || !pack.github_url) {
      continue;
    }

    const existingResult = await db.query<SeedVersionRow>(
      "SELECT pack_id, seed_version FROM pack_catalog WHERE pack_id = $1",
      [pack.pack_id],
    );
    const existing = existingResult.rows[0] ?? null;

    if (existing && existing.seed_version >= seedVersion) {
      stats.skipped += 1;
      continue;
    }

    await db.query(
      `INSERT INTO pack_catalog
         (pack_id, display_name, category, github_url, marketplace_url,
          description, harnesses, install_commands, uninstall_commands,
          install_notes, placeholder_reason, verified, pin_order, contents,
          detection_patterns, harness_agnostic, project_scoped,
          single_install, post_install, seed_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       ON CONFLICT(pack_id) DO UPDATE SET
         display_name        = EXCLUDED.display_name,
         category            = EXCLUDED.category,
         github_url          = EXCLUDED.github_url,
         marketplace_url     = EXCLUDED.marketplace_url,
         description         = EXCLUDED.description,
         harnesses           = EXCLUDED.harnesses,
         install_commands    = EXCLUDED.install_commands,
         uninstall_commands  = EXCLUDED.uninstall_commands,
         install_notes       = EXCLUDED.install_notes,
         placeholder_reason  = EXCLUDED.placeholder_reason,
         verified            = EXCLUDED.verified,
         pin_order           = EXCLUDED.pin_order,
         contents            = EXCLUDED.contents,
         detection_patterns  = EXCLUDED.detection_patterns,
         harness_agnostic    = EXCLUDED.harness_agnostic,
         project_scoped      = EXCLUDED.project_scoped,
         single_install      = EXCLUDED.single_install,
         post_install        = EXCLUDED.post_install,
         seed_version        = EXCLUDED.seed_version`,
      [
        pack.pack_id,
        pack.display_name,
        pack.category ?? null,
        pack.github_url,
        pack.marketplace_url ?? null,
        pack.description ?? null,
        pack.harnesses ? JSON.stringify(pack.harnesses) : null,
        pack.install_commands ? JSON.stringify(pack.install_commands) : null,
        pack.uninstall_commands
          ? JSON.stringify(pack.uninstall_commands)
          : null,
        pack.install_notes ?? null,
        pack.placeholder_reason ?? null,
        pack.verified ? true : false,
        typeof pack.pin_order === "number" ? pack.pin_order : null,
        pack.contents ? JSON.stringify(pack.contents) : null,
        Array.isArray(pack.detection_patterns)
          ? JSON.stringify(pack.detection_patterns)
          : null,
        pack.harness_agnostic ? true : false,
        pack.project_scoped ? true : false,
        pack.single_install ? true : false,
        pack.post_install ? JSON.stringify(pack.post_install) : null,
        seedVersion,
      ],
    );

    if (existing) stats.updated += 1;
    else stats.inserted += 1;
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Catalog listing
// ---------------------------------------------------------------------------

/**
 * List all catalog entries. Sort order:
 *   1. Pinned entries (pin_order ASC) — ClosedLoop always lands first.
 *   2. Everything else by star count DESC.
 *   3. Tiebreak: display name ASC.
 *
 * Installed status is decorated via subquery joins against `agent_packs` and
 * `skills`.
 */
export async function listCatalog(db: DbClient): Promise<CatalogEntry[]> {
  const result = await db.query<CatalogRow>(
    `SELECT
       c.*,
       (SELECT string_agg(DISTINCT ap.harness, ',')
        FROM agent_packs ap
        WHERE ap.pack_id = c.pack_id
          AND ap.uninstalled_at IS NULL)            AS installed_harnesses,
       (SELECT COUNT(*) FROM skills s
        WHERE s.pack_id = c.pack_id
          AND s.uninstalled_at IS NULL)             AS installed_skill_count,
       (SELECT MAX(ap.uninstalled_at)
        FROM agent_packs ap
        WHERE ap.pack_id = c.pack_id
          AND ap.uninstalled_at IS NOT NULL)        AS uninstalled_at
     FROM pack_catalog c
     ORDER BY
       CASE WHEN c.pin_order IS NULL THEN 1 ELSE 0 END ASC,
       c.pin_order ASC,
       COALESCE(c.stars, 0) DESC,
       c.display_name ASC`,
  );
  const rows = result.rows;

  const usage = await loadUsageMap(db);

  return rows.map((row) =>
    toCatalogEntry(row, { usage: usage.get(row.pack_id) ?? null }),
  );
}

// ---------------------------------------------------------------------------
// Single-entry detail
// ---------------------------------------------------------------------------

/** Get one catalog entry by pack_id, with installed status + recent history. */
export async function getCatalog(
  db: DbClient,
  packId: string,
  { historyDays = 30 }: { historyDays?: number } = {},
): Promise<CatalogEntry | null> {
  const result = await db.query<CatalogRow>(
    `SELECT
       c.*,
       (SELECT string_agg(DISTINCT ap.harness, ',')
        FROM agent_packs ap
        WHERE ap.pack_id = c.pack_id
          AND ap.uninstalled_at IS NULL)            AS installed_harnesses,
       (SELECT COUNT(*) FROM skills s
        WHERE s.pack_id = c.pack_id
          AND s.uninstalled_at IS NULL)             AS installed_skill_count,
       (SELECT MAX(ap.uninstalled_at)
        FROM agent_packs ap
        WHERE ap.pack_id = c.pack_id
          AND ap.uninstalled_at IS NOT NULL)        AS uninstalled_at
     FROM pack_catalog c
     WHERE c.pack_id = $1`,
    [packId],
  );
  const row = result.rows[0] ?? null;
  if (!row) return null;

  const usage = await loadUsageMap(db);

  return toCatalogEntry(row, {
    usage: usage.get(packId) ?? null,
    history: await listHistory(db, packId, historyDays),
  });
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export async function listHistory(
  db: DbClient,
  packId: string,
  days = 30,
): Promise<CatalogEntry["history"]> {
  const since = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000,
  ).toISOString();
  const result = await db.query<HistoryRow>(
    `SELECT fetched_at, stars, forks
     FROM pack_catalog_history
     WHERE pack_id = $1 AND fetched_at >= $2
     ORDER BY fetched_at ASC`,
    [packId, since],
  );
  return result.rows.map(toHistoryEntry);
}

// ---------------------------------------------------------------------------
// Fetch results (GitHub stats)
// ---------------------------------------------------------------------------

/**
 * Update the live fields after a successful GitHub fetch + append a history
 * sample. Called by the fetcher.
 */
export async function applyFetchResult(
  db: DbClient,
  {
    pack_id,
    stars,
    forks,
    description,
    last_release,
  }: {
    pack_id: string;
    stars?: number | null;
    forks?: number | null;
    description?: string | null;
    last_release?: string | null;
  },
): Promise<void> {
  const ts = nowIso();
  await db.query(
    `UPDATE pack_catalog
       SET stars            = $1,
           forks            = $2,
           description_live = COALESCE($3, description_live),
           last_release     = COALESCE($4, last_release),
           last_fetched_at  = $5
     WHERE pack_id = $6`,
    [
      stars ?? null,
      forks ?? null,
      description || null,
      last_release || null,
      ts,
      pack_id,
    ],
  );
  if (stars != null || forks != null) {
    await db.query(
      `INSERT INTO pack_catalog_history
         (pack_id, fetched_at, stars, forks)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (pack_id, fetched_at) DO UPDATE SET
         stars = EXCLUDED.stars,
         forks = EXCLUDED.forks`,
      [pack_id, ts, stars ?? null, forks ?? null],
    );
  }
}

// ---------------------------------------------------------------------------
// README fetch
// ---------------------------------------------------------------------------

/**
 * Update the README excerpt for a pack. Called by the catalog-route's
 * on-demand README fetcher (lazy — README is only pulled when a user
 * opens the detail modal).
 */
export async function applyReadmeFetch(
  db: DbClient,
  {
    pack_id,
    readme_excerpt,
  }: { pack_id: string; readme_excerpt: string | null },
): Promise<void> {
  await db.query(
    `UPDATE pack_catalog
       SET readme_excerpt    = $1,
           readme_fetched_at = $2
     WHERE pack_id = $3`,
    [readme_excerpt || null, nowIso(), pack_id],
  );
}

// ---------------------------------------------------------------------------
// Contents fetch
// ---------------------------------------------------------------------------

/**
 * Cache the per-pack contents listing fetched by catalog-contents.
 * `items` is an array of `{ name, kind, description?, path? }`.
 */
export async function applyContentsFetch(
  db: DbClient,
  {
    pack_id,
    items,
  }: { pack_id: string; items: unknown[] | null | undefined },
): Promise<void> {
  await db.query(
    `UPDATE pack_catalog
       SET contents_cache      = $1,
           contents_fetched_at = $2
     WHERE pack_id = $3`,
    [items == null ? null : JSON.stringify(items), nowIso(), pack_id],
  );
}

// ---------------------------------------------------------------------------
// Install runs (audit log)
// ---------------------------------------------------------------------------

interface InsertedIdRow extends Record<string, unknown> {
  id: number;
}

export async function recordInstallRunStart(
  db: DbClient,
  {
    pack_id,
    harness,
    action,
    command,
  }: { pack_id: string; harness: string; action: string; command: string },
): Promise<number> {
  const ts = nowIso();
  const result = await db.query<InsertedIdRow>(
    `INSERT INTO pack_install_runs (pack_id, harness, action, command, started_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [pack_id, harness, action, command, ts],
  );
  return result.rows[0]!.id;
}

export async function recordInstallRunEnd(
  db: DbClient,
  id: number,
  {
    exit_code,
    stdout_tail,
    stderr_tail,
  }: {
    exit_code?: number | null;
    stdout_tail?: string | null;
    stderr_tail?: string | null;
  },
): Promise<void> {
  await db.query(
    `UPDATE pack_install_runs
       SET exit_code   = $1,
           ended_at    = $2,
           stdout_tail = $3,
           stderr_tail = $4
     WHERE id = $5`,
    [
      exit_code ?? null,
      nowIso(),
      stdout_tail || null,
      stderr_tail || null,
      id,
    ],
  );
}

interface InFlightRow extends Record<string, unknown> {
  id: number;
  harness: string | null;
  command: string | null;
  started_at: string;
}

export async function inFlightInstallRun(
  db: DbClient,
  packId: string,
): Promise<InFlightRow | null> {
  const result = await db.query<InFlightRow>(
    `SELECT id, harness, command, started_at FROM pack_install_runs
     WHERE pack_id = $1 AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [packId],
  );
  return result.rows[0] ?? null;
}

export async function listInstallRuns(
  db: DbClient,
  {
    pack_id = null,
    limit = 50,
    offset = 0,
  }: { pack_id?: string | null; limit?: number; offset?: number } = {},
): Promise<InstallRunRecord[]> {
  if (pack_id) {
    const result = await db.query<InstallRunRow>(
      `SELECT * FROM pack_install_runs
       WHERE pack_id = $1
       ORDER BY started_at DESC
       LIMIT $2 OFFSET $3`,
      [pack_id, limit, offset],
    );
    return result.rows.map(toInstallRunRecord);
  }
  const result = await db.query<InstallRunRow>(
    `SELECT * FROM pack_install_runs
     ORDER BY started_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows.map(toInstallRunRecord);
}

export async function deleteInstallRun(
  db: DbClient,
  id: number,
): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM pack_install_runs WHERE id = $1 AND ended_at IS NOT NULL`,
    [id],
  );
  return (result.affectedRows ?? 0) > 0;
}
