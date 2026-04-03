/**
 * Unit tests for session/context limit detection in the symphony loop.
 *
 * Covers:
 * - detectSessionLimitFromJsonl: JSONL-based detection
 * - isSessionLimitError: log-tail-based detection
 * - SESSION_LIMIT_PATTERN: shared regex correctness
 *
 * These tests verify that only genuine session/context limit errors are
 * classified as CONTEXT_LIMIT_EXCEEDED, and that unrelated errors (API
 * auth failures, tool errors, generic crashes) are NOT misclassified.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  AUTH_CHALLENGE_PATTERN,
  SESSION_LIMIT_PATTERN,
  detectAuthChallengeFromJsonl,
  detectSessionLimitFromJsonl,
  isAuthChallengeError,
  isSessionLimitError,
} from "../src/server/operations/symphony-loop.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-limit-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeJsonl(lines: Record<string, unknown>[]): void {
  const content = lines.map((l) => JSON.stringify(l)).join("\n");
  fs.writeFileSync(path.join(tmpDir, "claude-output.jsonl"), content);
}

// ---------------------------------------------------------------------------
// detectSessionLimitFromJsonl
// ---------------------------------------------------------------------------

describe("detectSessionLimitFromJsonl", () => {
  test("returns null when JSONL file does not exist", () => {
    assert.strictEqual(detectSessionLimitFromJsonl(tmpDir), null);
  });

  test("returns null for empty JSONL file", () => {
    fs.writeFileSync(path.join(tmpDir, "claude-output.jsonl"), "");
    assert.strictEqual(detectSessionLimitFromJsonl(tmpDir), null);
  });

  test("returns null for successful result (is_error: false)", () => {
    writeJsonl([
      { type: "result", subtype: "success", result: "", is_error: false },
    ]);
    assert.strictEqual(detectSessionLimitFromJsonl(tmpDir), null);
  });

  test("returns null for is_error: true with NON-session-limit message", () => {
    writeJsonl([
      {
        type: "result",
        subtype: "error",
        result: "Authentication failed: invalid API key",
        is_error: true,
      },
    ]);
    assert.strictEqual(detectSessionLimitFromJsonl(tmpDir), null);
  });

  test("returns null for generic tool error (not a session limit)", () => {
    writeJsonl([
      {
        type: "result",
        subtype: "error",
        result: "Command failed with exit code 1",
        is_error: true,
      },
    ]);
    assert.strictEqual(detectSessionLimitFromJsonl(tmpDir), null);
  });

  test("returns null for unknown error without result string", () => {
    writeJsonl([
      { type: "result", is_error: true, result: 42 },
    ]);
    assert.strictEqual(detectSessionLimitFromJsonl(tmpDir), null);
  });

  test("returns null for non-result record with is_error", () => {
    writeJsonl([
      { type: "assistant", is_error: true, result: "Prompt is too long" },
    ]);
    assert.strictEqual(detectSessionLimitFromJsonl(tmpDir), null);
  });

  test('detects "Prompt is too long" as session limit', () => {
    writeJsonl([
      {
        type: "result",
        subtype: "error",
        result: "Prompt is too long",
        is_error: true,
      },
    ]);
    assert.strictEqual(
      detectSessionLimitFromJsonl(tmpDir),
      "Prompt is too long",
    );
  });

  test('detects "context limit reached" as session limit', () => {
    writeJsonl([
      {
        type: "result",
        subtype: "error",
        result: "Error: context limit reached, please start a new conversation",
        is_error: true,
      },
    ]);
    assert.strictEqual(
      detectSessionLimitFromJsonl(tmpDir),
      "Error: context limit reached, please start a new conversation",
    );
  });

  test('detects "conversation too long" as session limit', () => {
    writeJsonl([
      {
        type: "result",
        subtype: "error",
        result: "The conversation too long to continue",
        is_error: true,
      },
    ]);
    assert.strictEqual(
      detectSessionLimitFromJsonl(tmpDir),
      "The conversation too long to continue",
    );
  });

  test('detects "exceed context limit" as session limit', () => {
    writeJsonl([
      {
        type: "result",
        subtype: "error",
        result: "Messages exceed context limit for this model",
        is_error: true,
      },
    ]);
    assert.strictEqual(
      detectSessionLimitFromJsonl(tmpDir),
      "Messages exceed context limit for this model",
    );
  });

  test("detection is case-insensitive", () => {
    writeJsonl([
      {
        type: "result",
        subtype: "error",
        result: "PROMPT IS TOO LONG",
        is_error: true,
      },
    ]);
    assert.strictEqual(
      detectSessionLimitFromJsonl(tmpDir),
      "PROMPT IS TOO LONG",
    );
  });

  test("skips non-error records and finds session limit later in file", () => {
    writeJsonl([
      { type: "assistant", message: { content: [{ type: "text", text: "hello" }] } },
      { type: "result", subtype: "success", result: "", is_error: false },
      {
        type: "result",
        subtype: "error",
        result: "Prompt is too long",
        is_error: true,
      },
    ]);
    assert.strictEqual(
      detectSessionLimitFromJsonl(tmpDir),
      "Prompt is too long",
    );
  });

  test("skips malformed JSON lines gracefully", () => {
    const content = [
      "not valid json",
      JSON.stringify({
        type: "result",
        subtype: "error",
        result: "context limit reached",
        is_error: true,
      }),
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, "claude-output.jsonl"), content);
    assert.strictEqual(
      detectSessionLimitFromJsonl(tmpDir),
      "context limit reached",
    );
  });

  test("ignores blank lines", () => {
    const content = [
      "",
      JSON.stringify({
        type: "result",
        subtype: "error",
        result: "Prompt is too long",
        is_error: true,
      }),
      "",
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, "claude-output.jsonl"), content);
    assert.strictEqual(
      detectSessionLimitFromJsonl(tmpDir),
      "Prompt is too long",
    );
  });
});

// ---------------------------------------------------------------------------
// isSessionLimitError
// ---------------------------------------------------------------------------

describe("isSessionLimitError", () => {
  test("returns false for empty string", () => {
    assert.strictEqual(isSessionLimitError(""), false);
  });

  test("returns false for generic error output", () => {
    assert.strictEqual(
      isSessionLimitError("Error: ENOENT: no such file or directory"),
      false,
    );
  });

  test("returns false for API auth error", () => {
    assert.strictEqual(
      isSessionLimitError("Authentication error: Invalid API key provided"),
      false,
    );
  });

  test('detects "prompt is too long"', () => {
    assert.strictEqual(
      isSessionLimitError("Error: prompt is too long for this model"),
      true,
    );
  });

  test('detects "exceed context limit"', () => {
    assert.strictEqual(
      isSessionLimitError("Messages exceed context limit"),
      true,
    );
  });

  test('detects "context limit reached"', () => {
    assert.strictEqual(
      isSessionLimitError("context limit reached, please start a new conversation"),
      true,
    );
  });

  test('detects "conversation too long"', () => {
    assert.strictEqual(
      isSessionLimitError("The conversation too long to continue processing"),
      true,
    );
  });

  test("detection is case-insensitive", () => {
    assert.strictEqual(
      isSessionLimitError("PROMPT IS TOO LONG"),
      true,
    );
  });

  test("detects pattern embedded in multiline log tail", () => {
    const logTail = [
      "Running claude code...",
      "Processing files...",
      "Error: prompt is too long",
      "Process exited with code 2",
    ].join("\n");
    assert.strictEqual(isSessionLimitError(logTail), true);
  });
});

// ---------------------------------------------------------------------------
// SESSION_LIMIT_PATTERN
// ---------------------------------------------------------------------------

describe("SESSION_LIMIT_PATTERN", () => {
  const positives = [
    "prompt is too long",
    "Prompt is too long",
    "exceed context limit",
    "Messages exceed context limit for this model",
    "context limit reached",
    "Context limit reached, please start a new conversation",
    "conversation too long",
    "The conversation too long to continue",
  ];

  const negatives = [
    "Authentication failed",
    "Rate limit exceeded",
    "Command failed with exit code 1",
    "Something went wrong",
    "ENOENT: no such file or directory",
    "timeout after 300000ms",
    "",
  ];

  for (const input of positives) {
    test(`matches: "${input}"`, () => {
      assert.strictEqual(SESSION_LIMIT_PATTERN.test(input), true);
      // Reset lastIndex since the regex has no /g flag but just in case
    });
  }

  for (const input of negatives) {
    test(`does not match: "${input || "(empty)"}"`, () => {
      assert.strictEqual(SESSION_LIMIT_PATTERN.test(input), false);
    });
  }
});

// ---------------------------------------------------------------------------
// AUTH_CHALLENGE_PATTERN
// ---------------------------------------------------------------------------

describe("AUTH_CHALLENGE_PATTERN", () => {
  const positives = [
    "authentication_error",
    "Invalid bearer token",
    "token expired",
    "Authentication failed: token expired",
    "Please log in",
    "Please log in to access this resource",
    "rate_limit_error",
    "Rate limit reached",
    "Rate limit reached for model claude-3-5-sonnet",
    "Claude usage limit reached. Your limit will reset at 2pm.",
    "Usage limit exceeded",
    "billing_error: payment required",
    "permission_error: forbidden",
    "overloaded_error",
    "API overloaded, try again",
    "unauthorized",
    "OAuth token expired, please re-authenticate",
  ];

  const negatives = [
    "Prompt is too long",
    "context limit reached",
    "conversation too long",
    "session limit reached",
    "Command failed with exit code 1",
    "ENOENT: no such file or directory",
    "File content exceeds maximum allowed tokens",
    "login required",
    "",
  ];

  for (const input of positives) {
    test(`matches: "${input}"`, () => {
      assert.ok(AUTH_CHALLENGE_PATTERN.test(input));
    });
  }

  for (const input of negatives) {
    test(`does not match: "${input || "(empty)"}"`, () => {
      assert.strictEqual(AUTH_CHALLENGE_PATTERN.test(input), false);
    });
  }
});

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

  test("returns null for successful result", () => {
    writeJsonl([
      { type: "result", subtype: "success", result: "", is_error: false },
    ]);
    assert.strictEqual(detectAuthChallengeFromJsonl(tmpDir), null);
  });

  const positiveJsonlScenarios = [
    {
      name: "authentication error",
      message: "authentication_error: Invalid bearer token",
      expected: "authentication_error",
    },
    {
      name: "please log in",
      message: "Please log in to continue",
      expected: "Please log in to continue",
    },
    {
      name: "token expired",
      message: "token expired",
      expected: "token expired",
    },
    {
      name: "rate limit error",
      message: "rate_limit_error: Rate limit reached",
      expected: "rate_limit_error",
    },
    {
      name: "billing error",
      message: "billing_error: payment required",
      expected: "billing_error",
    },
  ] as const;

  for (const scenario of positiveJsonlScenarios) {
    test(`detects ${scenario.name}`, () => {
      writeJsonl([
        {
          type: "result",
          subtype: "error",
          result: scenario.message,
          is_error: true,
        },
      ]);
      const result = detectAuthChallengeFromJsonl(tmpDir);
      assert.ok(result);
      assert.ok(result.includes(scenario.expected));
    });
  }

  test("skips malformed lines and continues scanning", () => {
    const content = [
      "not valid json",
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "hello" }] },
      }),
      "",
      JSON.stringify({
        type: "result",
        subtype: "error",
        result: "Please log in",
        is_error: true,
      }),
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, "claude-output.jsonl"), content);
    assert.strictEqual(detectAuthChallengeFromJsonl(tmpDir), "Please log in");
  });

  for (const input of [
    "Prompt is too long",
    "Error: context limit reached, please start a new conversation",
    "session limit reached",
    "login required",
    "Command failed with exit code 1",
  ]) {
    test(`returns null for non-auth message: "${input}"`, () => {
      writeJsonl([
        { type: "result", subtype: "error", result: input, is_error: true },
      ]);
      assert.strictEqual(detectAuthChallengeFromJsonl(tmpDir), null);
    });
  }
});

// ---------------------------------------------------------------------------
// isAuthChallengeError
// ---------------------------------------------------------------------------

describe("isAuthChallengeError", () => {
  test("returns false for empty string", () => {
    assert.strictEqual(isAuthChallengeError(""), false);
  });

  for (const input of [
    "Error: authentication_error - Invalid bearer token",
    "authentication failed: token expired",
    "Please log in to access this resource",
    "unauthorized",
    "RATE_LIMIT_ERROR",
  ]) {
    test(`matches auth error in log tail: "${input}"`, () => {
      assert.ok(isAuthChallengeError(input));
    });
  }

  test("detects pattern embedded in multiline log tail", () => {
    const logTail = "Starting...\nProcessing...\nError: token expired\nExiting";
    assert.ok(isAuthChallengeError(logTail));
  });

  for (const input of [
    "Prompt is too long",
    "context limit reached",
    "conversation too long",
    "session limit reached",
    "login required",
    "ENOENT: no such file or directory",
  ]) {
    test(`does not match non-auth log tail: "${input}"`, () => {
      assert.strictEqual(isAuthChallengeError(input), false);
    });
  }
});
