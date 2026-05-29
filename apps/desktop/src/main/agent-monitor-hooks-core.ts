// Electron-free core of the Agent Monitor hook installer. Path resolution,
// `app.getPath()`, `electron-store`, and the `gatewayLog` logger live in the
// outer `agent-monitor-hooks.ts` shell; this module owns only the
// settings-file manipulation, hook-entry generation, and idempotent merge
// logic so the behavior can be exercised under `tsx --test` without an
// Electron runtime.
//
// FEA-1444: extended with Codex hook handling. The Codex path mirrors the
// Claude path: distinct handler filename, distinct settings file, separate
// idempotency predicate. Both file targets are JSON with the same outer
// `{ hooks: { <EventName>: [{ matcher?, hooks: [{ type, command }] }] } }`
// shape (Codex's experimental hook config gated by `[features].codex_hooks`).

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

// Distinct handler filenames let isClaudeEntry / isCodexEntry coexist safely
// even if a future bug ever co-mingles entries in one settings file.
export const CLAUDE_HANDLER_FILENAME = "hook-handler.js";
export const CODEX_HANDLER_FILENAME = "codex-hook-handler.js";

// Mirrors the upstream install-hooks.js contract: same event set, same
// matcher rule. Re-verify on every upstream bump.
export const HOOKS_WITH_MATCHER = [
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SubagentStop",
  "Notification",
] as const;
export const HOOKS_WITHOUT_MATCHER = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
] as const;
export const HOOK_TYPES = [...HOOKS_WITH_MATCHER, ...HOOKS_WITHOUT_MATCHER];

// FEA-1444: Codex hook surface is narrower than Claude's (no SessionEnd,
// SubagentStop, or Notification today). Per Daniel Levesque's reference
// writer in closedloop-ai/workflow `telemetry/codex-hook-writer.js`.
// Re-verify on Codex version bumps.
export const CODEX_HOOKS_WITH_MATCHER = [
  "PreToolUse",
  "PostToolUse",
] as const;
export const CODEX_HOOKS_WITHOUT_MATCHER = [
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
] as const;
export const CODEX_HOOK_TYPES = [
  ...CODEX_HOOKS_WITH_MATCHER,
  ...CODEX_HOOKS_WITHOUT_MATCHER,
];
// Codex `SessionStart` accepts a matcher distinguishing fresh startup from
// a resumed session; the other events do not honor matchers.
export const CODEX_SESSION_START_MATCHER = "startup|resume";

/**
 * Filename-boundary check: matches a path token equal to `filename` preceded
 * by a path separator. Prevents `codex-hook-handler.js` from matching the
 * `hook-handler.js` probe (and vice versa).
 */
function commandReferences(entry: unknown, filename: string): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const e = entry as {
    command?: unknown;
    hooks?: Array<{ command?: unknown }>;
  };
  const haystack = (s: unknown) =>
    typeof s === "string" &&
    (s.includes(`/${filename}"`) ||
      s.includes(`/${filename} `) ||
      s.includes(`\\${filename}"`) ||
      s.includes(`\\${filename} `));
  if (haystack(e.command)) {
    return true;
  }
  if (Array.isArray(e.hooks)) {
    return e.hooks.some((h) => haystack(h?.command));
  }
  return false;
}

export function isClaudeEntry(entry: unknown): boolean {
  return commandReferences(entry, CLAUDE_HANDLER_FILENAME);
}

export function isCodexEntry(entry: unknown): boolean {
  return commandReferences(entry, CODEX_HANDLER_FILENAME);
}

/**
 * Returns the shell-ready hook command. Caller supplies `execPath` (typically
 * `process.execPath`) so the command spawns the Electron binary as Node via
 * `ELECTRON_RUN_AS_NODE=1` — no system `node` is required.
 */
export function makeHookCommand(
  execPath: string,
  handler: string,
  hookType: string,
): string {
  return `ELECTRON_RUN_AS_NODE=1 "${execPath}" "${handler}" ${JSON.stringify(hookType)}`;
}

