/**
 * Unit tests for functions extracted during the symphony-loop.ts decomposition.
 *
 * Covers:
 * - symphony-loop-repo: slugifyLoopId, pickStableId
 * - symphony-loop-pipeline: shellEscape
 * - symphony-loop-errors: redactCredentials
 * - symphony-loop-process: killProcessGracefully
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { slugifyLoopId, pickStableId } from "../src/server/operations/symphony-loop-repo.js";
import { shellEscape } from "../src/server/operations/symphony-loop-pipeline.js";
import { redactCredentials } from "../src/server/operations/symphony-loop-errors.js";
import { killProcessGracefully } from "../src/server/operations/symphony-loop-process.js";

// ---------------------------------------------------------------------------
// slugifyLoopId
// ---------------------------------------------------------------------------

describe("slugifyLoopId", () => {
  test("lowercases and replaces non-alnum with dashes", () => {
    assert.strictEqual(slugifyLoopId("My-Loop_ID.123"), "my-loop-id-123");
  });

  test("truncates to 50 characters", () => {
    const long = "a".repeat(60);
    assert.strictEqual(slugifyLoopId(long).length, 50);
  });

  test("handles UUID-style loop IDs", () => {
    const uuid = "019d6347-5872-723c-b11b-b15860a4c68a";
    assert.strictEqual(slugifyLoopId(uuid), uuid); // already valid
  });

  test("handles empty string", () => {
    assert.strictEqual(slugifyLoopId(""), "");
  });
});

// ---------------------------------------------------------------------------
// pickStableId
// ---------------------------------------------------------------------------

describe("pickStableId", () => {
  test("returns slugified loopId from request body", () => {
    const body = { loopId: "My-Loop_123" } as any;
    assert.strictEqual(pickStableId(body), "my-loop-123");
  });
});

// ---------------------------------------------------------------------------
// shellEscape
// ---------------------------------------------------------------------------

describe("shellEscape", () => {
  test("wraps simple string in single quotes", () => {
    assert.strictEqual(shellEscape("hello"), "'hello'");
  });

  test("escapes single quotes within the string", () => {
    assert.strictEqual(shellEscape("it's"), "'it'\"'\"'s'");
  });

  test("handles empty string", () => {
    assert.strictEqual(shellEscape(""), "''");
  });

  test("handles string with spaces and special chars", () => {
    const result = shellEscape("hello world; rm -rf /");
    assert.strictEqual(result, "'hello world; rm -rf /'");
  });
});

// ---------------------------------------------------------------------------
// redactCredentials
// ---------------------------------------------------------------------------

describe("redactCredentials", () => {
  test("redacts AWS access keys", () => {
    const input = "key=AKIAIOSFODNN7EXAMPLE rest";
    const result = redactCredentials(input);
    assert.ok(!result.includes("AKIAIOSFODNN7EXAMPLE"));
    assert.ok(result.includes("[REDACTED_AWS_KEY]"));
  });

  test("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test";
    const result = redactCredentials(input);
    assert.ok(!result.includes("eyJhbGciOiJIUzI1NiJ9"));
    assert.ok(result.includes("Bearer [REDACTED]"));
  });

  test("redacts sk- prefixed API keys", () => {
    const input = "api_key: sk-ant-1234567890abcdef";
    const result = redactCredentials(input);
    assert.ok(!result.includes("sk-ant-1234567890abcdef"));
    assert.ok(result.includes("[REDACTED_SK_KEY]"));
  });

  test("redacts GitHub tokens", () => {
    const input = "token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl";
    const result = redactCredentials(input);
    assert.ok(!result.includes("ghp_"));
    assert.ok(result.includes("[REDACTED_GH_TOKEN]"));
  });

  test("redacts password= in query strings", () => {
    const input = "url?password=s3cret&user=admin";
    const result = redactCredentials(input);
    assert.ok(!result.includes("s3cret"));
    assert.ok(result.includes("password=[REDACTED]"));
  });

  test("preserves text without credentials", () => {
    const input = "Normal log line without any secrets";
    assert.strictEqual(redactCredentials(input), input);
  });
});

// ---------------------------------------------------------------------------
// killProcessGracefully
// ---------------------------------------------------------------------------

describe("killProcessGracefully", () => {
  test("does not throw for a non-existent PID", async () => {
    // PID 999999 is almost certainly not running
    await assert.doesNotReject(() => killProcessGracefully(999999, 100));
  });
});
