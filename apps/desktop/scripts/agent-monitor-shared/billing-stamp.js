/**
 * @file billing-stamp.js
 * @description Shared write-path helper that stamps a session's `billing_mode`
 * (CLOSEDLOOP FEA-1434). Both the Claude hook route (server/routes/hooks.js,
 * patched at build time) and the non-Claude importers (codex/cursor/copilot/
 * opencode) call this, so detection + the idempotent UPDATE live in one place
 * rather than being duplicated per harness.
 *
 * Detection is delegated to the canonical pure engine in
 * server/lib/billing-mode.js (the materialized twin of src/shared/billing-mode.ts)
 * and is existence-only: it inspects env vars and the *presence* of credential
 * files but NEVER reads their contents, so no secret value can leak into the DB,
 * logs, or IPC.
 *
 * Not part of the desktop ESM build — it runs only inside the generated
 * CommonJS sidecar tree, where `../lib/billing-mode` resolves to the
 * materialized engine.
 */
"use strict";

const { existsSync } = require("node:fs");
const { homedir } = require("node:os");
const { detectBillingModeForHarness } = require("../lib/billing-mode");

/**
 * Real dependency injection for the pure detection engine: the process
 * environment, an existence-only file check, and the user's home directory.
 * @returns {{ env: NodeJS.ProcessEnv, fileExists: (p: string) => boolean, homeDir: string }}
 */
function realBillingDeps() {
  return {
    env: process.env,
    fileExists: (p) => existsSync(p),
    homeDir: homedir(),
  };
}

/**
 * Detect and persist the billing mode for a session. Idempotent — the
 * setSessionBillingMode UPDATE no-ops when the stored value already matches —
 * and best-effort: any detection or DB hiccup is swallowed so a stamp failure
 * never blocks a hook event or an import.
 *
 * @param {{ setSessionBillingMode: { run: (...args: unknown[]) => unknown } }} stmts
 *   the db module's prepared-statement object (guaranteed by db.js FEA-1434 patch)
 * @param {string} harness e.g. "claude", "codex", "cursor", "copilot", "opencode"
 * @param {string} sessionId
 * @returns {string|null} the detected mode, or null if stamping failed
 */
function stampSessionBillingMode(stmts, harness, sessionId) {
  try {
    const mode = detectBillingModeForHarness(harness, realBillingDeps());
    stmts.setSessionBillingMode.run(mode, sessionId, mode);
    return mode;
  } catch {
    return null;
  }
}

module.exports = { stampSessionBillingMode, realBillingDeps };
