// FEA-1444 regression coverage for the electron-free hook-install core.
// The outer agent-monitor-hooks.ts shell imports `electron`, which the
// `tsx --test` runner cannot load. The core module owns the install/uninstall
// logic in isolation so the behavior contract — idempotent install, in-place
// self-heal of a moved handler path, narrow-scope uninstall that leaves
// foreign entries alone, and clean separation between Claude and Codex
// handler identity — can be exercised here without an Electron runtime.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import {
  applyHookInstall,
  applyHookUninstall,
  CODEX_HOOK_TYPES,
  CODEX_SESSION_START_MATCHER,
  HOOK_TYPES,
  isClaudeEntry,
  isCodexEntry,
  makeClaudeHookEntry,
  makeCodexHookEntry,
} from "../src/main/agent-monitor-hooks-core.js";

let tempRoot = "";
const FAKE_EXEC = "/fake/Electron";
const CLAUDE_HANDLER = "/fake/userData/agent-monitor/hook-handler.js";
const CODEX_HANDLER = "/fake/userData/agent-monitor/codex-hook-handler.js";

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "fea1444-hooks-"));
});

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

test("isClaudeEntry / isCodexEntry distinguish handler identities", () => {
  const claudeCmd =
    `ELECTRON_RUN_AS_NODE=1 "${FAKE_EXEC}" "${CLAUDE_HANDLER}" "SessionStart"`;
  const codexCmd =
    `ELECTRON_RUN_AS_NODE=1 "${FAKE_EXEC}" "${CODEX_HANDLER}" "SessionStart"`;

  const claudeEntry = { hooks: [{ type: "command", command: claudeCmd }] };
  const codexEntry = { hooks: [{ type: "command", command: codexCmd }] };

  assert.equal(isClaudeEntry(claudeEntry), true);
  assert.equal(isClaudeEntry(codexEntry), false);
  assert.equal(isCodexEntry(codexEntry), true);
  assert.equal(isCodexEntry(claudeEntry), false);
});

test("makeClaudeHookEntry applies '*' matcher only to gated events", () => {
  const tooled = makeClaudeHookEntry(FAKE_EXEC, CLAUDE_HANDLER, "PreToolUse");
  assert.equal(tooled.matcher, "*");
  const sessionStart = makeClaudeHookEntry(
    FAKE_EXEC,
    CLAUDE_HANDLER,
    "SessionStart",
  );
  assert.equal(sessionStart.matcher, undefined);
});

test("makeCodexHookEntry uses startup|resume matcher for SessionStart", () => {
  const sessionStart = makeCodexHookEntry(
    FAKE_EXEC,
    CODEX_HANDLER,
    "SessionStart",
  );
  assert.equal(sessionStart.matcher, CODEX_SESSION_START_MATCHER);

  const tooled = makeCodexHookEntry(FAKE_EXEC, CODEX_HANDLER, "PreToolUse");
  assert.equal(tooled.matcher, "*");

  const stop = makeCodexHookEntry(FAKE_EXEC, CODEX_HANDLER, "Stop");
  // Codex Stop / UserPromptSubmit ignore matchers — must NOT emit one.
  assert.equal(stop.matcher, undefined);
});

test("applyHookInstall creates a fresh settings file with all hook types", () => {
  const file = join(tempRoot, "settings.json");
  const result = applyHookInstall({
    file,
    hookTypes: HOOK_TYPES,
    isOurEntry: isClaudeEntry,
    makeEntry: (h) => makeClaudeHookEntry(FAKE_EXEC, CLAUDE_HANDLER, h),
  });
  assert.equal(result.installed, HOOK_TYPES.length);
  assert.equal(result.repaired, 0);

  const settings = readJson(file) as {
    hooks: Record<string, unknown[]>;
  };
  for (const hookType of HOOK_TYPES) {
    assert.equal(settings.hooks[hookType].length, 1);
    assert.equal(isClaudeEntry(settings.hooks[hookType][0]), true);
  }
});

test("applyHookInstall is idempotent: re-running self-heals a moved handler path", () => {
  const file = join(tempRoot, "settings.json");
  // First install with the original path.
  applyHookInstall({
    file,
    hookTypes: HOOK_TYPES,
    isOurEntry: isClaudeEntry,
    makeEntry: (h) => makeClaudeHookEntry(FAKE_EXEC, CLAUDE_HANDLER, h),
  });

  // Simulate the .app moving: re-install with a different handler path. The
  // stale entry must be replaced in place (NOT appended) so the file does
  // not grow unboundedly across upgrades.
  const newHandler = "/fake/userData2/agent-monitor/hook-handler.js";
  const result = applyHookInstall({
    file,
    hookTypes: HOOK_TYPES,
    isOurEntry: isClaudeEntry,
    makeEntry: (h) => makeClaudeHookEntry(FAKE_EXEC, newHandler, h),
  });
  assert.equal(result.installed, 0);
  assert.equal(result.repaired, HOOK_TYPES.length);

  const settings = readJson(file) as {
    hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
  };
  for (const hookType of HOOK_TYPES) {
    assert.equal(settings.hooks[hookType].length, 1);
    const cmd = settings.hooks[hookType][0].hooks[0].command;
    assert.match(cmd, /userData2/);
  }
});

