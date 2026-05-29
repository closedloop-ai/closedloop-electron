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
import { readFileSync } from "node:fs";
import {
  detectBillingModeForHarness,
  detectClaudeBillingMode,
  detectCodexBillingMode,
} from "../src/main/billing-mode-detector.js";
import {
  SUBSCRIPTION_MODES,
  type BillingMode,
} from "../src/shared/billing-mode.js";

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

// FEA-1434 (round-3 review follow-up — Finding 3): `claude_pro` is a
// reserved-for-future-use entry in the `BillingMode` union. No detector or
// importer produces it today — `detectClaudeBillingMode` always returns
// `claude_max` for an OAuth-detected Claude session because the credentials
// file on disk does not distinguish Pro from Max. We keep the variant in
// place because:
//   1. removing it would be a breaking change to the cloud-relay schema
//      (the `billingMode` field on the synced agent-session payload), and
//   2. the importer-clobber guard in `build-agent-monitor.mjs` already
//      protects it alongside `api` and `claude_max`, so a future detector
//      that emits it will land safely without further plumbing.
// The tests below pin the contract so a future "dead enum entry" cleanup
// pass cannot silently drop the variant.
test("FEA-1434: `claude_pro` is still a valid BillingMode variant (reserved for future signal)", () => {
  // Type-level pin: this assignment fails to compile if `claude_pro` is
  // removed from the BillingMode union.
  const reserved: BillingMode = "claude_pro";
  assert.equal(reserved, "claude_pro");
});

test("FEA-1434: `claude_pro` remains in SUBSCRIPTION_MODES (subscription-covered ledger)", () => {
  assert.ok(
    SUBSCRIPTION_MODES.has("claude_pro"),
    "`claude_pro` must remain in SUBSCRIPTION_MODES so a future detector emission groups it under the Covered ledger without needing a parallel UI change.",
  );
});

test("FEA-1434: billing-mode.ts documents why `claude_pro` is currently dead", () => {
  // The reserved-status rationale lives as a comment in the shared type
  // file. A future cleanup that re-removes the variant should at minimum
  // trigger this regression so the author re-reads the rationale.
  const source = readFileSync(
    new URL("../src/shared/billing-mode.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /claude_pro/,
    "billing-mode.ts must still reference `claude_pro`",
  );
  assert.match(
    source,
    /reserved for a future detection signal/i,
    "billing-mode.ts must explain that `claude_pro` is reserved for a future signal",
  );
});

