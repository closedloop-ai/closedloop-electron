import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const require = createRequire(import.meta.url);

type ParsedTurnDuration = {
  durationMs: number;
  timestamp: string;
};

type ParsedToolUse = {
  name: string;
};

type ParsedMultiHarnessSession = {
  sessionId: string;
  name: string;
  cwd: string | null;
  model: string | null;
  version: string | null;
  userMessages: number;
  assistantMessages: number;
  toolUses: ParsedToolUse[];
  thinkingBlockCount: number;
  turnDurations: ParsedTurnDuration[];
  entrypoint: string;
  startedAt: string;
  endedAt: string;
  tokensByModel: Record<
    string,
    {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    }
  >;
};

const copilotHome = require("../scripts/agent-monitor-copilot/copilot-home.js") as {
  workspacePathFromUri: (folder: string) => string | null;
};
const copilotParser = require("../scripts/agent-monitor-copilot/copilot-parser.js") as {
  parseChatSessionFile: (
    filePath: string,
    workspacePath: string | null,
  ) => ParsedMultiHarnessSession | null;
};
const codexParser = require("../scripts/agent-monitor-codex/codex-parser.js") as Record<string, unknown>;
const cursorParser = require("../scripts/agent-monitor-cursor/cursor-parser.js") as Record<string, unknown>;
const cursorTranscriptParser = cursorParser as {
  parseTranscriptFile: (filePath: string) => Promise<ParsedMultiHarnessSession | null>;
};
const opencodeParser = require("../scripts/agent-monitor-opencode/opencode-parser.js") as {
  loadSessionsFromDb: (dbPath: string) => ParsedMultiHarnessSession[];
};

test("Copilot workspace file URIs decode to filesystem paths", () => {
  assert.equal(
    copilotHome.workspacePathFromUri("file:///Users/dev/my%20project"),
    "/Users/dev/my project",
  );
});

test("Copilot Chat parser supports request-based session files", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "copilot-chat-"));
  const filePath = path.join(dir, "session.json");
  writeFileSync(
    filePath,
    JSON.stringify({
      sessionId: "copilot-session-1",
      creationDate: 1710000000000,
      lastMessageDate: 1710000060000,
      requests: [
        {
          id: "req-1",
          timestamp: 1710000000000,
          message: { text: "Summarize the repo" },
          response: { markdown: "Here is the summary." },
          toolCalls: [{ name: "search", arguments: '{"query":"repo"}' }],
          reasoning: { summary: "think first" },
        },
      ],
    }),
    "utf8",
  );

  const parsed = copilotParser.parseChatSessionFile(filePath, "/Users/dev/my project");
  assert.ok(parsed, "expected a parsed Copilot chat session");
  assert.equal(parsed.sessionId, "copilot-chat-copilot-session-1");
  assert.equal(parsed.name, "my project (copilot)");
  assert.equal(parsed.userMessages, 1);
  assert.equal(parsed.assistantMessages, 1);
  assert.equal(parsed.toolUses.length, 1);
  assert.equal(parsed.toolUses[0].name, "search");
  assert.equal(parsed.thinkingBlockCount, 1);
  assert.deepEqual(parsed.turnDurations, [
    {
      durationMs: 60_000,
      timestamp: "2024-03-09T16:01:00.000Z",
    },
  ]);
  assert.equal(parsed.entrypoint, "copilot");
  assert.equal(parsed.startedAt, "2024-03-09T16:00:00.000Z");
  assert.equal(parsed.endedAt, "2024-03-09T16:01:00.000Z");
});

