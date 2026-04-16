import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { constants } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Observability } from "../../main/observability.js";
import type { OperationDispatcher, OperationRequestContext } from "../operation-dispatcher.js";
import { getShellEnv, resolveExecutablesOnPath } from "../shell-path.js";
import { detectMcpAvailability, type McpDetectionResult } from "./mcp-detection.js";
import { getInstalledPluginVersions, isPluginInstalled } from "./plugin-cache.js";
import type { ProcessManager } from "../process-manager.js";

const execFileAsync = promisify(execFile);
const VERSION_REGEX = /(\d+\.\d+[\w.-]*)/;

type CheckResult = {
  id: string;
  label: string;
  required: boolean;
  passed: boolean;
  version?: string;
  error?: string;
  remediation?: string;
  debug?: {
    errorCode?: string;       // "ENOENT" | "EACCES" | "ETIMEDOUT" | "EPERM" | other
    stderr?: string;          // trimmed, capped at 512 chars
    resolvedPath?: string;    // PATH string from getShellEnv(), truncated to 1 KiB
    shell?: string;           // basename of process.env.SHELL ("zsh" / "bash" / "fish")
    platform?: NodeJS.Platform;
    foundAt?: string[];       // executable locations where the binary was found (PATH sweep + known dirs)
    nonExecutableAt?: string[]; // paths that exist but are not executable (drives EACCES diagnostics)
  };
};

type ReposConfig = {
  repos?: Array<{ path: string; description?: string }>;
  settings?: {
    worktreeParentDir?: string;
    worktreeParentDirConfirmed?: boolean;
  };
};

type CommandError = {
  code: string;             // "ENOENT", "EACCES", "ETIMEDOUT", or "EUNKNOWN"
  stderr: string;
  message: string;
};

export function registerHealthCheckRoutes(
  dispatcher: OperationDispatcher,
  processManager: ProcessManager,
  getSymphonyDir: () => string,
  detectMcpOverride?: (
    provider: "claude" | "codex",
    expectedMcpUrl?: string
  ) => Promise<McpDetectionResult>
): void {
  const detectMcp = detectMcpOverride ?? detectMcpAvailability;
  const configDir = () => path.join(getSymphonyDir(), "config");

  dispatcher.register("GET", "/api/gateway/health-check", async (context) => {
    const expectedMcpUrl = context.query.get("expectedMcpUrl")?.trim() || undefined;
    const [checks, claudeMcp, codexMcp] = await Promise.all([
      Promise.all([
        checkGit(processManager),
        checkClaudeCli(processManager),
        checkGhCli(processManager),
        checkGhAuth(processManager),
        Promise.resolve(checkPlugin("code", "Symphony Plugin", true)),
        Promise.resolve(checkPlugin("platform", "Platform Plugin", true)),
        Promise.resolve(checkPlugin("judges", "Judges Plugin", true)),
        Promise.resolve(checkPlugin("code-review", "Code Review Plugin", true)),
        Promise.resolve(checkPlugin("self-learning", "Self-Learning Plugin", true)),
        Promise.resolve(await checkWorktreeDir(configDir)),
        checkCodex(processManager),
        checkPython3(processManager)
      ]),
      detectMcp("claude", expectedMcpUrl),
      detectMcp("codex", expectedMcpUrl),
    ]);

    // Check plugin versions if all plugins are installed
    const allPluginsInstalled = checks
      .filter((c) => c.id.startsWith("plugin-"))
      .every((c) => c.passed);
    if (allPluginsInstalled) {
      const installed = getInstalledPluginVersions();
      const versionResult = await checkPluginVersions(installed);
      if (versionResult !== undefined) {
        checks.push(versionResult);
      }
    }

    for (const check of checks) {
      Observability.healthCheckResult(check);
    }

    const allRequiredPassed = checks.filter((check) => check.required).every((check) => check.passed);
    const mcpServers = {
      claude: claudeMcp,
      codex: codexMcp,
    };
    json(context, 200, { checks, allRequiredPassed, mcpServers });
  });
}

type RunCommand = (
  cmd: string,
  args: string[],
  options?: { timeoutMs?: number }
) => Promise<{ stdout: string }>;

