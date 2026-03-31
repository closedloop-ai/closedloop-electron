import { execFile } from "node:child_process";
import fs from "node:fs/promises";
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
const GH_TOKEN_SENTINEL_START = "__CLGHTOKEN_START__";
const GH_TOKEN_SENTINEL_END = "__CLGHTOKEN_END__";

type ShellBootstrap = { path: string; ghToken: string | null };

let resolvedBootstrapPromise: Promise<ShellBootstrap> | undefined;
let resolvedGhConfigDirPromise: Promise<string> | undefined;

/**
 * Resolve PATH and gh auth token in a single login-shell invocation.
 *
 * macOS Tahoe 26.x broke the `security` CLI — `security find-generic-password`
 * hangs for processes without a SecurityAgent session (i.e. Electron launched
 * from the Dock).  The login shell spawned via `-ilc` retains the session, so
 * we capture the gh token here and expose it via `getGhToken()` for callers
 * that need to inject it into gh-specific child processes.
 */
function resolveShellBootstrap(): Promise<ShellBootstrap> {
  resolvedBootstrapPromise ??= (async () => {
    try {
      const shell = process.env.SHELL || "/bin/zsh";
      const cmd = [
        `echo ${PATH_SENTINEL_START}\${PATH}${PATH_SENTINEL_END}`,
        `echo ${GH_TOKEN_SENTINEL_START}$(gh auth token 2>/dev/null)${GH_TOKEN_SENTINEL_END}`,
      ].join("; ");
      const { stdout } = await execFileAsync(shell, ["-ilc", cmd], {
        timeout: 5000,
      });
      const path = expandTildes(extractPathFromOutput(stdout));
      const ghToken = extractBetweenSentinels(stdout, GH_TOKEN_SENTINEL_START, GH_TOKEN_SENTINEL_END);
      cachedGhToken = ghToken;

      return { path, ghToken };
    } catch {
      return {
        path: expandTildes(`${process.env.PATH ?? ""}:/opt/homebrew/bin:/usr/local/bin`),
        ghToken: null,
      };
    }
  })();
  return resolvedBootstrapPromise;
}

export async function getShellPath(): Promise<string> {
  const { path } = await resolveShellBootstrap();
  return path;
}

/**
 * Return the cached gh auth token resolved from the user's login shell.
 * Returns null if gh is not installed or not authenticated.
 */
export async function getGhToken(): Promise<string | null> {
  const { ghToken } = await resolveShellBootstrap();
  return ghToken;
}

/**
 * Synchronous accessor for the cached gh token.
 * Only returns a value after resolveShellBootstrap() has completed (i.e.
 * after the first await of getShellPath/getGhToken). Safe to call in
 * synchronous code paths that run after server startup.
 */
let cachedGhToken: string | null = null;

export function getGhTokenSync(): string | null {
  return cachedGhToken;
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
 * Extract a value between sentinel markers in shell output.
 * Returns null if the sentinels are missing or the value is empty.
 */
function extractBetweenSentinels(
  stdout: string,
  startSentinel: string,
  endSentinel: string
): string | null {
  const startIdx = stdout.indexOf(startSentinel);
  const endIdx = stdout.indexOf(endSentinel);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return null;
  }
  const value = stdout.slice(startIdx + startSentinel.length, endIdx).trim();
  return value.length > 0 ? value : null;
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
 * Build a hardened environment for gh child processes launched from Electron.
 *
 * We avoid inheriting the full Electron environment because newer macOS/Electron
 * combinations have shown non-deterministic hangs in networked gh commands.
 * Keeping this env minimal also prevents gh from consulting interactive helpers.
 */
export async function getGhEnv(extra?: Record<string, string>): Promise<Record<string, string>> {
  const [shellPath, ghToken, ghConfigDir] = await Promise.all([
    getShellPath(),
    getGhToken(),
    getGhConfigDir(),
  ]);

  const env: Record<string, string> = {
    PATH: shellPath,
    HOME: process.env.HOME ?? os.homedir(),
    SHELL: process.env.SHELL ?? "/bin/zsh",
    TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
    LANG: process.env.LANG ?? "en_US.UTF-8",
    GH_CONFIG_DIR: ghConfigDir,
    GH_NO_UPDATE_NOTIFIER: "1",
    GH_PROMPT_DISABLED: "1",
    GH_PAGER: "",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
    BROWSER: "",
    GH_BROWSER: "",
  };

  for (const key of [
    "LC_ALL",
    "LC_CTYPE",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NO_PROXY",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
  ]) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }

  if (ghToken) {
    env.GH_TOKEN = ghToken;
  }

  return {
    ...env,
    ...extra,
  };
}

export function getGhEnvSync(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? os.homedir(),
    SHELL: process.env.SHELL ?? "/bin/zsh",
    TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
    LANG: process.env.LANG ?? "en_US.UTF-8",
    GH_CONFIG_DIR: path.join(os.tmpdir(), "closedloop-gh"),
    GH_NO_UPDATE_NOTIFIER: "1",
    GH_PROMPT_DISABLED: "1",
    GH_PAGER: "",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
    BROWSER: "",
    GH_BROWSER: "",
  };

  for (const key of [
    "LC_ALL",
    "LC_CTYPE",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NO_PROXY",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
  ]) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }

  if (cachedGhToken) {
    env.GH_TOKEN = cachedGhToken;
  }

  return {
    ...env,
    ...extra,
  };
}

function getGhConfigDir(): Promise<string> {
  resolvedGhConfigDirPromise ??= (async () => {
    const ghConfigDir = path.join(os.tmpdir(), "closedloop-gh");
    await fs.mkdir(ghConfigDir, { recursive: true });
    return ghConfigDir;
  })();
  return resolvedGhConfigDirPromise;
}

/**
 * Reset the cached shell PATH.  Only needed in tests.
 */
export function resetShellPathCache(): void {
  resolvedBootstrapPromise = undefined;
  resolvedGhConfigDirPromise = undefined;
  cachedGhToken = null;
}

/**
 * Lock the resolved shell PATH to the current process.env.PATH.
 * Only needed in tests that set process.env.PATH to a fake-bin directory —
 * call this instead of resetShellPathCache() so the next getShellPath()
 * returns the test's PATH rather than spawning a login shell that may
 * rebuild PATH via macOS path_helper.
 */
export function setShellPathForTest(): void {
  resolvedBootstrapPromise = Promise.resolve({
    path: process.env.PATH ?? "",
    ghToken: null,
  });
  resolvedGhConfigDirPromise = Promise.resolve(path.join(os.tmpdir(), "closedloop-gh-test"));
}
