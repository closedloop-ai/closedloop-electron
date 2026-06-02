// OpenCode parser contract test. OpenCode persists its session data in a
// SQLite DB (session / message / part tables). We construct a minimal
// fixture DB at runtime, run the parser, and assert the normalized session.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { buildOpenCodeFixtureDb } from "../../fixtures/parsers/opencode/build-fixture-db.mjs";

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
    "opencode-parser.js",
  ),
);

test("OpenCode parser · minimal DB produces normalized session", () => {
  const tmp = mkdtempSync(join(tmpdir(), "opencode-fixture-"));
  const dbPath = join(tmp, "opencode.db");
  try {
    buildOpenCodeFixtureDb(dbPath);
    const results = parserModule.loadSessionsFromDb(dbPath);
    assert.equal(results.length, 1, "should produce one session");

    const result = results[0];
    assert.equal(result.entrypoint, "opencode");
    assert.equal(result.sessionId, "opencode-cc33");
    assert.equal(result.cwd, "/Users/dev/repo");
    assert.equal(result.model, "claude-sonnet-4");
    assert.equal(result.version, "0.3.0");
    assert.equal(result.slug, "fixture-opencode-slug");

    assert.equal(result.userMessages, 1);
    assert.equal(result.assistantMessages, 1);
    assert.equal(result.toolUses.length, 1);
    assert.equal(result.toolUses[0].name, "read_file");

    const tokens = result.tokensByModel["claude-sonnet-4"];
    assert.ok(tokens, "tokensByModel must have a claude-sonnet-4 bucket");
    assert.equal(tokens.input, 900);
    // OpenCode adds tokens_output + tokens_reasoning into the .output bucket
    assert.equal(tokens.output, 280 + 50);
    assert.equal(tokens.cacheRead, 3000);
    assert.equal(tokens.cacheWrite, 400);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("OpenCode parser · idempotent — same DB twice returns same shape", () => {
  const tmp = mkdtempSync(join(tmpdir(), "opencode-fixture-"));
  const dbPath = join(tmp, "opencode.db");
  try {
    buildOpenCodeFixtureDb(dbPath);
    const a = parserModule.loadSessionsFromDb(dbPath)[0];
    const b = parserModule.loadSessionsFromDb(dbPath)[0];
    delete a.fileModifiedAt;
    delete b.fileModifiedAt;
    assert.deepEqual(a, b);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
