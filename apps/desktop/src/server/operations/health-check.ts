import { existsSync, readdirSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OperationDispatcher, OperationRequestContext } from "../operation-dispatcher.js";
import type { ProcessManager } from "../process-manager.js";

const VERSION_REGEX = /(\d+\.\d+[\w.-]*)/;
const REPOS_CONFIG_PATH = path.join(os.homedir(), ".claude", "closedloop", "repos.json");

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
  processManager: ProcessManager
): void {
  dispatcher.register("GET", "/api/engineer/health-check", async (context) => {
    const checks = await Promise.all([
      checkGit(processManager),
      checkClaudeCli(processManager),
      checkGhCli(processManager),
      checkGhAuth(processManager),
      Promise.resolve(checkSymphonyPlugin()),
      Promise.resolve(await checkWorktreeDir()),
      checkCodex(processManager),
      checkPython3(processManager)
    ]);

    const allRequiredPassed = checks.filter((check) => check.required).every((check) => check.passed);
    json(context, 200, { checks, allRequiredPassed });
  });
}

async function runCommand(processManager: ProcessManager, cmd: string, args: string[]): Promise<string> {
  const result = await processManager.exec(cmd, args);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `command failed: ${cmd}`);
  }
  return result.stdout.trim();
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
      remediation: "Install via Xcode CLT: xcode-select --install"
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
      remediation: "Install: brew install gh"
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

function checkSymphonyPlugin(): CheckResult {
  const scriptPath = getSymphonyScriptPath();
  if (scriptPath) {
    return { id: "symphony-plugin", label: "Symphony Plugin", required: true, passed: true };
  }

  return {
    id: "symphony-plugin",
    label: "Symphony Plugin",
    required: true,
    passed: false,
    error: "Not found",
    remediation: "Install the closedloop/experimental plugin in Claude Code"
  };
}

async function checkWorktreeDir(): Promise<CheckResult> {
  const config = await loadReposConfig();
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
  try {
    const output = await runCommand(processManager, "python3", ["--version"]);
    return { id: "python3", label: "python3", required: false, passed: true, version: parseVersion(output) };
  } catch {
    return {
      id: "python3",
      label: "python3",
      required: false,
      passed: false,
      error: "Not found",
      remediation: "Optional — enables learnings processing"
    };
  }
}

async function loadReposConfig(): Promise<ReposConfig> {
  try {
    const content = await fs.readFile(REPOS_CONFIG_PATH, "utf-8");
    return JSON.parse(content) as ReposConfig;
  } catch {
    return {};
  }
}

function getSymphonyScriptPath(): string | undefined {
  const pluginDir = path.join(
    os.homedir(),
    ".claude",
    "plugins",
    "cache",
    "closedloop",
    "experimental"
  );

  if (!existsSync(pluginDir)) {
    return undefined;
  }

  const versions = findPluginVersions(pluginDir);
  for (const version of versions) {
    const scriptPath = path.join(pluginDir, version, "scripts", "run-loop.sh");
    if (existsSync(scriptPath)) {
      return scriptPath;
    }
  }

  return undefined;
}

function findPluginVersions(pluginDir: string): string[] {
  try {
    const entries = readdirSync(pluginDir);
    return entries
      .filter((entry) => /^\d+\.\d+\.\d+/.test(entry))
      .sort((a, b) => compareSemverDescending(a, b));
  } catch {
    return [];
  }
}

function compareSemverDescending(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const diff = (partsB[index] ?? 0) - (partsA[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function json(context: OperationRequestContext, status: number, payload: unknown): void {
  context.response.statusCode = status;
  context.response.setHeader("content-type", "application/json");
  context.response.end(JSON.stringify(payload));
}
