/**
 * @file billing-mode-importer-clobber-guard.test.ts
 * @description FEA-1434 (round-3 review follow-up): verifies the sidecar
 * importer's `setSessionBillingMode` prepared statement never demotes a
 * deliberate non-default billing_mode value back to an importer default.
 *
 * Concrete race scenario this protects against:
 *
 *   1. User has OPENAI_API_KEY set. Desktop spawn writes 'api' on the row.
 *   2. Sidecar restarts and the codex importer re-runs
 *      setSessionBillingMode.run("codex_chatgpt_pro", id, ...).
 *   3. Without this guard, COALESCE('api','') != 'codex_chatgpt_pro' is TRUE,
 *      so the importer overwrites 'api' → 'codex_chatgpt_pro'. The next sync
 *      cycle restores it, but for a ~5s window the Sessions UI mis-buckets
 *      the row.
 *
 * The prepared statement source-of-truth lives in
 * `apps/desktop/scripts/build-agent-monitor.mjs` (string-patch over the
 * upstream `server/db.js`). This test re-renders the same SQL directly
 * against an in-memory DB so we can assert the protection without rebuilding
 * the generated sidecar tree.
 */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

/**
 * Modes that must NEVER be overwritten by an importer. These mirror the
 * `protectedModes` array in `apps/desktop/scripts/build-agent-monitor.mjs`.
 * Adding a new protected mode is a one-line array change in both places.
 */
const PROTECTED_MODES = ["api", "claude_max", "claude_pro"] as const;

function createSessionsTable(db: DatabaseSync): void {
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
      harness TEXT NOT NULL DEFAULT 'claude',
      billing_mode TEXT NOT NULL DEFAULT 'unknown'
    );
  `);
}

function insertSession(
  db: DatabaseSync,
  id: string,
  billingMode: string,
): void {
  db.prepare(
    `INSERT INTO sessions (id, name, status, cwd, model, started_at, updated_at, harness, billing_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    `session ${id}`,
    "completed",
    "/home/user/Work",
    "gpt-5",
    "2026-05-20T12:00:00.000Z",
    "2026-05-20T12:05:00.000Z",
    "codex",
    billingMode,
  );
}

/**
 * Prepared statement renderer — mirrors the SQL the build script patches
 * into the generated `server/db.js`. Kept inline so the test asserts the
 * intended invariant, not an arbitrary local replica.
 */
function prepareSetSessionBillingMode(db: DatabaseSync) {
  const placeholders = PROTECTED_MODES.map(() => "?").join(", ");
  return db.prepare(
    `UPDATE sessions SET billing_mode = ? WHERE id = ? AND COALESCE(billing_mode, '') NOT IN (?, ${placeholders})`,
  );
}

function runSetSessionBillingMode(
  stmt: ReturnType<typeof prepareSetSessionBillingMode>,
  newMode: string,
  sessionId: string,
): void {
  // Calling convention mirrors codex-import.js / cursor-import.js etc.:
  //   (newMode, sessionId, newMode, ...PROTECTED_MODES)
  stmt.run(newMode, sessionId, newMode, ...PROTECTED_MODES);
}

test("FEA-1434: importer can promote 'unknown' → 'codex_chatgpt_pro'", () => {
  const db = new DatabaseSync(":memory:");
  createSessionsTable(db);
  insertSession(db, "sess-unknown", "unknown");

  const stmt = prepareSetSessionBillingMode(db);
  runSetSessionBillingMode(stmt, "codex_chatgpt_pro", "sess-unknown");

  const row = db
    .prepare("SELECT billing_mode FROM sessions WHERE id = ?")
    .get("sess-unknown") as { billing_mode: string };
  assert.equal(
    row.billing_mode,
    "codex_chatgpt_pro",
    "importer must promote the 'unknown' default to the harness-specific value",
  );

  db.close();
});

test("FEA-1434: importer CANNOT clobber 'api' (deliberate desktop-detected mode)", () => {
  const db = new DatabaseSync(":memory:");
  createSessionsTable(db);
  insertSession(db, "sess-api", "api");

  const stmt = prepareSetSessionBillingMode(db);
  // The sidecar restarts and codex-import.js naively tries to stamp the
  // ChatGPT-Pro default. This MUST be a no-op because the desktop main
  // process already detected an API key and persisted 'api'.
  runSetSessionBillingMode(stmt, "codex_chatgpt_pro", "sess-api");

  const row = db
    .prepare("SELECT billing_mode FROM sessions WHERE id = ?")
    .get("sess-api") as { billing_mode: string };
  assert.equal(
    row.billing_mode,
    "api",
    "importer must NOT demote 'api' (deliberate API-key signal) to a subscription default",
  );

  db.close();
});

