/**
 * @file catalog-store.js
 * @description SQLite persistence for the Agent Pack Catalog (FEA-1314 /
 * PLN-657). Three tables: `pack_catalog` (10 curated packs + live GitHub
 * stats), `pack_catalog_history` (append-only star/fork samples for the
 * sparkline), `pack_install_runs` (audit log for install/uninstall
 * subprocess executions). All operate on the shared agent-monitor DB handle
 * (better-sqlite3 / compat-sqlite API).
 *
 * Catalog entries join against the FEA-1224 `agent_packs` table on
 * `pack_id` to derive installed status — keep pack_id strings aligned with
 * what the scanner writes (gstack, bmad-method, etc.).
 *
 * Part of CLOSEDLOOP pack-observability (FEA-1314 / PLN-657, builds on
 * FEA-1224).
 */
"use strict";

function nowIso() {
  return new Date().toISOString();
}

/**
 * Create the three catalog tables if absent. Idempotent — uses
 * `CREATE TABLE IF NOT EXISTS`, no ALTER migrations.
 */
function ensureCatalogSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pack_catalog (
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
    );

    CREATE TABLE IF NOT EXISTS pack_catalog_history (
      pack_id    TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      stars      INTEGER,
      forks      INTEGER,
      PRIMARY KEY (pack_id, fetched_at)
    );

    CREATE TABLE IF NOT EXISTS pack_install_runs (
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

    CREATE INDEX IF NOT EXISTS idx_pack_catalog_history_pack
      ON pack_catalog_history(pack_id, fetched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pack_install_runs_pack
      ON pack_install_runs(pack_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pack_install_runs_inflight
      ON pack_install_runs(pack_id, ended_at);
  `);

  // Idempotent additive migrations for columns added after seed v1. CREATE
  // TABLE IF NOT EXISTS above only fires on a fresh DB; on an upgraded DB
  // we need ALTER TABLE for the new columns. Mirrors the same
  // detect-then-ALTER pattern used in plan-store.js.
  for (const [col, type] of [
    ["verified", "INTEGER NOT NULL DEFAULT 0"],
    ["readme_excerpt", "TEXT"],
    ["readme_fetched_at", "TEXT"],
    // v3: pin_order surfaces "always show first" packs (closedloop) at the
    // top of the unified catalog grid, even if their star count is lower
    // than others. NULL = no pin (sort by stars).
    ["pin_order", "INTEGER"],
    // v3: contents describes how to fetch this pack's skill/agent/command
    // list from GitHub (JSON; see catalog-contents.js). Cached output lands
    // in contents_cache + contents_fetched_at.
    ["contents", "TEXT"],
    ["contents_cache", "TEXT"],
    ["contents_fetched_at", "TEXT"],
    // v6: upstream_github_url for marketplace plugins whose "real source"
    // lives in a separate repo from the marketplace. e.g. context7's true
    // upstream is upstash/context7 (55.8k stars), distinct from the
    // anthropics/claude-plugins-official marketplace that wraps it. When
    // set, the fetcher uses THIS for stars/forks; the marketplace github_url
    // stays for "find me in the marketplace" linking.
    ["upstream_github_url", "TEXT"],
  ]) {
    try {
      db.prepare(`SELECT ${col} FROM pack_catalog LIMIT 1`).get();
    } catch {
      try {
        db.prepare(`ALTER TABLE pack_catalog ADD COLUMN ${col} ${type}`).run();
      } catch {
        /* column may have been added by a concurrent run — non-fatal */
      }
    }
  }
}

/**
 * Apply the seed JSON to `pack_catalog`. Each row's `seed_version` is
 * compared against the seed's top-level `seed_version`; rows whose stored
 * seed_version is lower (or absent) are upserted. Higher stored seed_versions
 * are left alone (assume a newer seed was previously applied — don't roll
 * back).
 *
 * Live fields (stars, forks, description_live, last_fetched_at) are NEVER
 * touched by this function — they're owned by the fetcher.
 *
 * @returns {{ inserted: number, updated: number, skipped: number }}
 */
function upsertCatalogSeed(db, seedDoc) {
  if (!seedDoc || !Array.isArray(seedDoc.packs)) {
    return { inserted: 0, updated: 0, skipped: 0 };
  }
  const seedVersion = Number.isInteger(seedDoc.seed_version)
    ? seedDoc.seed_version
    : 1;
  const stats = { inserted: 0, updated: 0, skipped: 0 };

  const select = db.prepare(
    "SELECT pack_id, seed_version FROM pack_catalog WHERE pack_id = ?",
  );

  for (const pack of seedDoc.packs) {
    if (!pack || !pack.pack_id || !pack.display_name || !pack.github_url) {
      continue;
    }
    const existing = select.get(pack.pack_id);
    if (existing && existing.seed_version >= seedVersion) {
      stats.skipped += 1;
      continue;
    }
    db.prepare(
      `INSERT INTO pack_catalog
         (pack_id, display_name, category, github_url, upstream_github_url,
          description, harnesses, install_commands, uninstall_commands,
          install_notes, placeholder_reason, verified, pin_order, contents,
          seed_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(pack_id) DO UPDATE SET
         display_name        = excluded.display_name,
         category            = excluded.category,
         github_url          = excluded.github_url,
         upstream_github_url = excluded.upstream_github_url,
         description         = excluded.description,
         harnesses           = excluded.harnesses,
         install_commands    = excluded.install_commands,
         uninstall_commands  = excluded.uninstall_commands,
         install_notes       = excluded.install_notes,
         placeholder_reason  = excluded.placeholder_reason,
         verified            = excluded.verified,
         pin_order           = excluded.pin_order,
         contents            = excluded.contents,
         seed_version        = excluded.seed_version`,
    ).run(
      pack.pack_id,
      pack.display_name,
      pack.category || null,
      pack.github_url,
      pack.upstream_github_url || null,
      pack.description || null,
      pack.harnesses ? JSON.stringify(pack.harnesses) : null,
      pack.install_commands ? JSON.stringify(pack.install_commands) : null,
      pack.uninstall_commands
        ? JSON.stringify(pack.uninstall_commands)
        : null,
      pack.install_notes || null,
      pack.placeholder_reason || null,
      pack.verified ? 1 : 0,
      typeof pack.pin_order === "number" ? pack.pin_order : null,
      pack.contents ? JSON.stringify(pack.contents) : null,
      seedVersion,
    );
    if (existing) stats.updated += 1;
    else stats.inserted += 1;
  }
  return stats;
}

function parseJsonField(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function hydrateRow(row) {
  if (!row) return null;
  return {
    ...row,
    harnesses: parseJsonField(row.harnesses) || [],
    install_commands: parseJsonField(row.install_commands) || {},
    uninstall_commands: parseJsonField(row.uninstall_commands) || {},
    contents: parseJsonField(row.contents) || null,
    contents_cache: parseJsonField(row.contents_cache) || null,
  };
}

/**
 * List all catalog entries with `installed_harnesses` (array, derived from
 * the FEA-1224 `agent_packs` table). Sorted: installed-first descending by
 * skill count, then not-installed by star count.
 */
/**
 * List all catalog entries. Sort order (v3):
 *   1. Pinned entries (pin_order ASC) — ClosedLoop always lands first.
 *   2. Everything else by star count DESC.
 *   3. Tiebreak: display name ASC.
 *
 * Note: installed status is decorated but no longer used in the sort. The
 * v3 UI is a single unified grid, so installed/not-installed mixes with
 * the star order — closedloop pinned, then highest-star next.
 */
function listCatalog(db) {
  const rows = db
    .prepare(
      `SELECT
         c.*,
         (SELECT GROUP_CONCAT(DISTINCT ap.harness)
          FROM agent_packs ap
          WHERE ap.pack_id = c.pack_id)              AS installed_harnesses,
         (SELECT COUNT(*) FROM skills s
          WHERE s.pack_id = c.pack_id)               AS installed_skill_count
       FROM pack_catalog c
       ORDER BY
         CASE WHEN c.pin_order IS NULL THEN 1 ELSE 0 END ASC,
         c.pin_order ASC,
         COALESCE(c.stars, 0) DESC,
         c.display_name ASC`,
    )
    .all();
  return rows.map((r) => ({
    ...hydrateRow(r),
    installed_harnesses: r.installed_harnesses
      ? r.installed_harnesses.split(",")
      : [],
  }));
}

/** Get one catalog entry by pack_id, with installed status + recent history. */
function getCatalog(db, packId, { historyDays = 30 } = {}) {
  const row = db
    .prepare(
      `SELECT
         c.*,
         (SELECT GROUP_CONCAT(DISTINCT ap.harness)
          FROM agent_packs ap
          WHERE ap.pack_id = c.pack_id)              AS installed_harnesses,
         (SELECT COUNT(*) FROM skills s
          WHERE s.pack_id = c.pack_id)               AS installed_skill_count
       FROM pack_catalog c
       WHERE c.pack_id = ?`,
    )
    .get(packId);
  if (!row) return null;
  return {
    ...hydrateRow(row),
    installed_harnesses: row.installed_harnesses
      ? row.installed_harnesses.split(",")
      : [],
    history: listHistory(db, packId, historyDays),
  };
}

/**
 * Update the README excerpt for a pack. Called by the catalog-route's
 * on-demand README fetcher (lazy — README is only pulled when a user
 * opens the detail modal).
 */
function applyReadmeFetch(db, { pack_id, readme_excerpt }) {
  db.prepare(
    `UPDATE pack_catalog
       SET readme_excerpt    = ?,
           readme_fetched_at = ?
     WHERE pack_id = ?`,
  ).run(readme_excerpt || null, nowIso(), pack_id);
}

/**
 * Cache the per-pack contents listing fetched by catalog-contents.js.
 * `items` is an array of `{ name, kind, description?, path? }`.
 */
function applyContentsFetch(db, { pack_id, items }) {
  db.prepare(
    `UPDATE pack_catalog
       SET contents_cache     = ?,
           contents_fetched_at = ?
     WHERE pack_id = ?`,
  ).run(items == null ? null : JSON.stringify(items), nowIso(), pack_id);
}

function listHistory(db, packId, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return db
    .prepare(
      `SELECT fetched_at, stars, forks
       FROM pack_catalog_history
       WHERE pack_id = ? AND fetched_at >= ?
       ORDER BY fetched_at ASC`,
    )
    .all(packId, since);
}

/**
 * Update the live fields after a successful GitHub fetch + append a history
 * sample. Called by the fetcher.
 */
function applyFetchResult(db, { pack_id, stars, forks, description, last_release }) {
  const ts = nowIso();
  db.prepare(
    `UPDATE pack_catalog
       SET stars            = ?,
           forks            = ?,
           description_live = COALESCE(?, description_live),
           last_release     = COALESCE(?, last_release),
           last_fetched_at  = ?
     WHERE pack_id = ?`,
  ).run(
    stars == null ? null : stars,
    forks == null ? null : forks,
    description || null,
    last_release || null,
    ts,
    pack_id,
  );
  if (stars != null || forks != null) {
    db.prepare(
      `INSERT OR REPLACE INTO pack_catalog_history
         (pack_id, fetched_at, stars, forks)
       VALUES (?, ?, ?, ?)`,
    ).run(pack_id, ts, stars == null ? null : stars, forks == null ? null : forks);
  }
}

function recordInstallRunStart(db, { pack_id, harness, command }) {
  const ts = nowIso();
  const info = db
    .prepare(
      `INSERT INTO pack_install_runs (pack_id, harness, command, started_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(pack_id, harness, command, ts);
  return Number(info.lastInsertRowid);
}

function recordInstallRunEnd(db, id, { exit_code, stdout_tail, stderr_tail }) {
  db.prepare(
    `UPDATE pack_install_runs
       SET exit_code   = ?,
           ended_at    = ?,
           stdout_tail = ?,
           stderr_tail = ?
     WHERE id = ?`,
  ).run(
    exit_code == null ? null : exit_code,
    nowIso(),
    stdout_tail || null,
    stderr_tail || null,
    id,
  );
}

function inFlightInstallRun(db, packId) {
  return db
    .prepare(
      `SELECT id, harness, command, started_at FROM pack_install_runs
       WHERE pack_id = ? AND ended_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(packId);
}

function listInstallRuns(db, { pack_id = null, limit = 50, offset = 0 } = {}) {
  if (pack_id) {
    return db
      .prepare(
        `SELECT * FROM pack_install_runs
         WHERE pack_id = ?
         ORDER BY started_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(pack_id, limit, offset);
  }
  return db
    .prepare(
      `SELECT * FROM pack_install_runs
       ORDER BY started_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset);
}

function deleteInstallRun(db, id) {
  const r = db
    .prepare(`DELETE FROM pack_install_runs WHERE id = ? AND ended_at IS NOT NULL`)
    .run(id);
  return r.changes > 0;
}

module.exports = {
  ensureCatalogSchema,
  upsertCatalogSeed,
  listCatalog,
  getCatalog,
  listHistory,
  applyFetchResult,
  applyReadmeFetch,
  applyContentsFetch,
  recordInstallRunStart,
  recordInstallRunEnd,
  inFlightInstallRun,
  listInstallRuns,
  deleteInstallRun,
};
