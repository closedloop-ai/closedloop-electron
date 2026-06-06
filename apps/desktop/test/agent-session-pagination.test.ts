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

    const completed = db.sessions.getPage({ status: "completed" });
    assert.deepEqual(completed.sessions.map((session) => session.id), ["completed-1"]);

    const search = db.sessions.getPage({ q: "closedloop" });
    assert.deepEqual(search.sessions.map((session) => session.id), ["active-1"]);
  } finally {
    cleanup();
  }
});
