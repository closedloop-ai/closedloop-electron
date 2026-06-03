import { app } from "electron";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import Store from "electron-store";

import { gatewayLog } from "./gateway-logger.js";
import { resolveAgentMonitorHookPaths } from "./agent-monitor-path.js";
import {
  applyHookInstall,
  applyHookUninstall,
  CODEX_HOOK_TYPES,
  HOOK_TYPES,
  isClaudeEntry,
  isCodexEntry,
  makeClaudeHookEntry,
  makeCodexHookEntry,
} from "./agent-monitor-hooks-core.js";

const TAG = "agent-monitor-hooks";

interface HooksFlagStore {
  enabled: boolean;
  // FEA-1444: opt-in flag for installing Codex hooks alongside Claude hooks.
  // Defaults false — Codex telemetry already flows via the rollout-tail
  // watcher (FEA-1189), and enabling hooks without event-level dedup against
  // that watcher would double-count. Future work tracks the dedup; until then
  // this stays opt-in so existing users see no behavior change.
  codexOptIn?: boolean;
}

let flagStore: Store<HooksFlagStore> | null = null;
function store(): Store<HooksFlagStore> {
  flagStore ??= new Store<HooksFlagStore>({ name: "agent-monitor-hooks" });
  return flagStore;
}

export function isAgentMonitorHooksEnabled(): boolean {
  return store().get("enabled", false) === true;
}

export function isAgentMonitorCodexHooksOptIn(): boolean {
  return store().get("codexOptIn", false) === true;
}

// Same resolution as collectors/claude/claude-home.ts:
// CLAUDE_HOME || ~/.claude, then settings.json.
function claudeSettingsPath(): string {
  const home = process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude");
  return path.join(home, "settings.json");
}

// Mirrors scripts/agent-monitor-codex/codex-home.js getCodexHome: honor
// $CODEX_HOME first (some setups use a comma-separated list whose first entry
// is the active root), fall back to ~/.codex.
function codexHomeDir(): string {
  const raw = process.env.CODEX_HOME;
  if (raw && raw.trim()) {
    const first = raw.split(",")[0]?.trim();
    if (first) {
      return first.replace(/^~(?=\/)/, os.homedir());
    }
  }
  return path.join(os.homedir(), ".codex");
}

// Codex's experimental hook config (gated by `[features].codex_hooks = true`
// in Codex's own `config.toml`) lives in `$CODEX_HOME/hooks.json`. The JSON
// shape mirrors Claude Code's `settings.json` hooks block.
function codexHooksPath(): string {
  return path.join(codexHomeDir(), "hooks.json");
}

// A zero-dependency single file (pure node:http). Copying it to userData makes
// the installed hook command independent of the .app location (survives app
// move/rename and in-place updates).
function userDataHandlerPath(): string {
  return path.join(app.getPath("userData"), "agent-monitor", "hook-handler.js");
}

function userDataCodexHandlerPath(): string {
  return path.join(
    app.getPath("userData"),
    "agent-monitor",
    "codex-hook-handler.js",
  );
}

function refreshHandlerCopy(): string {
  const { hooksDir } = resolveAgentMonitorHookPaths();
  const src = path.join(hooksDir, "hook-handler.js");
  if (!existsSync(src)) {
    throw new Error(`hook-handler.js not found at ${src}`);
  }
  const dest = userDataHandlerPath();
  mkdirSync(path.dirname(dest), { recursive: true });
  const srcContent = readFileSync(src);
  if (!existsSync(dest) || !readFileSync(dest).equals(srcContent)) {
    copyFileSync(src, dest);
  }
  return dest;
}

// FEA-1444 / FEA-1503: the Codex wrapper handler is first-party and ships under
// `apps/desktop/resources/hooks/` (packaged: unpacked `extraResources/hooks`),
// resolved via the same hooksDir as the Claude handler.
function refreshCodexHandlerCopy(): string {
  const { hooksDir } = resolveAgentMonitorHookPaths();
  const src = path.join(hooksDir, "codex-hook-handler.js");
  if (!existsSync(src)) {
    throw new Error(`codex-hook-handler.js not found at ${src}`);
  }
  const dest = userDataCodexHandlerPath();
  mkdirSync(path.dirname(dest), { recursive: true });
  const srcContent = readFileSync(src);
  if (!existsSync(dest) || !readFileSync(dest).equals(srcContent)) {
    copyFileSync(src, dest);
  }
  return dest;
}

function installHooks(): void {
  const handler = refreshHandlerCopy();
  applyHookInstall({
    file: claudeSettingsPath(),
    hookTypes: HOOK_TYPES,
    isOurEntry: isClaudeEntry,
    makeEntry: (hookType) =>
      makeClaudeHookEntry(process.execPath, handler, hookType),
  });
  gatewayLog.info(
    TAG,
    `installed/repaired ${HOOK_TYPES.length} Claude Code hooks -> ${handler}`,
  );
}

