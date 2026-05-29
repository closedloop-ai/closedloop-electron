// Cursor parser contract test. Asserts the parser reads a minimal
// Cursor JSONL transcript and produces the expected normalized session
// shape consumed by importSession().

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Cursor parser is CommonJS but apps/desktop has type:module — same dodge
// as codex-parser.contract.test.mjs: load the build-pipeline-copied version
// in .generated/agent-monitor/server/lib/ where there's no surrounding
// type:module.
const GENERATED_PARSER = join(
  HERE,
  "..",
  "..",
  "..",
  "..",
  ".generated",
  "agent-monitor",
  "server",
  "lib",
  "cursor-parser.js",
);
const parserModule = require(GENERATED_PARSER);
const FIXTURE = join(
  HERE,
  "..",
  "..",
  "fixtures",
  "parsers",
  "cursor",
  "transcript-fixture-cursor-session-aa11.jsonl",
);

test("Cursor parser · minimal transcript produces normalized session", async () => {
  const result = await parserModule.parseTranscriptFile(FIXTURE);
  assert.ok(result, "parser returned null — should produce a session");

  assert.equal(result.entrypoint, "cursor", "entrypoint must be 'cursor'");
  assert.equal(result.cwd, "/Users/dev/repo");
  assert.equal(result.model, "claude-sonnet-4");
  assert.equal(result.gitBranch, "main");
  assert.equal(result.version, "0.42.0");

  // 1 user message + 2 assistant messages in fixture
  assert.equal(result.userMessages, 1);
  assert.equal(result.assistantMessages, 2);

  // 2 tool calls in fixture
  assert.equal(result.toolUses.length, 2);
  assert.equal(result.toolUses[0].name, "read_file");
  assert.equal(result.toolUses[1].name, "edit_file");

  // Token usage from the `usage` record
  const tokens = result.tokensByModel["claude-sonnet-4"];
  assert.ok(tokens, "tokensByModel should have an entry for claude-sonnet-4");
  assert.equal(tokens.input, 1200);
  assert.equal(tokens.output, 340);
  assert.equal(tokens.cacheRead, 5000);
  assert.equal(tokens.cacheWrite, 800);

  // Time bounds derived from first/last timestamp
  assert.equal(result.startedAt, "2026-05-20T10:00:00.000Z");
  assert.equal(result.endedAt, "2026-05-20T10:00:25.000Z");
});

test("Cursor parser · idempotent — re-parsing returns the same shape", async () => {
  const a = await parserModule.parseTranscriptFile(FIXTURE);
  const b = await parserModule.parseTranscriptFile(FIXTURE);
  // Strip fileModifiedAt (non-deterministic) before comparing.
  delete a.fileModifiedAt;
  delete b.fileModifiedAt;
  assert.deepEqual(a, b);
});
