import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Expand leading ~ in each PATH segment to the user's home directory.
 * Shells expand ~ at assignment time, but single-quoted entries like
 * PATH='~/bin':$PATH preserve the literal ~.  child_process.spawn does
 * not perform tilde expansion, so we must do it ourselves.
 */
export function expandTildes(rawPath: string): string {
  const home = os.homedir();
  return rawPath
    .split(":")
    .map((seg) => (seg === "~" ? home : seg.startsWith("~/") ? home + seg.slice(1) : seg))
    .join(":");
}

/**
 * Resolve the user's login-shell PATH.
 * Electron on macOS inherits a minimal PATH that excludes /opt/homebrew/bin,
 * nvm paths, etc.  Spawning the user's shell with -ilc gives us the real PATH.
 *
 * We wrap the echo output in unique sentinels so shell startup chatter
 * (MOTD, "Restored session:", conda banners, etc.) can be stripped reliably.
 */
const PATH_SENTINEL_START = "__CLPATH_START__";
const PATH_SENTINEL_END = "__CLPATH_END__";

let resolvedPathPromise: Promise<string> | undefined;

export async function getShellPath(): Promise<string> {
  resolvedPathPromise ??= (async () => {
    try {
      const shell = process.env.SHELL || "/bin/zsh";
      const cmd = `echo ${PATH_SENTINEL_START}\${PATH}${PATH_SENTINEL_END}`;
      const { stdout } = await execFileAsync(shell, ["-ilc", cmd], {
        timeout: 3000,
        env: sanitizeSpawnEnv(process.env),
      });
      return expandTildes(extractPathFromOutput(stdout));
    } catch {
      return expandTildes(`${process.env.PATH ?? ""}:/opt/homebrew/bin:/usr/local/bin`);
    }
  })();
  return resolvedPathPromise;
}

/**
 * Strip env vars that break nvm and other tooling when the desktop app is
 * launched via pnpm.  pnpm sets `npm_config_prefix` to the project dir when
 * running scripts; nvm refuses to initialize in its presence and skips adding
 * the default node version to PATH.  Always sanitize before spawning shells
 * or Node-based CLIs (claude, codex, gh, etc.).
 */
export function sanitizeSpawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy = { ...env };
  delete copy.npm_config_prefix;
  delete copy.NPM_CONFIG_PREFIX;
  return copy;
}

/**
 * Extract the PATH value from shell output by finding the sentinel markers.
 * Falls back to trimming the last non-empty line if sentinels are missing.
 */
export function extractPathFromOutput(stdout: string): string {
  const startIdx = stdout.indexOf(PATH_SENTINEL_START);
  const endIdx = stdout.indexOf(PATH_SENTINEL_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return stdout.slice(startIdx + PATH_SENTINEL_START.length, endIdx);
  }
  // Fallback: take the last non-empty line (most likely the PATH value)
  const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
  return lines.at(-1)?.trim() ?? "";
}

/**
 * Build a process env with the resolved shell PATH.
 * Use this for every spawn/exec that invokes CLI tools (claude, gh, codex, etc.)
 * which may be installed outside Electron's minimal inherited PATH.
 */
export async function getShellEnv(
  extra?: Record<string, string>
): Promise<Record<string, string>> {
  const shellPath = await getShellPath();
  return {
    ...(sanitizeSpawnEnv(process.env) as Record<string, string>),
    PATH: shellPath,
    ...extra,
  };
}

/**
 * Reset the cached shell PATH.  Only needed in tests.
 */
export function resetShellPathCache(): void {
  resolvedPathPromise = undefined;
}

/**
 * Lock the resolved shell PATH to the current process.env.PATH.
 * Only needed in tests that set process.env.PATH to a fake-bin directory —
 * call this instead of resetShellPathCache() so the next getShellPath()
 * returns the test's PATH rather than spawning a login shell that may
 * rebuild PATH via macOS path_helper.
 */
export function setShellPathForTest(): void {
  resolvedPathPromise = Promise.resolve(process.env.PATH ?? "");
}

/**
 * Scan every directory in searchPath for an executable named binary.
 * Returns all hits (not just the first), in PATH order, deduplicated.
 */
export async function resolveExecutablesOnPath(
  binary: string,
  searchPath: string
): Promise<string[]> {
  const segments = searchPath
    .split(path.delimiter)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const hits: string[] = [];
  for (const segment of segments) {
    const candidate = path.join(segment, binary);
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    try {
      await access(candidate, constants.X_OK);
      hits.push(candidate);
    } catch {
      // not found or not executable
    }
  }
  return hits;
}
