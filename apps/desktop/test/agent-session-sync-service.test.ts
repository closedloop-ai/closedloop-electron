import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AgentSessionSyncService,
  MAX_CONSECUTIVE_RATE_LIMITED,
  MAX_CONSECUTIVE_TIMEOUTS,
  RATE_LIMIT_BACKOFF_MS,
  SESSION_PAYLOAD_BYTE_CAP,
  type AgentSessionSyncSource,
} from "../src/main/agent-session-sync-service.js";
import type {
  AgentSessionSyncBatch,
  SyncedAgentSession,
} from "../src/main/agent-session-sync-contract.js";
import { DesktopAgentSessionsAckReason } from "../src/main/cloud-protocol.js";

test("agent-session sync batches source sessions and dequeues accepted backfill", async () => {
  const source = new FakeSyncSource([
    makeSyncedSession("session-1", "2026-06-08T12:01:00.000Z"),
    makeSyncedSession("session-2", "2026-06-08T12:02:00.000Z"),
    makeSyncedSession("session-3", "2026-06-08T12:03:00.000Z"),
    makeSyncedSession("session-4", "2026-06-08T12:04:00.000Z"),
  ]);
  const sent: AgentSessionSyncBatch[] = [];
  const service = makeService(source, async (batch) => {
    sent.push(batch);
    return { accepted: true };
  });

  service.start();
  await flushAgentSessionSync();
  service.refresh();
  await flushAgentSessionSync();
  service.stop();

  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].sessions.map((session) => session.externalSessionId), [
    "session-4",
    "session-3",
    "session-2",
  ]);
  assert.deepEqual(sent[1].sessions.map((session) => session.externalSessionId), [
    "session-1",
  ]);
});

test("agent-session sync chunks oversized sessions and sends remaining chunks before dequeue", async () => {
  const source = new FakeSyncSource([makeOversizedSession("oversized")]);
  const sent: AgentSessionSyncBatch[] = [];
  const service = makeService(source, async (batch) => {
    sent.push(batch);
    return { accepted: true };
  });

  service.start();
  await flushAgentSessionSync();
  service.refresh();
  await flushAgentSessionSync();
  service.refresh();
  await flushAgentSessionSync();
  service.stop();

  assert.ok(sent.length >= 2, "expected oversized payload to be split");
  assert.ok(
    sent.every((batch) => batch.sessions.length === 1),
    "chunked batches carry one session chunk",
  );
  assert.ok(
    sent.every((batch) => Buffer.byteLength(JSON.stringify(batch.sessions[0])) <= SESSION_PAYLOAD_BYTE_CAP),
    "every chunk stays under the payload cap",
  );
  assert.deepEqual(
    sent.map((batch) => batch.sessions[0].externalSessionId),
    Array.from({ length: sent.length }, () => "oversized"),
  );
});

test("agent-session sync drops validation_failed sessions to avoid permanent stalls", async () => {
  const source = new FakeSyncSource([
    makeSyncedSession("invalid-session", "2026-06-08T12:00:00.000Z"),
  ]);
  let attempts = 0;
  const service = makeService(source, async () => {
    attempts += 1;
    return {
      accepted: false,
      reason: DesktopAgentSessionsAckReason.ValidationFailed,
    };
  });

  service.start();
  await flushAgentSessionSync();
  service.refresh();
  await flushAgentSessionSync();
  service.stop();

  assert.equal(attempts, 1);
});

test("agent-session sync dead-letters repeated ack timeouts", async () => {
  const source = new FakeSyncSource([
    makeSyncedSession("timeout-session", "2026-06-08T12:00:00.000Z"),
  ]);
  let attempts = 0;
  const service = makeService(source, async () => {
    attempts += 1;
    return {
      accepted: false,
      reason: DesktopAgentSessionsAckReason.AckTimeout,
    };
  });

  service.start();
  await flushAgentSessionSync();
  for (let i = 1; i < MAX_CONSECUTIVE_TIMEOUTS; i += 1) {
    service.refresh();
    await flushAgentSessionSync();
  }
  service.refresh();
  await flushAgentSessionSync();
  service.stop();

  assert.equal(attempts, MAX_CONSECUTIVE_TIMEOUTS);
});

test("agent-session sync dead-letters repeated server rate limits", async () => {
  const source = new FakeSyncSource([
    makeSyncedSession("rate-limited-session", "2026-06-08T12:00:00.000Z"),
  ]);
  let attempts = 0;
  const service = makeService(source, async () => {
    attempts += 1;
    return {
      accepted: false,
      reason: DesktopAgentSessionsAckReason.RateLimited,
    };
  });

  const realNow = Date.now;
  try {
    let virtualNow = realNow();
    Date.now = () => virtualNow;
    service.start();
    await flushAgentSessionSync();
    for (let i = 1; i < MAX_CONSECUTIVE_RATE_LIMITED; i += 1) {
      virtualNow += RATE_LIMIT_BACKOFF_MS + 1;
      service.refresh();
      await flushAgentSessionSync();
    }
    virtualNow += RATE_LIMIT_BACKOFF_MS + 1;
    service.refresh();
    await flushAgentSessionSync();
  } finally {
    Date.now = realNow;
    service.stop();
  }

  assert.equal(attempts, MAX_CONSECUTIVE_RATE_LIMITED);
});

