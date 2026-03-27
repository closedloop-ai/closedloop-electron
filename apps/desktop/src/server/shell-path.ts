import { execFile } from "node:child_process";
import os from "node:os";
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
      });
      return expandTildes(extractPathFromOutput(stdout));
    } catch {
      return expandTildes(`${process.env.PATH ?? ""}:/opt/homebrew/bin:/usr/local/bin`);
    }
  })();
  return resolvedPathPromise;
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
    ...(process.env as Record<string, string>),
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
 * Override the resolved shell PATH with an explicit value.
 * Only needed in tests that set process.env.PATH to a fake-bin directory —
 * call this instead of resetShellPathCache() so the next getShellPath()
 * returns the test's PATH rather than spawning a login shell that may
 * rebuild PATH via macOS path_helper.
 */
export function setShellPathForTest(path: string): void {
  resolvedPathPromise = Promise.resolve(path);
}
