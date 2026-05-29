// FEA-1461 regression coverage for the dead-letter + per-session backoff
// behavior on persistent `rate_limited` rejections. Mirrors the test fixture
// style of agent-session-sync-service.test.ts (Node native test runner under
// tsx --test, in-memory SQLite for the agent-monitor DB, stubbed `sendBatch`).
//
// Bug shape from FEA-1461: a session that consistently gets `rate_limited`
// from the relay used to fall through to a bare `else` branch — no counter,
// no dead-letter, no dequeue. It would loop forever on the 5s sync tick,
// re-chunking + log-spamming the same oversized payload. These tests assert
// the new behavior: backoff between attempts, dead-letter after
// MAX_CONSECUTIVE_RATE_LIMITED rejections, queue head-of-line cleared.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
  AgentSessionSyncService,
  MAX_CONSECUTIVE_RATE_LIMITED,
  RATE_LIMIT_BACKOFF_MS,
} from "../src/main/agent-session-sync-service.js";
import { DesktopAgentSessionsAckReason } from "../src/main/cloud-protocol.js";

function createTestDb(rootDir: string): DatabaseSync {
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

function insertSession(
  db: DatabaseSync,
  id: string,
  updatedAt = "2026-05-29T12:00:00.000Z",
): void {
  db.prepare(`
    INSERT INTO sessions (
      id, name, status, cwd, model, started_at, updated_at, ended_at,
      awaiting_input_since, metadata, harness
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    id,
    "active",
    "/home/user/Work",
    null,
    updatedAt,
    updatedAt,
    null,
    null,
    null,
    "claude",
  );
}

async function flushAgentSessionSync(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

test("rate_limited: 5 consecutive rejections trigger dead-letter on the 5th", async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "fea1461-deadletter-"));
  const db = createTestDb(rootDir);
  insertSession(db, "sess-stuck");

  let rejectionCount = 0;
  const sentBatches: string[] = [];
  const service = new AgentSessionSyncService({
    isAgentMonitorEnabled: () => true,
    isRelayReady: () => true,
    // Required so the FEA-1407 sandbox filter doesn't drop every candidate
    // before sendBatch runs. "/" allows any cwd through.
    getSandboxBaseDirectory: () => "/",
    sendBatch: async (batch) => {
      sentBatches.push(batch.sessions[0]?.externalSessionId ?? "?");
      rejectionCount += 1;
      return {
        accepted: false,
        reason: DesktopAgentSessionsAckReason.RateLimited,
      };
    },
    getUserDataPath: () => path.join(rootDir, "user-data"),
  });

  service.start();
  await flushAgentSessionSync();

  // After the first rejection the session is deferred, not dead-lettered.
  assert.equal(rejectionCount, 1, "expected one send attempt");

  // Drive the remaining attempts. To bypass the RATE_LIMIT_BACKOFF_MS gate
  // between ticks we have to defeat the per-session backoff — but instrumenting
  // the service's internal map would couple this test to private state. The
  // service's public retry path is `refresh()`. We make the backoff effectively
  // zero by monkey-patching Date.now from inside the test for the duration of
  // the drive loop. This is a narrow, reversible test hook (no source change).
  const realNow = Date.now;
  try {
    let virtualNow = realNow();
    Date.now = () => virtualNow;
    for (let i = 1; i < MAX_CONSECUTIVE_RATE_LIMITED; i++) {
      virtualNow += RATE_LIMIT_BACKOFF_MS + 1; // jump past the backoff window
      service.refresh();
      await flushAgentSessionSync();
    }
  } finally {
    Date.now = realNow;
  }

  // The 5th rejection should have triggered dead-letter; on the next refresh
  // the session must NOT be sent again (dequeued).
  assert.equal(
    rejectionCount,
    MAX_CONSECUTIVE_RATE_LIMITED,
    `expected exactly ${MAX_CONSECUTIVE_RATE_LIMITED} rejections before dead-letter`,
  );

  service.refresh();
  await flushAgentSessionSync();
  assert.equal(
    rejectionCount,
    MAX_CONSECUTIVE_RATE_LIMITED,
    "dead-lettered session must not be re-sent on subsequent ticks",
  );

  service.stop();
  db.close();
});

test("rate_limited: deferred session does not block siblings added later to the queue", async () => {
  // Head-of-line scenario: a session that got rate-limited (and is now in
  // 30s backoff) must NOT prevent a different session — added to the queue
  // afterward — from being picked up by pickReadyCandidates on a subsequent
  // tick. Before FEA-1461, the rate-limited session sat unmoved at the head
  // of the queue and re-attempted every 5s, blocking siblings.
  const rootDir = mkdtempSync(path.join(tmpdir(), "fea1461-headofline-"));
  const db = createTestDb(rootDir);
  // Seed only the stuck session. The healthy session is added AFTER the
  // first tick so it enters via enqueueIncrementalUpdates, avoiding the
  // initial backfill batch (BACKFILL_SESSION_BATCH_SIZE=3) lumping them
  // together — which would cause batch-level deferral instead of the
  // queue-level head-of-line behavior we're testing here.
  insertSession(db, "sess-stuck", "2026-05-29T11:00:00.000Z");

  const acceptedIds: string[] = [];
  const service = new AgentSessionSyncService({
    isAgentMonitorEnabled: () => true,
    isRelayReady: () => true,
    getSandboxBaseDirectory: () => "/",
    sendBatch: async (batch) => {
      const sessionIds = batch.sessions.map((s) => s.externalSessionId);
      if (sessionIds.includes("sess-stuck")) {
        return {
          accepted: false,
          reason: DesktopAgentSessionsAckReason.RateLimited,
        };
      }
      acceptedIds.push(...sessionIds);
      return { accepted: true };
    },
    getUserDataPath: () => path.join(rootDir, "user-data"),
  });

  service.start();
  // First tick: sends sess-stuck alone → rate_limited → defers it for 30s.
  await flushAgentSessionSync();

  // Now add sess-healthy with a strictly-newer updated_at so it shows up on
  // the next incremental sweep. Without the FEA-1461 backoff, the next tick
  // would re-attempt sess-stuck (still at head of backfill queue) and
  // re-fetch / re-rate-limit it.
  insertSession(db, "sess-healthy", "2026-05-29T11:05:00.000Z");
  service.refresh();
  await flushAgentSessionSync();

  // Within the backoff window, sess-stuck is skipped and sess-healthy gets a
  // turn.
  assert.ok(
    acceptedIds.includes("sess-healthy"),
    `sess-healthy must sync while sess-stuck is in rate-limit backoff (saw: ${acceptedIds.join(",")})`,
  );

  service.stop();
  db.close();
});

test("rate_limited: a successful ack between rejections resets the counter", async () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "fea1461-counter-reset-"));
  const db = createTestDb(rootDir);
  insertSession(db, "sess-flapping");

  let rejectThisAttempt = true;
  let totalAttempts = 0;
  const service = new AgentSessionSyncService({
    isAgentMonitorEnabled: () => true,
    isRelayReady: () => true,
    // Required so the FEA-1407 sandbox filter doesn't drop every candidate
    // before sendBatch runs. "/" allows any cwd through.
    getSandboxBaseDirectory: () => "/",
    sendBatch: async () => {
      totalAttempts += 1;
      if (rejectThisAttempt) {
        return {
          accepted: false,
          reason: DesktopAgentSessionsAckReason.RateLimited,
        };
      }
      return { accepted: true };
    },
    getUserDataPath: () => path.join(rootDir, "user-data"),
  });

  service.start();
  await flushAgentSessionSync();

  const realNow = Date.now;
  try {
    let virtualNow = realNow();
    Date.now = () => virtualNow;

    // 3 consecutive rate-limited rejections (under the dead-letter threshold).
    for (let i = 1; i < 3; i++) {
      virtualNow += RATE_LIMIT_BACKOFF_MS + 1;
      service.refresh();
      await flushAgentSessionSync();
    }
    assert.equal(totalAttempts, 3, "expected 3 attempts before successful ack");

    // The relay recovers; the next attempt succeeds. This must reset the
    // rate-limit counter so a subsequent rate-limited rejection starts at 1
    // again (not at 4). Since the session is dequeued after success, we
    // re-insert (bump updated_at) to put it back in the incremental queue.
    rejectThisAttempt = false;
    db.prepare(
      "UPDATE sessions SET updated_at = ? WHERE id = ?",
    ).run("2026-05-29T12:30:00.000Z", "sess-flapping");
    virtualNow += RATE_LIMIT_BACKOFF_MS + 1;
    service.refresh();
    await flushAgentSessionSync();
    assert.equal(totalAttempts, 4, "successful retry should fire");

    // Now reject again — and run MAX-1 more rejections. If the counter
    // reset, we should NOT yet be dead-lettered, so we should still see
    // each rejection coming through (not silently dropped).
    rejectThisAttempt = true;
    db.prepare(
      "UPDATE sessions SET updated_at = ? WHERE id = ?",
    ).run("2026-05-29T12:31:00.000Z", "sess-flapping");
    const attemptsBeforeRound2 = totalAttempts;
    for (let i = 0; i < MAX_CONSECUTIVE_RATE_LIMITED - 1; i++) {
      virtualNow += RATE_LIMIT_BACKOFF_MS + 1;
      service.refresh();
      await flushAgentSessionSync();
    }
    const round2Attempts = totalAttempts - attemptsBeforeRound2;
    assert.equal(
      round2Attempts,
      MAX_CONSECUTIVE_RATE_LIMITED - 1,
      `counter must have reset on success; expected ${MAX_CONSECUTIVE_RATE_LIMITED - 1} retries before next dead-letter, got ${round2Attempts}`,
    );
  } finally {
    Date.now = realNow;
  }

  service.stop();
  db.close();
});

test("AckTimeout dead-letter is unaffected by FEA-1461 changes (regression guard)", async () => {
  // Reuses the timeoutCountById path that existed before FEA-1461. Confirms
  // we didn't accidentally affect the existing dead-letter trip when adding
  // the parallel rate-limited counter.
  const rootDir = mkdtempSync(path.join(tmpdir(), "fea1461-timeout-regression-"));
  const db = createTestDb(rootDir);
  insertSession(db, "sess-timeout");

  let attempts = 0;
  const service = new AgentSessionSyncService({
    isAgentMonitorEnabled: () => true,
    isRelayReady: () => true,
    // Required so the FEA-1407 sandbox filter doesn't drop every candidate
    // before sendBatch runs. "/" allows any cwd through.
    getSandboxBaseDirectory: () => "/",
    sendBatch: async () => {
      attempts += 1;
      return {
        accepted: false,
        reason: DesktopAgentSessionsAckReason.AckTimeout,
      };
    },
    getUserDataPath: () => path.join(rootDir, "user-data"),
  });

  service.start();
  await flushAgentSessionSync();
  // AckTimeout does NOT use the FEA-1461 backoff (different reason path),
  // so refresh() drives consecutive attempts without needing to advance Date.now.
  service.refresh();
  await flushAgentSessionSync();
  service.refresh();
  await flushAgentSessionSync();

  // After MAX_CONSECUTIVE_TIMEOUTS = 3 attempts the session is dead-lettered;
  // a 4th refresh must not produce a 4th attempt.
  assert.equal(attempts, 3, "expected 3 timeout attempts before dead-letter");
  service.refresh();
  await flushAgentSessionSync();
  assert.equal(
    attempts,
    3,
    "AckTimeout dead-letter regression: 4th attempt must NOT fire",
  );

  service.stop();
  db.close();
});
