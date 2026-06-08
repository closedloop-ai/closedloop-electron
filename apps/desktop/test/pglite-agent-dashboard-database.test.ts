import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { openPgliteAgentDatabase } from "../src/main/database/pglite.js";

test("PGlite dashboard database starts empty and fills from hook events", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-dashboard-pglite-"));
  const dataDir = path.join(dir, "agent-dashboard.pgdata");
  const changed: string[] = [];

  const db = await openPgliteAgentDatabase({
    dataDir,
    detectBillingMode: () => "metered_api",
    emit: (sessionId) => changed.push(sessionId),
    now: () => "2026-06-07T12:00:00.000Z",
  });
  try {
    assert.deepEqual(await db.sessions.getAll(), []);

    const processed = await db.processEvent(
      "SessionStart",
      {
        session_id: "pglite-session-1",
        cwd: "/workspace/project",
        model: "claude-sonnet-4-5",
      },
      "claude",
    );

    assert.equal(processed, true);
    assert.deepEqual(changed, ["pglite-session-1"]);

    const session = await db.sessions.getById("pglite-session-1");
    assert.equal(session?.id, "pglite-session-1");
    assert.equal(session?.status, "active");
    assert.equal(session?.harness, "claude");
    assert.equal(session?.billingMode, "metered_api");

    const agents = await db.agents.getBySession("pglite-session-1");
    assert.equal(agents.length, 1);
    assert.equal(agents[0].id, "pglite-session-1-main");

    const events = await db.events.getBySession("pglite-session-1");
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, "SessionStart");
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
