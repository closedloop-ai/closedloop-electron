import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { parseTokenUsage } from "../src/main/token-usage.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "token-usage-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeJsonl(dir: string, lines: unknown[]): void {
  const content = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "claude-output.jsonl"), content, "utf-8");
}

test("(a) normal case: accumulates all four token types and deduplicates models", () => {
  const dir = makeTempDir();
  writeJsonl(dir, [
    {
      type: "assistant",
      message: {
        model: "claude-opus-4",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 300,
        },
      },
    },
    {
      type: "assistant",
      message: {
        model: "claude-opus-4",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
        },
      },
    },
    {
      type: "assistant",
      message: {
        model: "claude-sonnet-4",
        usage: {
          input_tokens: 1,
          output_tokens: 2,
          cache_creation_input_tokens: 3,
          cache_read_input_tokens: 4,
        },
      },
    },
  ]);

  const result = parseTokenUsage(dir);
  assert.equal(result.inputTokens, 111);
  assert.equal(result.outputTokens, 57);
  assert.equal(result.cacheCreationInputTokens, 223);
  assert.equal(result.cacheReadInputTokens, 334);
  assert.equal(result.turns, 3);
  assert.deepEqual(result.models.sort(), ["claude-opus-4", "claude-sonnet-4"]);
});

test("(b) cache tokens absent defaults to 0", () => {
  const dir = makeTempDir();
  writeJsonl(dir, [
    {
      type: "assistant",
      message: {
        model: "claude-haiku-4",
        usage: { input_tokens: 50, output_tokens: 25 },
      },
    },
  ]);

  const result = parseTokenUsage(dir);
  assert.equal(result.inputTokens, 50);
  assert.equal(result.outputTokens, 25);
  assert.equal(result.cacheCreationInputTokens, 0);
  assert.equal(result.cacheReadInputTokens, 0);
  assert.equal(result.turns, 1);
  assert.deepEqual(result.models, ["claude-haiku-4"]);
});

test("(c) missing JSONL file returns zero values and empty arrays", () => {
  const dir = makeTempDir();
  // No claude-output.jsonl written

  const result = parseTokenUsage(dir);
  assert.equal(result.inputTokens, 0);
  assert.equal(result.outputTokens, 0);
  assert.equal(result.cacheCreationInputTokens, 0);
  assert.equal(result.cacheReadInputTokens, 0);
  assert.equal(result.turns, 0);
  assert.deepEqual(result.models, []);
});

test("(d) malformed lines are skipped", () => {
  const dir = makeTempDir();
  const content = [
    '{"type":"assistant","message":{"model":"claude-opus-4","usage":{"input_tokens":10,"output_tokens":5}}}',
    "not-valid-json{{{",
    '{"type":"assistant","message":{"model":"claude-opus-4","usage":{"input_tokens":20,"output_tokens":10}}}',
  ].join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "claude-output.jsonl"), content, "utf-8");

  const result = parseTokenUsage(dir);
  assert.equal(result.inputTokens, 30);
  assert.equal(result.outputTokens, 15);
  assert.equal(result.turns, 2);
});

test("(e) duplicate model names are deduplicated", () => {
  const dir = makeTempDir();
  writeJsonl(dir, [
    {
      type: "assistant",
      message: {
        model: "claude-opus-4",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    },
    {
      type: "assistant",
      message: {
        model: "claude-opus-4",
        usage: { input_tokens: 2, output_tokens: 2 },
      },
    },
    {
      type: "assistant",
      message: {
        model: "claude-opus-4",
        usage: { input_tokens: 3, output_tokens: 3 },
      },
    },
  ]);

  const result = parseTokenUsage(dir);
  assert.equal(result.models.length, 1);
  assert.deepEqual(result.models, ["claude-opus-4"]);
});

test("(f) tokensByModel: single model accumulates per-model counts", () => {
  const dir = makeTempDir();
  writeJsonl(dir, [
    {
      type: "assistant",
      message: {
        model: "claude-opus-4",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 300,
        },
      },
    },
    {
      type: "assistant",
      message: {
        model: "claude-opus-4",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
        },
      },
    },
  ]);

  const result = parseTokenUsage(dir);
  assert.deepEqual(result.tokensByModel, {
    "claude-opus-4": {
      input: 110,
      output: 55,
      cacheCreation: 220,
      cacheRead: 330,
    },
  });
});

test("(g) tokensByModel: multiple models have independent counts", () => {
  const dir = makeTempDir();
  writeJsonl(dir, [
    {
      type: "assistant",
      message: {
        model: "claude-opus-4",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 300,
        },
      },
    },
    {
      type: "assistant",
      message: {
        model: "claude-sonnet-4",
        usage: {
          input_tokens: 1,
          output_tokens: 2,
          cache_creation_input_tokens: 3,
          cache_read_input_tokens: 4,
        },
      },
    },
    {
      type: "assistant",
      message: {
        model: "claude-opus-4",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
        },
      },
    },
  ]);

  const result = parseTokenUsage(dir);
  assert.deepEqual(result.tokensByModel, {
    "claude-opus-4": {
      input: 110,
      output: 55,
      cacheCreation: 220,
      cacheRead: 330,
    },
    "claude-sonnet-4": {
      input: 1,
      output: 2,
      cacheCreation: 3,
      cacheRead: 4,
    },
  });
});

test("(h) tokensByModel: missing JSONL returns empty object", () => {
  const dir = makeTempDir();
  const result = parseTokenUsage(dir);
  assert.deepEqual(result.tokensByModel, {});
});