const defaultRunCommand: RunCommand = async (cmd, args, options) => {
  const env = await getShellEnv();
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      timeout: options?.timeoutMs ?? 3000,
      env,
    });
    return { stdout: stdout.trim() };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
    const code = e.killed ? "ETIMEDOUT" : (e.code ?? "EUNKNOWN");
    const stderr = (e.stderr ?? "").toString().trim().slice(0, 512);
    throw { code, stderr, message: e.message ?? "command failed" } satisfies CommandError;
  }
};

let runCommand: RunCommand = defaultRunCommand;

/**
 * @internal Test-only. Replace the binary command runner with a stub to
 * simulate ENOENT / EACCES / ETIMEDOUT without spawning real processes.
 * Call with no argument to restore the real implementation.
 */
export function _setRunCommandForTesting(fn?: RunCommand): void {
  runCommand = fn ?? defaultRunCommand;
}

function parseVersion(output: string): string | undefined {
  const match = VERSION_REGEX.exec(output);
  return match?.[1];
}

const KNOWN_CLAUDE_LOCATIONS: string[] = [
  "~/.claude/local/claude",       // Anthropic native installer default
  "/opt/homebrew/bin/claude",     // Apple Silicon Homebrew
  "/usr/local/bin/claude",        // Intel Homebrew / pre-Apple-Silicon
  "~/.bun/bin/claude",
  "~/.volta/bin/claude",
  "~/.local/bin/claude",
  "/snap/bin/claude",             // Linux snap
];

const KNOWN_GIT_LOCATIONS: string[] = [
  "/usr/bin/git",
  "/usr/local/bin/git",
  "/opt/homebrew/bin/git",
];

const KNOWN_GH_LOCATIONS: string[] = [
  "/opt/homebrew/bin/gh",
  "/usr/local/bin/gh",
  "~/.local/bin/gh",
];

const KNOWN_CODEX_LOCATIONS: string[] = [
  "~/.volta/bin/codex",
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex",
  "~/.bun/bin/codex",
  "~/.local/bin/codex",
];

const KNOWN_PYTHON3_LOCATIONS: string[] = [
  "/usr/bin/python3",
  "/usr/local/bin/python3",
  "/opt/homebrew/bin/python3",
  "~/.local/bin/python3",
];

function getInstallRemediation(binaryName: string, platform: NodeJS.Platform): string {
  const isMac = platform === "darwin";
  const isLinux = platform === "linux";
  switch (binaryName) {
    case "claude":
      return "Install: npm install -g @anthropic-ai/claude-code";
    case "codex":
      return "Install: npm install -g @openai/codex";
    case "git":
      if (isMac) return "Install: xcode-select --install";
      if (isLinux) return "Install via your package manager (e.g. apt install git, dnf install git)";
      return "Install Git: see https://git-scm.com";
    case "gh":
      if (isMac) return "Install: brew install gh (or see https://cli.github.com)";
      if (isLinux) return "Install the GitHub CLI: see https://github.com/cli/cli/blob/trunk/docs/install_linux.md";
      return "Install the GitHub CLI: see https://cli.github.com";
    case "python3":
      if (isMac) return "Install Python 3.10 or later: brew install python@3.13 (or see https://python.org)";
      if (isLinux) return "Install Python 3.10 or later via your package manager (e.g. apt install python3)";
      return "Install Python 3.10 or later: see https://python.org";
    default:
      return `Install ${binaryName}`;
  }
}

function expandTilde(loc: string): string {
  if (loc.startsWith("~/")) {
    return os.homedir() + loc.slice(1);
  }
  if (loc === "~") {
    return os.homedir();
  }
  return loc;
}

async function collectBinaryDebug(
  binaryName: string,
  spawnError: CommandError,
  knownLocations: string[]
): Promise<NonNullable<CheckResult["debug"]>> {
  const env = await getShellEnv();
  const shellPath = env.PATH ?? "";

  const pathHits = await resolveExecutablesOnPath(binaryName, shellPath);
  const seen = new Set<string>(pathHits);

  // Sweep PATH directories and known install locations, distinguishing
  // executable hits from files that exist but are not executable. The
  // latter drive EACCES diagnostics so remediation points at the actual
  // broken file rather than some other executable location.
  const pathSegmentCandidates = shellPath
    .split(path.delimiter)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => path.join(segment, binaryName));
  const candidates = [
    ...pathSegmentCandidates,
    ...knownLocations.map((loc) => expandTilde(loc)),
  ];

  const knownHits: string[] = [];
  const nonExecutableHits: string[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      await fs.access(candidate, constants.F_OK);
    } catch {
      continue; // does not exist
    }
    try {
      await fs.access(candidate, constants.X_OK);
      knownHits.push(candidate);
    } catch {
      nonExecutableHits.push(candidate);
    }
  }

  return {
    errorCode: spawnError.code,
    stderr: spawnError.stderr,
    resolvedPath: shellPath.slice(0, 1024),
    shell: path.basename(process.env.SHELL ?? ""),
    platform: process.platform,
    foundAt: [...pathHits, ...knownHits],
    ...(nonExecutableHits.length > 0 ? { nonExecutableAt: nonExecutableHits } : {}),
  };
}

