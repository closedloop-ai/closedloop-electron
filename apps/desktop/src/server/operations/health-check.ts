import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { OperationDispatcher, OperationRequestContext } from "../operation-dispatcher.js";
import { isPluginInstalled } from "./plugin-cache.js";
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
  getSymphonyDir: () => string
): void {
  const configDir = () => path.join(getSymphonyDir(), "config");

  dispatcher.register("GET", "/api/engineer/health-check", async (context) => {
    const checks = await Promise.all([
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
    ]);

    const allRequiredPassed = checks.filter((check) => check.required).every((check) => check.passed);
    json(context, 200, { checks, allRequiredPassed });
  });
}

/**
 * Resolve the user's login-shell PATH.
 * Electron on macOS inherits a minimal PATH that excludes /opt/homebrew/bin,
 * nvm paths, etc.  Spawning the user's shell with -ilc gives us the real PATH.
 */
let resolvedPathPromise: Promise<string> | undefined;
async function getShellPath(): Promise<string> {
  if (resolvedPathPromise) {
    return resolvedPathPromise;
  }
  resolvedPathPromise = (async () => {
    try {
      const shell = process.env.SHELL || "/bin/zsh";
      const { stdout } = await execFileAsync(shell, ["-ilc", "echo $PATH"], {
        timeout: 3000,
      });
      return stdout.trim();
    } catch {
      return `${process.env.PATH ?? ""}:/opt/homebrew/bin:/usr/local/bin`;
    }
  })();
  return resolvedPathPromise;
}

async function runCommand(_processManager: ProcessManager, cmd: string, args: string[]): Promise<string> {
  const shellPath = await getShellPath();
  const { stdout } = await execFileAsync(cmd, args, {
    timeout: 3000,
    env: { ...process.env, PATH: shellPath },
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
