import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { OperationDispatcher, OperationRequestContext } from "../operation-dispatcher.js";
import { getShellEnv } from "../shell-path.js";
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
};

type ReposConfig = {
  repos?: Array<{ path: string; description?: string }>;
  settings?: {
    worktreeParentDir?: string;
    worktreeParentDirConfirmed?: boolean;
  };
};

export function registerHealthCheckRoutes(
  dispatcher: OperationDispatcher,
  processManager: ProcessManager,
  getSymphonyDir: () => string,
  detectMcp: (
    provider: "claude" | "codex",
    expectedMcpUrl?: string
  ) => Promise<McpDetectionResult> = detectMcpAvailability
): void {
  const configDir = () => path.join(getSymphonyDir(), "config");

  dispatcher.register("GET", "/api/engineer/health-check", async (context) => {
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

    const allRequiredPassed = checks.filter((check) => check.required).every((check) => check.passed);
    const mcpServers = {
      claude: claudeMcp,
      codex: codexMcp,
    };
    json(context, 200, { checks, allRequiredPassed, mcpServers });
  });
}

async function runCommand(_processManager: ProcessManager, cmd: string, args: string[]): Promise<string> {
  const env = await getShellEnv();
  const { stdout } = await execFileAsync(cmd, args, {
    timeout: 3000,
    env,
  });
  return stdout.trim();
}

function parseVersion(output: string): string | undefined {
  const match = VERSION_REGEX.exec(output);
  return match?.[1];
}

async function checkGit(processManager: ProcessManager): Promise<CheckResult> {
  try {
    const output = await runCommand(processManager, "git", ["--version"]);
    return { id: "git", label: "Git", required: true, passed: true, version: parseVersion(output) };
  } catch {
    return {
      id: "git",
      label: "Git",
      required: true,
      passed: false,
      error: "Not found",
      remediation: process.platform === "darwin"
        ? "Install via Xcode CLT: xcode-select --install"
        : "Install: sudo apt-get install git (or your distro's package manager)"
    };
  }
}

async function checkClaudeCli(processManager: ProcessManager): Promise<CheckResult> {
  try {
    const output = await runCommand(processManager, "claude", ["--version"]);
    return {
      id: "claude-cli",
      label: "Claude CLI",
      required: true,
      passed: true,
      version: parseVersion(output)
    };
  } catch {
    return {
      id: "claude-cli",
      label: "Claude CLI",
      required: true,
      passed: false,
      error: "Not found",
      remediation: "Install: npm install -g @anthropic-ai/claude-code"
    };
  }
}

async function checkGhCli(processManager: ProcessManager): Promise<CheckResult> {
  try {
    const output = await runCommand(processManager, "gh", ["--version"]);
    return {
      id: "gh-cli",
      label: "GitHub CLI",
      required: true,
      passed: true,
      version: parseVersion(output)
    };
  } catch {
    return {
      id: "gh-cli",
      label: "GitHub CLI",
      required: true,
      passed: false,
      error: "Not found",
      remediation: process.platform === "darwin"
        ? "Install: brew install gh"
        : "Install: see https://github.com/cli/cli/blob/trunk/docs/install_linux.md"
    };
  }
}

async function checkGhAuth(processManager: ProcessManager): Promise<CheckResult> {
  try {
    await runCommand(processManager, "gh", ["auth", "status"]);
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

async function checkCodex(processManager: ProcessManager): Promise<CheckResult> {
  try {
    const output = await runCommand(processManager, "codex", ["--version"]);
    return { id: "codex", label: "Codex CLI", required: false, passed: true, version: parseVersion(output) };
  } catch {
    return {
      id: "codex",
      label: "Codex CLI",
      required: false,
      passed: false,
      error: "Not found",
      remediation: "Optional — enables debate/review features"
    };
  }
}

async function checkPython3(processManager: ProcessManager): Promise<CheckResult> {
  const REMEDIATION = process.platform === "darwin"
    ? "Install Python 3.10 or later: brew install python@3.13"
    : "Install Python 3.10 or later: sudo apt-get install python3 (or your distro's package manager)";
  try {
    const output = await runCommand(processManager, "python3", ["--version"]);
    const version = parseVersion(output);
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
  } catch {
    return {
      id: "python3",
      label: "python3",
      required: true,
      passed: false,
      error: "Not found",
      remediation: REMEDIATION,
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