function classifyBinaryError(binaryName: string, spawnError: CommandError, debug: NonNullable<CheckResult["debug"]>): string {
  const { errorCode } = debug;
  const foundAt = debug.foundAt ?? [];
  const nonExecutableAt = debug.nonExecutableAt ?? [];

  if (errorCode === "ENOENT") {
    if (foundAt.length > 0) {
      return `Found at ${foundAt[0]} but not on PATH`;
    }
    return "Not found";
  }

  if (errorCode === "EACCES" || errorCode === "EPERM") {
    // Prefer a path that actually has the permission problem over any
    // unrelated executable hit, so the error points at the real offender.
    const brokenPath = nonExecutableAt[0] ?? foundAt[0];
    if (brokenPath) {
      return `Found at ${brokenPath} but not executable`;
    }
    return "Permission denied";
  }

  if (errorCode === "ETIMEDOUT") {
    if (foundAt.length > 0) {
      return `Timed out running ${foundAt[0]} --version`;
    }
    return `Timed out running ${binaryName} --version`;
  }

  const raw = `${spawnError.code}: ${spawnError.stderr || spawnError.message}`;
  return raw.slice(0, 80);
}

function classifyBinaryRemediation(binaryName: string, spawnError: CommandError, debug: NonNullable<CheckResult["debug"]>): string {
  const { errorCode } = debug;
  const foundAt = debug.foundAt ?? [];
  const nonExecutableAt = debug.nonExecutableAt ?? [];
  const shell = debug.shell || "shell";
  const platform = debug.platform ?? process.platform;

  if (errorCode === "ENOENT") {
    if (foundAt.length > 0) {
      return `Add ${path.dirname(foundAt[0])} to PATH in your ${shell} rc, then restart the app`;
    }
    return getInstallRemediation(binaryName, platform);
  }

  if (errorCode === "EACCES" || errorCode === "EPERM") {
    const brokenPath = nonExecutableAt[0] ?? foundAt[0];
    if (brokenPath) {
      return `chmod +x ${brokenPath}`;
    }
    return `Check executable permissions on your ${binaryName} install`;
  }

  if (errorCode === "ETIMEDOUT") {
    return `Try \`${binaryName} --version\` in a terminal -- it may be hanging on startup`;
  }

  return "See diagnostics tab for details";
}

async function checkGit(_processManager: ProcessManager): Promise<CheckResult> {
  try {
    const { stdout } = await runCommand("git", ["--version"]);
    return { id: "git", label: "Git", required: true, passed: true, version: parseVersion(stdout) };
  } catch (err) {
    const spawnError = err as CommandError;
    const debug = await collectBinaryDebug("git", spawnError, KNOWN_GIT_LOCATIONS);
    return {
      id: "git",
      label: "Git",
      required: true,
      passed: false,
      error: classifyBinaryError("git", spawnError, debug),
      remediation: classifyBinaryRemediation("git", spawnError, debug),
      debug,
    };
  }
}

async function checkClaudeCli(_processManager: ProcessManager): Promise<CheckResult> {
  try {
    const { stdout } = await runCommand("claude", ["--version"]);
    return {
      id: "claude-cli",
      label: "Claude CLI",
      required: true,
      passed: true,
      version: parseVersion(stdout)
    };
  } catch (err) {
    const spawnError = err as CommandError;
    const debug = await collectBinaryDebug("claude", spawnError, KNOWN_CLAUDE_LOCATIONS);
    return {
      id: "claude-cli",
      label: "Claude CLI",
      required: true,
      passed: false,
      error: classifyBinaryError("claude", spawnError, debug),
      remediation: classifyBinaryRemediation("claude", spawnError, debug),
      debug,
    };
  }
}

