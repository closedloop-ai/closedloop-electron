// Regression test for FEA-1390: the sidecar's startup-time stale-session
// cleanup must not reap an "active" session that was just paused (long Bash
// tool, awaiting input). Anchor on updated_at, use 180-min threshold, and
// mark stale sessions 'abandoned' not 'completed'.
//
// Pre-fix, an "active" session with started_at > 1 hour ago was unconditionally
// flipped to 'completed' on boot — even if its updated_at was 1 minute ago.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { makeTempDbPath } from "../../helpers/seed-fixture-db.mjs";
import { launchSidecar } from "../../helpers/launch-sidecar.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(HERE, "..", "..", "fixtures", "schema.sql");

// Build a DB containing exactly two sessions:
//   - "recently-active": started 6 hours ago, updated 5 minutes ago, no events
//     in last hour. Pre-fix this would flip to 'completed'. Post-fix it MUST
//     stay 'active'.
//   - "genuinely-stale": started 7 days ago, last updated 7 days ago, no
//     recent events. Should flip to 'abandoned' (NOT 'completed').
function buildBugFixDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  const now = new Date();
  const minutesAgo = (m) => new Date(now.getTime() - m * 60_000).toISOString();
  const daysAgo = (d) => new Date(now.getTime() - d * 86_400_000).toISOString();

  // Recently-active session — paused on a long tool, but recently touched.
  db.prepare(
    "INSERT INTO sessions (id, name, status, cwd, model, started_at, updated_at, harness) VALUES (?, ?, 'active', ?, ?, ?, ?, 'claude')",
  ).run(
    "fea-1390-recent",
    "Recently-active fixture",
    "/tmp/fea-1390-recent",
    "claude-opus-4-7",
    minutesAgo(6 * 60),
    minutesAgo(5),
  );
  // An old "PreToolUse" event for the long-Bash case (no recent activity in
  // events, but updated_at is fresh because the harness watcher pinged us).
  db.prepare(
    "INSERT INTO events (session_id, event_type, tool_name, data, created_at) VALUES (?, 'PreToolUse', 'Bash', '{\"command\":\"npm install\"}', ?)",
  ).run("fea-1390-recent", minutesAgo(90));

  // Genuinely-stale session — a week old, never closed.
  db.prepare(
    "INSERT INTO sessions (id, name, status, cwd, model, started_at, updated_at, harness) VALUES (?, ?, 'active', ?, ?, ?, ?, 'claude')",
  ).run(
    "fea-1390-stale",
    "Genuinely-stale fixture",
    "/tmp/fea-1390-stale",
    "claude-opus-4-7",
    daysAgo(7),
    daysAgo(7),
  );

  db.close();
}

let sidecar;
let cleanupDb;
let dbPath;

before(async () => {
  const tmp = makeTempDbPath();
  cleanupDb = tmp.cleanup;
  dbPath = tmp.dbPath;
  buildBugFixDb(dbPath);
  sidecar = await launchSidecar({ dbPath });
});

after(async () => {
  await sidecar.stop();
  cleanupDb();
});

test("recently-active session is NOT reaped at sidecar boot (regression: FEA-1390)", () => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const row = db
    .prepare("SELECT status FROM sessions WHERE id = ?")
    .get("fea-1390-recent");
  db.close();
  assert.equal(
    row.status,
    "active",
    "session whose updated_at is < 180 min must remain active across sidecar boot",
  );
});

test("genuinely-stale session is marked 'abandoned' (not 'completed') at boot", () => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const row = db
    .prepare("SELECT status FROM sessions WHERE id = ?")
    .get("fea-1390-stale");
  db.close();
  assert.equal(
    row.status,
    "abandoned",
    "stale sessions should be 'abandoned' on boot — we lost contact, we don't know they completed",
  );
});

test("the boot cleanup respects DASHBOARD_STALE_MINUTES override", async () => {
  // Run a second sidecar with a 1-minute threshold and confirm the recently-
  // active fixture (updated 5 min ago) flips to abandoned. This proves the
  // env var actually reaches the SQL.
  const tmp2 = makeTempDbPath();
  buildBugFixDb(tmp2.dbPath);
  const sidecar2 = await launchSidecar({
    dbPath: tmp2.dbPath,
    env: { DASHBOARD_STALE_MINUTES: "1" },
  });
  try {
    const db = new DatabaseSync(tmp2.dbPath, { readOnly: true });
    const row = db
      .prepare("SELECT status FROM sessions WHERE id = ?")
      .get("fea-1390-recent");
    db.close();
    assert.equal(
      row.status,
      "abandoned",
      "with DASHBOARD_STALE_MINUTES=1, the 5-min-old session should be abandoned",
    );
  } finally {
    await sidecar2.stop();
    tmp2.cleanup();
  }
});
