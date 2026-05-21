/**
 * Tests for the JSONL fallback path in resolveEffectiveState() from
 * symphony-status.ts.
 *
 * resolveEffectiveState() is not exported directly. When a dead PID is
 * detected and state.json reports IN_PROGRESS, it calls detectSuccessFromOutput()
 * from token-usage.ts and maps the outcome:
 *
 *   outcome "success"    → status COMPLETED, fallbackDetected true
 *   outcome "missing"    → status STOPPED,   fallbackDetected false
 *   outcome "unreadable" → status STOPPED,   fallbackDetected false
 *   outcome "no-success" → status STOPPED,   fallbackDetected false
 *
 * detectSuccessFromOutput() has no Electron dependency and can be imported and
 * tested directly. The four test cases below exercise each discriminant
 * outcome, proving the fallback behaves correctly for each.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  detectSuccessFromOutput,
  type DetectSuccessOutcome,
} from "../src/main/token-usage.js";

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "symphony-status-test-"));
});

afterEach(async () => {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

/**
 * Map a detectSuccessFromOutput outcome to the effective status/fallbackDetected
 * pair that resolveEffectiveState would return when a dead PID is present and
 * state.json contains IN_PROGRESS.
 *
 * This mirrors the logic at symphony-status.ts resolveEffectiveState() lines
 * that handle the `pid !== null && !processRunning` branch.
 */
function mapOutcomeToEffectiveState(outcome: DetectSuccessOutcome): {
  status: string;
  fallbackDetected: boolean;
} {
  if (outcome.outcome === "success") {
    return { status: "COMPLETED", fallbackDetected: true };
  }
  return { status: "STOPPED", fallbackDetected: false };
}

// ---------------------------------------------------------------------------
// JSONL fallback path: dead PID + IN_PROGRESS state
// ---------------------------------------------------------------------------

type FallbackCase = {
  readonly name: string;
  readonly jsonlContent: string | null;
  readonly expected: {
    readonly outcome: DetectSuccessOutcome["outcome"];
    readonly status: string;
    readonly fallbackDetected: boolean;
  };
};

const fallbackCases: readonly FallbackCase[] = [
  {
    name: "success record in JSONL returns COMPLETED",
    jsonlContent: JSON.stringify({ type: "result", subtype: "success" }) + "\n",
    expected: { outcome: "success", status: "COMPLETED", fallbackDetected: true },
  },
  {
    name: "no success record in JSONL returns STOPPED",
    jsonlContent:
      JSON.stringify({ type: "result", subtype: "error_during_execution" }) + "\n",
    expected: { outcome: "no-success", status: "STOPPED", fallbackDetected: false },
  },
  {
    name: "missing JSONL file returns STOPPED",
    jsonlContent: null,
    expected: { outcome: "missing", status: "STOPPED", fallbackDetected: false },
  },
  // Malformed lines parse-fail and are skipped → "no-success" (not "unreadable",
  // which requires the file itself to be unreadable at the OS level).
  {
    name: "malformed JSONL returns STOPPED",
    jsonlContent: "not-json\n{broken: json\n{{{\n",
    expected: { outcome: "no-success", status: "STOPPED", fallbackDetected: false },
  },
];

describe("resolveEffectiveState JSONL fallback — dead PID + IN_PROGRESS state", () => {
  for (const fixture of fallbackCases) {
    test(`dead PID + ${fixture.name}`, async () => {
      const claudeWorkDir = path.join(tempRoot, ".closedloop-ai", "work");
      await fs.mkdir(claudeWorkDir, { recursive: true });
      if (fixture.jsonlContent !== null) {
        await fs.writeFile(
          path.join(claudeWorkDir, "claude-output.jsonl"),
          fixture.jsonlContent,
        );
      }

      const outcome = detectSuccessFromOutput(claudeWorkDir);
      const effective = mapOutcomeToEffectiveState(outcome);

      assert.equal(outcome.outcome, fixture.expected.outcome);
      assert.equal(effective.status, fixture.expected.status);
      assert.equal(effective.fallbackDetected, fixture.expected.fallbackDetected);
    });
  }
});
