/**
 * @file billing-mode-schema-migration.test.ts
 * @description FEA-1434: verifies that opening an old dashboard DB without
 * the `billing_mode` column triggers the additive ALTER TABLE migration and
 * keeps existing rows intact (they receive the column default of 'unknown').
 *
 * The migration source-of-truth lives in
 * `apps/desktop/scripts/build-agent-monitor.mjs` (string-patch over the
 * upstream `server/db.js`). This test re-runs the same SQL statements
 * directly against an in-memory DB so we can assert the migration is
 * idempotent and preserves existing data — without having to rebuild the
 * entire generated sidecar tree.
 */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

/**
 * Apply the same migration block the build script injects ahead of the
 * `const stmts = { … }` declaration. Kept inline (not exported from
 * build-agent-monitor.mjs) because the build script is a .mjs codegen and
 * the SQL strings are the authoritative spec.
 */
function applyBillingModeMigration(db: DatabaseSync): void {
  try {
    db.prepare("SELECT billing_mode FROM sessions LIMIT 1").get();
  } catch {
    db.prepare(
      "ALTER TABLE sessions ADD COLUMN billing_mode TEXT NOT NULL DEFAULT 'unknown'",
    ).run();
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_sessions_billing_mode ON sessions(billing_mode)",
  );
}

function createPreMigrationSessionsTable(db: DatabaseSync): void {
  // Mirror the pre-FEA-1434 schema: `harness` exists (added in the prior
  // codex patch) but `billing_mode` does not.
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      name TEXT,
      status TEXT NOT NULL,
      cwd TEXT,
      model TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      ended_at TEXT,
      awaiting_input_since TEXT,
      metadata TEXT,
      harness TEXT NOT NULL DEFAULT 'claude'
    );
  `);
}

test("FEA-1434: adds billing_mode column when missing", () => {
  const db = new DatabaseSync(":memory:");
  createPreMigrationSessionsTable(db);

  // Insert a row using the pre-migration schema.
  db.prepare(`
    INSERT INTO sessions (id, name, status, cwd, model, started_at, updated_at, harness)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "legacy-1",
    "legacy session",
    "completed",
    "/home/user/Work",
    "gpt-5",
    "2026-05-20T12:00:00.000Z",
    "2026-05-20T12:05:00.000Z",
    "claude",
  );

  // Sanity: column does not exist yet.
  assert.throws(() => {
    db.prepare("SELECT billing_mode FROM sessions LIMIT 1").get();
  });

  applyBillingModeMigration(db);

  // After migration the column exists and the legacy row carries the default.
  const row = db
    .prepare("SELECT id, billing_mode FROM sessions WHERE id = ?")
    .get("legacy-1") as { id: string; billing_mode: string };
  assert.equal(row.id, "legacy-1");
  assert.equal(row.billing_mode, "unknown");

  db.close();
});

test("FEA-1434: migration is idempotent — running twice is a no-op", () => {
  const db = new DatabaseSync(":memory:");
  createPreMigrationSessionsTable(db);

  applyBillingModeMigration(db);
  // A second invocation must not throw and must not alter rows.
  applyBillingModeMigration(db);

  db.prepare(`
    INSERT INTO sessions (id, name, status, cwd, model, started_at, updated_at, harness, billing_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "explicit-1",
    "explicit session",
    "completed",
    "/home/user/Work",
    "gpt-5",
    "2026-05-20T12:00:00.000Z",
    "2026-05-20T12:05:00.000Z",
    "codex",
    "codex_chatgpt_pro",
  );

  const row = db
    .prepare("SELECT billing_mode FROM sessions WHERE id = ?")
    .get("explicit-1") as { billing_mode: string };
  assert.equal(row.billing_mode, "codex_chatgpt_pro");

  db.close();
});

test("FEA-1434: index on billing_mode is created", () => {
  const db = new DatabaseSync(":memory:");
  createPreMigrationSessionsTable(db);
  applyBillingModeMigration(db);

  const indexes = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sessions'",
    )
    .all() as Array<{ name: string }>;
  const names = indexes.map((i) => i.name);
  assert.ok(
    names.includes("idx_sessions_billing_mode"),
    `expected idx_sessions_billing_mode index, got ${names.join(", ")}`,
  );

  db.close();
});