export function makeClaudeHookEntry(
  execPath: string,
  handler: string,
  hookType: string,
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    hooks: [
      { type: "command", command: makeHookCommand(execPath, handler, hookType) },
    ],
  };
  if ((HOOKS_WITH_MATCHER as readonly string[]).includes(hookType)) {
    entry.matcher = "*";
  }
  return entry;
}

export function makeCodexHookEntry(
  execPath: string,
  handler: string,
  hookType: string,
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    hooks: [
      { type: "command", command: makeHookCommand(execPath, handler, hookType) },
    ],
  };
  if ((CODEX_HOOKS_WITH_MATCHER as readonly string[]).includes(hookType)) {
    entry.matcher = "*";
  } else if (hookType === "SessionStart") {
    entry.matcher = CODEX_SESSION_START_MATCHER;
  }
  return entry;
}

export function readSettingsFile(file: string): Record<string, unknown> {
  if (!existsSync(file)) {
    return {};
  }
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

/**
 * Atomic-rename write: stage to a sibling `.tmp` file, then `rename` so a
 * crash mid-write never leaves a half-written settings file the user's
 * tooling has to recover from.
 */
export function writeSettingsFile(file: string, settings: unknown): void {
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true });
  const tempFile = path.join(
    dir,
    `${path.basename(file)}.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(tempFile, JSON.stringify(settings, null, 2) + "\n", "utf8");
  renameSync(tempFile, file);
}

export interface ApplyHooksInput {
  /** Path to the JSON settings file to mutate. */
  file: string;
  /** Hook event names to install. */
  hookTypes: readonly string[];
  /** Identity predicate: returns true for an entry owned by this installer. */
  isOurEntry: (entry: unknown) => boolean;
  /** Factory: produce the canonical entry for one hook type. */
  makeEntry: (hookType: string) => Record<string, unknown>;
}

/**
 * Idempotent in-place install: replaces a stale entry of ours (self-heals a
 * moved handler path) or appends a fresh one. Mirrors upstream
 * `install-hooks.js`. Returns the number of entries installed plus the
 * number repaired.
 */
export function applyHookInstall(
  input: ApplyHooksInput,
): { installed: number; repaired: number } {
  const settings = readSettingsFile(input.file);
  const hooks = (settings.hooks ??= {}) as Record<string, unknown[]>;
  let installed = 0;
  let repaired = 0;

  for (const hookType of input.hookTypes) {
    const list = (hooks[hookType] ??= []);
    const idx = list.findIndex(input.isOurEntry);
    const entry = input.makeEntry(hookType);
    if (idx >= 0) {
      list[idx] = entry;
      repaired += 1;
    } else {
      list.push(entry);
      installed += 1;
    }
  }
  writeSettingsFile(input.file, settings);
  return { installed, repaired };
}

export interface ApplyUninstallInput {
  /** Path to the JSON settings file to clean. No-op if missing. */
  file: string;
  /** Identity predicate: returns true for an entry owned by this installer. */
  isOurEntry: (entry: unknown) => boolean;
}

/**
 * Removes only entries identified by `isOurEntry`. Preserves other entries.
 * Deletes empty per-event arrays and the outer `hooks` block when nothing
 * remains, so the file stays clean.
 */
export function applyHookUninstall(input: ApplyUninstallInput): {
  removed: number;
} {
  if (!existsSync(input.file)) {
    return { removed: 0 };
  }
  const settings = readSettingsFile(input.file);
  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  if (!hooks) {
    return { removed: 0 };
  }
  let removed = 0;
  for (const hookType of Object.keys(hooks)) {
    const list = hooks[hookType];
    if (!Array.isArray(list)) {
      continue;
    }
    const kept = list.filter((e) => {
      const ours = input.isOurEntry(e);
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
  writeSettingsFile(input.file, settings);
  return { removed };
}