test("applyHookInstall preserves user-installed foreign entries", () => {
  const file = join(tempRoot, "settings.json");
  // Pre-seed a foreign entry the user installed themselves.
  writeFileSync(
    file,
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { hooks: [{ type: "command", command: "echo my-own-thing" }] },
        ],
      },
    }),
  );

  applyHookInstall({
    file,
    hookTypes: HOOK_TYPES,
    isOurEntry: isClaudeEntry,
    makeEntry: (h) => makeClaudeHookEntry(FAKE_EXEC, CLAUDE_HANDLER, h),
  });

  const settings = readJson(file) as {
    hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
  };
  // Foreign entry must still be present alongside ours.
  assert.equal(settings.hooks.PreToolUse.length, 2);
  assert.equal(
    settings.hooks.PreToolUse[0].hooks[0].command,
    "echo my-own-thing",
  );
  assert.equal(isClaudeEntry(settings.hooks.PreToolUse[1]), true);
});

test("applyHookUninstall removes only our entries and preserves foreign ones", () => {
  const file = join(tempRoot, "settings.json");
  // Install ours, then add a foreign entry.
  applyHookInstall({
    file,
    hookTypes: HOOK_TYPES,
    isOurEntry: isClaudeEntry,
    makeEntry: (h) => makeClaudeHookEntry(FAKE_EXEC, CLAUDE_HANDLER, h),
  });
  const seeded = readJson(file) as {
    hooks: Record<string, Array<unknown>>;
  };
  seeded.hooks.PreToolUse.push({
    hooks: [{ type: "command", command: "echo my-own-thing" }],
  });
  writeFileSync(file, JSON.stringify(seeded));

  const result = applyHookUninstall({ file, isOurEntry: isClaudeEntry });
  assert.equal(result.removed, HOOK_TYPES.length);

  const after = readJson(file) as {
    hooks?: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
  };
  // The only surviving event is PreToolUse, with only the foreign entry.
  assert.deepEqual(Object.keys(after.hooks ?? {}), ["PreToolUse"]);
  assert.equal(after.hooks?.PreToolUse.length, 1);
  assert.equal(
    after.hooks?.PreToolUse[0].hooks[0].command,
    "echo my-own-thing",
  );
});

test("applyHookUninstall deletes the hooks block when nothing remains", () => {
  const file = join(tempRoot, "settings.json");
  applyHookInstall({
    file,
    hookTypes: HOOK_TYPES,
    isOurEntry: isClaudeEntry,
    makeEntry: (h) => makeClaudeHookEntry(FAKE_EXEC, CLAUDE_HANDLER, h),
  });
  applyHookUninstall({ file, isOurEntry: isClaudeEntry });

  const after = readJson(file);
  assert.equal(
    Object.prototype.hasOwnProperty.call(after, "hooks"),
    false,
    "outer `hooks` block must be removed when no entries remain",
  );
});

test("applyHookUninstall is a no-op when the settings file does not exist", () => {
  const result = applyHookUninstall({
    file: join(tempRoot, "does-not-exist.json"),
    isOurEntry: isClaudeEntry,
  });
  assert.equal(result.removed, 0);
});

test("Codex install does not touch Claude entries in a co-mingled file", () => {
  // Defensive check: although Claude hooks live in ~/.claude/settings.json
  // and Codex hooks live in ~/.codex/hooks.json under normal operation, the
  // filename-boundary predicates must not cross-match if entries ever end
  // up co-mingled (e.g., a future change targeting the same file).
  const file = join(tempRoot, "settings.json");
  applyHookInstall({
    file,
    hookTypes: HOOK_TYPES,
    isOurEntry: isClaudeEntry,
    makeEntry: (h) => makeClaudeHookEntry(FAKE_EXEC, CLAUDE_HANDLER, h),
  });
  const claudePreToolBefore = (readJson(file) as {
    hooks: Record<string, Array<unknown>>;
  }).hooks.PreToolUse.length;

  applyHookInstall({
    file,
    hookTypes: CODEX_HOOK_TYPES,
    isOurEntry: isCodexEntry,
    makeEntry: (h) => makeCodexHookEntry(FAKE_EXEC, CODEX_HANDLER, h),
  });

  const settings = readJson(file) as {
    hooks: Record<string, Array<unknown>>;
  };
  // Claude PreToolUse entry must still be present (now alongside the Codex
  // one). Total count for PreToolUse should be claudePreToolBefore + 1.
  assert.equal(
    settings.hooks.PreToolUse.length,
    claudePreToolBefore + 1,
    "Codex install must not have replaced the Claude PreToolUse entry",
  );

  // Now uninstall Codex; Claude entries must remain intact.
  applyHookUninstall({ file, isOurEntry: isCodexEntry });
  const afterCodexUninstall = readJson(file) as {
    hooks: Record<string, Array<unknown>>;
  };
  assert.equal(
    afterCodexUninstall.hooks.PreToolUse.length,
    claudePreToolBefore,
    "Codex uninstall must not have touched the Claude entry",
  );
});
