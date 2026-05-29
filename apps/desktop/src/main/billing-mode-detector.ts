/**
 * @file billing-mode-detector.ts
 * @description Best-effort billing-mode detection for agent harness spawns
 * (FEA-1434).
 *
 * **Privacy rule:** the credential files at `~/.claude/.credentials.json` and
 * `~/.codex/auth.json` hold OAuth tokens. We only check **existence** via
 * `fs.existsSync` — we never read, parse, or log file contents. Tokens and
 * usernames must never appear in logs or telemetry.
 *
 * **Tier limitation:** we cannot distinguish Claude Pro from Claude Max from
 * disk alone (both write the same credentials file). We default the
 * subscription tier to `claude_max` because that is the user segment we want
 * to highlight in the UI; the UI labels it as a generic subscription. A future
 * change can refine this when a reliable signal exists (e.g. a response header
 * captured at runtime). Same caveat for Codex / ChatGPT Pro.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import type { BillingMode } from "../shared/billing-mode.js";

const DEFAULT_CLAUDE_CREDENTIALS = path.join(
  "~",
  ".claude",
  ".credentials.json",
);
const DEFAULT_CODEX_AUTH = path.join("~", ".codex", "auth.json");

/**
 * Internal harness identifiers used at desktop spawn sites and importer entry
 * points. Mirrors the values written to the `sessions.harness` column.
 */
export type DetectHarness =
  | "claude"
  | "codex"
  | "cursor"
  | "copilot"
  | "opencode";

/**
 * Expand a leading `~` to the current user's home directory. We avoid a
 * `expandHomePath` import here to keep this module dependency-free for tests.
 */
function expandHome(p: string): string {
  if (p.startsWith("~")) {
    return path.join(homedir(), p.slice(1));
  }
  return p;
}

function envValue(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  key: string,
): string | undefined {
  const value = env[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Detect the billing mode for a Claude (Claude Code CLI) spawn.
 *
 * Rules:
 * - `ANTHROPIC_API_KEY` set and non-empty → `api`
 * - Else `~/.claude/.credentials.json` exists → `claude_max` (subscription;
 *   tier cannot be determined from disk)
 * - Else → `unknown`
 */
export function detectClaudeBillingMode(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  claudeCredentialsPath: string = DEFAULT_CLAUDE_CREDENTIALS,
): BillingMode {
  if (envValue(env, "ANTHROPIC_API_KEY")) {
    return "api";
  }
  // Existence-only check — never read or log the contents of this file. The
  // OAuth token inside the credentials file must not appear in logs or
  // telemetry; see CLAUDE.md "spawn|argv|env|secrets".
  if (existsSync(expandHome(claudeCredentialsPath))) {
    return "claude_max";
  }
  return "unknown";
}

/**
 * Detect the billing mode for a Codex (OpenAI Codex CLI) spawn.
 *
 * Rules:
 * - `OPENAI_API_KEY` set and non-empty → `api`
 * - Else `~/.codex/auth.json` exists → `codex_chatgpt_pro`
 * - Else → `unknown`
 */
export function detectCodexBillingMode(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  codexAuthPath: string = DEFAULT_CODEX_AUTH,
): BillingMode {
  if (envValue(env, "OPENAI_API_KEY")) {
    return "api";
  }
  // Existence-only check — see comment in `detectClaudeBillingMode`.
  if (existsSync(expandHome(codexAuthPath))) {
    return "codex_chatgpt_pro";
  }
  return "unknown";
}

/**
 * Dispatch to the right detector for a given harness. Cursor, Copilot, and
 * OpenCode have no in-desktop spawn — their importers stamp a fixed mode at
 * ingest time (see `apps/desktop/scripts/agent-monitor-{cursor,copilot,
 * opencode}/`). The fallback returned here is what the desktop main process
 * would record if it ever did spawn one of those tools.
 */
export function detectBillingModeForHarness(
  harness: DetectHarness,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): BillingMode {
  switch (harness) {
    case "claude":
      return detectClaudeBillingMode(env);
    case "codex":
      return detectCodexBillingMode(env);
    case "cursor":
      return "cursor_pro";
    case "copilot":
      return "copilot_seat";
    case "opencode":
      return "opencode";
    default: {
      // Exhaustive switch guard — adding a new DetectHarness without updating
      // this switch is a type error.
      const _exhaustive: never = harness;
      void _exhaustive;
      return "unknown";
    }
  }
}
