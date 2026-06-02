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

// Poll-with-timeout for cross-connection DB visibility. The sidecar:
//   1. Writes via its own DatabaseSync handle (separate from the test's).
//   2. As of FEA-1407 (merged from main), responds 200 to POST /api/hooks/event
//      synchronously and enqueues the actual write for drainHookQueue() to
//      process out-of-band. So the row may not be visible for 1-2 seconds
//      after the HTTP response returns.
// Up to ~5s of polling absorbs both windows without masking real bugs (a real
// bug never returns a row, so the poll just times out and the test still
// fails with the same message).
async function pollSync(check, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = check();
    if (v) return v;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// Same shape, but for async check functions (e.g. fetching via API).
async function pollSyncAsync(check, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function fetchSession() {
  const r = await fetch(
    `${baseUrl}/api/sessions/${encodeURIComponent(FIXTURE.session_id)}`,
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET /api/sessions/${FIXTURE.session_id} -> ${r.status}`);
  const body = await r.json();
  return body.session ?? body;
}

test("Claude hooks · UserPromptSubmit creates a session", async () => {
  const userPrompt = FIXTURE.events.find(
    (e) => e.hook_type === "UserPromptSubmit",
  );
  await postHook(userPrompt);

  // Verify via API. node:sqlite cross-connection visibility is unreliable
  // for async hook writes — see FEA-1407: POST returns 200 immediately,
  // drainHookQueue() does the actual write. The API uses the sidecar's
  // own DatabaseSync handle so it sees the queued+drained state correctly.
  const session = await pollSyncAsync(async () => await fetchSession());
  assert.ok(session, "session row should exist after UserPromptSubmit");
  assert.equal(session.cwd, "/Users/dev/repo");
  assert.equal(session.status, "active");
});

test("Claude hooks · PreToolUse + PostToolUse produce events with tool_name", async () => {
  const toolEvents = FIXTURE.events.filter(
    (e) => e.hook_type === "PreToolUse" || e.hook_type === "PostToolUse",
  );
  for (const e of toolEvents) {
    await postHook(e);
  }

  // Verify via /api/events?session_id=... — single read filtered to the
  // fixture session, sees the sidecar's own writes after drainHookQueue.
  const evts = await pollSyncAsync(async () => {
    const r = await fetch(
      `${baseUrl}/api/events?session_id=${encodeURIComponent(FIXTURE.session_id)}&limit=100`,
    );
    if (!r.ok) return null;
    const body = await r.json();
    const list = body.events ?? body;
    return list.length >= 4 ? list : null; // 2 Pre + 2 Post
  });
  assert.ok(evts, "expected ≥4 tool events to be visible after drain");

  const preCount = evts.filter((e) => e.event_type === "PreToolUse").length;
  const postCount = evts.filter((e) => e.event_type === "PostToolUse").length;
  assert.equal(preCount, 2, "expected 2 PreToolUse events");
  assert.equal(postCount, 2, "expected 2 PostToolUse events");

  const byTool = {};
  for (const e of evts) {
    if (e.tool_name) byTool[e.tool_name] = (byTool[e.tool_name] ?? 0) + 1;
  }
  // Each tool: Pre + Post = 2 events (the FEA-1420 double-count manifests here)
  assert.equal(byTool.Read, 2);
  assert.equal(byTool.Edit, 2);
});

test("Claude hooks · Stop moves main agent to 'waiting' but leaves session 'active'", async () => {
  // Stop ends the *turn*, not the session. The user can still send more
  // messages; until they do, the main agent is "waiting" but the session
  // remains "active" with awaiting_input_since stamped.
  const stop = FIXTURE.events.find((e) => e.hook_type === "Stop");
  await postHook(stop);

  // Use the API. Wait until awaiting_input_since is stamped — that's proof
  // the Stop hook has drained.
  const drilled = await pollSyncAsync(async () => {
    const r = await fetch(
      `${baseUrl}/api/sessions/${encodeURIComponent(FIXTURE.session_id)}`,
    );
    if (!r.ok) return null;
    const body = await r.json();
    const session = body.session ?? body;
    if (!session?.awaiting_input_since) return null;
    return { session, agents: body.agents ?? [] };
  });
  assert.ok(drilled, "session should still exist after Stop, with awaiting_input_since stamped");
  assert.equal(
    drilled.session.status,
    "active",
    "session.status stays 'active' after Stop (user can still send more)",
  );

  const mainAgent = drilled.agents.find((a) => a.type === "main");
  assert.ok(mainAgent, "main agent should exist after a turn");
  assert.equal(
    mainAgent.status,
    "waiting",
    "main agent moves to 'waiting' after Stop",
  );
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
