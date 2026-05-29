// Copilot parser contract test. Asserts the Copilot chat-session parser
// produces the expected normalized session shape from a minimal VS Code
// workspaceStorage-style JSON file.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const parserModule = require(
  join(
    HERE,
    "..",
    "..",
    "..",
    "..",
    ".generated",
    "agent-monitor",
    "server",
    "lib",
    "copilot-parser.js",
  ),
);

const FIXTURE = join(
  HERE,
  "..",
  "..",
  "fixtures",
  "parsers",
  "copilot",
  "chat-session-fixture-copilot-bb22.json",
);

test("Copilot parser · minimal chat session produces normalized session", () => {
  const result = parserModule.parseChatSessionFile(FIXTURE, "/workspace");
  assert.ok(result, "parser returned null — should produce a session");

  assert.equal(result.entrypoint, "copilot", "entrypoint must be 'copilot'");
  assert.equal(result.sessionId, "copilot-chat-fixture-copilot-bb22");

  // 2 requests = 2 user messages + 2 assistant messages
  assert.equal(result.userMessages, 2);
  assert.equal(result.assistantMessages, 2);

  // 2 tool calls in the second request
  assert.equal(result.toolUses.length, 2);
  assert.equal(result.toolUses[0].name, "read_file");
  assert.equal(result.toolUses[1].name, "edit_file");

  // Token totals: sum across both requests
  // Default model bucket key — parser uses "copilot" or model from data; check via
  // tokensByModel object as the source of truth.
  const bucketKey = Object.keys(result.tokensByModel)[0];
  assert.ok(bucketKey, "tokensByModel must have at least one bucket");
  const tokens = result.tokensByModel[bucketKey];
  assert.equal(tokens.input, 600 + 800); // 1400
  assert.equal(tokens.output, 220 + 350); // 570
  assert.equal(tokens.cacheRead, 2000 + 4500); // 6500
  assert.equal(tokens.cacheWrite, 300 + 200); // 500

  // Time bounds
  assert.equal(result.startedAt, "2026-05-20T11:00:05.000Z");
  assert.equal(result.endedAt, "2026-05-20T11:00:25.000Z");
});

test("Copilot parser · idempotent — re-parsing returns the same shape", () => {
  const a = parserModule.parseChatSessionFile(FIXTURE, "/workspace");
  const b = parserModule.parseChatSessionFile(FIXTURE, "/workspace");
  delete a.fileModifiedAt;
  delete b.fileModifiedAt;
  assert.deepEqual(a, b);
});