async function checkGhCli(_processManager: ProcessManager): Promise<CheckResult> {
  try {
    const { stdout } = await runCommand("gh", ["--version"]);
    return {
      id: "gh-cli",
      label: "GitHub CLI",
      required: true,
      passed: true,
      version: parseVersion(stdout)
    };
  } catch (err) {
    const spawnError = err as CommandError;
    const debug = await collectBinaryDebug("gh", spawnError, KNOWN_GH_LOCATIONS);
    return {
      id: "gh-cli",
      label: "GitHub CLI",
      required: true,
      passed: false,
      error: classifyBinaryError("gh", spawnError, debug),
      remediation: classifyBinaryRemediation("gh", spawnError, debug),
      debug,
    };
  }
}

async function checkGhAuth(_processManager: ProcessManager): Promise<CheckResult> {
  try {
    await runCommand("gh", ["auth", "status"]);
    return { id: "gh-auth", label: "GitHub Auth", required: true, passed: true };
  } catch {
    return {
      id: "gh-auth",
      label: "GitHub Auth",
      required: true,
      passed: false,
      error: "Not authenticated",
      remediation: "Run: gh auth login"
    };
  }
}

function checkPlugin(name: string, label: string, required: boolean): CheckResult {
  if (isPluginInstalled(name)) {
    return { id: `plugin-${name}`, label, required, passed: true };
  }

  return {
    id: `plugin-${name}`,
    label,
    required,
    passed: false,
    error: "Not found",
    remediation: `Install the closedloop-ai/${name} plugin in Claude Code`
  };
}

async function checkWorktreeDir(getConfigDir: () => string): Promise<CheckResult> {
  let configDir: string;
  try {
    configDir = getConfigDir();
  } catch {
    return {
      id: "worktree-dir",
      label: "Worktree Directory",
      required: true,
      passed: false,
      error: "Not configured",
      remediation: "Set the parent directory where git worktrees will be created"
    };
  }
  const config = await loadReposConfig(configDir);
  const configuredDir = config.settings?.worktreeParentDir;
  const confirmed = config.settings?.worktreeParentDirConfirmed;
  if (configuredDir && confirmed) {
    return {
      id: "worktree-dir",
      label: "Worktree Directory",
      required: true,
      passed: true,
      version: configuredDir
    };
  }

  return {
    id: "worktree-dir",
    label: "Worktree Directory",
    required: true,
    passed: false,
    error: "Not configured",
    remediation: "Set the parent directory where git worktrees will be created"
  };
}

async function checkCodex(_processManager: ProcessManager): Promise<CheckResult> {
  try {
    const { stdout } = await runCommand("codex", ["--version"]);
    return { id: "codex", label: "Codex CLI", required: false, passed: true, version: parseVersion(stdout) };
  } catch (err) {
    const spawnError = err as CommandError;
    const debug = await collectBinaryDebug("codex", spawnError, KNOWN_CODEX_LOCATIONS);
    return {
      id: "codex",
      label: "Codex CLI",
      required: false,
      passed: false,
      error: classifyBinaryError("codex", spawnError, debug),
      remediation: classifyBinaryRemediation("codex", spawnError, debug),
      debug,
    };
  }
}

async function checkPython3(_processManager: ProcessManager): Promise<CheckResult> {
  const REMEDIATION = process.platform === "darwin"
    ? "Install Python 3.10 or later: brew install python@3.13"
    : "Install Python 3.10 or later: sudo apt-get install python3 (or your distro's package manager)";
  try {
    const { stdout } = await runCommand("python3", ["--version"]);
    const version = parseVersion(stdout);
    if (!version) {
      return {
        id: "python3",
        label: "python3",
        required: true,
        passed: false,
        error: "Unable to determine Python version",
        remediation: REMEDIATION,
      };
    }
    // parseVersion guarantees \d+\.\d+ so this always matches
    const m = /^(\d+)\.(\d+)/.exec(version)!;
    const major = Number(m[1]);
    const minor = Number(m[2]);
    if (major < 3 || (major === 3 && minor < 10)) {
      return {
        id: "python3",
        label: "python3",
        required: true,
        passed: false,
        version,
        error: `Python ${version} is below the required minimum of 3.10`,
        remediation: REMEDIATION,
      };
    }
    return { id: "python3", label: "python3", required: true, passed: true, version };
  } catch (err) {
    const spawnError = err as CommandError;
    const debug = await collectBinaryDebug("python3", spawnError, KNOWN_PYTHON3_LOCATIONS);
    return {
      id: "python3",
      label: "python3",
      required: true,
      passed: false,
      error: classifyBinaryError("python3", spawnError, debug),
      remediation: classifyBinaryRemediation("python3", spawnError, debug),
      debug,
    };
  }
}

