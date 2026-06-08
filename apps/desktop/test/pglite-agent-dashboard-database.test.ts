import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { openPgliteAgentDatabase } from "../src/main/database/pglite.js";
import type { NormalizedSession } from "../src/main/collectors/types.js";

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

test("PGlite close drains queued lifecycle writes before closing", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-dashboard-pglite-"));
  const dataDir = path.join(dir, "agent-dashboard.pgdata");
  const db = await openPgliteAgentDatabase({
    dataDir,
    detectBillingMode: () => "metered_api",
    now: () => "2026-06-07T12:00:00.000Z",
  });

  try {
    const write = db.processEvent(
      "SessionStart",
      {
        session_id: "close-drain-session",
        cwd: "/workspace/project",
        model: "claude-sonnet-4-5",
      },
      "claude",
    );
    await db.close();
    assert.equal(await write, true);

    const reopened = await openPgliteAgentDatabase({
      dataDir,
      detectBillingMode: () => "metered_api",
    });
    try {
      assert.equal((await reopened.sessions.getById("close-drain-session"))?.id, "close-drain-session");
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("PGlite live hook event data is capped before storage", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-dashboard-pglite-"));
  const dataDir = path.join(dir, "agent-dashboard.pgdata");
  const db = await openPgliteAgentDatabase({
    dataDir,
    detectBillingMode: () => "metered_api",
    now: () => "2026-06-07T12:00:00.000Z",
  });

  try {
    await db.processEvent(
      "SessionStart",
      {
        session_id: "large-event-session",
        cwd: "/workspace/project",
        tool_input: "x".repeat(70 * 1024),
      },
      "claude",
    );

    const events = await db.events.getBySession("large-event-session");
    assert.deepEqual(JSON.parse(events[0].data ?? "{}"), {
      truncated: true,
      bytes: JSON.stringify({
        session_id: "large-event-session",
        cwd: "/workspace/project",
        tool_input: "x".repeat(70 * 1024),
      }).length,
    });
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PGlite workflow queries satisfy PostgreSQL GROUP BY rules", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-dashboard-pglite-"));
  const dataDir = path.join(dir, "agent-dashboard.pgdata");
  const db = await openPgliteAgentDatabase({
    dataDir,
    detectBillingMode: () => "metered_api",
    now: () => "2026-06-07T12:00:00.000Z",
  });

  try {
    await db.processEvent(
      "SessionStart",
      {
        session_id: "workflow-session-1",
        cwd: "/workspace/project",
        model: "claude-sonnet-4-5",
      },
      "claude",
    );
    await db.run(
      `INSERT INTO agents (id, session_id, name, type, status, started_at, updated_at, parent_agent_id)
       VALUES ($1, $2, $3, 'subagent', 'completed', $4, $4, $5)`,
      "workflow-session-1-sub-a",
      "workflow-session-1",
      "alpha",
      "2026-06-07T12:01:00.000Z",
      "workflow-session-1-main",
    );
    await db.run(
      `INSERT INTO agents (id, session_id, name, type, status, started_at, updated_at, parent_agent_id)
       VALUES ($1, $2, $3, 'subagent', 'completed', $4, $4, $5)`,
      "workflow-session-1-sub-b",
      "workflow-session-1",
      "beta",
      "2026-06-07T12:02:00.000Z",
      "workflow-session-1-main",
    );

    const workflow = await db.dashboard.getWorkflowData();

    assert.equal(workflow.stats.totalSubagents, 2);
    assert.deepEqual(
      workflow.orchestration.subagentTypes.map((row) => row.count),
      [2],
    );
    assert.equal(workflow.orchestration.subagentTypes[0].subagentType, "beta");
    assert.equal(workflow.orchestration.edges[0].source, "main");
    assert.equal(workflow.orchestration.edges[0].target, "beta");
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PGlite dashboard core features are filled from imported sessions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-dashboard-pglite-"));
  const dataDir = path.join(dir, "agent-dashboard.pgdata");
  const db = await openPgliteAgentDatabase({
    dataDir,
    detectBillingMode: () => "metered_api",
    now: () => "2026-06-07T12:00:00.000Z",
  });

  try {
    const imported = await db.importer.importSession(
      makeNormalizedSession(),
      "codex",
    );
    assert.equal(imported.skipped, false);

    const features = await db.dashboard.getCoreFeatures();

    assert.equal(features.plans.length, 1);
    assert.equal(features.plans[0].title, "Ship PGlite dashboard parity");
    assert.equal(features.pullRequests.length, 1);
    assert.equal(features.pullRequests[0].prUrl, "https://github.com/closedloop-ai/closedloop-electron/pull/275");
    assert.equal(features.tools.some((tool) => tool.toolName === "Skill"), true);
    assert.equal(features.skills.length, 1);
    assert.equal(features.skills[0].name, "core/ship-dashboard");
    assert.equal(features.packs.length, 1);
    assert.equal(features.packs[0].id, "core");
    assert.equal(features.subagents.length, 1);
    assert.equal(features.subagents[0].subagentType, "engineer");
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PGlite metered usage rows include only metered sessions within the cutoff", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-dashboard-pglite-"));
  const dataDir = path.join(dir, "agent-dashboard.pgdata");
  const db = await openPgliteAgentDatabase({
    dataDir,
    detectBillingMode: () => "metered_api",
    now: () => "2026-06-07T12:00:00.000Z",
  });

  try {
    await db.run(
      `INSERT INTO sessions (id, status, started_at, updated_at, harness, billing_mode)
       VALUES
        ($1, 'completed', $2, $2, 'claude', 'api'),
        ($3, 'completed', $4, $4, 'claude', 'subscription_unknown'),
        ($5, 'completed', $6, $6, 'claude', 'api')`,
      "metered-in-window",
      "2026-05-20T10:00:00.000Z",
      "subscription-in-window",
      "2026-05-20T10:00:00.000Z",
      "metered-before-cutoff",
      "2025-01-01T00:00:00.000Z",
    );
    await db.run(
      `INSERT INTO token_usage (
        session_id, model, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, raw_input, raw_output,
        raw_cache_read, raw_cache_write, created_at, updated_at
       )
       VALUES
        ($1, 'claude-opus-4-5', 1500, 300, 75, 15, 1500, 300, 75, 15, $2, $2),
        ($3, 'claude-opus-4-5', 1000, 200, 0, 0, 1000, 200, 0, 0, $2, $2),
        ($4, 'claude-opus-4-5', 1, 2, 3, 4, 1, 2, 3, 4, $2, $2)`,
      "metered-in-window",
      "2026-05-20T10:00:00.000Z",
      "subscription-in-window",
      "metered-before-cutoff",
    );

    const rows = await db.loadMeteredUsageRows("2026-04-23T00:00:00.000Z");

    assert.equal(rows.length, 1);
    assert.equal(rows[0].sessionId, "metered-in-window");
    assert.equal(rows[0].billingMode, "api");
    assert.equal(rows[0].inputTokens, 1500);
    assert.equal(rows[0].outputTokens, 300);
    assert.equal(rows[0].cacheReadTokens, 75);
    assert.equal(rows[0].cacheWriteTokens, 15);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PGlite token analytics supports sums above PostgreSQL integer range", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-dashboard-pglite-"));
  const dataDir = path.join(dir, "agent-dashboard.pgdata");
  const db = await openPgliteAgentDatabase({
    dataDir,
    detectBillingMode: () => "metered_api",
    now: () => "2026-06-07T12:00:00.000Z",
  });

  try {
    await db.run(
      `INSERT INTO sessions (id, status, started_at, updated_at, harness, billing_mode)
       VALUES ($1, 'completed', $2, $2, 'codex', 'api')`,
      "large-token-session",
      "2026-06-07T10:00:00.000Z",
    );
    await db.run(
      `INSERT INTO token_usage (
        session_id, model, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, raw_input, raw_output,
        raw_cache_read, raw_cache_write, created_at, updated_at
       )
       VALUES
        ($1, 'model-a', 1500000000, 900000000, 800000000, 700000000, 1500000000, 900000000, 800000000, 700000000, $2, $2),
        ($1, 'model-b', 1500000000, 900000000, 800000000, 700000000, 1500000000, 900000000, 800000000, 700000000, $2, $2)`,
      "large-token-session",
      "2026-06-07T10:00:00.000Z",
    );

    const analytics = await db.dashboard.getAnalytics();
    const summary = await db.dashboard.getSummary();
    const detail = await db.sessions.getDetailsById("large-token-session");

    assert.equal(analytics.tokens.totalInputTokens, 3_000_000_000);
    assert.equal(analytics.tokens.totalOutputTokens, 1_800_000_000);
    assert.equal(analytics.tokens.totalCacheReadTokens, 1_600_000_000);
    assert.equal(analytics.tokens.totalCacheWriteTokens, 1_400_000_000);
    assert.equal(summary.totalTokens, 4_800_000_000);
    assert.equal(detail?.totalTokens, 4_800_000_000);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PGlite token reconciliation preserves cumulative and compaction-drop semantics", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-dashboard-pglite-"));
  const dataDir = path.join(dir, "agent-dashboard.pgdata");
  const db = await openPgliteAgentDatabase({
    dataDir,
    detectBillingMode: () => "metered_api",
    now: () => "2026-06-07T12:00:00.000Z",
  });

  try {
    await db.tokenUsage.replace("s1", "m1", { input: 100, output: 50, cacheRead: 10, cacheWrite: 5 }, "2026-06-02T00:00:00.000Z");
    await db.tokenUsage.replace("s1", "m1", { input: 150, output: 70, cacheRead: 20, cacheWrite: 5 }, "2026-06-02T00:00:00.000Z");
    let rows = await db.tokenUsage.getBySession("s1");
    assert.equal(rows[0].inputTokens, 150);
    assert.equal(rows[0].outputTokens, 70);
    assert.equal(rows[0].cacheReadTokens, 20);
    assert.equal(rows[0].cacheWriteTokens, 5);

    await db.tokenUsage.replace("s2", "m1", { input: 150, output: 80, cacheRead: 0, cacheWrite: 0 }, "2026-06-02T00:00:00.000Z");
    await db.tokenUsage.replace("s2", "m1", { input: 30, output: 10, cacheRead: 0, cacheWrite: 0 }, "2026-06-02T00:00:00.000Z");
    rows = await db.tokenUsage.getBySession("s2");
    assert.equal(rows[0].inputTokens, 180);
    assert.equal(rows[0].outputTokens, 90);

    await db.tokenUsage.replace("s3", "m1", { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, "2026-06-02T00:00:00.000Z");
    assert.equal((await db.tokenUsage.getBySession("s3")).length, 0);

    await db.tokenUsage.replace("s4", "m1", { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 }, "2026-06-02T00:00:00.000Z");
    await db.tokenUsage.replace("s4", "m2", { input: 200, output: 0, cacheRead: 0, cacheWrite: 0 }, "2026-06-02T00:00:00.000Z");
    const byModel = Object.fromEntries((await db.tokenUsage.getBySession("s4")).map((row) => [row.model, row.inputTokens]));
    assert.deepEqual(byModel, { m1: 100, m2: 200 });
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PGlite sessions pagination preserves details, filters, escaping, and deterministic ordering", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-dashboard-pglite-"));
  const dataDir = path.join(dir, "agent-dashboard.pgdata");
  const db = await openPgliteAgentDatabase({
    dataDir,
    detectBillingMode: () => "metered_api",
    now: () => "2026-06-07T12:00:00.000Z",
  });

  try {
    for (let i = 1; i <= 5; i += 1) {
      await insertPgliteSession(db, `s${i}`, {
        startedAt: `2024-03-09T16:0${i}:00.000Z`,
      });
    }
    await db.run(
      `INSERT INTO agents (id, session_id, name, type, status, started_at, updated_at)
       VALUES
        ('a4-main', 's4', 'main', 'main', 'completed', '2024-03-09T16:04:00.000Z', '2024-03-09T16:04:00.000Z'),
        ('a4-sub', 's4', 'sub', 'subagent', 'completed', '2024-03-09T16:04:01.000Z', '2024-03-09T16:04:01.000Z')`,
    );
    await db.run(
      `INSERT INTO events (id, session_id, event_type, created_at)
       VALUES
        ('e4-1', 's4', 'Stop', '2024-03-09T16:04:00.000Z'),
        ('e4-2', 's4', 'Stop', '2024-03-09T16:04:01.000Z'),
        ('e4-3', 's4', 'Stop', '2024-03-09T16:04:02.000Z')`,
    );
    await db.tokenUsage.replace("s4", "gpt-5", { input: 100, output: 25, cacheRead: 0, cacheWrite: 0 }, "2024-03-09T16:04:00.000Z");

    const page = await db.sessions.getPage({ limit: 2, offset: 1 });
    assert.equal(page.total, 5);
    assert.deepEqual(page.sessions.map((session) => session.id), ["s4", "s3"]);
    assert.equal(page.sessions[0].agentCount, 2);
    assert.equal(page.sessions[0].eventCount, 3);
    assert.equal(page.sessions[0].totalTokens, 125);

    const clamped = await db.sessions.getPage({ limit: 1000, offset: -10 });
    assert.equal(clamped.limit, 100);
    assert.equal(clamped.offset, 0);

    await insertPgliteSession(db, "waiting-1", {
      name: "Needs Input",
      cwd: "/repo/design-system",
      status: "active",
      startedAt: "2024-03-09T16:06:00.000Z",
      awaitingInputSince: "2024-03-09T16:06:30.000Z",
    });
    await insertPgliteSession(db, "literal-percent", {
      name: "100% done",
      startedAt: "2024-03-09T16:07:00.000Z",
    });
    await insertPgliteSession(db, "literal-underscore", {
      name: "task_runner",
      startedAt: "2024-03-09T16:08:00.000Z",
    });
    assert.deepEqual((await db.sessions.getPage({ status: "waiting" })).sessions.map((session) => session.id), ["waiting-1"]);
    assert.deepEqual((await db.sessions.getPage({ q: "%" })).sessions.map((session) => session.id), ["literal-percent"]);
    assert.deepEqual((await db.sessions.getPage({ q: "_" })).sessions.map((session) => session.id), ["literal-underscore"]);

    const sharedTime = "2024-03-09T17:00:00.000Z";
    for (const id of ["aaa", "bbb", "ccc", "ddd", "eee"]) {
      await insertPgliteSession(db, id, { startedAt: sharedTime });
    }
    const page1 = await db.sessions.getPage({ limit: 2, offset: 0 });
    const page2 = await db.sessions.getPage({ limit: 2, offset: 2 });
    const page3 = await db.sessions.getPage({ limit: 2, offset: 4 });
    assert.deepEqual(
      [...page1.sessions, ...page2.sessions, ...page3.sessions].map((session) => session.id),
      ["eee", "ddd", "ccc", "bbb", "aaa", "literal-underscore"],
    );

    const kanban = await db.sessions.getKanbanPages(["running", "waiting", "completed"], 25);
    assert.equal(kanban.waiting.sessions[0].id, "waiting-1");
    assert.ok(kanban.completed.sessions.length > 0);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PGlite lifecycle, store, and sync source preserve identity columns", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-dashboard-pglite-"));
  const dataDir = path.join(dir, "agent-dashboard.pgdata");
  const db = await openPgliteAgentDatabase({
    dataDir,
    detectBillingMode: () => "api",
    getUserIdentity: () => ({ userId: "u-pglite", organizationId: "org-pglite" }),
    now: () => "2026-06-07T12:00:00.000Z",
  });

  try {
    await db.processEvent(
      "SessionStart",
      {
        session_id: "identity-session",
        cwd: "/workspace/project",
      },
      "claude",
    );

    const session = await db.sessions.getById("identity-session");
    assert.equal(session?.userId, "u-pglite");
    assert.equal(session?.organizationId, "org-pglite");

    const synced = await db.syncSource.loadSyncedSessions(["identity-session"], {
      attributionByCwd: new Map(),
      launchMetadataRootByCwd: new Map(),
      repoFullNameByPath: new Map(),
    });
    assert.equal(synced[0].userId, "u-pglite");
    assert.equal(synced[0].organizationId, "org-pglite");

    await insertPgliteSession(db, "anonymous-session", {
      startedAt: "2026-06-07T12:05:00.000Z",
    });
    const anonymous = await db.sessions.getById("anonymous-session");
    assert.equal(anonymous?.userId, null);
    assert.equal(anonymous?.organizationId, null);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PGlite lifecycle processes status transitions, subagents, transcript tokens, and bad hook payloads", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-dashboard-pglite-"));
  const dataDir = path.join(dir, "agent-dashboard.pgdata");
  const db = await openPgliteAgentDatabase({
    dataDir,
    detectBillingMode: () => "api",
    extractTranscript: () => ({
      latestModel: "claude-opus-4-5",
      tokensByModel: new Map([
        ["claude-opus-4-5", { input: 100, output: 50, cacheRead: 10, cacheWrite: 5 }],
      ]),
      compactionCount: 0,
    }),
    now: () => "2026-06-07T12:00:00.000Z",
  });

  try {
    assert.equal(await db.processEvent("SessionStart", { cwd: "/missing-id" }, "claude"), false);
    assert.equal(await db.processEvent("SessionStart", { session_id: "life-1", cwd: "/work" }, "claude"), true);
    assert.equal(await db.processEvent("PreToolUse", {
      session_id: "life-1",
      tool_name: "Task",
      tool_input: {
        subagent_type: "engineer",
        description: "Implement the fix",
        prompt: "patch it",
      },
    }, "claude"), true);
    assert.equal(await db.processEvent("SubagentStop", {
      session_id: "life-1",
      tool_name: "Task",
    }, "claude"), true);
    assert.equal(await db.processEvent("Stop", { session_id: "life-1" }, "claude"), true);
    assert.equal(await db.processEvent("SessionEnd", {
      session_id: "life-1",
      transcript_path: "/tmp/transcript.jsonl",
    }, "claude"), true);

    const session = await db.sessions.getById("life-1");
    assert.equal(session?.status, "completed");
    assert.equal(session?.model, "claude-opus-4-5");
    const agents = await db.agents.getBySession("life-1");
    assert.equal(agents.some((agent) => agent.subagentType === "engineer" && agent.status === "completed"), true);
    const tokenRows = await db.tokenUsage.getBySession("life-1");
    assert.deepEqual(tokenRows.map((row) => ({
      model: row.model,
      input: row.inputTokens,
      output: row.outputTokens,
      cacheRead: row.cacheReadTokens,
      cacheWrite: row.cacheWriteTokens,
    })), [{
      model: "claude-opus-4-5",
      input: 100,
      output: 50,
      cacheRead: 10,
      cacheWrite: 5,
    }]);

    assert.equal(await db.processEvent("SessionStart", { session_id: "life-error", cwd: "/work" }, "claude"), true);
    assert.equal(await db.processEvent("Stop", { session_id: "life-error", stop_reason: "error" }, "claude"), true);
    assert.equal((await db.sessions.getById("life-error"))?.status, "error");
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PGlite importer is idempotent and can append new historical events", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-dashboard-pglite-"));
  const dataDir = path.join(dir, "agent-dashboard.pgdata");
  const db = await openPgliteAgentDatabase({
    dataDir,
    detectBillingMode: () => "api",
    now: () => "2026-06-07T12:00:00.000Z",
  });

  try {
    const session = makeNormalizedSession();
    assert.equal((await db.importer.importSession(session, "codex")).skipped, false);
    const firstEventCount = (await db.events.getBySession(session.sessionId)).length;
    const firstTokenRows = await db.tokenUsage.getBySession(session.sessionId);
    assert.equal((await db.importer.importSession(session, "codex")).skipped, true);
    assert.equal((await db.events.getBySession(session.sessionId)).length, firstEventCount);
    assert.deepEqual(await db.tokenUsage.getBySession(session.sessionId), firstTokenRows);

    const extended: NormalizedSession = {
      ...session,
      messageTimestamps: [...session.messageTimestamps, "2026-06-07T11:04:00.000Z"],
      fileModifiedAt: Date.parse("2026-06-07T12:00:00.000Z"),
    };
    const appended = await db.importer.importSession(extended, "codex");
    assert.equal(appended.skipped, false);
    assert.equal((await db.events.getBySession(session.sessionId)).length, firstEventCount + 1);
    assert.equal((await db.sessions.getById(session.sessionId))?.status, "active");
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PGlite importer refreshes metadata when a session is re-imported", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-dashboard-pglite-"));
  const dataDir = path.join(dir, "agent-dashboard.pgdata");
  const db = await openPgliteAgentDatabase({
    dataDir,
    detectBillingMode: () => "api",
    now: () => "2026-06-07T12:00:00.000Z",
  });

  try {
    const session = makeNormalizedSession();
    assert.equal((await db.importer.importSession(session, "codex")).skipped, false);

    const updated: NormalizedSession = {
      ...session,
      plans: [
        {
          source: "codex",
          content: "## Refreshed dashboard plan\n\n- Include plans added after first import",
          timestamp: "2026-06-07T11:03:00.000Z",
        },
      ],
      artifacts: {
        prs: [{ number: "276", repo: "closedloop-ai/closedloop-electron" }],
        issues: [],
        repo: "closedloop-ai/closedloop-electron",
      },
    };

    assert.equal((await db.importer.importSession(updated, "codex")).skipped, true);

    const features = await db.dashboard.getCoreFeatures();
    assert.equal(features.plans[0].title, "Refreshed dashboard plan");
    assert.equal(features.pullRequests[0].prNumber, 276);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("PGlite historical session details refresh after cache invalidation", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-dashboard-pglite-"));
  const dataDir = path.join(dir, "agent-dashboard.pgdata");
  const db = await openPgliteAgentDatabase({
    dataDir,
    detectBillingMode: () => "api",
    now: () => "2026-06-07T12:00:00.000Z",
  });

  try {
    await insertPgliteSession(db, "cached-history-1", {
      startedAt: "2026-06-07T10:00:00.000Z",
    });
    assert.deepEqual(
      (await db.sessions.getHistoricalWithDetails()).map((session) => session.id),
      ["cached-history-1"],
    );

    await insertPgliteSession(db, "cached-history-2", {
      startedAt: "2026-06-07T11:00:00.000Z",
    });
    assert.deepEqual(
      (await db.sessions.getHistoricalWithDetails()).map((session) => session.id),
      ["cached-history-1"],
    );

    db.sessions.invalidateHistoricalDetails();
    assert.deepEqual(
      (await db.sessions.getHistoricalWithDetails()).map((session) => session.id),
      ["cached-history-2", "cached-history-1"],
    );
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

async function insertPgliteSession(
  db: Awaited<ReturnType<typeof openPgliteAgentDatabase>>,
  id: string,
  overrides: {
    name?: string;
    status?: string;
    cwd?: string;
    model?: string;
    startedAt?: string;
    awaitingInputSince?: string | null;
  } = {},
): Promise<void> {
  const startedAt = overrides.startedAt ?? "2024-03-09T16:00:00.000Z";
  await db.run(
    `INSERT INTO sessions (
       id, name, status, cwd, model, started_at, updated_at,
       awaiting_input_since, harness, billing_mode
     )
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, 'codex', 'api')`,
    id,
    overrides.name ?? `Session ${id}`,
    overrides.status ?? "completed",
    overrides.cwd ?? `/work/${id}`,
    overrides.model ?? "gpt-5",
    startedAt,
    overrides.awaitingInputSince ?? null,
  );
}

function makeNormalizedSession(): NormalizedSession {
  return {
    sessionId: "imported-session-1",
    name: "Imported Session",
    cwd: "/workspace/closedloop-electron",
    model: "gpt-5",
    version: "1.0.0",
    slug: "imported-session",
    gitBranch: "fea-1550",
    startedAt: "2026-06-07T11:00:00.000Z",
    endedAt: "2026-06-07T11:05:00.000Z",
    teams: [],
    userMessages: 1,
    assistantMessages: 1,
    tokensByModel: {
      "gpt-5": { input: 100, output: 40, cacheRead: 0, cacheWrite: 0 },
    },
    messageTimestamps: ["2026-06-07T11:00:30.000Z"],
    toolUses: [
      {
        name: "Skill",
        timestamp: "2026-06-07T11:01:00.000Z",
        input: { skill: "core/ship-dashboard" },
        skillName: "core/ship-dashboard",
      },
      {
        name: "Agent",
        timestamp: "2026-06-07T11:02:00.000Z",
        input: {
          subagent_type: "engineer",
          description: "Implement dashboard parity",
          prompt: "Move the old dashboard surfaces to PGlite.",
        },
      },
    ],
    plans: [
      {
        source: "codex",
        content: "## Ship PGlite dashboard parity\n\n- Move feature summaries\n- Keep workflows loading",
        timestamp: "2026-06-07T11:03:00.000Z",
      },
    ],
    compactions: [],
    apiErrors: [],
    fileModifiedAt: null,
    turnDurations: [],
    entrypoint: "codex",
    permissionMode: null,
    thinkingBlockCount: 0,
    toolResultErrors: [],
    usageExtras: {
      service_tiers: [],
      speeds: [],
      inference_geos: [],
    },
    messages: [],
    tokenSeries: [],
    diffStats: null,
    slashCommands: [],
    artifacts: {
      prs: [{ number: "275", repo: "closedloop-ai/closedloop-electron" }],
      issues: [],
      repo: "closedloop-ai/closedloop-electron",
    },
  };
}
