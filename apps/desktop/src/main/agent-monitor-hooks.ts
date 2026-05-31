import { app } from "electron";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import Store from "electron-store";

import { resolveAgentMonitorPort } from "../shared/contracts.js";
import { gatewayLog } from "./gateway-logger.js";
import { resolveAgentMonitorPaths } from "./agent-monitor-path.js";

const TAG = "agent-monitor-hooks";

// Mirrors the upstream install-hooks.js contract: same event set, same matcher
// rule. Re-verify on every upstream bump.
const HOOKS_WITH_MATCHER = [
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SubagentStop",
  "Notification",
] as const;
const HOOKS_WITHOUT_MATCHER = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
] as const;
const HOOK_TYPES = [...HOOKS_WITH_MATCHER, ...HOOKS_WITHOUT_MATCHER];

interface HooksFlagStore {
  enabled: boolean;
}

let flagStore: Store<HooksFlagStore> | null = null;
function store(): Store<HooksFlagStore> {
  flagStore ??= new Store<HooksFlagStore>({ name: "agent-monitor-hooks" });
  return flagStore;
}

export function isAgentMonitorHooksEnabled(): boolean {
  return store().get("enabled", false) === true;
}

// Matches install-hooks.js / uninstall-hooks.js isOurEntry: any hook whose
// command references hook-handler.js. Keeps install/uninstall symmetric with
// the generated CLI scripts.
function isOurEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const e = entry as {
    command?: unknown;
    hooks?: Array<{ command?: unknown }>;
  };
  if (typeof e.command === "string" && e.command.includes("hook-handler.js")) {
    return true;
  }
  if (Array.isArray(e.hooks)) {
    return e.hooks.some(
      (h) => typeof h?.command === "string" && h.command.includes("hook-handler.js"),
    );
  }
  return false;
}

// Same resolution as agent-dashboard/server/lib/claude-home.js:
// CLAUDE_HOME || ~/.claude, then settings.json.
function claudeSettingsPath(): string {
  const home = process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude");
  return path.join(home, "settings.json");
}

// A zero-dependency single file (pure node:http). Copying it to userData makes
// the installed hook command independent of the .app location (survives app
// move/rename and in-place updates).
function userDataHandlerPath(): string {
  return path.join(app.getPath("userData"), "agent-monitor", "hook-handler.js");
}

function refreshHandlerCopy(): string {
  const { scriptsDir } = resolveAgentMonitorPaths();
  const src = path.join(scriptsDir, "hook-handler.js");
  if (!existsSync(src)) {
    throw new Error(
      `hook-handler.js not found at ${src} — run \`pnpm -C apps/desktop build:agent-monitor\``,
    );
  }
  const dest = userDataHandlerPath();
  mkdirSync(path.dirname(dest), { recursive: true });
  const srcContent = readFileSync(src);
  if (!existsSync(dest) || !readFileSync(dest).equals(srcContent)) {
    copyFileSync(src, dest);
  }
  return dest;
}

function makeHookCommand(handler: string, hookType: string): string {
  // Executed by Claude Code via the shell. Use the Electron binary as Node
  // (ELECTRON_RUN_AS_NODE) so no system `node` is required. The dashboard port
  // is baked into the command so dev overrides stay aligned with the runtime.
  return `CLAUDE_DASHBOARD_PORT=${resolveAgentMonitorPort()} ELECTRON_RUN_AS_NODE=1 "${process.execPath}" "${handler}" ${JSON.stringify(hookType)}`;
}

function makeHookEntry(
  handler: string,
  hookType: string,
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    hooks: [{ type: "command", command: makeHookCommand(handler, hookType) }],
  };
  if ((HOOKS_WITH_MATCHER as readonly string[]).includes(hookType)) {
    entry.matcher = "*";
  }
  return entry;
}

function readSettings(file: string): Record<string, unknown> {
  if (!existsSync(file)) {
    return {};
  }
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

function writeSettings(file: string, settings: unknown): void {
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true });
  const tempFile = path.join(
    dir,
    `${path.basename(file)}.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(tempFile, JSON.stringify(settings, null, 2) + "\n", "utf8");
  renameSync(tempFile, file);
}

// Idempotent: replaces a stale entry of ours in place (self-heals a moved
// handler path), otherwise appends. Mirrors upstream install-hooks.js.
function installHooks(): void {
  const handler = refreshHandlerCopy();
  const file = claudeSettingsPath();
  const settings = readSettings(file);
  const hooks = (settings.hooks ??= {}) as Record<string, unknown[]>;

  for (const hookType of HOOK_TYPES) {
    const list = (hooks[hookType] ??= []);
    const idx = list.findIndex(isOurEntry);
    const entry = makeHookEntry(handler, hookType);
    if (idx >= 0) {
      list[idx] = entry;
    } else {
      list.push(entry);
    }
  }
  writeSettings(file, settings);
  gatewayLog.info(
    TAG,
    `installed/repaired ${HOOK_TYPES.length} Claude Code hooks -> ${handler}`,
  );
}

function uninstallHooks(): void {
  const file = claudeSettingsPath();
  if (!existsSync(file)) {
    return;
  }
  const settings = readSettings(file);
  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  if (!hooks) {
    return;
  }
  let removed = 0;
  for (const hookType of Object.keys(hooks)) {
    const list = hooks[hookType];
    if (!Array.isArray(list)) {
      continue;
    }
    const kept = list.filter((e) => {
      const ours = isOurEntry(e);
      if (ours) {
        removed += 1;
      }
      return !ours;
    });
    if (kept.length > 0) {
      hooks[hookType] = kept;
    } else {
      delete hooks[hookType];
    }
  }
  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  }
  writeSettings(file, settings);
  gatewayLog.info(TAG, `removed ${removed} Claude Code hook entr${removed === 1 ? "y" : "ies"}`);
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
    } else {
      uninstallHooks();
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
}
