/**
 * @file plan-store.js
 * @description SQLite persistence for captured plans, aligned with the Harness
 * Router strategy §9.2 data model (local-first `plans` + append-only
 * `plan_versions`). Operates on the shared agent-monitor DB handle
 * (better-sqlite3 / compat-sqlite API: prepare().run/get/all, exec).
 *
 * Versioning is native to this schema (NOT a DocumentVersion mirror): each
 * distinct content (by sha256) for a given (session, plan_key) appends a new
 * monotonic version_number; identical re-captures are de-duped to a no-op.
 * Upsert is intentionally non-transactional + idempotent so it is safe to call
 * from inside the hook route's existing db.transaction without nesting.
 *
 * Part of CLOSEDLOOP plan-extraction (FEA-1189 / PLN-613, builds on FEA-1169).
 */
"use strict";

const crypto = require("crypto");

function nowIso() {
  return new Date().toISOString();
}

function uuid() {
  return crypto.randomUUID();
}

/**
 * Create the plans / plan_versions tables if absent. Idempotent — mirrors the
 * upstream `CREATE TABLE IF NOT EXISTS` convention in server/db.js (NOT an
 * ALTER migration patch).
 */
function ensurePlanSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
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
      needs_confirmation INTEGER NOT NULL DEFAULT 0,
      confidence REAL,
      sync_state TEXT NOT NULL DEFAULT 'local_only'
        CHECK(sync_state IN ('local_only','metadata_synced','full_synced','excluded')),
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS plan_versions (
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

    CREATE INDEX IF NOT EXISTS idx_plans_session ON plans(created_from_session_id);
    CREATE INDEX IF NOT EXISTS idx_plans_needs_confirmation ON plans(needs_confirmation);
    CREATE INDEX IF NOT EXISTS idx_plans_updated ON plans(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_plan_versions_plan ON plan_versions(plan_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_session_key
      ON plans(created_from_session_id, plan_key);
  `);
}

/** Stable per-(session,plan) grouping key. */
function planKeyFor(capture) {
  if (capture.file_path) {
    const base = String(capture.file_path)
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
      .pop();
    if (base) return base;
  }
  return `${capture.created_from_session_id || "nosession"}:${capture.source}`;
}

/**
 * Upsert a PlanCapture. Resolves/creates the parent `plans` row by
 * (created_from_session_id, plan_key); appends a new `plan_versions` row only
 * when the content sha256 differs from the latest version.
 *
 * @returns {{planId:string, versionId:string|null, version:number, deduped:boolean, created:boolean}}
 */
function upsertPlanCapture(db, capture) {
  const planKey = planKeyFor(capture);
  const sessionId = capture.created_from_session_id || null;
  const ts = capture.captured_at || nowIso();

  const existingPlan = db
    .prepare(
      `SELECT * FROM plans
       WHERE created_from_session_id IS ? AND plan_key = ?
       LIMIT 1`,
    )
    .get(sessionId, planKey);

  let planId;
  let created = false;

  if (existingPlan) {
    planId = existingPlan.id;
    const latest = db
      .prepare(
        `SELECT content_sha256, version_number
         FROM plan_versions WHERE plan_id = ?
         ORDER BY version_number DESC LIMIT 1`,
      )
      .get(planId);

    if (latest && latest.content_sha256 === capture.content_sha256) {
      // Identical content already captured — no-op (dedup).
      return {
        planId,
        versionId: null,
        version: latest.version_number,
        deduped: true,
        created: false,
      };
    }
  } else {
    planId = uuid();
    db.prepare(
      `INSERT INTO plans
        (id, organization_id, title, current_version_id, status, source,
         capture_method, harness, created_from_session_id, created_from_event_id,
         plan_key, needs_confirmation, confidence, sync_state, metadata,
         created_at, updated_at)
       VALUES (?, NULL, ?, NULL, 'draft', 'captured', ?, ?, ?, ?, ?, ?, ?,
               'local_only', NULL, ?, ?)`,
    ).run(
      planId,
      capture.title || null,
      capture.capture_method || null,
      capture.harness || null,
      sessionId,
      capture.source_event_ref || null,
      planKey,
      capture.needs_confirmation ? 1 : 0,
      capture.confidence == null ? null : capture.confidence,
      ts,
      ts,
    );
    created = true;
  }

  const nextRow = db
    .prepare(
      `SELECT COALESCE(MAX(version_number), 0) AS n
       FROM plan_versions WHERE plan_id = ?`,
    )
    .get(planId);
  const versionNumber = (nextRow ? nextRow.n : 0) + 1;
  const versionId = uuid();

  db.prepare(
    `INSERT INTO plan_versions
      (id, plan_id, version_number, content_markdown, content_json,
       content_sha256, author_type, author_user_id, source_session_id,
       source_event_ref, capture_method, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, 'agent', NULL, ?, ?, ?, ?)`,
  ).run(
    versionId,
    planId,
    versionNumber,
    capture.content_markdown,
    capture.content_sha256,
    sessionId,
    capture.source_event_ref || null,
    capture.capture_method || null,
    ts,
  );

  // Point the plan at the new version and refresh the latest-capture signals.
  db.prepare(
    `UPDATE plans
       SET current_version_id = ?,
           title = COALESCE(?, title),
           capture_method = COALESCE(?, capture_method),
           harness = COALESCE(?, harness),
           needs_confirmation = ?,
           confidence = ?,
           updated_at = ?
     WHERE id = ?`,
  ).run(
    versionId,
    capture.title || null,
    capture.capture_method || null,
    capture.harness || null,
    capture.needs_confirmation ? 1 : 0,
    capture.confidence == null ? null : capture.confidence,
    ts,
    planId,
  );

  return {
    planId,
    versionId,
    version: versionNumber,
    deduped: false,
    created,
  };
}

function listPlans(db, { sessionId = null, limit = 100, offset = 0 } = {}) {
  if (sessionId) {
    return db
      .prepare(
        `SELECT * FROM plans
         WHERE created_from_session_id = ?
         ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      )
      .all(sessionId, limit, offset);
  }
  return db
    .prepare(
      `SELECT * FROM plans ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset);
}

function listVersions(db, planId) {
  return db
    .prepare(
      `SELECT id, plan_id, version_number, content_markdown, content_sha256,
              author_type, source_session_id, source_event_ref, capture_method,
              created_at
       FROM plan_versions WHERE plan_id = ?
       ORDER BY version_number ASC`,
    )
    .all(planId);
}

function getPlan(db, id) {
  const plan = db.prepare(`SELECT * FROM plans WHERE id = ?`).get(id);
  if (!plan) return null;
  return { ...plan, versions: listVersions(db, id) };
}

function confirmPlan(db, id) {
  const r = db
    .prepare(
      `UPDATE plans
         SET needs_confirmation = 0, status = 'proposed', updated_at = ?
       WHERE id = ?`,
    )
    .run(nowIso(), id);
  return r.changes > 0;
}

function rejectPlan(db, id) {
  const r = db
    .prepare(
      `UPDATE plans
         SET needs_confirmation = 0, status = 'rejected', updated_at = ?
       WHERE id = ?`,
    )
    .run(nowIso(), id);
  return r.changes > 0;
}

module.exports = {
  ensurePlanSchema,
  upsertPlanCapture,
  listPlans,
  listVersions,
  getPlan,
  confirmPlan,
  rejectPlan,
  planKeyFor,
};
