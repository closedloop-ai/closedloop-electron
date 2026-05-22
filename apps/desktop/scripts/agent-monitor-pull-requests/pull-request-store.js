/**
 * @file pull-request-store.js
 * @description SQLite persistence for captured pull requests (FEA-1226).
 * Operates on the shared agent-monitor DB handle (`dashboard.db`) — the SAME
 * database that holds sessions, plans, and packs — so a captured PR FK-joins
 * directly to `sessions.id` (which is the harness session id). No second
 * database, no cross-process bridge.
 *
 * `pull_requests` is keyed on a deterministic digest of
 * (harness, session id, pr url) so re-importing a session is idempotent.
 * Materialized into the generated tree as server/lib/pull-request-store.js by
 * build-agent-monitor.mjs (mirrors agent-monitor-plans/plan-store.js).
 */
"use strict";

const crypto = require("crypto");

function nowIso() {
  return new Date().toISOString();
}

/** Deterministic 16-hex id — same PR in the same session dedups to one row. */
function pullRequestId(harness, sessionId, prUrl) {
  return crypto
    .createHash("sha256")
    .update(`${harness}|${sessionId}|${prUrl}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Create the `pull_requests` table if absent. Idempotent — mirrors the
 * upstream `CREATE TABLE IF NOT EXISTS` convention in server/db.js.
 */
function ensurePullRequestSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pull_requests (
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

    CREATE INDEX IF NOT EXISTS idx_pull_requests_session
      ON pull_requests(session_id);
    CREATE INDEX IF NOT EXISTS idx_pull_requests_repo
      ON pull_requests(repo_full_name, pr_number);
    CREATE INDEX IF NOT EXISTS idx_pull_requests_observed
      ON pull_requests(observed_at DESC);
  `);
}

/**
 * Upsert a captured PR. Idempotent: an identical (harness, session, url)
 * re-capture is a no-op except for backfilling branch/sha/title if they were
 * unknown the first time.
 *
 * @param {object} pr - {externalSessionId, prUrl, prNumber, repoFullName,
 *                        branchName?, headSha?, title?, harness, observedAt?}
 * @returns {{id:string, created:boolean}}
 */
function upsertPullRequest(db, pr) {
  const id = pullRequestId(pr.harness, pr.externalSessionId, pr.prUrl);
  const existing = db
    .prepare(`SELECT id FROM pull_requests WHERE id = ?`)
    .get(id);

  if (existing) {
    db.prepare(
      `UPDATE pull_requests
         SET branch_name = COALESCE(branch_name, ?),
             head_sha    = COALESCE(head_sha, ?),
             title       = COALESCE(title, ?)
       WHERE id = ?`,
    ).run(pr.branchName || null, pr.headSha || null, pr.title || null, id);
    return { id, created: false };
  }

  db.prepare(
    `INSERT INTO pull_requests
       (id, session_id, pr_url, pr_number, repo_full_name, branch_name,
        head_sha, title, harness, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    pr.externalSessionId || null,
    pr.prUrl,
    pr.prNumber,
    pr.repoFullName,
    pr.branchName || null,
    pr.headSha || null,
    pr.title || null,
    pr.harness,
    pr.observedAt || nowIso(),
  );
  return { id, created: true };
}

function clampInt(raw, fallback, min, max) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** Shared WHERE builder so list + count apply the SAME filters. */
function buildPrFilter({ sessionId = null, repo = null } = {}) {
  const clauses = [];
  const params = [];
  if (sessionId) {
    clauses.push("session_id = ?");
    params.push(sessionId);
  }
  if (repo) {
    clauses.push("repo_full_name = ?");
    params.push(repo);
  }
  return {
    where: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

/** List captured PRs, newest-first. Optional repo / session filters. */
function listPullRequests(db, { sessionId = null, repo = null, limit = 100, offset = 0 } = {}) {
  const { where, params } = buildPrFilter({ sessionId, repo });
  return db
    .prepare(
      `SELECT * FROM pull_requests${where}
       ORDER BY observed_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
}

/** Count captured PRs — honors the same session / repo filters as listPullRequests. */
function countPullRequests(db, { sessionId = null, repo = null } = {}) {
  const { where, params } = buildPrFilter({ sessionId, repo });
  return db
    .prepare(`SELECT COUNT(*) AS c FROM pull_requests${where}`)
    .get(...params).c;
}

/** Distinct repos that have ≥1 captured PR. */
function countRepos(db) {
  return db
    .prepare(`SELECT COUNT(DISTINCT repo_full_name) AS c FROM pull_requests`)
    .get().c;
}

/**
 * One row per session that produced ≥1 PR — the "Pull Requests" page table.
 * Joins sessions (when imported) so the row carries the session name/harness;
 * a PR whose session was not imported still appears with null session fields.
 */
function listSessionsWithPullRequests(db, { limit = 100, offset = 0 } = {}) {
  const rows = db
    .prepare(
      `SELECT
         pr.session_id                         AS session_id,
         s.name                                AS session_name,
         s.started_at                          AS session_started_at,
         s.cwd                                 AS session_cwd,
         COUNT(*)                              AS pr_count,
         MAX(pr.observed_at)                   AS last_pr_at,
         MIN(pr.harness)                       AS harness
       FROM pull_requests pr
       LEFT JOIN sessions s ON s.id = pr.session_id
       GROUP BY pr.session_id
       ORDER BY last_pr_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset);
  for (const row of rows) {
    row.pull_requests = db
      .prepare(
        `SELECT id, pr_url, pr_number, repo_full_name, branch_name, head_sha,
                title, harness, observed_at
         FROM pull_requests WHERE session_id IS ?
         ORDER BY observed_at DESC`,
      )
      .all(row.session_id);
  }
  return rows;
}

function countSessionsWithPullRequests(db) {
  // Count GROUP BY groups, not COUNT(DISTINCT) — SQLite's COUNT(DISTINCT)
  // excludes NULL, but listSessionsWithPullRequests groups all NULL
  // session_id PRs into one row. Counting the grouped rows keeps `total`
  // consistent with the list length when orphan (unimported-session) PRs exist.
  return db
    .prepare(
      `SELECT COUNT(*) AS c FROM (SELECT 1 FROM pull_requests GROUP BY session_id)`,
    )
    .get().c;
}

/** Set of session ids that produced ≥1 PR — backs the per-row session chip. */
function sessionIdsWithPullRequests(db) {
  return db
    .prepare(
      `SELECT session_id, COUNT(*) AS c FROM pull_requests
       WHERE session_id IS NOT NULL GROUP BY session_id`,
    )
    .all();
}

module.exports = {
  ensurePullRequestSchema,
  upsertPullRequest,
  pullRequestId,
  listPullRequests,
  countPullRequests,
  countRepos,
  listSessionsWithPullRequests,
  countSessionsWithPullRequests,
  sessionIdsWithPullRequests,
  clampInt,
};
