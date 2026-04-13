import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { loopLog, runLoopsSetupScript } from "./symphony-utils.js";
import type { WorktreeProvider } from "./symphony-loop-types.js";
import { shellEscape } from "./symphony-loop-pipeline.js";

// ---------------------------------------------------------------------------
// Worktree implementations
// ---------------------------------------------------------------------------

export async function ensureWorktreeImpl(
  expandedRepoPath: string,
  worktreeDir: string,
  branchName: string,
  baseBranch: string,
  loopId: string,
): Promise<void> {
  if (existsSync(worktreeDir)) {
    return;
  }

  await fs.mkdir(path.dirname(worktreeDir), { recursive: true });

  try {
    execSync("git fetch origin", {
      cwd: expandedRepoPath,
      stdio: "pipe",
      timeout: 30_000,
    });
  } catch {
    // non-fatal
  }

  // Resolve base ref
  let baseRef = `origin/${baseBranch}`;
  try {
    execSync(`git rev-parse --verify ${shellEscape(baseRef)}`, {
      cwd: expandedRepoPath,
      stdio: "pipe",
      timeout: 10_000,
    });
  } catch {
    baseRef = baseBranch;
  }

  execSync(
    `git worktree add -B ${shellEscape(branchName)} ${shellEscape(worktreeDir)} ${shellEscape(baseRef)}`,
    {
      cwd: expandedRepoPath,
      stdio: "pipe",
      timeout: 30_000,
    },
  );

  await runLoopsSetupScript(worktreeDir, loopId);
}

/** Find existing worktree for a branch name. */
export function findWorktreeForBranchImpl(
  expandedRepoPath: string,
  branchName: string,
): string | null {
  try {
    const output = execSync("git worktree list --porcelain", {
      cwd: expandedRepoPath,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 10_000,
    });

    let currentWorktree: string | null = null;
    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        currentWorktree = line.slice("worktree ".length);
      }
      if (line.startsWith("branch ") && line.endsWith(`/${branchName}`)) {
        return currentWorktree;
      }
    }
  } catch {
    // fall through
  }
  return null;
}

// findExistingLoopWorktree was removed -- it greedy-matched ANY loop worktree
// from ANY prior loop, causing new PLAN loops to reuse stale worktrees.
// PLAN always creates a fresh worktree. EXECUTE/REQUEST_CHANGES reuse via
// findWorktreeForBranch(parentBranchName) which matches the specific parent.

/**
 * Remove a worktree via git worktree remove, falling back to
 * fs.rm + git worktree prune. Used from both handleProcessCompletion and
 * early-return cleanup in handleLoopRequest.
 */
export async function removeWorktreeImpl(
  worktreeDir: string,
  expandedRepoPath: string,
  loopId?: string,
): Promise<void> {
  try {
    execSync(`git worktree remove --force ${shellEscape(worktreeDir)}`, {
      cwd: expandedRepoPath,
      stdio: "pipe",
      timeout: 15_000,
    });
  } catch {
    if (loopId) {
      loopLog(
        loopId,
        `git worktree remove failed for GENERATE_PRD, falling back to fs.rm`,
      );
    }
    await fs.rm(worktreeDir, { recursive: true, force: true });
    try {
      execSync("git worktree prune", {
        cwd: expandedRepoPath,
        stdio: "pipe",
        timeout: 10_000,
      });
    } catch {
      // Best-effort
    }
  }
}

/** Read the current branch name from a worktree directory. */
export function getCurrentBranchImpl(worktreeDir: string): string | null {
  try {
    return (
      execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: worktreeDir,
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 5_000,
      }).trim() || null
    );
  } catch {
    return null;
  }
}

export const defaultWorktreeProvider: WorktreeProvider = {
  ensureWorktree: ensureWorktreeImpl,
  findWorktreeForBranch: findWorktreeForBranchImpl,
  removeWorktree: removeWorktreeImpl,
  getCurrentBranch: getCurrentBranchImpl,
};
