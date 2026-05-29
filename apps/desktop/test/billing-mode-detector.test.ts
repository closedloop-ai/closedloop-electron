/**
 * @file billing-mode-detector.test.ts
 * @description Unit tests for FEA-1434 billing-mode detection. Verifies the
 * env+disk decision tree for Claude and Codex, and the per-harness dispatch.
 * Uses a real fs scratch path rather than mocking `fs.existsSync` so the
 * existence check exercises Node's actual semantics.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  detectBillingModeForHarness,
  detectClaudeBillingMode,
  detectCodexBillingMode,
} from "../src/main/billing-mode-detector.js";

function createScratchCredentialsPath(
  filename: string,
  shouldExist: boolean,
): string {
  const dir = mkdtempSync(path.join(tmpdir(), "billing-mode-detector-"));
  const filePath = path.join(dir, filename);
  if (shouldExist) {
    // Existence-only — content must NEVER be read by the detector. We write a
    // marker string to confirm via a separate assertion (in the next test)
    // that the detector did not surface or log it.
    writeFileSync(filePath, "DO_NOT_READ_THIS_TOKEN");
  }
  return filePath;
}

test("detectClaudeBillingMode returns 'api' when ANTHROPIC_API_KEY is set", () => {
  const credPath = createScratchCredentialsPath(".credentials.json", false);
  const mode = detectClaudeBillingMode(
    { ANTHROPIC_API_KEY: "sk-ant-xxxxxxxxxxxxxxxx" },
    credPath,
  );
  assert.equal(mode, "api");
});

test("detectClaudeBillingMode treats whitespace-only ANTHROPIC_API_KEY as unset", () => {
  const credPath = createScratchCredentialsPath(".credentials.json", false);
  const mode = detectClaudeBillingMode(
    { ANTHROPIC_API_KEY: "   " },
    credPath,
  );
  // No API key + no credentials file → unknown.
  assert.equal(mode, "unknown");
});

test("detectClaudeBillingMode returns 'claude_max' when credentials file exists and no API key", () => {
  const credPath = createScratchCredentialsPath(".credentials.json", true);
  const mode = detectClaudeBillingMode({}, credPath);
  assert.equal(mode, "claude_max");
});

test("detectClaudeBillingMode prefers API key over credentials file", () => {
  const credPath = createScratchCredentialsPath(".credentials.json", true);
  const mode = detectClaudeBillingMode(
    { ANTHROPIC_API_KEY: "sk-ant-xxxxxxxxxxxxxxxx" },
    credPath,
  );
  assert.equal(mode, "api");
});

test("detectClaudeBillingMode returns 'unknown' when neither signal is present", () => {
  const credPath = createScratchCredentialsPath(".credentials.json", false);
  const mode = detectClaudeBillingMode({}, credPath);
  assert.equal(mode, "unknown");
});

test("detectCodexBillingMode returns 'api' when OPENAI_API_KEY is set", () => {
  const credPath = createScratchCredentialsPath("auth.json", false);
  const mode = detectCodexBillingMode(
    { OPENAI_API_KEY: "sk-xxxxxxxxxxxxxxxxxxxx" },
    credPath,
  );
  assert.equal(mode, "api");
});

test("detectCodexBillingMode returns 'codex_chatgpt_pro' when auth.json exists and no API key", () => {
  const credPath = createScratchCredentialsPath("auth.json", true);
  const mode = detectCodexBillingMode({}, credPath);
  assert.equal(mode, "codex_chatgpt_pro");
});

test("detectCodexBillingMode prefers API key over auth.json", () => {
  const credPath = createScratchCredentialsPath("auth.json", true);
  const mode = detectCodexBillingMode(
    { OPENAI_API_KEY: "sk-xxxxxxxxxxxxxxxxxxxx" },
    credPath,
  );
  assert.equal(mode, "api");
});

test("detectCodexBillingMode returns 'unknown' when neither signal is present", () => {
  const credPath = createScratchCredentialsPath("auth.json", false);
  const mode = detectCodexBillingMode({}, credPath);
  assert.equal(mode, "unknown");
});

test("detectBillingModeForHarness dispatches by harness id", () => {
  // Cursor / Copilot / OpenCode have fixed modes — no env or disk lookup.
  assert.equal(detectBillingModeForHarness("cursor", {}), "cursor_pro");
  assert.equal(detectBillingModeForHarness("copilot", {}), "copilot_seat");
  assert.equal(detectBillingModeForHarness("opencode", {}), "opencode");
  // Claude / Codex defer to their detectors. Without env or default file
  // existence, these will be `unknown` on the test host.
  const claudeMode = detectBillingModeForHarness("claude", {
    ANTHROPIC_API_KEY: "sk-ant-yes",
  });
  assert.equal(claudeMode, "api");
  const codexMode = detectBillingModeForHarness("codex", {
    OPENAI_API_KEY: "sk-yes",
  });
  assert.equal(codexMode, "api");
});

test("detector does not surface credentials file contents through return value", () => {
  // Defense-in-depth: verifies the return value is a fixed mode string, never
  // a substring of the credentials file body. The file holds a marker token
  // (created by createScratchCredentialsPath) that must never leak.
  const credPath = createScratchCredentialsPath(".credentials.json", true);
  const mode = detectClaudeBillingMode({}, credPath);
  assert.equal(mode, "claude_max");
  assert.ok(
    !mode.includes("DO_NOT_READ_THIS_TOKEN"),
    "billing mode return value must never contain credentials file contents",
  );
});

