import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  BACKFILL_SESSION_BATCH_SIZE,
  AgentSessionSyncService,
  chunkOversizedSession,
  estimateSessionPayloadBytes,
  estimateTokenUsageCostUsd,
  isSessionInSandbox,
  listAllSessionCursorRows,
  listUpdatedSessionCursorRows,
  loadSyncedSessions,
  MAX_CONSECUTIVE_TIMEOUTS,
  sanitizeSessionForSync,
  SESSION_PAYLOAD_BYTE_CAP,
} from "../src/main/agent-session-sync-service.js";
import {
  DesktopAgentSessionsAckReason,
  type DesktopAgentSessionsAck,
} from "../src/main/cloud-protocol.js";
import {
  createAgentMonitorTestDatabase as createServiceTestDatabase,
  flushAgentSessionSync,
  insertTestSessionRow as insertSessionRow,
} from "./helpers/agent-session-sync-test-utils.js";
import { computeTokenCost } from "../src/shared/token-cost.js";

test("agent-session sync loads normalized session payloads with attribution and cost", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "agent-session-sync-"));
  const worktreeDir = path.join(rootDir, "symphony-alpha-pln-628");
  const dbPath = path.join(rootDir, "dashboard.db");
  mkdirSync(path.join(worktreeDir, ".closedloop-ai", "work"), {
    recursive: true,
  });
  writeFileSync(
    path.join(worktreeDir, ".closedloop-ai", "work", "launch-metadata.json"),
    JSON.stringify({
      artifactId: "artifact-1",
      loopId: "loop-1",
      issueId: "PLN-628",
      baseBranch: "main",
    }),
  );

  execFileSync("git", ["init"], { cwd: worktreeDir, stdio: "ignore" });
  execFileSync(
    "git",
    [
      "remote",
      "add",
      "origin",
      "git@github.com:closedloop-ai/symphony-alpha.git",
    ],
    { cwd: worktreeDir, stdio: "ignore" },
  );

  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      name TEXT,
      status TEXT NOT NULL,
      cwd TEXT,
      model TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      ended_at TEXT,
      awaiting_input_since TEXT,
      metadata TEXT,
      harness TEXT NOT NULL,
      billing_mode TEXT NOT NULL DEFAULT 'unknown',
      user_id TEXT,
      organization_id TEXT
    );
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      subagent_type TEXT,
      status TEXT NOT NULL,
      task TEXT,
      current_tool TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      ended_at TEXT,
      awaiting_input_since TEXT,
      parent_agent_id TEXT,
      metadata TEXT
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      agent_id TEXT,
      event_type TEXT NOT NULL,
      tool_name TEXT,
      summary TEXT,
      data TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE token_usage (
      session_id TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      raw_input INTEGER NOT NULL DEFAULT 0,
      raw_output INTEGER NOT NULL DEFAULT 0,
      raw_cache_read INTEGER NOT NULL DEFAULT 0,
      raw_cache_write INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, model)
    );
  `);

  db.prepare(`
    INSERT INTO sessions (
      id, name, status, cwd, model, started_at, updated_at, ended_at,
      awaiting_input_since, metadata, harness, billing_mode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "sess-1",
    "Sync monitor test",
    "active",
    worktreeDir,
    "gpt-4.1",
    "2026-05-20T12:00:00.000Z",
    "2026-05-20T12:05:00.000Z",
    null,
    "2026-05-20T12:04:00.000Z",
    JSON.stringify({ imported: true, source: "codex" }),
    "codex",
    "codex_subscription",
  );

  db.prepare(`
    INSERT INTO agents (
      id, session_id, name, type, subagent_type, status, task, current_tool,
      started_at, updated_at, ended_at, awaiting_input_since, parent_agent_id,
      metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "agent-1",
    "sess-1",
    "main",
    "main",
    null,
    "working",
    "Investigate session sync",
    "search",
    "2026-05-20T12:00:00.000Z",
    "2026-05-20T12:05:00.000Z",
    null,
    null,
    null,
    JSON.stringify({ lane: "primary" }),
  );

  db.prepare(`
    INSERT INTO events (
      session_id, agent_id, event_type, tool_name, summary, data, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    "sess-1",
    "agent-1",
    "tool_use",
    "search",
    "Searched repository",
    JSON.stringify({ query: "agent sessions" }),
    "2026-05-20T12:02:00.000Z",
  );

  // FEA-1497: the in-process token_usage stores effective reconciled counts in
  // the plain columns (no baseline_* at read time). 1000+25 input, 500+10
  // output, 250+5 cache-read, 100+0 cache-write — the same effective totals the
  // old baseline-summed query produced.
  db.prepare(`
    INSERT INTO token_usage (
      session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run("sess-1", "gpt-4.1", 1025, 510, 255, 100);

  const sessions = loadSyncedSessions(db, ["sess-1"]);
  assert.equal(sessions.length, 1);

  const session = sessions[0];
  assert.equal(session.externalSessionId, "sess-1");
  assert.equal(session.harness, "codex");
  // FEA-1434: a stored, definite billing mode propagates unchanged (no
  // re-detection from the live environment).
  assert.equal(session.billingMode, "codex_subscription");
  assert.equal(session.awaitingInputSince, "2026-05-20T12:04:00.000Z");
  assert.deepEqual(session.metadata, { imported: true, source: "codex" });
  assert.deepEqual(session.attribution, {
    repositoryFullName: "closedloop-ai/symphony-alpha",
    worktreePath: worktreeDir,
    sourceArtifactId: "artifact-1",
    sourceLoopId: "loop-1",
    issueId: "PLN-628",
    baseBranch: "main",
  });
  assert.equal(session.agents.length, 1);
  assert.equal(session.events.length, 1);
  assert.deepEqual(session.events[0].data, { query: "agent sessions" });
  assert.equal(session.tokenUsageByModel.length, 1);
  assert.equal(session.tokenUsageByModel[0].inputTokens, 1025);
  assert.equal(session.tokenUsageByModel[0].outputTokens, 510);
  assert.equal(session.tokenUsageByModel[0].cacheReadTokens, 255);
  assert.equal(session.tokenUsageByModel[0].cacheWriteTokens, 100);
  // Cost is computed by genai-prices via the canonical engine. Assert the load
  // path fed it the correct effective, provider-normalized counts (gpt-4.1 is
  // OpenAI → input passes through as the total, cache is a subset) rather than
  // hard-coding a library-version-dependent dollar figure.
  const expectedCost = computeTokenCost({
    model: "gpt-4.1",
    inputTokens: 1025,
    outputTokens: 510,
    cacheReadTokens: 255,
    cacheWriteTokens: 100,
  });
  assert.equal(expectedCost.priced, true);
  assert.equal(
    session.tokenUsageByModel[0].estimatedCostUsd,
    expectedCost.costUsd,
  );

  db.close();
});

test("agent-session sync falls back to live detection for legacy unknown billing_mode", () => {
  // A row migrated to the default 'unknown' billing_mode (legacy / unstamped)
  // should be resolved from the live desktop environment at sync time. Control
  // the env deterministically so the assertion does not depend on the test
  // machine's real credentials.
  const rootDir = mkdtempSync(path.join(tmpdir(), "agent-session-sync-bm-"));
  const db = createServiceTestDatabase(rootDir);
  insertSessionRow(db, {
    id: "legacy-1",
    startedAt: "2026-05-20T12:00:00.000Z",
    updatedAt: "2026-05-20T12:05:00.000Z",
    harness: "claude",
  });

  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-detection-only";
  try {
    const [session] = loadSyncedSessions(db, ["legacy-1"]);
    assert.equal(session.billingMode, "api");
  } finally {
    if (prev === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = prev;
    }
  }

  db.close();
});

test("agent-session sync cursor queries preserve updated_at ordering", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO sessions (id, updated_at) VALUES (?, ?)").run(
    "sess-a",
    "2026-05-20T12:00:00.000Z",
  );
  db.prepare("INSERT INTO sessions (id, updated_at) VALUES (?, ?)").run(
    "sess-b",
    "2026-05-20T12:03:00.000Z",
  );
  db.prepare("INSERT INTO sessions (id, updated_at) VALUES (?, ?)").run(
    "sess-c",
    "2026-05-20T12:01:00.000Z",
  );
  db.prepare("INSERT INTO sessions (id, updated_at) VALUES (?, ?)").run(
    "sess-d",
    "2026-05-20T12:03:00.000Z",
  );

  assert.deepEqual(
    listAllSessionCursorRows(db).map((row) => ({ ...row })),
    [
      { id: "sess-d", updated_at: "2026-05-20T12:03:00.000Z" },
      { id: "sess-b", updated_at: "2026-05-20T12:03:00.000Z" },
      { id: "sess-c", updated_at: "2026-05-20T12:01:00.000Z" },
      { id: "sess-a", updated_at: "2026-05-20T12:00:00.000Z" },
    ],
  );
  assert.deepEqual(
    listUpdatedSessionCursorRows(db, "2026-05-20T12:00:30.000Z").map((row) => ({
      ...row,
    })),
    [
      { id: "sess-d", updated_at: "2026-05-20T12:03:00.000Z" },
      { id: "sess-b", updated_at: "2026-05-20T12:03:00.000Z" },
      { id: "sess-c", updated_at: "2026-05-20T12:01:00.000Z" },
    ],
  );
  assert.deepEqual(
    listUpdatedSessionCursorRows(db, "2026-05-20T12:03:00.000Z").map((row) => ({
      ...row,
    })),
    [
      { id: "sess-d", updated_at: "2026-05-20T12:03:00.000Z" },
      { id: "sess-b", updated_at: "2026-05-20T12:03:00.000Z" },
    ],
  );

  db.close();
});

test("agent-session sync picks up new sessions added at the current top timestamp", async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "agent-session-sync-service-"));
  const db = createServiceTestDatabase(rootDir);
  insertSessionRow(db, {
    id: "sess-z",
    startedAt: "2026-05-20T12:00:00.000Z",
    updatedAt: "2026-05-20T12:05:00.000Z",
  });

  const batches: string[][] = [];
  const service = new AgentSessionSyncService({
    isAgentMonitorEnabled: () => true,
    isRelayReady: () => true,
    getSandboxBaseDirectory: () => "/",
    sendBatch: async (batch) => {
      batches.push(batch.sessions.map((session) => session.externalSessionId));
      return { accepted: true };
    },
    getUserDataPath: () => path.join(rootDir, "user-data"),
  });

  service.start();
  await flushAgentSessionSync();
  assert.deepEqual(batches, [["sess-z"]]);

  insertSessionRow(db, {
    id: "sess-a",
    startedAt: "2026-05-20T12:01:00.000Z",
    updatedAt: "2026-05-20T12:05:00.000Z",
  });
  service.refresh();
  await flushAgentSessionSync();
  assert.deepEqual(batches, [["sess-z"], ["sess-a"]]);

  service.stop();
  db.close();
});

test("agent-session sync pauses after feature_disabled until relay reconnects", async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "agent-session-sync-service-"));
  const db = createServiceTestDatabase(rootDir);
  insertSessionRow(db, {
    id: "sess-1",
    startedAt: "2026-05-20T12:00:00.000Z",
    updatedAt: "2026-05-20T12:05:00.000Z",
  });

  let relayReady = true;
  let sendCount = 0;
  const service = new AgentSessionSyncService({
    isAgentMonitorEnabled: () => true,
    isRelayReady: () => relayReady,
    getSandboxBaseDirectory: () => "/",
    sendBatch: async () => {
      sendCount += 1;
      if (sendCount === 1) {
        return {
          accepted: false,
          reason: DesktopAgentSessionsAckReason.FeatureDisabled,
        };
      }
      return { accepted: true };
    },
    getUserDataPath: () => path.join(rootDir, "user-data"),
  });

  service.start();
  await flushAgentSessionSync();
  assert.equal(sendCount, 1);

  service.refresh();
  await flushAgentSessionSync();
  assert.equal(sendCount, 1);

  relayReady = false;
  service.refresh();
  await flushAgentSessionSync();

  relayReady = true;
  service.refresh();
  await flushAgentSessionSync();
  assert.equal(sendCount, 2);

  service.stop();
  db.close();
});

test("agent-session sync throttles repeated incremental full-session syncs", async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "agent-session-sync-service-"));
  const db = createServiceTestDatabase(rootDir);
  insertSessionRow(db, {
    id: "sess-1",
    startedAt: "2026-05-20T12:00:00.000Z",
    updatedAt: "2026-05-20T12:00:00.000Z",
  });

  let nowMs = Date.parse("2026-05-20T12:00:00.000Z");
  const originalDateNow = Date.now;
  Date.now = () => nowMs;

  const syncModes: string[] = [];
  const service = new AgentSessionSyncService({
    isAgentMonitorEnabled: () => true,
    isRelayReady: () => true,
    getSandboxBaseDirectory: () => "/",
    sendBatch: async (batch) => {
      syncModes.push(batch.syncMode);
      return { accepted: true };
    },
    getUserDataPath: () => path.join(rootDir, "user-data"),
  });

  try {
    service.start();
    await flushAgentSessionSync();
    assert.deepEqual(syncModes, ["backfill"]);

    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(
      "2026-05-20T12:00:05.000Z",
      "sess-1",
    );
    service.refresh();
    await flushAgentSessionSync();
    assert.deepEqual(syncModes, ["backfill", "incremental"]);

    nowMs += 5_000;
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(
      "2026-05-20T12:00:06.000Z",
      "sess-1",
    );
    service.refresh();
    await flushAgentSessionSync();
    assert.deepEqual(syncModes, ["backfill", "incremental"]);

    nowMs += 30_000;
    service.refresh();
    await flushAgentSessionSync();
    assert.deepEqual(syncModes, ["backfill", "incremental", "incremental"]);
  } finally {
    Date.now = originalDateNow;
    service.stop();
    db.close();
  }
});

test("agent-session sync stop clears retry state before a new dashboard source is selected", async () => {
  const legacyRootDir = mkdtempSync(path.join(tmpdir(), "agent-session-sync-legacy-"));
  const designRootDir = mkdtempSync(path.join(tmpdir(), "agent-session-sync-design-"));
  const legacyDb = createServiceTestDatabase(legacyRootDir);
  const designDb = createServiceTestDatabase(designRootDir);
  insertSessionRow(legacyDb, {
    id: "shared-session",
    startedAt: "2026-05-20T12:00:00.000Z",
    updatedAt: "2026-05-20T12:05:00.000Z",
  });
  insertSessionRow(designDb, {
    id: "shared-session",
    startedAt: "2026-05-20T13:00:00.000Z",
    updatedAt: "2026-05-20T13:05:00.000Z",
  });

  let monitorEnabled = true;
  let source: "legacy" | "design" = "legacy";
  const sentSessionStartedAt: string[] = [];
  const service = new AgentSessionSyncService({
    isAgentMonitorEnabled: () => monitorEnabled,
    isRelayReady: () => true,
    getSandboxBaseDirectory: () => "/",
    getConnection: () => (source === "design" ? designDb : null),
    getUserDataPath: () => path.join(legacyRootDir, "user-data"),
    sendBatch: async (batch) => {
      sentSessionStartedAt.push(batch.sessions[0]?.startedAt ?? "");
      if (source === "legacy") {
        return {
          accepted: false,
          reason: DesktopAgentSessionsAckReason.RateLimited,
        };
      }
      return { accepted: true };
    },
  });

  service.start();
  await flushAgentSessionSync();
  assert.deepEqual(sentSessionStartedAt, ["2026-05-20T12:00:00.000Z"]);

  monitorEnabled = false;
  service.stop();
  service.refresh();
  await flushAgentSessionSync();
  assert.deepEqual(
    sentSessionStartedAt,
    ["2026-05-20T12:00:00.000Z"],
    "disabled mode must not send from the stopped source",
  );

  monitorEnabled = true;
  source = "design";
  service.start();
  await flushAgentSessionSync();
  assert.deepEqual(
    sentSessionStartedAt,
    ["2026-05-20T12:00:00.000Z", "2026-05-20T13:00:00.000Z"],
    "design source must send immediately instead of inheriting legacy backoff",
  );

  service.stop();
  legacyDb.close();
  designDb.close();
});

test("agent-session sync ignores stale in-flight acks after source reset", async () => {
  const legacyRootDir = mkdtempSync(path.join(tmpdir(), "agent-session-sync-legacy-"));
  const designRootDir = mkdtempSync(path.join(tmpdir(), "agent-session-sync-design-"));
  const legacyDb = createServiceTestDatabase(legacyRootDir);
  const designDb = createServiceTestDatabase(designRootDir);
  insertSessionRow(legacyDb, {
    id: "shared-session",
    startedAt: "2026-05-20T12:00:00.000Z",
    updatedAt: "2026-05-20T12:05:00.000Z",
  });
  insertSessionRow(designDb, {
    id: "shared-session",
    startedAt: "2026-05-20T13:00:00.000Z",
    updatedAt: "2026-05-20T13:05:00.000Z",
  });

  let monitorEnabled = true;
  let source: "legacy" | "design" = "legacy";
  let resolveLegacyAck: ((ack: DesktopAgentSessionsAck) => void) | null = null;
  const sentSessionStartedAt: string[] = [];
  const service = new AgentSessionSyncService({
    isAgentMonitorEnabled: () => monitorEnabled,
    isRelayReady: () => true,
    getSandboxBaseDirectory: () => "/",
    getConnection: () => (source === "design" ? designDb : null),
    getUserDataPath: () => path.join(legacyRootDir, "user-data"),
    sendBatch: async (batch) => {
      sentSessionStartedAt.push(batch.sessions[0]?.startedAt ?? "");
      if (batch.sessions[0]?.startedAt === "2026-05-20T12:00:00.000Z") {
        return await new Promise<DesktopAgentSessionsAck>((resolve) => {
          resolveLegacyAck = resolve;
        });
      }
      return { accepted: true };
    },
  });

  service.start();
  await flushAgentSessionSync();
  assert.deepEqual(sentSessionStartedAt, ["2026-05-20T12:00:00.000Z"]);

  monitorEnabled = false;
  service.stop();
  resolveLegacyAck?.({
    accepted: false,
    reason: DesktopAgentSessionsAckReason.RateLimited,
  });
  await flushAgentSessionSync();

  source = "design";
  monitorEnabled = true;
  service.start();
  await flushAgentSessionSync();
  assert.deepEqual(
    sentSessionStartedAt,
    ["2026-05-20T12:00:00.000Z", "2026-05-20T13:00:00.000Z"],
    "stale legacy ack after stop must not back off the next design source",
  );

  service.stop();
  legacyDb.close();
  designDb.close();
});

test("agent-session sync cost estimator returns undefined for an unpriced model", () => {
  // An unknown model is not priced by genai-prices → undefined, so the caller
  // omits the optional estimatedCostUsd field (renders as "—", not a silent $0).
  assert.equal(
    estimateTokenUsageCostUsd({
      session_id: "sess-1",
      model: "unknown-model",
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 25,
      cache_write_tokens: 10,
    }),
    undefined,
  );
});

function insertEventRow(
  db: DatabaseSync,
  sessionId: string,
  data: string,
): void {
  db.prepare(`
    INSERT INTO events (session_id, agent_id, event_type, tool_name, summary, data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    null,
    "tool_use",
    null,
    null,
    data,
    "2026-05-20T12:00:00.000Z",
  );
}

function insertPaddingEvents(
  db: DatabaseSync,
  sessionId: string,
  count: number,
  toolName: string,
): void {
  for (let index = 0; index < count; index += 1) {
    db.prepare(`
      INSERT INTO events (session_id, agent_id, event_type, tool_name, summary, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      null,
      "tool_use",
      toolName,
      null,
      null,
      "2026-05-20T12:00:00.000Z",
    );
  }
}

test("agent-session sync stop clears pending chunks before source re-enable", async () => {
  const legacyRootDir = mkdtempSync(path.join(tmpdir(), "agent-session-sync-legacy-"));
  const designRootDir = mkdtempSync(path.join(tmpdir(), "agent-session-sync-design-"));
  const legacyDb = createServiceTestDatabase(legacyRootDir);
  const designDb = createServiceTestDatabase(designRootDir);
  insertSessionRow(legacyDb, {
    id: "legacy-chunked",
    startedAt: "2026-05-20T12:00:00.000Z",
    updatedAt: "2026-05-20T12:05:00.000Z",
  });
  insertPaddingEvents(
    legacyDb,
    "legacy-chunked",
    Math.ceil((SESSION_PAYLOAD_BYTE_CAP * 2) / 600),
    "Z".repeat(500),
  );
  insertSessionRow(designDb, {
    id: "design-fresh",
    startedAt: "2026-05-20T13:00:00.000Z",
    updatedAt: "2026-05-20T13:05:00.000Z",
  });

  let monitorEnabled = true;
  let source: "legacy" | "design" = "legacy";
  const sentSessionIds: string[] = [];
  const service = new AgentSessionSyncService({
    isAgentMonitorEnabled: () => monitorEnabled,
    isRelayReady: () => true,
    isChunkedSyncEnabled: () => true,
    getSandboxBaseDirectory: () => "/",
    getConnection: () => (source === "design" ? designDb : null),
    getUserDataPath: () => path.join(legacyRootDir, "user-data"),
    sendBatch: async (batch) => {
      sentSessionIds.push(batch.sessions[0]?.externalSessionId ?? "");
      return { accepted: true };
    },
  });

  service.start();
  await flushAgentSessionSync();
  assert.deepEqual(sentSessionIds, ["legacy-chunked"]);

  monitorEnabled = false;
  service.stop();
  source = "design";
  monitorEnabled = true;
  service.start();
  await flushAgentSessionSync();
  assert.deepEqual(
    sentSessionIds,
    ["legacy-chunked", "design-fresh"],
    "source re-enable must not resume pending chunks from the prior DB",
  );

  service.stop();
  legacyDb.close();
  designDb.close();
});

test("agent-session payload-aware batcher keeps each batch at or below SESSION_PAYLOAD_BYTE_CAP", async () => {
  // Create sessions whose combined size exceeds the cap so the batcher must
  // split them across multiple sync cycles.
  const rootDir = mkdtempSync(path.join(tmpdir(), "agent-session-sync-service-"));
  const db = createServiceTestDatabase(rootDir);

  // Each session has many events with long tool_name fields (~100 KiB each).
  // Event data is stripped by transcript sanitization (FEA-1407) so tool_name
  // is used for padding since it survives sanitization.
  // Three sessions together (~300 KiB) exceed the 256 KiB cap, so the batcher
  // must exclude at least one from the first batch.
  const longToolName = "T".repeat(500);
  const eventsPerSession = Math.ceil(100_000 / 600);
  const sessionIds = ["sess-pad-1", "sess-pad-2", "sess-pad-3"];
  for (const id of sessionIds) {
    insertSessionRow(db, {
      id,
      startedAt: "2026-05-20T12:00:00.000Z",
      updatedAt: "2026-05-20T12:05:00.000Z",
    });
    for (let i = 0; i < eventsPerSession; i++) {
      db.prepare(`
        INSERT INTO events (session_id, agent_id, event_type, tool_name, summary, data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, null, "tool_use", longToolName, null, null, "2026-05-20T12:00:00.000Z");
    }
  }

  const receivedBatches: import("../src/main/agent-session-sync-contract.js").AgentSessionSyncBatch[] = [];
  const service = new AgentSessionSyncService({
    isAgentMonitorEnabled: () => true,
    isRelayReady: () => true,
    getSandboxBaseDirectory: () => "/",
    sendBatch: async (batch) => {
      receivedBatches.push(batch);
      return { accepted: true };
    },
    getUserDataPath: () => path.join(rootDir, "user-data"),
  });

  service.start();
  await flushAgentSessionSync();

  // Verify at least one batch was sent and every batch's serialized size is
  // within the 256 KiB cap.
  assert.ok(receivedBatches.length >= 1, "expected at least one batch to be sent");
  for (const batch of receivedBatches) {
    const sessionsByteSum = batch.sessions.reduce(
      (sum, s) => sum + estimateSessionPayloadBytes(s),
      0,
    );
    assert.ok(
      sessionsByteSum <= SESSION_PAYLOAD_BYTE_CAP,
      `batch session payload sum ${sessionsByteSum} exceeds cap ${SESSION_PAYLOAD_BYTE_CAP}`,
    );
  }

  service.stop();
  db.close();
});

