/**
 * Unit tests for the vendored Codex rollout parser
 * (vendor/agent-monitor/server/lib/codex-parser.js, CLOSEDLOOP Addition #6).
 *
 * The parser MUST emit the same normalized session shape that Claude's
 * scripts/import-history.js `parseSessionFile` produces, so the shared
 * importSession() renders Codex sessions through the unchanged dashboard.
 * These tests pin that contract against synthesized rollout fixtures (no
 * Codex install / ~/.codex required on the machine running CI).
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { parseRolloutFile } = require(
  "../scripts/agent-monitor-codex/codex-parser.js",
) as {
  parseRolloutFile: (p: string) => Promise<Record<string, unknown> | null>;
};

type ParsedCodexSession = {
  sessionId: string;
  cwd: string | null;
  model: string | null;
  gitBranch: string | null;
  version: string | null;
  name: string;
  entrypoint: string;
  userMessages: number;
  assistantMessages: number;
  thinkingBlockCount: number;
  startedAt: string;
  endedAt: string;
  toolUses: Array<{ name: string }>;
  tokensByModel: Record<
    string,
    {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    }
  >;
  turnDurations: Array<{ durationMs: number; timestamp: string }>;
};

const UUID = "11111111-1111-4111-8111-111111111111";

function writeRollout(name: string, lines: unknown[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "codex-rollout-"));
  const file = path.join(dir, name);
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
  return file;
}

test("parses the modern RolloutLine envelope into the shared session shape", async () => {
  const file = writeRollout(`rollout-2026-05-18T10-00-00-${UUID}.jsonl`, [
    {
      timestamp: "2026-05-18T10:00:00.000Z",
      type: "session_meta",
      payload: {
        id: UUID,
        cwd: "/Users/dev/myproj",
        cli_version: "0.40.0",
        git: { branch: "main" },
      },
    },
    {
      timestamp: "2026-05-18T10:00:01.000Z",
      type: "turn_context",
      payload: { model: "gpt-5-codex", cwd: "/Users/dev/myproj" },
    },
    {
      timestamp: "2026-05-18T10:00:02.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: "fix the bug" },
    },
    {
      timestamp: "2026-05-18T10:00:05.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "on it" }],
      },
    },
    {
      timestamp: "2026-05-18T10:00:06.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell",
        arguments: '{"command":["ls"]}',
        call_id: "c1",
      },
    },
    {
      timestamp: "2026-05-18T10:00:07.000Z",
      type: "response_item",
      payload: { type: "reasoning", summary: [] },
    },
    {
      timestamp: "2026-05-18T10:00:08.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 1200,
            cached_input_tokens: 400,
            output_tokens: 300,
            reasoning_output_tokens: 50,
            total_tokens: 1950,
          },
        },
        turn_context: { model: "gpt-5-codex" },
      },
    },
  ]);

  const s = (await parseRolloutFile(file)) as ParsedCodexSession;
  assert.ok(s, "expected a parsed session");
  assert.equal(s.sessionId, UUID);
  assert.equal(s.cwd, "/Users/dev/myproj");
  assert.equal(s.model, "gpt-5-codex");
  assert.equal(s.gitBranch, "main");
  assert.equal(s.version, "0.40.0");
  assert.equal(s.name, "myproj (codex)");
  assert.equal(s.entrypoint, "codex");
  assert.equal(s.userMessages, 1);
  assert.equal(s.assistantMessages, 1);
  assert.equal(s.thinkingBlockCount, 1);
  assert.equal(s.startedAt, "2026-05-18T10:00:00.000Z");
  assert.equal(s.endedAt, "2026-05-18T10:00:08.000Z");
  assert.equal(s.toolUses.length, 1);
  assert.equal(s.toolUses[0].name, "shell");
  // Cumulative token_count → session totals; reasoning folds into output.
  assert.deepEqual(s.tokensByModel["gpt-5-codex"], {
    input: 1200,
    output: 350,
    cacheRead: 400,
    cacheWrite: 0,
  });
  assert.deepEqual(s.turnDurations, [
    {
      durationMs: 3000,
      timestamp: "2026-05-18T10:00:05.000Z",
    },
  ]);
  // Shape parity with the Claude parser (fields importSession reads).
  for (const k of [
    "messageTimestamps",
    "compactions",
    "apiErrors",
    "turnDurations",
    "toolResultErrors",
    "usageExtras",
    "teams",
  ]) {
    assert.ok(k in s, `missing normalized field: ${k}`);
  }
});

test("tolerates bare/legacy records (no envelope, no timestamp on items)", async () => {
  const file = writeRollout(`rollout-legacy-${UUID}.jsonl`, [
    { session_id: UUID, cwd: "/x", timestamp: "2026-05-18T09:00:00.000Z" },
    { type: "message", role: "user", content: "hi" },
    { type: "function_call", name: "apply_patch", arguments: "{}" },
  ]);
  const s = (await parseRolloutFile(file)) as ParsedCodexSession;
  assert.ok(s);
  assert.equal(s.cwd, "/x");
  assert.equal(s.userMessages, 1);
  assert.equal(s.toolUses.length, 1);
  assert.equal(s.toolUses[0].name, "apply_patch");
});

test("returns null when the file has no usable timestamp", async () => {
  const file = writeRollout(`rollout-empty-${UUID}.jsonl`, [
    { type: "event_msg", payload: { type: "agent_message_delta", delta: "x" } },
    "not json at all",
  ]);
  const s = await parseRolloutFile(file);
  assert.equal(s, null);
});
