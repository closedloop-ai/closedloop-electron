// Build a fresh SQLite file from the committed schema + JSON fixture rows.
// Used by both Layer-1 HTTP contract tests and Layer-2 Playwright specs so the
// shape under test is identical to what the live app reads.

import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, "..", "fixtures");
const SCHEMA_PATH = join(FIXTURES_DIR, "schema.sql");

function loadJson(name) {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8"));
}

function bindRow(db, table, row) {
  const cols = Object.keys(row);
  const placeholders = cols.map(() => "?").join(", ");
  const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`;
  db.prepare(sql).run(...cols.map((c) => (row[c] === undefined ? null : row[c])));
}

// Post-FEA-1390 the sidecar's startup cleanup anchors on updated_at and uses
// the same 180-minute default as the runtime sweep. Our fixture rows have
// fixed-date timestamps in the past, so we bump updated_at on active rows
// (sessions + their agents) to "1 minute ago" at seed time. No anchor events
// are required anymore (pre-fix we also had to insert a heartbeat per active
// session to dodge the buggy `started_at + last-event` clause).
function refreshActiveTimestamps(sessions, agents /*, events */) {
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const activeIds = new Set(
    sessions.filter((s) => s.status === "active").map((s) => s.id),
  );
  if (activeIds.size === 0) return;
  for (const s of sessions) {
    if (!activeIds.has(s.id)) continue;
    s.updated_at = oneMinuteAgo;
  }
  for (const a of agents) {
    if (!activeIds.has(a.session_id)) continue;
    a.updated_at = oneMinuteAgo;
  }
}

// Build a fresh DB file at `dbPath` and return some derived counts so tests
// can assert against the fixture without hard-coding numbers twice.
export function seedFixtureDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));

  const sessions = loadJson("sessions.json");
  const agents = loadJson("agents.json");
  const events = loadJson("events.json");
  const tokenUsage = loadJson("token_usage.json");
  const modelPricing = loadJson("model_pricing.json");
  const packs = loadJson("agent_packs.json");
  const skills = loadJson("skills.json");
  const packCatalog = loadJson("pack_catalog.json");
  const pullRequests = loadJson("pull_requests.json");

  refreshActiveTimestamps(sessions, agents);

  for (const row of sessions) bindRow(db, "sessions", row);
  for (const row of agents) bindRow(db, "agents", row);
  for (const row of events) bindRow(db, "events", row);
  for (const row of tokenUsage) bindRow(db, "token_usage", row);
  for (const row of modelPricing) bindRow(db, "model_pricing", row);
  for (const row of packs) bindRow(db, "agent_packs", row);
  for (const row of skills) bindRow(db, "skills", row);
  for (const row of packCatalog) bindRow(db, "pack_catalog", row);
  for (const row of pullRequests) bindRow(db, "pull_requests", row);

  db.close();

  return {
    counts: {
      sessions: sessions.length,
      sessionsActive: sessions.filter((s) => s.status === "active").length,
      sessionsCompleted: sessions.filter((s) => s.status === "completed").length,
      sessionsError: sessions.filter((s) => s.status === "error").length,
      agents: agents.length,
      agentsWorking: agents.filter((a) => a.status === "working").length,
      events: events.length,
      packs: packs.length,
      packsInstalled: [...new Set(packs.map((p) => p.pack_id))].length,
      skills: skills.length,
      pullRequests: pullRequests.length,
    },
  };
}

// Re-seed packs/skills AFTER the sidecar's startup pack-scanner has run. The
// scanner walks the sandboxed CLAUDE_HOME, finds nothing, and tombstones every
// row it doesn't see. So we wait until the sidecar is healthy, then put the
// fixture rows back with uninstalled_at = NULL. This is the same DB file the
// sidecar holds open — SQLite's file locking handles the concurrent writer.
export function reseedPacksAndSkills(dbPath) {
  const db = new DatabaseSync(dbPath);
  const packs = loadJson("agent_packs.json");
  const skills = loadJson("skills.json");
  // Drop tombstoned rows the scanner inserted so the fixture rows can land
  // cleanly (PRIMARY KEY collision otherwise).
  db.exec("DELETE FROM agent_packs");
  db.exec("DELETE FROM skills");
  for (const row of packs) bindRow(db, "agent_packs", row);
  for (const row of skills) bindRow(db, "skills", row);
  db.close();
}

export function makeTempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "closedloop-e2e-db-"));
  return {
    dbPath: join(dir, "dashboard.db"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
