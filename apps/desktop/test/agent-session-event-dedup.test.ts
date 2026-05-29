// FEA-1444 regression coverage for the rollout-tail-side dedup that prevents
// the same logical Codex event from being inserted twice when the user opts
// into Codex hooks. The hook handler inserts events in real time; the
// rollout-tail watcher catches up ~5s later via importCodexSession. Without
// the filter added in `codex-import.js`, the second arrival would create a
// duplicate row for every event.
//
// The test exercises the filter against a sandboxed SQLite database (no
// Electron runtime needed). The generated agent-monitor runtime supplies the
// JS module under .generated/agent-monitor/server/lib/codex-import.js.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, "..");
const generatedCodexImport = join(
  desktopRoot,
  ".generated",
  "agent-monitor",
  "server",
  "lib",
  "codex-import.js",
);

const skipReason = !existsSync(generatedCodexImport)
  ? `generated agent-monitor runtime not built (looked for ${generatedCodexImport}) — run pnpm build:agent-monitor`
  : null;

type CodexImport = {
  filterEventsAlreadyCapturedByHooks: (
    dbModule: { db: DatabaseSync },
    session: {
      sessionId: string;
      events: Array<{
        event_type?: string | null;
        tool_name?: string | null;
        created_at?: string | null;
      }>;
    },
  ) => void;
};

let tempRoot = "";

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "fea1444-dedup-"));
});

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

function createTestDb(): DatabaseSync {
  const dbDir = join(tempRoot, "agent-monitor");
  mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseSync(join(dbDir, "dashboard.db"));
  // Minimal events schema — only the columns the filter queries against.
  // IF NOT EXISTS in case the same temp dir is somehow reused across tests.
  db.exec(
    "CREATE TABLE IF NOT EXISTS events (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
      "session_id TEXT NOT NULL, " +
      "agent_id TEXT, " +
      "event_type TEXT NOT NULL, " +
      "tool_name TEXT, " +
      "summary TEXT, " +
      "data TEXT, " +
      "created_at TEXT NOT NULL" +
      ")",
  );
  return db;
}

function insertEvent(
  db: DatabaseSync,
  sessionId: string,
  eventType: string,
  toolName: string | null,
  createdAt: string,
): void {
  db.prepare(
    "INSERT INTO events (session_id, event_type, tool_name, created_at) VALUES (?, ?, ?, ?)",
  ).run(sessionId, eventType, toolName, createdAt);
}

test("dedup: rollout-tail event matching an existing hook-sourced row is dropped", skipReason ? { skip: skipReason } : undefined, () => {
  const db = createTestDb();
  // Hook-sourced row already in the DB (simulating the hook handler having
  // POSTed this event ~5s ago).
  insertEvent(db, "sess-A", "PreToolUse", "Read", "2026-05-29T19:00:00.123Z");

  // codex-import has assembled a session from the rollout file. Same logical
  // event — sub-second drift in created_at is normal and must NOT defeat
  // dedup (the filter truncates created_at to whole seconds before matching).
  const session = {
    sessionId: "sess-A",
    events: [
      {
        event_type: "PreToolUse",
        tool_name: "Read",
        created_at: "2026-05-29T19:00:00.987Z",
      },
    ],
  };

  const { filterEventsAlreadyCapturedByHooks } = createRequire(generatedCodexImport)(
    "./codex-import.js",
  ) as CodexImport;
  filterEventsAlreadyCapturedByHooks({ db } as { db: DatabaseSync }, session);

  assert.equal(session.events.length, 0, "the duplicate event must be filtered out");
  db.close();
});

test("dedup: events the hook handler hasn't captured are kept", skipReason ? { skip: skipReason } : undefined, () => {
  const db = createTestDb();
  // Only one of the two rollout-tail events exists in the DB.
  insertEvent(db, "sess-B", "PreToolUse", "Read", "2026-05-29T19:00:00.000Z");

  const session = {
    sessionId: "sess-B",
    events: [
      // Already captured — should be filtered.
      {
        event_type: "PreToolUse",
        tool_name: "Read",
        created_at: "2026-05-29T19:00:00.500Z",
      },
      // Different tool — not in DB — must survive.
      {
        event_type: "PreToolUse",
        tool_name: "Bash",
        created_at: "2026-05-29T19:00:01.000Z",
      },
      // Different timestamp by a full second — different DB row.
      {
        event_type: "PreToolUse",
        tool_name: "Read",
        created_at: "2026-05-29T19:00:02.000Z",
      },
    ],
  };

  const { filterEventsAlreadyCapturedByHooks } = createRequire(generatedCodexImport)(
    "./codex-import.js",
  ) as CodexImport;
  filterEventsAlreadyCapturedByHooks({ db } as { db: DatabaseSync }, session);

  assert.equal(session.events.length, 2, "non-duplicate events must survive");
  assert.equal(session.events[0].tool_name, "Bash");
  assert.equal(session.events[1].tool_name, "Read");
  assert.equal(session.events[1].created_at, "2026-05-29T19:00:02.000Z");
  db.close();
});

test("dedup: filter is best-effort and non-fatal when the DB query fails", skipReason ? { skip: skipReason } : undefined, () => {
  const dbDir = join(tempRoot, "agent-monitor");
  mkdirSync(dbDir, { recursive: true });
  // Empty DB with no `events` table — the SELECT will throw inside the
  // filter. The filter must swallow the error and leave the session intact
  // (acceptable v1 trade-off: rather have cosmetic duplicates than block
  // the entire import on a schema/lock issue).
  const db = new DatabaseSync(join(dbDir, "dashboard.db"));
  const session = {
    sessionId: "sess-C",
    events: [
      {
        event_type: "PreToolUse",
        tool_name: "Read",
        created_at: "2026-05-29T19:00:00.000Z",
      },
    ],
  };

  const { filterEventsAlreadyCapturedByHooks } = createRequire(generatedCodexImport)(
    "./codex-import.js",
  ) as CodexImport;
  // Must NOT throw.
  filterEventsAlreadyCapturedByHooks({ db } as { db: DatabaseSync }, session);
  // And must leave events untouched.
  assert.equal(session.events.length, 1);
  db.close();
});

test("dedup: empty events array is a no-op", skipReason ? { skip: skipReason } : undefined, () => {
  const db = createTestDb();
  const session = { sessionId: "sess-D", events: [] };
  const { filterEventsAlreadyCapturedByHooks } = createRequire(generatedCodexImport)(
    "./codex-import.js",
  ) as CodexImport;
  filterEventsAlreadyCapturedByHooks({ db } as { db: DatabaseSync }, session);
  assert.equal(session.events.length, 0);
  db.close();
});
