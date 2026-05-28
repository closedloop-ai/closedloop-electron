// Claude hook contract test. POSTs a representative hook event sequence
// to /api/hooks/event and asserts the resulting SQL DB rows match the
// fixture's expected shape.
//
// This is the "Claude" branch of the parser-equivalence story — Claude
// doesn't use a file parser; it ingests via the hooks endpoint.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  makeTempDbPath,
  reseedPacksAndSkills,
  seedFixtureDb,
} from "../../helpers/seed-fixture-db.mjs";
import { launchSidecar } from "../../helpers/launch-sidecar.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(
    join(
      HERE,
      "..",
      "..",
      "fixtures",
      "parsers",
      "claude",
      "hook-sequence.json",
    ),
    "utf8",
  ),
);

let sidecar;
let cleanupDb;
let baseUrl;
let dbPath;

before(async () => {
  const tmp = makeTempDbPath();
  cleanupDb = tmp.cleanup;
  dbPath = tmp.dbPath;
  seedFixtureDb(dbPath);
  sidecar = await launchSidecar({ dbPath });
  reseedPacksAndSkills(dbPath);
  baseUrl = sidecar.baseUrl;
});

after(async () => {
  await sidecar.stop();
  cleanupDb();
});

async function postHook(hookEvent) {
  const res = await fetch(`${baseUrl}/api/hooks/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(hookEvent),
  });
  if (!res.ok) {
    throw new Error(
      `POST /api/hooks/event -> ${res.status} ${await res.text()}`,
    );
  }
  return res.json();
}

test("Claude hooks · UserPromptSubmit creates a session", async () => {
  const userPrompt = FIXTURE.events.find(
    (e) => e.hook_type === "UserPromptSubmit",
  );
  await postHook(userPrompt);

  const db = new DatabaseSync(dbPath);
  try {
    const session = db
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .get(FIXTURE.session_id);
    assert.ok(session, "session row should exist after UserPromptSubmit");
    assert.equal(session.cwd, "/Users/dev/repo");
    assert.equal(session.status, "active");
  } finally {
    db.close();
  }
});

test("Claude hooks · PreToolUse + PostToolUse produce events with tool_name", async () => {
  const toolEvents = FIXTURE.events.filter(
    (e) => e.hook_type === "PreToolUse" || e.hook_type === "PostToolUse",
  );
  for (const e of toolEvents) {
    await postHook(e);
  }

  const db = new DatabaseSync(dbPath);
  try {
    const preCount = Number(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM events WHERE session_id = ? AND event_type = 'PreToolUse'`,
        )
        .get(FIXTURE.session_id).n,
    );
    const postCount = Number(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM events WHERE session_id = ? AND event_type = 'PostToolUse'`,
        )
        .get(FIXTURE.session_id).n,
    );
    // Fixture has 2 PreToolUse + 2 PostToolUse events
    assert.equal(preCount, 2, "expected 2 PreToolUse events");
    assert.equal(postCount, 2, "expected 2 PostToolUse events");

    const tools = db
      .prepare(
        `SELECT tool_name, COUNT(*) AS n
         FROM events WHERE session_id = ? AND tool_name IS NOT NULL
         GROUP BY tool_name`,
      )
      .all(FIXTURE.session_id);
    const byTool = Object.fromEntries(
      tools.map((t) => [t.tool_name, Number(t.n)]),
    );
    // Each tool: Pre + Post = 2 events (the FEA-1420 double-count manifests here)
    assert.equal(byTool.Read, 2);
    assert.equal(byTool.Edit, 2);
  } finally {
    db.close();
  }
});

test("Claude hooks · Stop moves main agent to 'waiting' but leaves session 'active'", async () => {
  // Stop ends the *turn*, not the session. The user can still send more
  // messages; until they do, the main agent is "waiting" but the session
  // remains "active" with awaiting_input_since stamped.
  const stop = FIXTURE.events.find((e) => e.hook_type === "Stop");
  await postHook(stop);

  const db = new DatabaseSync(dbPath);
  try {
    const session = db
      .prepare(
        `SELECT status, awaiting_input_since FROM sessions WHERE id = ?`,
      )
      .get(FIXTURE.session_id);
    assert.ok(session, "session should still exist");
    assert.equal(
      session.status,
      "active",
      "session.status stays 'active' after Stop (user can still send more)",
    );
    assert.ok(
      session.awaiting_input_since,
      "awaiting_input_since must be stamped after Stop (the human-input-required flag)",
    );

    const mainAgent = db
      .prepare(
        `SELECT status FROM agents WHERE session_id = ? AND type = 'main'`,
      )
      .get(FIXTURE.session_id);
    assert.ok(mainAgent, "main agent should exist after a turn");
    assert.equal(
      mainAgent.status,
      "waiting",
      "main agent moves to 'waiting' after Stop",
    );
  } finally {
    db.close();
  }
});

test("Claude hooks · full sequence produces a coherent session-level summary", async () => {
  // After the full sequence, /api/sessions/:id/stats should reflect:
  //   - 4 events (2 PreToolUse + 2 PostToolUse — Stop doesn't insert event in
  //     the per-session count) — actually Stop also creates an event, so 5
  //   - 1 main agent
  //   - tools_used has Read + Edit
  const res = await fetch(
    `${baseUrl}/api/sessions/${encodeURIComponent(FIXTURE.session_id)}/stats`,
  );
  assert.equal(res.status, 200);
  const stats = await res.json();
  assert.ok(stats.total_events >= 4, `expected ≥4 events; got ${stats.total_events}`);
  assert.ok(stats.agents.main >= 1, "expected at least one main agent");
  const toolNames = (stats.tools_used || []).map((t) => t.tool_name);
  assert.ok(toolNames.includes("Read"), "Read tool should appear in tools_used");
  assert.ok(toolNames.includes("Edit"), "Edit tool should appear in tools_used");
});
