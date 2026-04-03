/**
 * Unit tests for authentication challenge detection in the symphony loop.
 *
 * Covers:
 * - detectAuthChallengeFromJsonl: JSONL-based detection
 * - isAuthChallengeError: log-tail-based detection
 * - AUTH_CHALLENGE_PATTERN: shared regex correctness
 *
 * These tests verify that only genuine auth challenge / session expiry errors
 * are classified as AUTH_CHALLENGE, and that unrelated errors (session/context
 * limit errors, generic crashes) are NOT misclassified.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  AUTH_CHALLENGE_PATTERN,
  detectAuthChallengeFromJsonl,
  isAuthChallengeError,
} from "../src/server/operations/symphony-loop.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-challenge-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeJsonl(lines: Record<string, unknown>[]): void {
  const content = lines.map((l) => JSON.stringify(l)).join("\n");
  fs.writeFileSync(path.join(tmpDir, "claude-output.jsonl"), content);
}

// ---------------------------------------------------------------------------
// detectAuthChallengeFromJsonl
// ---------------------------------------------------------------------------

describe("detectAuthChallengeFromJsonl", () => {
  test("returns null when JSONL file does not exist", () => {
    assert.strictEqual(detectAuthChallengeFromJsonl(tmpDir), null);
  });

  test("returns null for empty JSONL file", () => {
    fs.writeFileSync(path.join(tmpDir, "claude-output.jsonl"), "");
    assert.strictEqual(detectAuthChallengeFromJsonl(tmpDir), null);
  });

  test("returns null for successful result (is_error: false)", () => {
    writeJsonl([
      { type: "result", subtype: "success", result: "login required", is_error: false },
    ]);
    assert.strictEqual(detectAuthChallengeFromJsonl(tmpDir), null);
  });

  test("returns null for is_error: true with non-auth-challenge message", () => {
    writeJsonl([
      {
        type: "result",
        subtype: "error",
        result: "Command failed with exit code 1",
        is_error: true,
      },
    ]);
    assert.strictEqual(detectAuthChallengeFromJsonl(tmpDir), null);
  });

  test("returns null for malformed JSON lines", () => {
    fs.writeFileSync(
      path.join(tmpDir, "claude-output.jsonl"),
      "not valid json\nalso not json",
    );
    assert.strictEqual(detectAuthChallengeFromJsonl(tmpDir), null);
  });

  test("skips malformed lines and continues scanning", () => {
    const content = [
      "not valid json",
      JSON.stringify({
        type: "result",
        subtype: "error",
        result: "login required",
        is_error: true,
      }),
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, "claude-output.jsonl"), content);
    assert.strictEqual(
      detectAuthChallengeFromJsonl(tmpDir),
      "login required",
    );
  });

  test('detects "login required" as auth challenge', () => {
    writeJsonl([
      {
        type: "result",
        subtype: "error",
        result: "login required",
        is_error: true,
      },
    ]);
    assert.strictEqual(
      detectAuthChallengeFromJsonl(tmpDir),
      "login required",
    );
  });

  test('detects "authentication failed" as auth challenge', () => {
    writeJsonl([
      {
        type: "result",
        subtype: "error",
        result: "authentication failed: invalid credentials",
        is_error: true,
      },
    ]);
    assert.strictEqual(
      detectAuthChallengeFromJsonl(tmpDir),
      "authentication failed: invalid credentials",
    );
  });

  test('detects "Please log in" as auth challenge', () => {
    writeJsonl([
      {
        type: "result",
        subtype: "error",
        result: "Please log in to continue",
        is_error: true,
      },
    ]);
    assert.strictEqual(
      detectAuthChallengeFromJsonl(tmpDir),
      "Please log in to continue",
    );
  });

  test('detects "session expired" as auth challenge', () => {
    writeJsonl([
      {
        type: "result",
        subtype: "error",
        result: "session expired, please re-authenticate",
        is_error: true,
      },
    ]);
    assert.strictEqual(
      detectAuthChallengeFromJsonl(tmpDir),
      "session expired, please re-authenticate",
    );
  });

  test("detection is case-insensitive", () => {
    writeJsonl([
      {
        type: "result",
        subtype: "error",
        result: "LOGIN REQUIRED",
        is_error: true,
      },
    ]);
    assert.strictEqual(
      detectAuthChallengeFromJsonl(tmpDir),
      "LOGIN REQUIRED",
    );
  });

  test("skips non-error records and finds auth challenge later in file", () => {
    writeJsonl([
      { type: "assistant", message: { content: [{ type: "text", text: "hello" }] } },
      { type: "result", subtype: "success", result: "", is_error: false },
      {
        type: "result",
        subtype: "error",
        result: "login required",
        is_error: true,
      },
    ]);
    assert.strictEqual(
      detectAuthChallengeFromJsonl(tmpDir),
      "login required",
    );
  });

  test("ignores blank lines", () => {
    const content = [
      "",
      JSON.stringify({
        type: "result",
        subtype: "error",
        result: "session expired",
        is_error: true,
      }),
      "",
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, "claude-output.jsonl"), content);
    assert.strictEqual(
      detectAuthChallengeFromJsonl(tmpDir),
      "session expired",
    );
  });

  // Negative: SESSION_LIMIT_PATTERN positives must NOT match AUTH_CHALLENGE_PATTERN
  test('does not detect "prompt is too long" as auth challenge', () => {
    writeJsonl([
      {
        type: "result",
        subtype: "error",
        result: "prompt is too long",
        is_error: true,
      },
    ]);
    assert.strictEqual(detectAuthChallengeFromJsonl(tmpDir), null);
  });

  test('does not detect "exceed context limit" as auth challenge', () => {
    writeJsonl([
      {
        type: "result",
        subtype: "error",
        result: "Messages exceed context limit for this model",
        is_error: true,
      },
    ]);
    assert.strictEqual(detectAuthChallengeFromJsonl(tmpDir), null);
  });

  test('does not detect "context limit reached" as auth challenge', () => {
    writeJsonl([
      {
        type: "result",
        subtype: "error",
        result: "Error: context limit reached, please start a new conversation",
        is_error: true,
      },
    ]);
    assert.strictEqual(detectAuthChallengeFromJsonl(tmpDir), null);
  });

  test('does not detect "conversation too long" as auth challenge', () => {
    writeJsonl([
      {
        type: "result",
        subtype: "error",
        result: "The conversation too long to continue",
        is_error: true,
      },
    ]);
    assert.strictEqual(detectAuthChallengeFromJsonl(tmpDir), null);
  });

  test('does not detect "session limit reached" as auth challenge', () => {
    writeJsonl([
      {
        type: "result",
        subtype: "error",
        result: "session limit reached",
        is_error: true,
      },
    ]);
    assert.strictEqual(detectAuthChallengeFromJsonl(tmpDir), null);
  });

  test('does not detect "unauthorized" alone as auth challenge', () => {
    writeJsonl([
      {
        type: "result",
        subtype: "error",
        result: "unauthorized",
        is_error: true,
      },
    ]);
    assert.strictEqual(detectAuthChallengeFromJsonl(tmpDir), null);
  });
});

// ---------------------------------------------------------------------------
// isAuthChallengeError
// ---------------------------------------------------------------------------

describe("isAuthChallengeError", () => {
  test("returns false for empty string", () => {
    assert.strictEqual(isAuthChallengeError(""), false);
  });

  test("returns false for generic error output", () => {
    assert.strictEqual(
      isAuthChallengeError("Error: ENOENT: no such file or directory"),
      false,
    );
  });

  test("returns false for generic session limit error", () => {
    assert.strictEqual(
      isAuthChallengeError("context limit reached"),
      false,
    );
  });

  test('detects "login required"', () => {
    assert.strictEqual(
      isAuthChallengeError("Error: login required, please authenticate"),
      true,
    );
  });

  test('detects "authentication failed"', () => {
    assert.strictEqual(
      isAuthChallengeError("authentication failed: token expired"),
      true,
    );
  });

  test('detects "Please log in"', () => {
    assert.strictEqual(
      isAuthChallengeError("Please log in to access this resource"),
      true,
    );
  });

  test('detects "session expired"', () => {
    assert.strictEqual(
      isAuthChallengeError("session expired"),
      true,
    );
  });

  test("detection is case-insensitive", () => {
    assert.strictEqual(
      isAuthChallengeError("LOGIN REQUIRED"),
      true,
    );
  });

  test("detects pattern embedded in multiline log tail", () => {
    const logTail = [
      "Running claude code...",
      "Processing files...",
      "Error: session expired",
      "Process exited with code 2",
    ].join("\n");
    assert.strictEqual(isAuthChallengeError(logTail), true);
  });

  // Negative: SESSION_LIMIT_PATTERN positives must NOT match via isAuthChallengeError
  test('does not match "prompt is too long"', () => {
    assert.strictEqual(isAuthChallengeError("prompt is too long"), false);
  });

  test('does not match "exceed context limit"', () => {
    assert.strictEqual(isAuthChallengeError("exceed context limit"), false);
  });

  test('does not match "context limit reached"', () => {
    assert.strictEqual(isAuthChallengeError("context limit reached"), false);
  });

  test('does not match "conversation too long"', () => {
    assert.strictEqual(isAuthChallengeError("conversation too long"), false);
  });

  test('does not match "session limit reached"', () => {
    assert.strictEqual(isAuthChallengeError("session limit reached"), false);
  });

  test('does not match "unauthorized" alone', () => {
    assert.strictEqual(isAuthChallengeError("unauthorized"), false);
  });
});

// ---------------------------------------------------------------------------
// AUTH_CHALLENGE_PATTERN
// ---------------------------------------------------------------------------

describe("AUTH_CHALLENGE_PATTERN", () => {
  const positives = [
    "login required",
    "Login required to continue",
    "authentication failed",
    "Authentication failed: invalid token",
    "Please log in",
    "Please log in to access this resource",
    "session expired",
    "Session expired, please re-authenticate",
  ];

  // SESSION_LIMIT_PATTERN positive inputs must NOT match AUTH_CHALLENGE_PATTERN
  const negatives = [
    "prompt is too long",
    "Prompt is too long",
    "exceed context limit",
    "Messages exceed context limit for this model",
    "context limit reached",
    "Context limit reached, please start a new conversation",
    "conversation too long",
    "The conversation too long to continue",
    // Additional explicit negatives
    "session limit reached",
    "unauthorized",
    "Rate limit exceeded",
    "Command failed with exit code 1",
    "Something went wrong",
    "ENOENT: no such file or directory",
    "",
  ];

  for (const input of positives) {
    test(`matches: "${input}"`, () => {
      assert.strictEqual(AUTH_CHALLENGE_PATTERN.test(input), true);
    });
  }

  for (const input of negatives) {
    test(`does not match: "${input || "(empty)"}"`, () => {
      assert.strictEqual(AUTH_CHALLENGE_PATTERN.test(input), false);
    });
  }
});