function uninstallHooks(): void {
  const result = applyHookUninstall({
    file: claudeSettingsPath(),
    isOurEntry: isClaudeEntry,
  });
  gatewayLog.info(
    TAG,
    `removed ${result.removed} Claude Code hook entr${result.removed === 1 ? "y" : "ies"}`,
  );
}

// FEA-1444: install Codex hooks alongside Claude hooks. Same idempotency +
// self-heal semantics as installHooks(), targeting `$CODEX_HOME/hooks.json`
// and the Codex wrapper handler. Caller is responsible for gating on
// `isAgentMonitorCodexHooksOptIn()`.
function installCodexHooks(): void {
  const handler = refreshCodexHandlerCopy();
  applyHookInstall({
    file: codexHooksPath(),
    hookTypes: CODEX_HOOK_TYPES,
    isOurEntry: isCodexEntry,
    makeEntry: (hookType) =>
      makeCodexHookEntry(process.execPath, handler, hookType),
  });
  gatewayLog.info(
    TAG,
    `installed/repaired ${CODEX_HOOK_TYPES.length} Codex hooks -> ${handler}`,
  );
}

function uninstallCodexHooks(): void {
  const result = applyHookUninstall({
    file: codexHooksPath(),
    isOurEntry: isCodexEntry,
  });
  gatewayLog.info(
    TAG,
    `removed ${result.removed} Codex hook entr${result.removed === 1 ? "y" : "ies"}`,
  );
}

export interface AgentMonitorHooksResult {
  ok: boolean;
  enabled: boolean;
  error?: string;
}

export function setAgentMonitorHooksEnabled(
  enabled: boolean,
): AgentMonitorHooksResult {
  try {
    if (enabled) {
      installHooks();
      // FEA-1444: when the user previously opted into Codex hooks, install
      // those too. If they have not opted in, ensure no stale Codex entries
      // remain (a previous opt-in followed by opt-out, then re-enable, must
      // not silently re-install Codex hooks).
      if (isAgentMonitorCodexHooksOptIn()) {
        installCodexHooks();
      } else {
        uninstallCodexHooks();
      }
    } else {
      uninstallHooks();
      uninstallCodexHooks();
    }
    store().set("enabled", enabled);
    return { ok: true, enabled };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    gatewayLog.error(
      TAG,
      `failed to ${enabled ? "enable" : "disable"} hooks: ${message}`,
    );
    return { ok: false, enabled: isAgentMonitorHooksEnabled(), error: message };
  }
}

// FEA-1444: flip the Codex opt-in flag. When the master `enabled` flag is
// already on, immediately install/uninstall the Codex hook entries to reflect
// the new opt-in state.
//
// Currently exported but not yet wired to any IPC handler — the renderer
// toggle is a separate follow-up ticket. Until then this is reachable only
// from tests / dev consoles. Do not remove: removing this would make
// codexOptIn permanently false in production builds.
//
// Persist-then-apply order is intentional: a side-effect failure (e.g.,
// `~/.codex/hooks.json` locked or malformed) must not silently lose the
// user's intent. `syncAgentMonitorHooksOnBoot` re-applies from the
// persisted intent at next launch, so the eventual state remains
// consistent with what the user asked for. See CLAUDE.md learned pattern:
// "Setting toggles must update persisted state and in-memory side effects
// together."
export function setAgentMonitorCodexHooksOptIn(
  optIn: boolean,
): AgentMonitorHooksResult {
  store().set("codexOptIn", optIn);
  try {
    if (isAgentMonitorHooksEnabled()) {
      if (optIn) {
        installCodexHooks();
      } else {
        uninstallCodexHooks();
      }
    }
    return { ok: true, enabled: isAgentMonitorHooksEnabled() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    gatewayLog.error(
      TAG,
      `failed to apply Codex hook opt-in side effect (intent persisted as ${optIn}): ${message}`,
    );
    return {
      ok: false,
      enabled: isAgentMonitorHooksEnabled(),
      error: message,
    };
  }
}

// Boot-time repair: if the user previously opted in, re-copy the handler and
// re-write the entries so a moved/updated .app self-heals. No-op when disabled
// (and never throws into boot).
export function syncAgentMonitorHooksOnBoot(): void {
  if (!isAgentMonitorHooksEnabled()) {
    return;
  }
  try {
    installHooks();
  } catch (error) {
    gatewayLog.warn(
      TAG,
      `boot hook repair failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  // FEA-1444: reconcile Codex hook state with the persisted intent. When
  // opted in, self-heal the install (mirrors the Claude repair above).
  // When opted out, remove any stale entries that may linger from a prior
  // opt-in whose uninstall failed at the file layer (setAgentMonitorCodex-
  // HooksOptIn persists intent before applying side effects). Independent
  // try/catch so a Codex-side failure cannot suppress the Claude-side
  // repair logging above.
  try {
    if (isAgentMonitorCodexHooksOptIn()) {
      installCodexHooks();
    } else {
      uninstallCodexHooks();
    }
  } catch (error) {
    gatewayLog.warn(
      TAG,
      `boot Codex hook reconcile failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
