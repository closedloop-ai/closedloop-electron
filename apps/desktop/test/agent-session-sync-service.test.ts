import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  AgentSessionSyncService,
  estimateTokenUsageCostUsd,
  listAllSessionCursorRows,
  listUpdatedSessionCursorRows,
  loadSyncedSessions,
} from "../src/main/agent-session-sync-service.js";
import { DesktopAgentSessionsAckReason } from "../src/main/cloud-protocol.js";

function createServiceTestDatabase(rootDir: string): DatabaseSync {
  const userDataDir = path.join(rootDir, "user-data");
  mkdirSync(path.join(userDataDir, "agent-monitor"), { recursive: true });
  const db = new DatabaseSync(
    path.join(userDataDir, "agent-monitor", "dashboard.db"),
  );
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
      harness TEXT NOT NULL
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
      baseline_input INTEGER NOT NULL DEFAULT 0,
      baseline_output INTEGER NOT NULL DEFAULT 0,
      baseline_cache_read INTEGER NOT NULL DEFAULT 0,
      baseline_cache_write INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE model_pricing (
      model_pattern TEXT PRIMARY KEY,
      input_per_mtok REAL NOT NULL DEFAULT 0,
      output_per_mtok REAL NOT NULL DEFAULT 0,
      cache_read_per_mtok REAL NOT NULL DEFAULT 0,
      cache_write_per_mtok REAL NOT NULL DEFAULT 0
    );
  `);
  return db;
}

function insertSessionRow(
  db: DatabaseSync,
  session: {
    id: string;
    startedAt: string;
    updatedAt: string;
    status?: string;
    harness?: string;
  },
): void {
  db.prepare(`
    INSERT INTO sessions (
      id, name, status, cwd, model, started_at, updated_at, ended_at,
      awaiting_input_since, metadata, harness
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id,
    session.id,
    session.status ?? "active",
    null,
    null,
    session.startedAt,
    session.updatedAt,
    null,
    null,
    null,
    session.harness ?? "claude",
  );
}

async function flushAgentSessionSync(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

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
      harness TEXT NOT NULL
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
      baseline_input INTEGER NOT NULL DEFAULT 0,
      baseline_output INTEGER NOT NULL DEFAULT 0,
      baseline_cache_read INTEGER NOT NULL DEFAULT 0,
      baseline_cache_write INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE model_pricing (
      model_pattern TEXT PRIMARY KEY,
      input_per_mtok REAL NOT NULL DEFAULT 0,
      output_per_mtok REAL NOT NULL DEFAULT 0,
      cache_read_per_mtok REAL NOT NULL DEFAULT 0,
      cache_write_per_mtok REAL NOT NULL DEFAULT 0
    );
  `);

  db.prepare(`
    INSERT INTO sessions (
      id, name, status, cwd, model, started_at, updated_at, ended_at,
      awaiting_input_since, metadata, harness
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  db.prepare(`
    INSERT INTO token_usage (
      session_id, model, input_tokens, output_tokens, cache_read_tokens,
      cache_write_tokens, baseline_input, baseline_output, baseline_cache_read,
      baseline_cache_write
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("sess-1", "gpt-4.1", 1000, 500, 250, 100, 25, 10, 5, 0);

  db.prepare(`
    INSERT INTO model_pricing (
      model_pattern, input_per_mtok, output_per_mtok, cache_read_per_mtok,
      cache_write_per_mtok
    ) VALUES (?, ?, ?, ?, ?)
  `).run("gpt-4.1%", 2, 8, 0.5, 1);

  const sessions = loadSyncedSessions(db, ["sess-1"]);
  assert.equal(sessions.length, 1);

  const session = sessions[0];
  assert.equal(session.externalSessionId, "sess-1");
  assert.equal(session.harness, "codex");
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
  assert.equal(session.tokenUsageByModel[0].estimatedCostUsd, 0.006358);

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

test("agent-session sync cost estimator falls back to zero without pricing", () => {
  assert.equal(
    estimateTokenUsageCostUsd(
      {
        session_id: "sess-1",
        model: "unknown-model",
        input_tokens: 100,
        output_tokens: 50,
        cache_read_tokens: 25,
        cache_write_tokens: 10,
      },
      [],
    ),
    0,
  );
});