test("OpenCode parser loads sessions from opencode.db", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "opencode-db-"));
  const dbPath = path.join(dir, "opencode.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      slug TEXT,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      agent TEXT,
      model TEXT,
      permission TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      tokens_input INTEGER DEFAULT 0 NOT NULL,
      tokens_output INTEGER DEFAULT 0 NOT NULL,
      tokens_reasoning INTEGER DEFAULT 0 NOT NULL,
      tokens_cache_read INTEGER DEFAULT 0 NOT NULL,
      tokens_cache_write INTEGER DEFAULT 0 NOT NULL
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);

  db.prepare(`
    INSERT INTO session (
      id, slug, directory, title, version, agent, model, permission,
      time_created, time_updated, tokens_input, tokens_output,
      tokens_reasoning, tokens_cache_read, tokens_cache_write
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "ses_1",
    "quiet-orchid",
    "/Users/dev/my project",
    "Repo overview",
    "1.15.5",
    "build",
    JSON.stringify({ id: "big-pickle", providerID: "opencode" }),
    "",
    1710000000000,
    1710000060000,
    100,
    20,
    5,
    40,
    0,
  );
  db.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    "msg_1",
    "ses_1",
    1710000000000,
    1710000000000,
    JSON.stringify({
      role: "user",
      time: { created: 1710000000000 },
    }),
  );
  db.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    "msg_2",
    "ses_1",
    1710000030000,
    1710000030000,
    JSON.stringify({
      role: "assistant",
      path: { cwd: "/Users/dev/my project", root: "/Users/dev/my project" },
      time: { created: 1710000030000 },
    }),
  );
  db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "part_1",
    "msg_2",
    "ses_1",
    1710000020000,
    1710000021000,
    JSON.stringify({
      type: "reasoning",
      text: "Think first",
      time: { start: 1710000020000, end: 1710000021000 },
    }),
  );
  db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "part_2",
    "msg_2",
    "ses_1",
    1710000025000,
    1710000026000,
    JSON.stringify({
      type: "tool",
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "/Users/dev/my project/README.md" },
      },
      time: { start: 1710000025000, end: 1710000026000 },
    }),
  );
  db.close();

  const sessions = opencodeParser.loadSessionsFromDb(dbPath);
  assert.equal(sessions.length, 1);
  const parsed = sessions[0];
  assert.equal(parsed.sessionId, "opencode-ses_1");
  assert.equal(parsed.cwd, "/Users/dev/my project");
  assert.equal(parsed.name, "my project (opencode)");
  assert.equal(parsed.model, "big-pickle");
  assert.equal(parsed.version, "1.15.5");
  assert.equal(parsed.userMessages, 1);
  assert.equal(parsed.assistantMessages, 1);
  assert.equal(parsed.toolUses.length, 1);
  assert.equal(parsed.toolUses[0].name, "read");
  assert.equal(parsed.thinkingBlockCount, 1);
  assert.deepEqual(parsed.turnDurations, [
    {
      durationMs: 30_000,
      timestamp: "2024-03-09T16:00:30.000Z",
    },
  ]);
  assert.deepEqual(parsed.tokensByModel["big-pickle"], {
    input: 100,
    output: 25,
    cacheRead: 40,
    cacheWrite: 0,
  });
});

test("Cursor parser derives turn durations from user/assistant timestamps", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cursor-transcript-"));
  const sessionDir = path.join(dir, "session-123");
  mkdirSync(sessionDir, { recursive: true });
  const filePath = path.join(sessionDir, "rollout.jsonl");
  writeFileSync(
    filePath,
    [
      {
        timestamp: "2024-03-09T16:00:00.000Z",
        type: "session_meta",
        payload: {
          cwd: "/Users/dev/cursor project",
          model: "claude-3-7-sonnet",
        },
      },
      {
        timestamp: "2024-03-09T16:00:05.000Z",
        type: "user_message",
        payload: { message: "Investigate failing test" },
      },
      {
        timestamp: "2024-03-09T16:00:11.500Z",
        type: "assistant_message",
        payload: { message: "Looking now" },
      },
    ].map((line) => JSON.stringify(line)).join("\n"),
    "utf8",
  );

  const parsed = await cursorTranscriptParser.parseTranscriptFile(filePath);
  assert.ok(parsed, "expected a parsed Cursor transcript");
  assert.deepEqual(parsed.turnDurations, [
    {
      durationMs: 6_500,
      timestamp: "2024-03-09T16:00:11.500Z",
    },
  ]);
});

test("multi-harness parsers no longer re-export shared timestamp helpers", () => {
  assert.equal("toIso" in codexParser, false);
  assert.equal("toIso" in cursorParser, false);
  assert.equal("toIso" in copilotParser, false);
  assert.equal("toIso" in opencodeParser, false);
  assert.equal("pushTurnDuration" in codexParser, false);
  assert.equal("pushTurnDuration" in cursorParser, false);
  assert.equal("pushTurnDuration" in copilotParser, false);
  assert.equal("pushTurnDuration" in opencodeParser, false);
});
