// Parser-to-normalized-session contract test for the Codex rollout parser.
//
// This is the Phase 1 vertical-slice for parser-layer auditing: take a
// hand-crafted raw Codex JSONL, run the SAME `parseRolloutFile` function the
// sidecar uses at runtime, and assert the normalized session object matches
// the fixture contents.
//
// Phase 1 day-2 will add: parsed session → `importSession()` → temp SQLite,
// then re-run the Dashboard manifest oracles against the parser-built DB
// instead of seed-fixture-db.mjs's pre-cooked rows. Disagreements at that
// point are parser↔DB bugs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));

// The Codex parser is CommonJS but apps/desktop has `"type": "module"` in
// package.json — so loading scripts/agent-monitor-codex/codex-parser.js
// directly fails (Node treats .js+type:module as ESM and the `require()` at
// the top of the parser file is undefined).
//
// The build pipeline copies the parser to `.generated/agent-monitor/server/lib/`
// where there is no surrounding type:module, and that's the path the sidecar
// loads at runtime. Test the same file the sidecar runs — both for correctness
// (identical bytes) and to dodge the ESM/CJS confusion.
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
  "codex-parser.js",
);
const { parseRolloutFile } = require_(GENERATED_PARSER);

const FIXTURE = join(
  HERE,
  "..",
  "..",
  "fixtures",
  "parsers",
  "codex",
  "rollout-a1b2c3d4-1111-2222-3333-444455556666.jsonl",
);

test("Codex parser · minimal rollout produces the expected normalized session", async () => {
  const parsed = await parseRolloutFile(FIXTURE);

  // Identity / metadata
  assert.equal(parsed.sessionId, "a1b2c3d4-1111-2222-3333-444455556666");
  assert.equal(parsed.cwd, "/tmp/fixture-codex-repo");
  assert.equal(parsed.model, "gpt-5");
  assert.equal(parsed.version, "0.27.0");
  assert.equal(parsed.gitBranch, "main");
  assert.equal(parsed.entrypoint, "codex");

  // Timestamps — start should be the earliest, end the latest.
  assert.equal(parsed.startedAt, "2026-05-20T10:00:00.000Z");
  assert.equal(parsed.endedAt, "2026-05-20T10:00:14.000Z");

  // Message counts
  assert.equal(parsed.userMessages, 1);
  assert.equal(parsed.assistantMessages, 1);
  assert.equal(parsed.thinkingBlockCount, 1);

  // Tool uses: one local_shell_call (normalized to name="shell")
  assert.equal(parsed.toolUses.length, 1);
  assert.equal(parsed.toolUses[0].name, "shell");

  // Tokens: cumulative; the single token_count event sets the totals.
  // Expected per model "gpt-5":
  //   input=150, output=40+15(reasoning)=55, cacheRead=0
  const gpt5 = parsed.tokensByModel?.["gpt-5"];
  assert.ok(gpt5, `tokensByModel.gpt-5 missing; got: ${JSON.stringify(parsed.tokensByModel)}`);
  assert.equal(gpt5.input, 150);
  assert.equal(gpt5.output, 55);
  assert.equal(gpt5.cacheRead, 0);

  // No plans in this minimal fixture
  assert.equal(parsed.plans.length, 0);

  // No API errors / tool-result errors
  assert.equal(parsed.apiErrors.length, 0);
  assert.equal(parsed.toolResultErrors.length, 0);
});

test("Codex parser · idempotent: parsing twice returns equal shape", async () => {
  const a = await parseRolloutFile(FIXTURE);
  const b = await parseRolloutFile(FIXTURE);
  // Strip mtime-dependent field for the comparison — the file's mtime can
  // shift on copy or rsync but the parsed content must be stable.
  const norm = (o) => {
    const { fileModifiedAt, ...rest } = o;
    return rest;
  };
  assert.deepEqual(norm(a), norm(b));
});
