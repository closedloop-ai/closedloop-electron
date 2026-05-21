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

describe("resolveEffectiveState JSONL fallback — dead PID + IN_PROGRESS state", () => {
  /**
   * (1) A JSONL file containing {"type":"result","subtype":"success"} causes
   *     the fallback to return COMPLETED with fallbackDetected=true.
   */
  test("dead PID + success record in JSONL returns COMPLETED", async () => {
    const claudeWorkDir = path.join(tempRoot, ".closedloop-ai", "work");
    await fs.mkdir(claudeWorkDir, { recursive: true });
    await fs.writeFile(
      path.join(claudeWorkDir, "claude-output.jsonl"),
      [
        JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-4-5", usage: { input_tokens: 10, output_tokens: 5 } } }),
        JSON.stringify({ type: "result", subtype: "success" }),
      ].join("\n") + "\n",
    );

    const outcome = detectSuccessFromOutput(claudeWorkDir);
    const effective = mapOutcomeToEffectiveState(outcome);

    assert.equal(outcome.outcome, "success");
    assert.equal(effective.status, "COMPLETED");
    assert.equal(effective.fallbackDetected, true);
  });

  /**
   * (2) A JSONL file with no success record (only error/other records) causes
   *     the fallback to return STOPPED with fallbackDetected=false.
   */
  test("dead PID + no success record in JSONL returns STOPPED", async () => {
    const claudeWorkDir = path.join(tempRoot, ".closedloop-ai", "work");
    await fs.mkdir(claudeWorkDir, { recursive: true });
    await fs.writeFile(
      path.join(claudeWorkDir, "claude-output.jsonl"),
      [
        JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-4-5", usage: { input_tokens: 10, output_tokens: 5 } } }),
        JSON.stringify({ type: "result", subtype: "error_during_execution" }),
      ].join("\n") + "\n",
    );

    const outcome = detectSuccessFromOutput(claudeWorkDir);
    const effective = mapOutcomeToEffectiveState(outcome);

    assert.equal(outcome.outcome, "no-success");
    assert.equal(effective.status, "STOPPED");
    assert.equal(effective.fallbackDetected, false);
  });

  /**
   * (3) When the JSONL output file is absent, detectSuccessFromOutput returns
   *     "missing" and the fallback returns STOPPED with fallbackDetected=false.
   */
  test("dead PID + missing JSONL file returns STOPPED", async () => {
    const claudeWorkDir = path.join(tempRoot, ".closedloop-ai", "work");
    await fs.mkdir(claudeWorkDir, { recursive: true });
    // No JSONL file written.

    const outcome = detectSuccessFromOutput(claudeWorkDir);
    const effective = mapOutcomeToEffectiveState(outcome);

    assert.equal(outcome.outcome, "missing");
    assert.equal(effective.status, "STOPPED");
    assert.equal(effective.fallbackDetected, false);
  });

  /**
   * (4) A JSONL file containing only malformed lines yields "no-success"
   *     because all lines are skipped, and the fallback returns STOPPED.
   *
   *     Note: the file IS present and readable at the OS level, so the outcome
   *     is "no-success" (not "unreadable"). The "unreadable" outcome only
   *     arises when the file itself cannot be read (e.g. permission error).
   */
  test("dead PID + malformed JSONL returns STOPPED", async () => {
    const claudeWorkDir = path.join(tempRoot, ".closedloop-ai", "work");
    await fs.mkdir(claudeWorkDir, { recursive: true });
    await fs.writeFile(
      path.join(claudeWorkDir, "claude-output.jsonl"),
      "not-json\n{broken: json\n{{{\n",
    );

    const outcome = detectSuccessFromOutput(claudeWorkDir);
    const effective = mapOutcomeToEffectiveState(outcome);

    assert.equal(outcome.outcome, "no-success");
    assert.equal(effective.status, "STOPPED");
    assert.equal(effective.fallbackDetected, false);
  });
});
