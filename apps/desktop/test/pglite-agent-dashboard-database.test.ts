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