const PLUGIN_VERSION_MAP: Record<string, string> = {
  "code@closedloop-ai": "code",
  "self-learning@closedloop-ai": "self-learning",
  "judges@closedloop-ai": "judges",
  "code-review@closedloop-ai": "code-review",
  "platform@closedloop-ai": "platform",
};

function parseStrictSemver(version: string): [number, number, number] | undefined {
  const parts = version.split(".");
  if (parts.length !== 3) {
    return undefined;
  }
  const numericOnly = /^\d+$/;
  const [majorStr, minorStr, patchStr] = parts;
  if (!(numericOnly.test(majorStr) && numericOnly.test(minorStr) && numericOnly.test(patchStr))) {
    return undefined;
  }
  return [Number(majorStr), Number(minorStr), Number(patchStr)];
}

function compareStrictSemver(installed: string, latest: string): boolean | undefined {
  const installedTuple = parseStrictSemver(installed);
  const latestTuple = parseStrictSemver(latest);
  if (installedTuple === undefined || latestTuple === undefined) {
    return undefined;
  }
  for (let i = 0; i < 3; i++) {
    if (installedTuple[i] > latestTuple[i]) {
      return true;
    }
    if (installedTuple[i] < latestTuple[i]) {
      return false;
    }
  }
  return true;
}

async function checkPluginVersions(installed: Record<string, string>): Promise<CheckResult | undefined> {
  const entries = Object.entries(PLUGIN_VERSION_MAP);

  const results = await Promise.allSettled(
    entries.map(([, folder]) =>
      fetch(
        `https://raw.githubusercontent.com/closedloop-ai/claude-plugins/main/plugins/${folder}/.claude-plugin/plugin.json`,
        { signal: AbortSignal.timeout(3000) }
      )
    )
  );

  const outdated: { key: string; installed: string; latest: string }[] = [];
  const upToDate: string[] = [];
  let unverified = 0;

  for (let i = 0; i < entries.length; i++) {
    const [pluginKey] = entries[i];
    const result = results[i];

    if (result.status === "rejected") {
      unverified++;
      continue;
    }

    const response = result.value;
    if (!response.ok) {
      unverified++;
      continue;
    }

    let latestVer: string;
    try {
      const body = (await response.json()) as { version?: unknown };
      if (typeof body.version !== "string") {
        unverified++;
        continue;
      }
      latestVer = body.version;
    } catch {
      unverified++;
      continue;
    }

    const installedVer = installed[pluginKey] ?? "";
    const cmp = compareStrictSemver(installedVer, latestVer);

    if (cmp === undefined) {
      unverified++;
    } else if (cmp === false) {
      outdated.push({ key: pluginKey, installed: installedVer, latest: latestVer });
    } else {
      upToDate.push(pluginKey);
    }
  }

  if (outdated.length > 0) {
    return {
      id: "plugin-versions",
      label: "Plugin Versions (@closedloop-ai)",
      required: false,
      passed: false,
      error: "Outdated: " + outdated.map((p) => `${p.key} (${p.installed} -> ${p.latest})`).join(", "),
      remediation: outdated.map((p) => `claude plugin install ${p.key}`).join(" && "),
    };
  }

  if (unverified > 0) {
    return {
      id: "plugin-versions",
      label: "Plugin Versions (@closedloop-ai)",
      required: false,
      passed: false,
      error: `${unverified}/${entries.length} plugin manifest(s) could not be verified`,
    };
  }

  return {
    id: "plugin-versions",
    label: "Plugin Versions (@closedloop-ai)",
    required: false,
    passed: true,
  };
}

async function loadReposConfig(configDir: string): Promise<ReposConfig> {
  try {
    const configPath = path.join(configDir, "repos.json");
    const content = await fs.readFile(configPath, "utf-8");
    return JSON.parse(content) as ReposConfig;
  } catch {
    return {};
  }
}

function json(context: OperationRequestContext, status: number, payload: unknown): void {
  context.response.statusCode = status;
  context.response.setHeader("content-type", "application/json");
  context.response.end(JSON.stringify(payload));
}
