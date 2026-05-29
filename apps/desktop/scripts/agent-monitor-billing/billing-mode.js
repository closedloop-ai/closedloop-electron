/**
 * @file billing-mode.js
 * @description Canonical billing-mode engine for the agent-monitor sidecar
 * (CommonJS). Classifies each tracked session as METERED (real per-token API
 * spend) vs SUBSCRIPTION-covered (Claude Pro/Max, ChatGPT/Codex, Copilot seat,
 * Cursor Pro) so the dashboard can keep two separate ledgers and never sum a
 * hypothetical subscription cost into real headline spend.
 *
 * CLOSEDLOOP FEA-1434. Mirrors the agent-monitor-cost engine pattern: this CJS
 * module is the source of truth that runs inside the generated sidecar tree,
 * and `src/shared/billing-mode.ts` is a byte-equal ESM twin for desktop-main
 * (which must work with the sidecar disabled). A parity test
 * (`test/billing-mode.test.ts`) imports BOTH and asserts identical output so
 * the twins cannot drift.
 *
 * ── Two responsibilities ──────────────────────────────────────────────────────
 *   1. CLASSIFICATION (pure, total over the BillingMode union): map a stored
 *      billing mode → a ledger ("metered" | "subscription" | "unknown"). The
 *      schema column, relay sync, and UI all rely on this being total.
 *   2. DETECTION (pure, dependency-injected): infer the billing mode for a
 *      harness from credential PRESENCE only. Detection takes injected deps
 *      ({ env, fileExists, homeDir }) so it is testable and so it can run in
 *      both the sidecar and desktop-main with the right real implementations.
 *
 * ── Secret-handling rule (non-negotiable) ─────────────────────────────────────
 * Detection checks credential EXISTENCE only. It NEVER reads the contents of
 * `~/.claude/.credentials.json`, `~/.codex/auth.json`, or any API-key env var
 * beyond a non-empty check, and NEVER logs, echoes, or returns those values.
 * The only output is an opaque BillingMode string.
 *
 * ── Tier granularity ──────────────────────────────────────────────────────────
 * The BillingMode union carries tier-specific Anthropic values (pro/max_5x/
 * max_20x) and Codex values for the persisted/synced contract, but existence-
 * only detection cannot distinguish tiers (that needs `/status` parsing, out of
 * scope for this slice — see PRD-414). So OAuth-present Anthropic resolves to
 * `subscription_unknown`; the finer tiers arrive later from `/status` or cloud
 * sync. The ledger mapping is total over every value regardless.
 */
"use strict";

const path = require("node:path");

/**
 * Every valid billing mode. Persisted in the sessions.billing_mode column and
 * carried on the relay sync contract, so this is a stable, additive list.
 * Exported so callers/tests can iterate the full domain.
 */
const BILLING_MODES = [
  "api",
  "subscription_unknown",
  "pro",
  "max_5x",
  "max_20x",
  "codex_subscription",
  "cursor_api",
  "cursor_pro",
  "copilot_seat",
  "opencode",
  "unknown",
];

// Real per-token API spend → counts toward headline metered cost.
const METERED_MODES = new Set(["api", "cursor_api"]);
// Subscription-covered → priced only as a hypothetical "would have cost"
// equivalent, NEVER summed into headline spend.
const SUBSCRIPTION_MODES = new Set([
  "subscription_unknown",
  "pro",
  "max_5x",
  "max_20x",
  "codex_subscription",
  "cursor_pro",
  "copilot_seat",
]);

/**
 * Map a billing mode to its ledger. Total over the union: anything not metered
 * or subscription (opencode BYOK, the literal "unknown", or any unrecognized
 * future value read from disk/relay) lands in "unknown" so it is neither
 * charged nor mislabeled as covered.
 * @param {string} mode
 * @returns {"metered"|"subscription"|"unknown"}
 */
function billingLedger(mode) {
  if (METERED_MODES.has(mode)) return "metered";
  if (SUBSCRIPTION_MODES.has(mode)) return "subscription";
  return "unknown";
}

/** True when the mode represents real, per-token API spend. */
function isMeteredApi(mode) {
  return billingLedger(mode) === "metered";
}

