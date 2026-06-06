/**
 * @file collectors-import.test.ts
 * @description Tests the first-party importSession write-sink (FEA-1503): it
 * writes a NormalizedSession into the in-process repository, is idempotent on
 * re-import (the headline acceptance criterion), and the CollectorManager applies
 * FEA-1407 sandbox gating (fail-closed) before any write.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { openAgentDatabase } from "../src/main/database/index.js";
import { createImporter } from "../src/main/collectors/import-session.js";
import { CollectorManager } from "../src/main/collectors/collector-manager.js";
import type { HarnessCollector, NormalizedSession } from "../src/main/collectors/types.js";

const FIXED_NOW = "2024-03-09T17:00:00.000Z";

function makeSession(overrides: Partial<NormalizedSession> = {}): NormalizedSession {
  return {
    sessionId: "s1",
    name: "proj",
    cwd: "/sandbox/proj",
    model: "gpt-5",
    version: null,
    slug: null,
    gitBranch: null,
    startedAt: "2024-03-09T16:00:00.000Z",
    endedAt: "2024-03-09T16:05:00.000Z",
    teams: [],
    userMessages: 1,
    assistantMessages: 1,
    tokensByModel: { "gpt-5": { input: 100, output: 50, cacheRead: 10, cacheWrite: 0 } },
    messageTimestamps: ["2024-03-09T16:01:00.000Z", "2024-03-09T16:02:00.000Z"],
    toolUses: [{ name: "Read", timestamp: "2024-03-09T16:01:30.000Z", input: { file: "x" } }],
    plans: [],
    compactions: [],
    apiErrors: [],
    fileModifiedAt: null, // not recently active ⇒ status "completed"
    turnDurations: [],
    entrypoint: "codex",
    permissionMode: null,
    thinkingBlockCount: 0,
    toolResultErrors: [],
    usageExtras: { service_tiers: [], speeds: [], inference_geos: [] },
    ...overrides,
  };
}

function openTempDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "collectors-import-"));
  const db = openAgentDatabase(path.join(dir, "agent-dashboard.sqlite"));
  return { db, dir, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("importSession writes session, main agent, events, and token rows", () => {
  const { db, cleanup } = openTempDb();
  try {
    const importer = createImporter(db.connection, {
      tokenUsage: db.tokenUsage,
      detectBillingMode: () => "api",
      now: () => FIXED_NOW,
    });

    const result = importer.importSession(makeSession(), "codex");
    assert.equal(result.skipped, false);

    const session = db.sessions.getById("s1");
    assert.ok(session);
    assert.equal(session.harness, "codex");
    assert.equal(session.billingMode, "api");
    assert.equal(session.status, "completed");

    // main agent only (no Agent/Task tool use)
    const agents = db.agents.getBySession("s1");
    assert.equal(agents.length, 1);
    assert.equal(agents[0].id, "s1-main");

    // 2 Stop events + 1 PostToolUse event
    const events = db.events.getBySession("s1");
    assert.equal(events.filter((e) => e.eventType === "Stop").length, 2);
    assert.equal(events.filter((e) => e.eventType === "PostToolUse").length, 1);

    const tokens = db.tokenUsage.getBySession("s1");
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].inputTokens, 100);
    assert.equal(tokens[0].outputTokens, 50);
  } finally {
    cleanup();
  }
});

test("re-import is idempotent — no duplicate session/agent/event/token rows", () => {
  const { db, cleanup } = openTempDb();
  try {
    const importer = createImporter(db.connection, {
      tokenUsage: db.tokenUsage,
      detectBillingMode: () => "api",
      now: () => FIXED_NOW,
    });

    importer.importSession(makeSession(), "codex");
    const eventsAfterFirst = db.events.getBySession("s1").length;
    const tokensAfterFirst = db.tokenUsage.getBySession("s1")[0].inputTokens;

    const second = importer.importSession(makeSession(), "codex");
    assert.equal(second.skipped, true, "second import of an unchanged session is a no-op");

    assert.equal(db.sessions.getAll().length, 1);
    assert.equal(db.agents.getBySession("s1").length, 1);
    assert.equal(db.events.getBySession("s1").length, eventsAfterFirst);
    // token cumulative is reconciled, not doubled
    assert.equal(db.tokenUsage.getBySession("s1")[0].inputTokens, tokensAfterFirst);
  } finally {
    cleanup();
  }
});

test("a new event with a later timestamp backfills without duplicating prior events", () => {
  const { db, cleanup } = openTempDb();
  try {
    const importer = createImporter(db.connection, {
      tokenUsage: db.tokenUsage,
      detectBillingMode: () => "api",
      now: () => FIXED_NOW,
    });

    importer.importSession(makeSession(), "codex");
    const before = db.events.getBySession("s1").filter((e) => e.eventType === "Stop").length;

    // Same session, one additional later Stop timestamp.
    importer.importSession(
      makeSession({
        messageTimestamps: [
          "2024-03-09T16:01:00.000Z",
          "2024-03-09T16:02:00.000Z",
          "2024-03-09T16:03:00.000Z",
        ],
      }),
      "codex",
    );
    const after = db.events.getBySession("s1").filter((e) => e.eventType === "Stop").length;
    assert.equal(after, before + 1, "only the new Stop event is appended");
  } finally {
    cleanup();
  }
});

test("backfill writes source timestamps instead of importer runtime", () => {
  const { db, cleanup } = openTempDb();
  try {
    const importer = createImporter(db.connection, {
      tokenUsage: db.tokenUsage,
      detectBillingMode: () => "api",
      now: () => "2026-06-06T12:00:00.000Z",
    });

    importer.importSession(
      makeSession({
        sessionId: "old-session",
        startedAt: "2026-04-01T10:00:00.000Z",
        endedAt: "2026-04-01T10:05:00.000Z",
        fileModifiedAt: Date.parse("2026-06-06T11:59:00.000Z"),
        messageTimestamps: [
          "2026-04-01T10:01:00.000Z",
          "2026-04-01T10:02:00.000Z",
        ],
        toolUses: [
          { name: "Read", timestamp: "2026-04-01T10:01:30.000Z", input: { file: "x" } },
        ],
      }),
      "codex",
    );

    const session = db.sessions.getById("old-session");
    assert.ok(session);
    assert.equal(session.status, "completed");
    assert.equal(session.updatedAt, "2026-04-01T10:05:00.000Z");

    const agent = db.agents.getBySession("old-session")[0];
    assert.equal(agent.updatedAt, "2026-04-01T10:05:00.000Z");

    const events = db.events.getBySession("old-session");
    assert.equal(events.length, 3);
    assert.deepEqual(
      events.map((event) => event.createdAt).sort(),
      [
        "2026-04-01T10:01:00.000Z",
        "2026-04-01T10:01:30.000Z",
        "2026-04-01T10:02:00.000Z",
      ],
    );
    const recentRow = db.connection.prepare(`
      SELECT COUNT(*) AS count
      FROM events
      WHERE session_id = ?
        AND created_at >= datetime(?, '-30 days')
    `).get("old-session", "2026-06-06T12:00:00.000Z") as { count: number };
    assert.equal(
      recentRow.count,
      0,
      "historical backfill must not appear in recent event windows",
    );

    const tokenRow = db.connection.prepare(`
      SELECT created_at AS createdAt, updated_at AS updatedAt
      FROM token_usage
      WHERE session_id = ? AND model = ?
    `).get("old-session", "gpt-5") as { createdAt: string; updatedAt: string };
    assert.equal(tokenRow.createdAt, "2026-04-01T10:05:00.000Z");
    assert.equal(tokenRow.updatedAt, "2026-04-01T10:05:00.000Z");
  } finally {
    cleanup();
  }
});

test("backfill falls back missing event timestamps to the source session date", () => {
  const { db, cleanup } = openTempDb();
  try {
    const importer = createImporter(db.connection, {
      tokenUsage: db.tokenUsage,
      detectBillingMode: () => "api",
      now: () => "2026-06-06T12:00:00.000Z",
    });

    importer.importSession(
      makeSession({
        sessionId: "missing-event-ts",
        startedAt: "2026-04-02T10:00:00.000Z",
        endedAt: "2026-04-02T10:05:00.000Z",
        messageTimestamps: [],
        toolUses: [{ name: "Read", timestamp: null, input: { file: "x" } }],
      }),
      "codex",
    );

    const events = db.events.getBySession("missing-event-ts");
    assert.equal(events.length, 1);
    assert.equal(events[0].createdAt, "2026-04-02T10:00:00.000Z");
  } finally {
    cleanup();
  }
});

test("Agent/Task tool use creates an idempotent subagent row", () => {
  const { db, cleanup } = openTempDb();
  try {
    const importer = createImporter(db.connection, {
      tokenUsage: db.tokenUsage,
      detectBillingMode: () => "api",
      now: () => FIXED_NOW,
    });

    const session = makeSession({
      toolUses: [
        {
          name: "Task",
          timestamp: "2024-03-09T16:01:30.000Z",
          input: { subagent_type: "explorer", prompt: "go look" },
        },
      ],
    });
    importer.importSession(session, "codex");
    importer.importSession(session, "codex"); // re-import

    const agents = db.agents.getBySession("s1");
    assert.equal(agents.length, 2, "main + one subagent, not duplicated on re-import");
    const sub = agents.find((a) => a.type === "subagent");
    assert.ok(sub);
    assert.equal(sub.subagentType, "explorer");
  } finally {
    cleanup();
  }
});

test("CollectorManager imports in-sandbox sessions and drops out-of-sandbox ones (FEA-1407)", async () => {
  const { db, dir, cleanup } = openTempDb();
  try {
    let emitted = 0;
    const fakeCollector: HarnessCollector = {
      key: "codex",
      cacheName: "codex",
      watchRoots: () => [], // no real dirs to watch
      watchMatch: () => false,
      listSources: () => ["one-batch"],
      parse: async () => [
        makeSession({ sessionId: "in", cwd: "/sandbox/proj" }),
        makeSession({ sessionId: "out", cwd: "/elsewhere/proj" }),
      ],
    };

    const manager = new CollectorManager({
      agentDatabase: db,
      detectBillingMode: () => "api",
      getSandboxBaseDirectory: () => "/sandbox",
      stateDir: dir,
      emit: () => { emitted++; },
      shouldWatchClaude: () => false,
      collectors: [fakeCollector],
      now: () => FIXED_NOW,
    });

    manager.start();
    // The initial boot import is scheduled via setImmediate; give it a few ticks.
    await new Promise((resolve) => setTimeout(resolve, 50));
    manager.stop();

    assert.ok(db.sessions.getById("in"), "in-sandbox session is imported");
    assert.equal(db.sessions.getById("out"), undefined, "out-of-sandbox session is dropped");
    assert.ok(emitted > 0, "emits a live-update signal after writing");
  } finally {
    cleanup();
  }
});

test("CollectorManager with an empty sandbox captures nothing (fail-closed)", async () => {
  const { db, dir, cleanup } = openTempDb();
  try {
    const fakeCollector: HarnessCollector = {
      key: "codex",
      cacheName: "codex",
      watchRoots: () => [],
      watchMatch: () => false,
      listSources: () => ["batch"],
      parse: async () => [makeSession({ sessionId: "in", cwd: "/sandbox/proj" })],
    };

    const manager = new CollectorManager({
      agentDatabase: db,
      detectBillingMode: () => "api",
      getSandboxBaseDirectory: () => "", // empty ⇒ capture nothing
      stateDir: dir,
      emit: () => {},
      shouldWatchClaude: () => false,
      collectors: [fakeCollector],
      now: () => FIXED_NOW,
    });

    manager.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    manager.stop();

    assert.equal(db.sessions.getAll().length, 0, "empty sandbox ⇒ nothing captured");
  } finally {
    cleanup();
  }
});
