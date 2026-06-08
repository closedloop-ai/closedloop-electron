import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AgentSessionSyncService,
  sanitizeSessionForSync,
  type AgentSessionSyncSource,
} from "../src/main/agent-session-sync-service.js";
import type {
  AgentSessionSyncBatch,
  SyncedAgentSession,
} from "../src/main/agent-session-sync-contract.js";

test("agent-session sync sends all source sessions and sanitizes event content", async () => {
  const sourceSession = makeSyncedSession();
  const source: AgentSessionSyncSource = {
    listAllSessionCursorRows: () => [
      { id: sourceSession.externalSessionId, updated_at: sourceSession.updatedAt },
    ],
    listUpdatedSessionCursorRows: () => [],
    loadSyncedSessions: () => [sourceSession],
  };
  const sent: AgentSessionSyncBatch[] = [];
  const service = new AgentSessionSyncService({
    isAgentMonitorEnabled: () => true,
    isRelayReady: () => true,
    getSource: () => source,
    sendBatch: async (batch) => {
      sent.push(batch);
      return { accepted: true };
    },
  });

  service.start();
  await flushAgentSessionSync();
  service.stop();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].sessions[0].externalSessionId, "outside-sandbox");
  assert.equal(sent[0].sessions[0].cwd, "/outside/sandbox/project");
  assert.deepEqual(sent[0].sessions[0].events[0].data, {
    exitCode: 0,
    nested: { safe: "preserved" },
  });
});

test("sanitizeSessionForSync strips content-bearing keys recursively", () => {
  const sanitized = sanitizeSessionForSync(makeSyncedSession());
  const data = sanitized.events[0].data as Record<string, unknown>;

  for (const key of ["prompt", "content", "stdout", "stderr", "text", "output", "reasoning"]) {
    assert.equal(Object.hasOwn(data, key), false, `${key} must be stripped`);
  }
  assert.deepEqual(data.nested, { safe: "preserved" });
});

function makeSyncedSession(): SyncedAgentSession {
  return {
    externalSessionId: "outside-sandbox",
    status: "completed",
    harness: "codex",
    cwd: "/outside/sandbox/project",
    startedAt: "2026-06-08T12:00:00.000Z",
    updatedAt: "2026-06-08T12:05:00.000Z",
    agents: [],
    events: [
      {
        externalEventId: "event-1",
        eventType: "PostToolUse",
        toolName: "Bash",
        createdAt: "2026-06-08T12:01:00.000Z",
        data: {
          prompt: "run private command",
          content: "file contents",
          stdout: "command output",
          stderr: "command errors",
          text: "assistant text",
          output: "tool output",
          reasoning: "hidden reasoning",
          exitCode: 0,
          nested: {
            prompt: "nested prompt",
            content: "nested content",
            stdout: "nested stdout",
            stderr: "nested stderr",
            text: "nested text",
            output: "nested output",
            reasoning: "nested reasoning",
            safe: "preserved",
          },
        },
      },
    ],
    tokenUsageByModel: [],
  };
}

async function flushAgentSessionSync(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}