/** True when the mode is covered by a flat subscription/seat. */
function isSubscription(mode) {
  return billingLedger(mode) === "subscription";
}

/**
 * Coerce a possibly-null/legacy/garbage value (e.g. a DB read from a row
 * written before this column existed, or a relay payload from an older build)
 * to a valid BillingMode. Unrecognized → "unknown".
 * @param {unknown} value
 * @returns {string}
 */
function normalizeBillingMode(value) {
  return typeof value === "string" && BILLING_MODES.includes(value)
    ? value
    : "unknown";
}

/** Non-empty string presence check for an env var (existence only — never logged). */
function hasNonEmptyEnv(env, key) {
  const v = env && typeof env === "object" ? env[key] : undefined;
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Resolve the Codex home dir, honoring the documented $CODEX_HOME override
 * (same precedence the codex importer's codex-home.js uses) so a relocated
 * Codex install is classified correctly rather than falling through to unknown.
 */
function codexHomeDir(deps) {
  if (hasNonEmptyEnv(deps.env, "CODEX_HOME")) {
    return deps.env.CODEX_HOME;
  }
  return path.join(deps.homeDir, ".codex");
}

/**
 * Anthropic (Claude Code harness): an ANTHROPIC_API_KEY means real metered API
 * billing; otherwise a present OAuth credential file means a Pro/Max
 * subscription (tier undeterminable here → subscription_unknown). Neither path
 * reads the secret's contents.
 */
function detectAnthropicBillingMode(deps) {
  if (hasNonEmptyEnv(deps.env, "ANTHROPIC_API_KEY")) return "api";
  if (deps.fileExists(path.join(deps.homeDir, ".claude", ".credentials.json"))) {
    return "subscription_unknown";
  }
  return "unknown";
}

/**
 * OpenAI/Codex harness: an OPENAI_API_KEY means metered API billing; otherwise
 * a present Codex OAuth file means a ChatGPT/Codex subscription.
 */
function detectOpenAiBillingMode(deps) {
  if (hasNonEmptyEnv(deps.env, "OPENAI_API_KEY")) return "api";
  if (deps.fileExists(path.join(codexHomeDir(deps), "auth.json"))) {
    return "codex_subscription";
  }
  return "unknown";
}

/**
 * Cursor harness: a CURSOR_API_KEY means metered API billing; otherwise a
 * tracked Cursor session (the importer only runs when transcripts exist) is a
 * Pro/Business seat. Seat-share allocation math is out of scope (PRD-414).
 */
function detectCursorBillingMode(deps) {
  if (hasNonEmptyEnv(deps.env, "CURSOR_API_KEY")) return "cursor_api";
  return "cursor_pro";
}

/** GitHub Copilot is always a seat-based subscription (no per-token API). */
function detectCopilotBillingMode(_deps) {
  return "copilot_seat";
}

/** OpenCode is bring-your-own-key; per-call billing attribution is deferred. */
function detectOpencodeBillingMode(_deps) {
  return "opencode";
}

/**
 * Detect the billing mode for a harness from injected deps. Unknown harnesses
 * resolve to "unknown" (ledger: unknown) rather than guessing.
 * @param {string} harness  one of "claude" | "codex" | "cursor" | "copilot" | "opencode"
 * @param {{ env: object, fileExists: (p: string) => boolean, homeDir: string }} deps
 * @returns {string} a BillingMode
 */
function detectBillingModeForHarness(harness, deps) {
  switch (harness) {
    case "claude":
      return detectAnthropicBillingMode(deps);
    case "codex":
      return detectOpenAiBillingMode(deps);
    case "cursor":
      return detectCursorBillingMode(deps);
    case "copilot":
      return detectCopilotBillingMode(deps);
    case "opencode":
      return detectOpencodeBillingMode(deps);
    default:
      return "unknown";
  }
}

module.exports = {
  BILLING_MODES,
  billingLedger,
  isMeteredApi,
  isSubscription,
  normalizeBillingMode,
  detectBillingModeForHarness,
  // Exported for the parity test + targeted unit coverage.
  detectAnthropicBillingMode,
  detectOpenAiBillingMode,
  detectCursorBillingMode,
  detectCopilotBillingMode,
  detectOpencodeBillingMode,
};