test("agent-session sync lets healthy siblings pass a rate-limited queue head", async () => {
  const source = new FakeSyncSource([
    makeSyncedSession("stuck-session", "2026-06-08T12:00:00.000Z"),
  ]);
  const accepted: string[] = [];
  const service = makeService(source, async (batch) => {
    const ids = batch.sessions.map((session) => session.externalSessionId);
    if (ids.includes("stuck-session")) {
      return {
        accepted: false,
        reason: DesktopAgentSessionsAckReason.RateLimited,
      };
    }
    accepted.push(...ids);
    return { accepted: true };
  });

  service.start();
  await flushAgentSessionSync();
  source.upsert(makeSyncedSession("healthy-session", "2026-06-08T12:05:00.000Z"));
  service.refresh();
  await flushAgentSessionSync();
  service.stop();

  assert.deepEqual(accepted, ["healthy-session"]);
});

test("agent-session sync picks up new sessions added at the current top timestamp", async () => {
  const topTimestamp = "2026-06-08T12:00:00.000Z";
  const source = new FakeSyncSource([
    makeSyncedSession("existing-a", topTimestamp),
    makeSyncedSession("existing-b", topTimestamp),
  ]);
  const sent: string[][] = [];
  const service = makeService(source, async (batch) => {
    sent.push(batch.sessions.map((session) => session.externalSessionId));
    return { accepted: true };
  });

  service.start();
  await flushAgentSessionSync();
  source.upsert(makeSyncedSession("new-at-top", topTimestamp));
  service.refresh();
  await flushAgentSessionSync();
  service.stop();

  assert.deepEqual(sent[0], ["existing-b", "existing-a"]);
  assert.deepEqual(sent[1], ["new-at-top"]);
});

test("agent-session sync pauses after feature_disabled until relay reconnects", async () => {
  const source = new FakeSyncSource([
    makeSyncedSession("feature-disabled-session", "2026-06-08T12:00:00.000Z"),
  ]);
  let relayReady = true;
  let attempts = 0;
  const service = new AgentSessionSyncService({
    isAgentMonitorEnabled: () => true,
    isRelayReady: () => relayReady,
    getSource: () => source,
    sendBatch: async () => {
      attempts += 1;
      return attempts === 1
        ? {
            accepted: false,
            reason: DesktopAgentSessionsAckReason.FeatureDisabled,
          }
        : { accepted: true };
    },
  });

  service.start();
  await flushAgentSessionSync();
  service.refresh();
  await flushAgentSessionSync();
  assert.equal(attempts, 1);

  relayReady = false;
  service.refresh();
  await flushAgentSessionSync();
  relayReady = true;
  service.refresh();
  await flushAgentSessionSync();
  service.stop();

  assert.equal(attempts, 2);
});

class FakeSyncSource implements AgentSessionSyncSource {
  private readonly sessions = new Map<string, SyncedAgentSession>();

  constructor(sessions: SyncedAgentSession[]) {
    for (const session of sessions) {
      this.upsert(session);
    }
  }

  upsert(session: SyncedAgentSession): void {
    this.sessions.set(session.externalSessionId, session);
  }

  listAllSessionCursorRows() {
    return this.cursorRows();
  }

  listUpdatedSessionCursorRows(sinceUpdatedAt: string) {
    return this.cursorRows().filter((row) => row.updated_at >= sinceUpdatedAt);
  }

  loadSyncedSessions(ids: string[]) {
    return ids
      .map((id) => this.sessions.get(id))
      .filter((session): session is SyncedAgentSession => Boolean(session));
  }

  private cursorRows() {
    return [...this.sessions.values()]
      .map((session) => ({
        id: session.externalSessionId,
        updated_at: session.updatedAt,
      }))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id));
  }
}

function makeService(
  source: AgentSessionSyncSource,
  sendBatch: (batch: AgentSessionSyncBatch) => Promise<{ accepted: true } | { accepted: false; reason: DesktopAgentSessionsAckReason }>,
) {
  return new AgentSessionSyncService({
    isAgentMonitorEnabled: () => true,
    isRelayReady: () => true,
    getSource: () => source,
    sendBatch,
  });
}

function makeSyncedSession(
  id: string,
  updatedAt: string,
  events: SyncedAgentSession["events"] = [],
): SyncedAgentSession {
  return {
    externalSessionId: id,
    status: "completed",
    harness: "codex",
    cwd: `/workspace/${id}`,
    startedAt: "2026-06-08T12:00:00.000Z",
    updatedAt,
    agents: [],
    events,
    tokenUsageByModel: [],
  };
}

function makeOversizedSession(id: string): SyncedAgentSession {
  const events = Array.from({ length: 80 }, (_, index) => ({
    externalEventId: `${id}-event-${index}`,
    eventType: "ToolUse",
    toolName: "Read",
    createdAt: "2026-06-08T12:00:00.000Z",
    data: {
      index,
      safePayload: "x".repeat(6_000),
    },
  }));
  return makeSyncedSession(id, "2026-06-08T12:00:00.000Z", events);
}

async function flushAgentSessionSync(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}
