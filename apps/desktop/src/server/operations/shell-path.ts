/**
 * Resolve the user's interactive-shell PATH.
 *
 * Electron on macOS inherits a minimal PATH that excludes /opt/homebrew/bin,
 * nvm/volta paths, etc.  Spawning the user's login shell with `-ilc` gives
 * us the real PATH.  The result is cached after the first call.
 *
 * Two accessors are provided:
 *  - `getShellPath()` — async, triggers resolution on first call.
 *  - `getShellPathSync()` — returns the cached value if already resolved,
 *    otherwise falls back to `process.env.PATH` extended with common paths.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const FALLBACK_SUFFIX = ":/opt/homebrew/bin:/usr/local/bin";

let resolvedPath: string | undefined;
let resolvedPathPromise: Promise<string> | undefined;

export async function getShellPath(): Promise<string> {
  if (resolvedPathPromise) {
    return resolvedPathPromise;
  }
  resolvedPathPromise = (async () => {
    try {
      const shell = process.env.SHELL || "/bin/zsh";
      const { stdout } = await execFileAsync(shell, ["-ilc", "echo $PATH"], {
        timeout: 3000,
      });
      resolvedPath = stdout.trim();
      return resolvedPath;
    } catch {
      resolvedPath = `${process.env.PATH ?? ""}${FALLBACK_SUFFIX}`;
      return resolvedPath;
    }
  })();
  return resolvedPathPromise;
}

/**
 * Synchronous accessor — returns the cached shell PATH if `getShellPath()`
 * has already been awaited (health-check runs it at boot), otherwise returns
 * `process.env.PATH` extended with common tool directories.
 */
export function getShellPathSync(): string {
  return resolvedPath ?? `${process.env.PATH ?? ""}${FALLBACK_SUFFIX}`;
}

/**
 * Build a process env with the resolved shell PATH merged in.
 * Shorthand used by most operation handlers when spawning child processes.
 */
export function envWithShellPath(
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    PATH: `${process.env.PATH ?? ""}:${getShellPathSync()}`,
    ...extra,
  };
}
