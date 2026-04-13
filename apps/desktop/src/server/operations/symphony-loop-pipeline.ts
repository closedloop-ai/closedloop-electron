import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  findPluginVersions,
  getPluginCacheRoot,
} from "./plugin-cache.js";

// ---------------------------------------------------------------------------
// Claude binary resolution
// ---------------------------------------------------------------------------

/**
 * Cached absolute path to the `claude` binary, resolved once at first use.
 *
 * Resolution strategy (tried in order):
 *   1. `which claude` using the current process.env.PATH (fast; works in
 *      tests where PATH is set to a fake-bin directory, and in dev shells).
 *   2. `bash -lc 'which claude'` in a login shell so that nvm/homebrew/local
 *      bin directories are found even when Electron strips PATH at launch via
 *      the .app bundle, launchd (macOS), or systemd (Linux).
 *   3. Falls back to the bare string "claude" so that the caller can still
 *      attempt spawn and receive a descriptive ENOENT error.
 */
let resolvedClaudePath: string | null = null;

/**
 * Reset the cached claude binary path. Intended for use in tests where PATH
 * changes between test cases -- production code should not call this.
 */
export function resetResolvedClaudePath(): void {
  resolvedClaudePath = null;
}

export function getResolvedClaudePath(): string {
  // If we have a cached path, return it only if the binary still exists on
  // disk. This handles test scenarios where a fake binary directory is cleaned
  // up between test cases, causing the cached path to become stale.
  if (resolvedClaudePath !== null && existsSync(resolvedClaudePath)) {
    return resolvedClaudePath;
  }
  // Invalidate stale cache entry before re-resolving
  resolvedClaudePath = null;

  // Strategy 1: which via current process PATH (works in tests and dev shells)
  try {
    const result = execFileSync("which", ["claude"], {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 5_000,
    }).trim();
    if (result) {
      resolvedClaudePath = result;
      return resolvedClaudePath;
    }
  } catch {
    // Not found in current PATH -- try login shell
  }

  // Strategy 2: login shell which -- sources ~/.nvm/nvm.sh and similar to
  // populate the full user PATH that Electron strips on launch.
  try {
    const result = execFileSync("bash", ["-lc", "which claude"], {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 5_000,
    }).trim();
    if (result) {
      resolvedClaudePath = result;
      return resolvedClaudePath;
    }
  } catch {
    // Login shell which also failed -- fall through to bare name fallback
  }

  // Fall back to bare name; spawn will throw ENOENT with a descriptive message
  resolvedClaudePath = "claude";
  return resolvedClaudePath;
}

// ---------------------------------------------------------------------------
// Shell helpers
// ---------------------------------------------------------------------------

export function shellEscape(value: string): string {
  return "'" + value.replaceAll("'", String.raw`'\''`) + "'";
}

/**
 * Find the stream_formatter.py script from the code plugin.
 * Reuses getPluginCacheRoot() and findPluginVersions() from plugin-cache.ts.
 * Falls back to null if not installed -- caller should degrade gracefully.
 */
export function findStreamFormatter(): string | null {
  // Unit/integration tests set this to exercise the raw `claude` bash wrapper
  // without grep/tee/python (stub claude output is not a full formatter stream).
  if (process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE === "1") {
    return null;
  }
  const pluginDir = path.join(getPluginCacheRoot(), "code");
  const versions = findPluginVersions(pluginDir);
  for (const v of versions) {
    const p = path.join(pluginDir, v, "tools", "python", "stream_formatter.py");
    if (existsSync(p)) {
      return p;
    }
  }
  return null;
}

/**
 * Build a bash pipeline command that runs claude with stream-json output,
 * filters JSON lines, tees to a jsonl log, and formats for human reading.
 * Falls back to raw claude if formatter is not available.
 */
export function buildClaudePipeline(
  claudeArgs: string[],
  claudeWorkDir: string,
  stdinFile?: string,
): { cmd: string; args: string[] } {
  const formatter = findStreamFormatter();
  const stderrFile = path.join(claudeWorkDir, "claude-stderr.log");
  const jsonlFile = path.join(claudeWorkDir, "claude-output.jsonl");

  // Build the claude command with properly escaped args
  const escapedArgs = claudeArgs.map(shellEscape).join(" ");
  const claudeCmd = stdinFile
    ? `claude ${escapedArgs} < ${shellEscape(stdinFile)}`
    : `claude ${escapedArgs}`;

  if (formatter) {
    // Full pipeline matching run-loop.sh:
    // claude ... 2>stderr | grep JSON | tee jsonl | formatter
    const pipeline = [
      `${claudeCmd} 2>${shellEscape(stderrFile)}`,
      "grep --line-buffered '^{'",
      `tee -a ${shellEscape(jsonlFile)}`,
      `python3 ${shellEscape(formatter)}`,
    ].join(" | ");
    return { cmd: "bash", args: ["-c", `${pipeline}; exit \${PIPESTATUS[0]}`] };
  }

  // No formatter -- wrap in bash pipeline so grep|tee still writes claude-output.jsonl
  const pipeline = [
    `${claudeCmd} 2>${shellEscape(stderrFile)}`,
    "grep --line-buffered '^{'",
    `tee -a ${shellEscape(jsonlFile)}`,
  ].join(" | ");
  return { cmd: "bash", args: ["-c", `${pipeline}; exit \${PIPESTATUS[0]}`] };
}
