import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { openAgentDatabase } from "../src/main/database/index.js";

function openTempDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "agent-session-pagination-"));
  const db = openAgentDatabase(path.join(dir, "agent-dashboard.sqlite"));
  return {
    db,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function insertSession(
  db: ReturnType<typeof openAgentDatabase>,
  id: string,
  overrides: {
    name?: string;
    status?: string;
    cwd?: string;
    model?: string;
    startedAt?: string;
    awaitingInputSince?: string | null;
  } = {},
) {
  db.connection.prepare(`
    INSERT INTO sessions (
      id,
      name,
      status,
      cwd,
      model,
      started_at,
      updated_at,
      awaiting_input_since,
      harness
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.name ?? `Session ${id}`,
    overrides.status ?? "completed",
    overrides.cwd ?? `/work/${id}`,
    overrides.model ?? "gpt-5",
    overrides.startedAt ?? `2024-03-09T16:${id.padStart(2, "0")}:00.000Z`,
    overrides.startedAt ?? `2024-03-09T16:${id.padStart(2, "0")}:00.000Z`,
    overrides.awaitingInputSince ?? null,
    "codex",
  );
}

function insertAgent(db: ReturnType<typeof openAgentDatabase>, id: string, sessionId: string) {
  db.connection.prepare(`
    INSERT INTO agents (id, session_id, name, type, status, started_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, sessionId, `Agent ${id}`, "main", "completed", "2024-03-09T16:00:00.000Z");
}

function insertEvent(db: ReturnType<typeof openAgentDatabase>, id: string, sessionId: string) {
  db.connection.prepare(`
    INSERT INTO events (id, session_id, event_type, created_at)
    VALUES (?, ?, ?, ?)
  `).run(id, sessionId, "Stop", "2024-03-09T16:00:00.000Z");
}

function insertTokenUsage(db: ReturnType<typeof openAgentDatabase>, sessionId: string, input: number, output: number) {
  db.connection.prepare(`
    INSERT INTO token_usage (
      session_id,
      model,
      input_tokens,
      output_tokens,
      raw_input,
      raw_output
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, "gpt-5", input, output, input, output);
}

test("sessions.getPage returns bounded session details and total count", () => {
  const { db, cleanup } = openTempDb();
  try {
    for (let i = 1; i <= 5; i += 1) {
      insertSession(db, `s${i}`, {
        startedAt: `2024-03-09T16:0${i}:00.000Z`,
      });
    }
    insertAgent(db, "a4-main", "s4");
    insertAgent(db, "a4-sub", "s4");
    insertEvent(db, "e4-1", "s4");
    insertEvent(db, "e4-2", "s4");
    insertEvent(db, "e4-3", "s4");
    insertTokenUsage(db, "s4", 100, 25);

    const page = db.sessions.getPage({ limit: 2, offset: 1 });

    assert.equal(page.total, 5);
    assert.equal(page.limit, 2);
    assert.equal(page.offset, 1);
    assert.deepEqual(page.sessions.map((session) => session.id), ["s4", "s3"]);
    assert.equal(page.sessions[0].agentCount, 2);
    assert.equal(page.sessions[0].eventCount, 3);
    assert.equal(page.sessions[0].totalTokens, 125);

    const details = db.sessions.getDetailsById("s4");
    assert.ok(details);
    assert.equal(details.agentCount, 2);
    assert.equal(details.eventCount, 3);
    assert.equal(details.totalTokens, 125);
  } finally {
    cleanup();
  }
});

test("sessions.getPage clamps runaway limits", () => {
  const { db, cleanup } = openTempDb();
  try {
    for (let i = 1; i <= 105; i += 1) {
      insertSession(db, `s${i}`, {
        startedAt: `2024-03-09T16:${String(i).padStart(3, "0")}:00.000Z`,
      });
    }

    const page = db.sessions.getPage({ limit: 1000, offset: -10 });

    assert.equal(page.total, 105);
    assert.equal(page.limit, 100);
    assert.equal(page.offset, 0);
    assert.equal(page.sessions.length, 100);
  } finally {
    cleanup();
  }
});

test("sessions.getPage supports renderer status and search filters", () => {
  const { db, cleanup } = openTempDb();
  try {
    insertSession(db, "active-1", {
      status: "active",
      name: "Renderer Shell",
      cwd: "/repo/closedloop-electron",
      startedAt: "2024-03-09T16:03:00.000Z",
    });
    insertSession(db, "waiting-1", {
      status: "active",
      name: "Needs Input",
      cwd: "/repo/design-system",
      startedAt: "2024-03-09T16:02:00.000Z",
      awaitingInputSince: "2024-03-09T16:02:30.000Z",
    });
    insertSession(db, "completed-1", {
      status: "completed",
      name: "Historical Session",
      model: "claude-sonnet-4-6",
      startedAt: "2024-03-09T16:01:00.000Z",
    });

    const waiting = db.sessions.getPage({ status: "waiting" });
    assert.deepEqual(waiting.sessions.map((session) => session.id), ["waiting-1"]);
    assert.equal(waiting.total, 1);

    const running = db.sessions.getPage({ status: "running" });
    assert.deepEqual(running.sessions.map((session) => session.id), ["active-1"]);
    assert.equal(running.total, 1);

    const completed = db.sessions.getPage({ status: "completed" });
    assert.deepEqual(completed.sessions.map((session) => session.id), ["completed-1"]);

    const search = db.sessions.getPage({ q: "closedloop" });
    assert.deepEqual(search.sessions.map((session) => session.id), ["active-1"]);
  } finally {
    cleanup();
  }
});

test("sessions.getPage escapes LIKE wildcards in search queries", () => {
  const { db, cleanup } = openTempDb();
  try {
    insertSession(db, "s-percent", {
      name: "100% done",
      startedAt: "2024-03-09T16:03:00.000Z",
    });
    insertSession(db, "s-underscore", {
      name: "task_runner",
      startedAt: "2024-03-09T16:02:00.000Z",
    });
    insertSession(db, "s-normal", {
      name: "normal session",
      startedAt: "2024-03-09T16:01:00.000Z",
    });

    // "%" should match only the session with a literal percent, not all sessions
    const percentSearch = db.sessions.getPage({ q: "%" });
    assert.deepEqual(percentSearch.sessions.map((s) => s.id), ["s-percent"]);
    assert.equal(percentSearch.total, 1);

    // "_" should match only the session with a literal underscore, not single-char wildcards
    const underscoreSearch = db.sessions.getPage({ q: "_" });
    assert.deepEqual(underscoreSearch.sessions.map((s) => s.id), ["s-underscore"]);
    assert.equal(underscoreSearch.total, 1);
  } finally {
    cleanup();
  }
});

test("sessions.getPage paginates deterministically with tied timestamps", () => {
  const { db, cleanup } = openTempDb();
  try {
    // All sessions share the same started_at — tiebreaker is s.id DESC
    const sharedTime = "2024-03-09T16:00:00.000Z";
    for (const id of ["aaa", "bbb", "ccc", "ddd", "eee"]) {
      insertSession(db, id, { startedAt: sharedTime });
    }

    const page1 = db.sessions.getPage({ limit: 2, offset: 0 });
    const page2 = db.sessions.getPage({ limit: 2, offset: 2 });
    const page3 = db.sessions.getPage({ limit: 2, offset: 4 });

    const allPaged = [
      ...page1.sessions.map((s) => s.id),
      ...page2.sessions.map((s) => s.id),
      ...page3.sessions.map((s) => s.id),
    ];

    // Should have 5 unique IDs with no duplicates or skips
    assert.equal(new Set(allPaged).size, 5, "no duplicates across pages");
    assert.equal(allPaged.length, 5, "no skipped sessions");

    // ORDER BY id DESC means: eee, ddd, ccc, bbb, aaa
    assert.deepEqual(allPaged, ["eee", "ddd", "ccc", "bbb", "aaa"]);
  } finally {
    cleanup();
  }
});

test("sessions.getKanbanPages returns all status pages in a single call", () => {
  const { db, cleanup } = openTempDb();
  try {
    insertSession(db, "run-1", {
      status: "active",
      startedAt: "2024-03-09T16:03:00.000Z",
    });
    insertSession(db, "wait-1", {
      status: "active",
      startedAt: "2024-03-09T16:02:00.000Z",
      awaitingInputSince: "2024-03-09T16:02:30.000Z",
    });
    insertSession(db, "done-1", {
      status: "completed",
      startedAt: "2024-03-09T16:01:00.000Z",
    });

    const pages = db.sessions.getKanbanPages(["running", "waiting", "completed"], 25);

    assert.deepEqual(Object.keys(pages).sort(), ["completed", "running", "waiting"]);
    assert.deepEqual(pages.running.sessions.map((s) => s.id), ["run-1"]);
    assert.deepEqual(pages.waiting.sessions.map((s) => s.id), ["wait-1"]);
    assert.deepEqual(pages.completed.sessions.map((s) => s.id), ["done-1"]);
  } finally {
    cleanup();
  }
});