test("FEA-1434: importer CANNOT clobber 'claude_max' (deliberate OAuth signal)", () => {
  const db = new DatabaseSync(":memory:");
  createSessionsTable(db);
  insertSession(db, "sess-claude-max", "claude_max");

  const stmt = prepareSetSessionBillingMode(db);
  // A cross-harness importer run (e.g. Cursor importer happening to discover
  // a row id collision — paranoia case) must not be able to demote the
  // intentional Claude-subscription signal back to a default.
  runSetSessionBillingMode(stmt, "cursor_pro", "sess-claude-max");

  const row = db
    .prepare("SELECT billing_mode FROM sessions WHERE id = ?")
    .get("sess-claude-max") as { billing_mode: string };
  assert.equal(
    row.billing_mode,
    "claude_max",
    "importer must NOT demote 'claude_max' to any importer default",
  );

  db.close();
});

test("FEA-1434: importer CANNOT clobber 'claude_pro' (reserved subscription tier)", () => {
  const db = new DatabaseSync(":memory:");
  createSessionsTable(db);
  insertSession(db, "sess-claude-pro", "claude_pro");

  const stmt = prepareSetSessionBillingMode(db);
  runSetSessionBillingMode(stmt, "copilot_seat", "sess-claude-pro");

  const row = db
    .prepare("SELECT billing_mode FROM sessions WHERE id = ?")
    .get("sess-claude-pro") as { billing_mode: string };
  assert.equal(
    row.billing_mode,
    "claude_pro",
    "importer must NOT demote 'claude_pro' to any importer default",
  );

  db.close();
});

test("FEA-1434: importer is a no-op when the row already carries the target mode", () => {
  const db = new DatabaseSync(":memory:");
  createSessionsTable(db);
  insertSession(db, "sess-already-codex", "codex_chatgpt_pro");

  const stmt = prepareSetSessionBillingMode(db);
  const result = stmt.run(
    "codex_chatgpt_pro",
    "sess-already-codex",
    "codex_chatgpt_pro",
    ...PROTECTED_MODES,
  );

  // Idempotency: COALESCE('codex_chatgpt_pro','') NOT IN ('codex_chatgpt_pro',
  // 'api', 'claude_max', 'claude_pro') is FALSE → zero rows updated.
  assert.equal(
    result.changes,
    0,
    "no-op when the row already carries the target mode",
  );

  db.close();
});

test("FEA-1434: importer can promote one importer default to another", () => {
  // Belt-and-suspenders: a misclassified row tagged with a different
  // importer default (e.g. 'cursor_pro' on a Codex session because of a
  // historical bug) must still be correctable by the right importer.
  const db = new DatabaseSync(":memory:");
  createSessionsTable(db);
  insertSession(db, "sess-mistagged", "cursor_pro");

  const stmt = prepareSetSessionBillingMode(db);
  runSetSessionBillingMode(stmt, "codex_chatgpt_pro", "sess-mistagged");

  const row = db
    .prepare("SELECT billing_mode FROM sessions WHERE id = ?")
    .get("sess-mistagged") as { billing_mode: string };
  assert.equal(
    row.billing_mode,
    "codex_chatgpt_pro",
    "importer defaults are mutually overwritable — only protected modes are sticky",
  );

  db.close();
});

test("FEA-1434: build-script patch declares the protected-mode exclusion list", async () => {
  // The actual SQL is rendered by build-agent-monitor.mjs. A regression
  // test on the build-script source itself catches any future edit that
  // narrows the protected-mode list (e.g. drops 'claude_pro' "because no
  // detector produces it" — see FEA-1434 Finding 3, reserved for a future
  // signal).
  const { readFileSync } = await import("node:fs");
  const buildScriptSource = readFileSync(
    new URL("../scripts/build-agent-monitor.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    buildScriptSource,
    /const protectedModes = \["api", "claude_max", "claude_pro"\]/,
    "build-agent-monitor.mjs must declare the protected-mode exclusion list verbatim",
  );
  // The rendered statement is split across three string fragments (literal +
  // placeholder injection + literal) so we assert on the structural shape:
  // the leading "NOT IN (?, " fragment, the placeholder-array splice, and the
  // closing ")\"),". Together these are unique to the patched SQL.
  assert.ok(
    buildScriptSource.includes('NOT IN (?, "'),
    "build-agent-monitor.mjs must open the exclusion list with `NOT IN (?, \"`",
  );
  assert.ok(
    buildScriptSource.includes("protectedPlaceholders"),
    "build-agent-monitor.mjs must splice protectedPlaceholders into the prepared statement",
  );
});