test("agent-session payload-aware batcher skips oversized sessions and advances the queue", async () => {
  // A session whose serialized size exceeds SESSION_PAYLOAD_BYTE_CAP must be
  // skipped (dead-lettered) so it does not permanently block the queue.
  // The smaller session behind it must still be sent successfully.
  const rootDir = mkdtempSync(path.join(tmpdir(), "agent-session-sync-service-"));
  const db = createServiceTestDatabase(rootDir);

  // Pad the session so its payload exceeds 256 KiB on its own.
  // Use many events with long tool_name values since event.data is stripped
  // by transcript sanitization (FEA-1407) before size estimation.
  const longToolName = "T".repeat(500);
  insertSessionRow(db, {
    id: "sess-oversize",
    startedAt: "2026-05-20T12:00:00.000Z",
    updatedAt: "2026-05-20T12:05:00.000Z",
  });
  const eventsNeeded = Math.ceil((SESSION_PAYLOAD_BYTE_CAP + 1000) / 600);
  for (let i = 0; i < eventsNeeded; i++) {
    db.prepare(`
      INSERT INTO events (session_id, agent_id, event_type, tool_name, summary, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("sess-oversize", null, "tool_use", longToolName, null, null, `2026-05-20T12:0${String(i % 10).padStart(1, "0")}:00.000Z`);
  }

  // Insert a second, small session to confirm it is sent after the oversized one is skipped.
  insertSessionRow(db, {
    id: "sess-small",
    startedAt: "2026-05-20T12:01:00.000Z",
    updatedAt: "2026-05-20T12:06:00.000Z",
  });

  const receivedBatches: import("../src/main/agent-session-sync-contract.js").AgentSessionSyncBatch[] = [];
  const service = new AgentSessionSyncService({
    isAgentMonitorEnabled: () => true,
    isRelayReady: () => true,
    getSandboxBaseDirectory: () => "/",
    sendBatch: async (batch) => {
      receivedBatches.push(batch);
      return { accepted: true };
    },
    getUserDataPath: () => path.join(rootDir, "user-data"),
  });

  service.start();
  await flushAgentSessionSync();

  // The oversized session must be skipped; the small session must be sent.
  assert.equal(receivedBatches.length, 1, "expected exactly one batch (small session only)");
  assert.equal(
    receivedBatches[0].sessions[0].externalSessionId,
    "sess-small",
    "the small session must be sent after skipping the oversized one",
  );
  const oversizeBatch = receivedBatches.find((b) =>
    b.sessions.some((s) => s.externalSessionId === "sess-oversize"),
  );
  assert.equal(oversizeBatch, undefined, "oversized session must not be sent");

  service.stop();
  db.close();
});

test("agent-session sync uses smaller batches for backfill than incremental", async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "agent-session-sync-service-"));
  const db = createServiceTestDatabase(rootDir);

  for (let index = 0; index < BACKFILL_SESSION_BATCH_SIZE + 2; index += 1) {
    insertSessionRow(db, {
      id: `sess-backfill-${index + 1}`,
      startedAt: "2026-05-20T12:00:00.000Z",
      updatedAt: `2026-05-20T12:0${index}:00.000Z`,
    });
  }

  const receivedBatches: import("../src/main/agent-session-sync-contract.js").AgentSessionSyncBatch[] = [];
  const service = new AgentSessionSyncService({
    isAgentMonitorEnabled: () => true,
    isRelayReady: () => true,
    getSandboxBaseDirectory: () => "/",
    sendBatch: async (batch) => {
      receivedBatches.push(batch);
      return { accepted: true };
    },
    getUserDataPath: () => path.join(rootDir, "user-data"),
  });

  service.start();
  await flushAgentSessionSync();

  assert.ok(receivedBatches.length >= 1, "expected at least one backfill batch");
  assert.equal(receivedBatches[0].syncMode, "backfill");
  assert.equal(
    receivedBatches[0].sessions.length,
    BACKFILL_SESSION_BATCH_SIZE,
    "backfill batches should use the smaller backfill-specific size",
  );

  service.stop();
  db.close();
});

test("agent-session sync retries on ack_timeout then dead-letters after MAX_CONSECUTIVE_TIMEOUTS", async () => {
  // Uses a normal-sized session that times out due to server issues (not payload
  // size). Oversized sessions are skipped immediately; this test covers the
  // dead-letter path for sessions that fit within the cap but still time out.
  const rootDir = mkdtempSync(path.join(tmpdir(), "agent-session-sync-service-"));
  const db = createServiceTestDatabase(rootDir);

  insertSessionRow(db, {
    id: "sess-timeout",
    startedAt: "2026-05-20T12:00:00.000Z",
    updatedAt: "2026-05-20T12:05:00.000Z",
  });
  insertSessionRow(db, {
    id: "sess-healthy",
    startedAt: "2026-05-20T11:00:00.000Z",
    updatedAt: "2026-05-20T11:05:00.000Z",
  });

  const telemetryEvents: import("../src/main/agent-session-sync-service.js").AgentSessionSyncTelemetryEvent[] = [];
  const sentBatches: import("../src/main/agent-session-sync-contract.js").AgentSessionSyncBatch[] = [];
  const service = new AgentSessionSyncService({
    isAgentMonitorEnabled: () => true,
    isRelayReady: () => true,
    getSandboxBaseDirectory: () => "/",
    sendBatch: async (batch) => {
      sentBatches.push(batch);
      // Timeout every batch that contains sess-timeout; accept others.
      if (batch.sessions.some((s) => s.externalSessionId === "sess-timeout")) {
        return {
          accepted: false,
          reason: DesktopAgentSessionsAckReason.AckTimeout,
        };
      }
      return { accepted: true };
    },
    getUserDataPath: () => path.join(rootDir, "user-data"),
    onBatchOutcome: (event) => {
      telemetryEvents.push(event);
    },
  });

  service.start();
  await flushAgentSessionSync();

  // First timeout: session stays queued for retry.
  assert.equal(telemetryEvents.length, 1, "expected one telemetry event after first timeout");
  assert.equal(telemetryEvents[0].reason, DesktopAgentSessionsAckReason.AckTimeout);

  // Drive remaining cycles — session retries then gets dead-lettered.
  for (let i = 1; i < MAX_CONSECUTIVE_TIMEOUTS; i++) {
    service.refresh();
    await flushAgentSessionSync();
  }

  // After dead-lettering, the healthy session should be sent and accepted.
  service.refresh();
  await flushAgentSessionSync();
  const healthyBatch = sentBatches.find((b) =>
    b.sessions.some((s) => s.externalSessionId === "sess-healthy"),
  );
  assert.ok(healthyBatch, "queue must advance past the dead-lettered session to sess-healthy");

  service.stop();
  db.close();
});

test("chunked sync splits oversized sessions into multiple batches when enabled", async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "agent-session-sync-service-"));
  const db = createServiceTestDatabase(rootDir);

  // Create an oversized session with many events. Use long tool_name fields
  // since event data is stripped by transcript sanitization (FEA-1407).
  const longToolName = "Z".repeat(500);
  insertSessionRow(db, {
    id: "sess-chunked",
    startedAt: "2026-05-20T12:00:00.000Z",
    updatedAt: "2026-05-20T12:05:00.000Z",
  });
  // Insert enough events that total payload exceeds the cap even after sanitization.
  const chunkEventsNeeded = Math.ceil((SESSION_PAYLOAD_BYTE_CAP * 2) / 600);
  for (let i = 0; i < chunkEventsNeeded; i++) {
    db.prepare(`
      INSERT INTO events (session_id, agent_id, event_type, tool_name, summary, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("sess-chunked", null, "tool_use", longToolName, null, null, "2026-05-20T12:00:00.000Z");
  }

  const receivedBatches: import("../src/main/agent-session-sync-contract.js").AgentSessionSyncBatch[] = [];
  const service = new AgentSessionSyncService({
    isAgentMonitorEnabled: () => true,
    isRelayReady: () => true,
    isChunkedSyncEnabled: () => true,
    getSandboxBaseDirectory: () => "/",
    sendBatch: async (batch) => {
      receivedBatches.push(batch);
      return { accepted: true };
    },
    getUserDataPath: () => path.join(rootDir, "user-data"),
  });

  service.start();
  // Flush enough cycles to send all chunks.
  for (let i = 0; i < 10; i++) {
    service.refresh();
    await flushAgentSessionSync();
  }

  // All batches must contain the same session ID.
  assert.ok(receivedBatches.length >= 2, `expected ≥2 chunked batches, got ${receivedBatches.length}`);
  for (const batch of receivedBatches) {
    assert.equal(batch.sessions[0].externalSessionId, "sess-chunked");
    // Each batch must be within the payload cap (the first chunk can be slightly over
    // due to base session metadata, but subsequent chunks must fit).
    const batchBytes = estimateSessionPayloadBytes(batch.sessions[0]);
    assert.ok(
      batchBytes <= SESSION_PAYLOAD_BYTE_CAP * 1.1,
      `chunk payload ${batchBytes} exceeds cap ${SESSION_PAYLOAD_BYTE_CAP} by more than 10%`,
    );
  }

  const totalEvents = receivedBatches.reduce(
    (sum, b) => sum + b.sessions[0].events.length,
    0,
  );
  assert.equal(totalEvents, chunkEventsNeeded, "all events must be sent across chunks");

  service.stop();
  db.close();
});

test("chunkOversizedSession splits events to fit within byte cap", () => {
  const session = {
    externalSessionId: "sess-unit",
    name: null,
    status: "completed",
    harness: "claude",
    cwd: null,
    model: null,
    startedAt: "2026-05-20T12:00:00.000Z",
    updatedAt: "2026-05-20T12:05:00.000Z",
    endedAt: null,
    awaitingInputSince: null,
    metadata: null,
    agents: [],
    events: Array.from({ length: 10 }, (_, i) => ({
      externalEventId: String(i),
      agentExternalId: null,
      eventType: "tool_use",
      toolName: null,
      summary: null,
      data: { pad: "x".repeat(1000) },
      createdAt: "2026-05-20T12:01:00.000Z",
    })),
    tokenUsageByModel: [],
  };

  // Use a small cap so events get split.
  const smallCap = estimateSessionPayloadBytes({ ...session, events: [] }) + 3000;
  const chunks = chunkOversizedSession(session as any, smallCap);

  assert.ok(chunks.length >= 2, `expected ≥2 chunks, got ${chunks.length}`);
  const totalEvents = chunks.reduce((sum, c) => sum + c.events.length, 0);
  assert.equal(totalEvents, 10, "all events must appear across chunks");

  // Every chunk has the same session metadata.
  for (const chunk of chunks) {
    assert.equal(chunk.externalSessionId, "sess-unit");
  }
});

// ---------------------------------------------------------------------------
// FEA-1407: isSessionInSandbox
// ---------------------------------------------------------------------------

test("isSessionInSandbox returns true for cwd inside sandbox", () => {
  assert.equal(isSessionInSandbox("/home/user/Work/acme", "/home/user/Work"), true);
});

test("isSessionInSandbox returns true for cwd equal to sandbox", () => {
  assert.equal(isSessionInSandbox("/home/user/Work", "/home/user/Work"), true);
});

test("isSessionInSandbox returns false for cwd outside sandbox", () => {
  assert.equal(isSessionInSandbox("/home/user/personal", "/home/user/Work"), false);
});

test("isSessionInSandbox returns false for null cwd", () => {
  assert.equal(isSessionInSandbox(null, "/home/user/Work"), false);
});

test("isSessionInSandbox returns false for empty cwd", () => {
  assert.equal(isSessionInSandbox("", "/home/user/Work"), false);
});

test("isSessionInSandbox returns false for null sandbox (setup incomplete)", () => {
  assert.equal(isSessionInSandbox("/home/user/Work/acme", null), false);
});

test("isSessionInSandbox returns false for empty sandbox", () => {
  assert.equal(isSessionInSandbox("/home/user/Work/acme", ""), false);
});

test("isSessionInSandbox with sandbox '/' allows all absolute paths", () => {
  assert.equal(isSessionInSandbox("/home/user/anything", "/"), true);
  assert.equal(isSessionInSandbox("/tmp/test", "/"), true);
});

test("isSessionInSandbox rejects prefix-match without path separator", () => {
  assert.equal(isSessionInSandbox("/home/user/Workspace-evil", "/home/user/Workspace"), false);
});

test("isSessionInSandbox handles trailing slashes", () => {
  assert.equal(isSessionInSandbox("/home/user/Work/acme", "/home/user/Work/"), true);
});

// ---------------------------------------------------------------------------
// FEA-1407: sanitizeSessionForSync
// ---------------------------------------------------------------------------

test("sanitizeSessionForSync strips content fields", () => {
  const session = {
    externalSessionId: "sess-1",
    status: "completed",
    startedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T01:00:00Z",
    metadata: { key: "secret-value" },
    agents: [
      {
        externalAgentId: "agent-1",
        name: "main",
        type: "main",
        status: "completed",
        task: "implement the feature with secret credentials",
        metadata: { internal: "data" },
      },
    ],
    events: [
      {
        externalEventId: "1",
        eventType: "UserPromptSubmit",
        toolName: null,
        summary: "user typed a secret API key",
        data: { content: "sk-secret-key-12345" },
        createdAt: "2026-01-01T00:01:00Z",
      },
      {
        externalEventId: "2",
        eventType: "PreToolUse",
        toolName: "Read",
        summary: "read .env file containing passwords",
        data: { path: "/home/user/.env", content: "DB_PASSWORD=hunter2" },
        createdAt: "2026-01-01T00:02:00Z",
      },
    ],
    tokenUsageByModel: [
      {
        model: "claude-opus-4-6",
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheWriteTokens: 100,
        estimatedCostUsd: 0.05,
      },
    ],
  };

  const sanitized = sanitizeSessionForSync(session as any);

  // agent.task is stripped (contains user prompt)
  assert.equal(sanitized.agents[0].task, null, "agent task should be null");

  // content/stdout/stderr leaves are stripped recursively, other data keys preserved
  assert.equal(sanitized.events[0].data, null, "event with only content should be null");
  assert.deepEqual(sanitized.events[1].data, { path: "/home/user/.env" }, "non-content data keys preserved");

  // everything else is kept
  assert.deepEqual(sanitized.metadata, { key: "secret-value" }, "session metadata preserved");
  assert.deepEqual(sanitized.agents[0].metadata, { internal: "data" }, "agent metadata preserved");
  assert.equal(sanitized.events[0].summary, "user typed a secret API key", "event summary preserved");
  assert.equal(sanitized.events[1].summary, "read .env file containing passwords", "event summary preserved");
  assert.equal(sanitized.externalSessionId, "sess-1", "session ID preserved");
  assert.equal(sanitized.status, "completed", "status preserved");
  assert.equal(sanitized.events[0].eventType, "UserPromptSubmit", "eventType preserved");
  assert.equal(sanitized.events[1].toolName, "Read", "toolName preserved");
  assert.equal(sanitized.events[0].createdAt, "2026-01-01T00:01:00Z", "createdAt preserved");
  assert.equal(sanitized.tokenUsageByModel[0].inputTokens, 1000, "token usage preserved");
  assert.equal(sanitized.tokenUsageByModel[0].estimatedCostUsd, 0.05, "cost preserved");
  assert.equal(sanitized.agents[0].externalAgentId, "agent-1", "agent ID preserved");
  assert.equal(sanitized.agents[0].name, "main", "agent name preserved");
  assert.equal(sanitized.agents[0].status, "completed", "agent status preserved");
});

test("sanitizeSessionForSync does not mutate the original session", () => {
  const session = {
    externalSessionId: "sess-orig",
    status: "active",
    startedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T01:00:00Z",
    metadata: { secret: true },
    agents: [{ externalAgentId: "a1", name: "main", type: "main", status: "active", task: "secret task", metadata: { x: 1 } }],
    events: [{ externalEventId: "1", eventType: "Test", toolName: null, summary: "kept", data: { content: "stripped", other: "kept" }, createdAt: "2026-01-01T00:00:00Z" }],
    tokenUsageByModel: [],
  };

  sanitizeSessionForSync(session as any);

  assert.equal(session.agents[0].task, "secret task", "original agent task unchanged");
  assert.deepEqual(session.events[0].data, { content: "stripped", other: "kept" }, "original event data unchanged");
});

test("sanitizeSessionForSync preserves data without content key", () => {
  const session = {
    externalSessionId: "sess-nocontent",
    status: "active",
    startedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T01:00:00Z",
    agents: [],
    events: [{ externalEventId: "1", eventType: "Test", toolName: "Bash", summary: "ran command", data: { command: "git status", cwd: "/home/user" }, createdAt: "2026-01-01T00:00:00Z" }],
    tokenUsageByModel: [],
  };

  const sanitized = sanitizeSessionForSync(session as any);

  assert.deepEqual(sanitized.events[0].data, { command: "git status", cwd: "/home/user" }, "data without content key is fully preserved");
});

test("sanitizeSessionForSync strips content/stdout/stderr recursively inside tool_response", () => {
  const session = {
    externalSessionId: "sess-recursive",
    status: "completed",
    startedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T01:00:00Z",
    agents: [],
    events: [
      {
        externalEventId: "1", eventType: "PostToolUse", toolName: "Read",
        summary: "File read",
        data: {
          tool_name: "Read",
          tool_response: { type: "text", file: { filePath: "/app/.env", content: "DB_PASSWORD=secret" } },
        },
        createdAt: "2026-01-01T00:01:00Z",
      },
      {
        externalEventId: "2", eventType: "PostToolUse", toolName: "Bash",
        summary: "Command ran",
        data: {
          tool_name: "Bash",
          tool_response: { stdout: "secret output", stderr: "secret errors", interrupted: false, isImage: false },
        },
        createdAt: "2026-01-01T00:02:00Z",
      },
    ],
    tokenUsageByModel: [],
  };

  const sanitized = sanitizeSessionForSync(session as any);

  assert.deepEqual(sanitized.events[0].data, {
    tool_name: "Read",
    tool_response: { type: "text", file: { filePath: "/app/.env" } },
  }, "Read: content stripped, filePath and type preserved");

  assert.deepEqual(sanitized.events[1].data, {
    tool_name: "Bash",
    tool_response: { interrupted: false, isImage: false },
  }, "Bash: stdout/stderr stripped, structural keys preserved");
});
