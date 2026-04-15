import type { OperationDispatcher, OperationRequestContext } from "../operation-dispatcher.js";
import type { ProcessManager } from "../process-manager.js";
import { DirectoryNotAllowedError, assertPathAllowed } from "../security.js";
import { expandHome } from "./symphony-utils.js";

type GitAction =
  | "branch"
  | "commit"
  | "push"
  | "pull"
  | "status"
  | "branch-diff"
  | "sync-status";

export function registerGitActionRoutes(
  dispatcher: OperationDispatcher,
  processManager: ProcessManager,
  getAllowedDirectories: () => string[]
): void {
  dispatcher.register("POST", "/api/gateway/git", async (context) => {
    const body = parseBody(context);
    if (!body) {
      json(context, 400, { error: "Invalid JSON body" });
      return;
    }

    const action = body.action as GitAction | undefined;
    const repoPath = typeof body.repoPath === "string" ? body.repoPath : null;
    const branchName = typeof body.branchName === "string" ? body.branchName : undefined;
    const message = typeof body.message === "string" ? body.message : undefined;
    const baseBranch = typeof body.baseBranch === "string" ? body.baseBranch : "main";

    if (!repoPath) {
      json(context, 400, { error: "repoPath is required" });
      return;
    }

    const expandedRepoPath = expandHome(repoPath);
    try {
      assertPathAllowed(expandedRepoPath, getAllowedDirectories());
    } catch (error) {
      if (error instanceof DirectoryNotAllowedError) {
        json(context, 403, { error: "directory not allowed" });
        return;
      }
      throw error;
    }

    try {
      switch (action) {
        case "status":
          await handleStatus(context, processManager, expandedRepoPath);
          return;
        case "branch":
          await handleBranch(context, processManager, expandedRepoPath, branchName);
          return;
        case "commit":
          await handleCommit(context, processManager, expandedRepoPath, message);
          return;
        case "push":
          await handlePush(context, processManager, expandedRepoPath);
          return;
        case "pull":
          await handlePull(context, processManager, expandedRepoPath);
          return;
        case "branch-diff":
          await handleBranchDiff(context, processManager, expandedRepoPath, baseBranch);
          return;
        case "sync-status":
          await handleSyncStatus(context, processManager, expandedRepoPath);
          return;
        default:
          json(context, 400, { error: "Invalid action" });
          return;
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Unknown error";
      json(context, 500, { error: messageText });
    }
  });
}

async function handleStatus(
  context: OperationRequestContext,
  processManager: ProcessManager,
  repoPath: string
): Promise<void> {
  const currentBranch = await gitRead(processManager, repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const statusOutput = await gitRead(processManager, repoPath, ["status", "--porcelain"]);
  const lines = statusOutput.split("\n").filter(Boolean);

  const modified: string[] = [];
  const created: string[] = [];
  const deleted: string[] = [];
  const staged: string[] = [];

  for (const line of lines) {
    const statusCode = line.slice(0, 2);
    const file = line.slice(3).trim();
    if (!file) {
      continue;
    }
    if (statusCode.includes("M")) {
      modified.push(file);
    }
    if (statusCode.includes("A") || statusCode === "??") {
      created.push(file);
    }
    if (statusCode.includes("D")) {
      deleted.push(file);
    }
    if (statusCode[0] && statusCode[0] !== "?" && statusCode[0] !== " ") {
      staged.push(file);
    }
  }

  json(context, 200, {
    currentBranch: currentBranch || "unknown",
    hasChanges: lines.length > 0,
    files: { modified, created, deleted, staged }
  });
}

async function handleBranch(
  context: OperationRequestContext,
  processManager: ProcessManager,
  repoPath: string,
  branchName?: string
): Promise<void> {
  if (!branchName) {
    json(context, 400, { error: "branchName is required for branch action" });
    return;
  }

  const sanitizedBranch = branchName.replaceAll(/[^a-zA-Z0-9-_/]/g, "-");
  const branchesOutput = await gitRead(processManager, repoPath, ["branch", "--list", sanitizedBranch]);

  if (branchesOutput.trim()) {
    await gitRun(processManager, repoPath, ["checkout", sanitizedBranch]);
  } else {
    await gitRun(processManager, repoPath, ["checkout", "-b", sanitizedBranch]);
  }

  json(context, 200, {
    success: true,
    branchName: sanitizedBranch,
    message: `Switched to branch '${sanitizedBranch}'`
  });
}

async function handleCommit(
  context: OperationRequestContext,
  processManager: ProcessManager,
  repoPath: string,
  message?: string
): Promise<void> {
  if (!message) {
    json(context, 400, { error: "message is required for commit action" });
    return;
  }

  await gitRun(processManager, repoPath, ["add", "."]);
  const commitOutput = await gitRead(processManager, repoPath, ["commit", "-m", message]);
  const commitHashMatch = /\[.+\s([0-9a-f]{7,40})\]/.exec(commitOutput);
  const commitHash = commitHashMatch?.[1] ?? "unknown";

  json(context, 200, {
    success: true,
    commit: commitHash,
    message: "Committed changes"
  });
}

async function handlePush(
  context: OperationRequestContext,
  processManager: ProcessManager,
  repoPath: string
): Promise<void> {
  const branch = await gitRead(processManager, repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  await gitRun(processManager, repoPath, ["push", "origin", branch, "--set-upstream"]);
  json(context, 200, {
    success: true,
    pushed: true,
    message: `Pushed branch '${branch}' to remote`
  });
}

async function handlePull(
  context: OperationRequestContext,
  processManager: ProcessManager,
  repoPath: string
): Promise<void> {
  const branch = await gitRead(processManager, repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  await gitRun(processManager, repoPath, ["pull", "origin", branch]);
  json(context, 200, {
    success: true,
    message: `Pulled latest changes for '${branch}'`
  });
}

async function handleBranchDiff(
  context: OperationRequestContext,
  processManager: ProcessManager,
  repoPath: string,
  baseBranch: string
): Promise<void> {
  const currentBranch = await gitRead(processManager, repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const diffOutput = await gitRead(processManager, repoPath, [
    "diff",
    "--name-status",
    `origin/${baseBranch}...HEAD`
  ]);

  const files: { modified: string[]; created: string[]; deleted: string[] } = {
    modified: [],
    created: [],
    deleted: []
  };
  for (const line of diffOutput.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const [statusCode, file] = line.split(/\s+/, 2);
    if (!file) {
      continue;
    }
    if (statusCode.startsWith("A")) {
      files.created.push(file);
    } else if (statusCode.startsWith("D")) {
      files.deleted.push(file);
    } else {
      files.modified.push(file);
    }
  }

  json(context, 200, {
    baseBranch,
    currentBranch,
    files,
    totalChanges: files.modified.length + files.created.length + files.deleted.length
  });
}

async function handleSyncStatus(
  context: OperationRequestContext,
  processManager: ProcessManager,
  repoPath: string
): Promise<void> {
  await gitRun(processManager, repoPath, ["fetch", "origin"]);
  const currentBranch = await gitRead(processManager, repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const trackingBranch = await resolveTrackingBranch(processManager, repoPath);

  if (!trackingBranch) {
    json(context, 200, {
      isUpToDate: true,
      behindBy: 0,
      aheadBy: 0,
      currentBranch,
      trackingBranch: null
    });
    return;
  }

  const counts = await gitRead(processManager, repoPath, [
    "rev-list",
    "--left-right",
    "--count",
    `${currentBranch}...${trackingBranch}`
  ]);
  const [aheadRaw, behindRaw] = counts.split(/\s+/, 2);
  const aheadBy = Number.parseInt(aheadRaw ?? "0", 10) || 0;
  const behindBy = Number.parseInt(behindRaw ?? "0", 10) || 0;

  json(context, 200, {
    isUpToDate: aheadBy === 0 && behindBy === 0,
    behindBy,
    aheadBy,
    currentBranch,
    trackingBranch
  });
}

async function resolveTrackingBranch(
  processManager: ProcessManager,
  repoPath: string
): Promise<string | null> {
  const branches = await gitRead(processManager, repoPath, ["branch", "-r"]);
  if (branches.includes("origin/main")) {
    return "origin/main";
  }
  if (branches.includes("origin/master")) {
    return "origin/master";
  }
  return null;
}

async function gitRead(
  processManager: ProcessManager,
  repoPath: string,
  args: string[]
): Promise<string> {
  const result = await processManager.exec("git", args, repoPath);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

async function gitRun(
  processManager: ProcessManager,
  repoPath: string,
  args: string[]
): Promise<void> {
  const result = await processManager.exec("git", args, repoPath);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
}

function parseBody(context: OperationRequestContext): Record<string, unknown> | null {
  if (!context.body.trim()) {
    return {};
  }
  try {
    return JSON.parse(context.body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function json(context: OperationRequestContext, status: number, payload: unknown): void {
  context.response.statusCode = status;
  context.response.setHeader("content-type", "application/json");
  context.response.end(JSON.stringify(payload));
}

