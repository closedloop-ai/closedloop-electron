import { execFileSync, execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { DirectoryNotAllowedError, assertPathAllowed } from "../security.js";

/** Timeout for local-only git commands (rev-parse, checkout, diff, worktree list/prune). */
const LOCAL_GIT_TIMEOUT = 10_000;

/** Timeout for network-touching git commands (fetch, pull, rebase) and worktree add. */
const NETWORK_GIT_TIMEOUT = 30_000;

export class SymphonyDirNotConfiguredError extends Error {
  constructor() {
    super("Symphony directory not configured — complete onboarding");
    this.name = "SymphonyDirNotConfiguredError";
  }
}

export function computeSymphonyDir(sandboxBaseDirectory: string): string {
  return path.join(sandboxBaseDirectory, ".closedloop-ai");
}

export function expandHome(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

export function resolveWorktreeParentDir(expandedRepoPath: string): string {
  const configuredParent = process.env.SYMPHONY_WORKTREE_PARENT_DIR;
  if (configuredParent?.trim()) {
    return expandHome(configuredParent);
  }

  return path.dirname(expandedRepoPath);
}

export function sanitizeTicketId(ticketId: string): string {
  return ticketId.replaceAll(/[^a-zA-Z0-9-_]/g, "_");
}

export function resolveWorktreeDir(expandedRepoPath: string, ticketId: string): string {
  const sanitizedTicket = sanitizeTicketId(ticketId);
  const repoName = path.basename(expandedRepoPath);
  return path.join(resolveWorktreeParentDir(expandedRepoPath), `${repoName}-${sanitizedTicket}`);
}

export function assertRepoAllowed(repoPath: string, allowedDirectories: string[]): string {
  const expandedRepoPath = expandHome(repoPath);
  try {
    assertPathAllowed(expandedRepoPath, allowedDirectories);
    return expandedRepoPath;
  } catch (error) {
    if (error instanceof DirectoryNotAllowedError) {
      throw error;
    }
    throw error;
  }
}

// --- Worktree management for reviews ---

/**
 * Recursively find all .env and .env.local files in a directory.
 * Skips node_modules and hidden directories.
 */
function findEnvFiles(dir: string, results: string[] = []): string[] {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
          continue;
        }
        findEnvFiles(fullPath, results);
      } else if (entry.name === ".env" || entry.name === ".env.local") {
        results.push(fullPath);
      }
    }
  } catch {
    // Can't read directory
  }
  return results;
}

/**
 * Copy .env and .env.local files from base repo to worktree.
 * Git worktrees don't include ignored files, so we need to copy them manually.
 */
function copyEnvLocalFiles(repoPath: string, worktreePath: string): void {
  const envFiles = findEnvFiles(repoPath);
  for (const absPath of envFiles) {
    const relativePath = absPath.slice(repoPath.length + 1);
    const destPath = path.join(worktreePath, relativePath);
    try {
      copyFileSync(absPath, destPath);
    } catch {
      // Can't copy file (dest dir may not exist in worktree, permission issue, etc.)
    }
  }
}

/** Fetch latest refs from origin. No-op if offline. */
function fetchOrigin(repoPath: string): void {
  try {
    execSync("git fetch origin", {
      cwd: repoPath,
      stdio: "pipe",
      timeout: NETWORK_GIT_TIMEOUT,
    });
  } catch {
    // Offline — continue with local state
  }
}

/**
 * Save .claude/ from a non-git directory to a temp location.
 * Returns the temp path, or null if there was nothing to save.
 */
function saveClaudeState(worktreeDir: string): string | null {
  const claudeDir = path.join(worktreeDir, ".claude");
  if (!existsSync(claudeDir)) {
    return null;
  }
  const saved = path.join(os.tmpdir(), `worktree-claude-${Date.now()}`);
  renameSync(claudeDir, saved);
  return saved;
}

/**
 * Restore previously saved .claude/ state files into worktreeDir.
 * Merges work files if .claude/ already exists (created by git worktree add).
 */
function restoreClaudeState(savedDir: string, worktreeDir: string): void {
  const destClaude = path.join(worktreeDir, ".claude");
  if (!existsSync(destClaude)) {
    renameSync(savedDir, destClaude);
    return;
  }
  // Merge: copy saved work files into the new worktree's .claude/work
  const savedWork = path.join(savedDir, "work");
  if (existsSync(savedWork)) {
    const destWork = path.join(destClaude, "work");
    mkdirSync(destWork, { recursive: true });
    for (const file of readdirSync(savedWork)) {
      try {
        copyFileSync(path.join(savedWork, file), path.join(destWork, file));
      } catch {
        // Best effort
      }
    }
  }
  rmSync(savedDir, { recursive: true, force: true });
}

/**
 * Create a new git worktree at worktreeDir checked out to ref,
 * then copy .env/.env.local files from the base repo.
 */
function addWorktree(repoPath: string, worktreeDir: string, ref: string): void {
  // If the directory exists but isn't a git worktree (e.g. state files were
  // written there by a "use base repo" review), remove it so git worktree add
  // can create it cleanly. Preserve .claude/ (review state files).
  let savedClaudeDir: string | null = null;
  if (existsSync(worktreeDir) && !existsSync(path.join(worktreeDir, ".git"))) {
    savedClaudeDir = saveClaudeState(worktreeDir);
    rmSync(worktreeDir, { recursive: true, force: true });
  }

  // Prune stale worktree entries (directory was removed but git still tracks it)
  try {
    execSync("git worktree prune", {
      cwd: repoPath,
      stdio: "pipe",
      timeout: LOCAL_GIT_TIMEOUT,
    });
  } catch {
    // Best effort
  }

  execFileSync("git", ["worktree", "add", worktreeDir, ref], {
    cwd: repoPath,
    stdio: "pipe",
    timeout: NETWORK_GIT_TIMEOUT,
  });

  if (savedClaudeDir) {
    restoreClaudeState(savedClaudeDir, worktreeDir);
  }

  copyEnvLocalFiles(repoPath, worktreeDir);
}

/** Check out a branch in an existing worktree, trying multiple fallback strategies. */
function checkoutBranch(worktreeDir: string, branchName: string): void {
  try {
    execFileSync("git", ["checkout", branchName], {
      cwd: worktreeDir,
      stdio: "pipe",
      timeout: LOCAL_GIT_TIMEOUT,
    });
    return;
  } catch {
    // Branch may not exist locally yet
  }
  try {
    execFileSync("git", ["checkout", "-B", branchName, `origin/${branchName}`], {
      cwd: worktreeDir,
      stdio: "pipe",
      timeout: LOCAL_GIT_TIMEOUT,
    });
    return;
  } catch {
    // Branch may be checked out in another worktree
  }
  try {
    execFileSync("git", ["checkout", "--detach", `origin/${branchName}`], {
      cwd: worktreeDir,
      stdio: "pipe",
      timeout: LOCAL_GIT_TIMEOUT,
    });
  } catch {
    // Best effort — continue with whatever is checked out
  }
}

/** Fast-forward or rebase an existing worktree to the latest remote branch. */
function fastForwardBranch(worktreeDir: string, branchName: string): void {
  try {
    execFileSync("git", ["pull", "--ff-only", "origin", branchName], {
      cwd: worktreeDir,
      stdio: "pipe",
      timeout: NETWORK_GIT_TIMEOUT,
    });
    return;
  } catch {
    // ff-only failed (diverged) — try rebase if working tree is clean
  }
  try {
    execFileSync("git", ["diff", "--quiet"], {
      cwd: worktreeDir,
      stdio: "pipe",
      timeout: LOCAL_GIT_TIMEOUT,
    });
    execFileSync("git", ["diff", "--cached", "--quiet"], {
      cwd: worktreeDir,
      stdio: "pipe",
      timeout: LOCAL_GIT_TIMEOUT,
    });
    execFileSync("git", ["rebase", `origin/${branchName}`], {
      cwd: worktreeDir,
      stdio: "pipe",
      timeout: NETWORK_GIT_TIMEOUT,
    });
  } catch {
    // Dirty working tree or rebase failed — continue with current state
  }
}

/**
 * Ensure a worktree exists at worktreeDir on the given branch, fast-forwarded to latest.
 * Creates a new worktree if none exists, or checks out the branch and pulls if it does.
 */
function ensureWorktree(repoPath: string, worktreeDir: string, branchName?: string): void {
  fetchOrigin(repoPath);

  const hasGit = existsSync(path.join(worktreeDir, ".git"));

  if (!hasGit && branchName) {
    addWorktree(repoPath, worktreeDir, `origin/${branchName}`);
  } else if (hasGit && branchName) {
    checkoutBranch(worktreeDir, branchName);
    fastForwardBranch(worktreeDir, branchName);
  }
}

/**
 * Ensure a worktree is ready for a review session.
 *
 * - No-ops when `useBaseRepo` is true (review runs in the base repo).
 * - Returns an error object when `branchName` is missing and no worktree exists.
 * - Otherwise creates or updates the worktree via `ensureWorktree`.
 *
 * Returns `null` on success, or `{ status, message }` on error.
 */
export function ensureWorktreeForReview(
  expandedRepoPath: string,
  worktreeDir: string,
  branchName: string | undefined,
  useBaseRepo: boolean
): { status: number; message: string } | null {
  if (useBaseRepo) {
    return null;
  }

  if (!branchName && !existsSync(path.join(worktreeDir, ".git"))) {
    return { status: 400, message: "branchName is required to create a worktree" };
  }

  try {
    ensureWorktree(expandedRepoPath, worktreeDir, branchName);
  } catch (err) {
    // A concurrent request may have won the race — if the worktree now exists, use it
    if (!existsSync(path.join(worktreeDir, ".git"))) {
      return {
        status: 500,
        message: `Failed to create worktree: ${err instanceof Error ? err.message : "unknown error"}`,
      };
    }
  }

  return null;
}

export function tryAssertRepoAllowed(
  repoPath: string,
  allowedDirs: string[]
): { path: string } | { error: string; status: 403 } {
  try {
    return { path: assertRepoAllowed(repoPath, allowedDirs) };
  } catch (error) {
    if (error instanceof DirectoryNotAllowedError) {
      return { error: "directory not allowed", status: 403 };
    }
    throw error;
  }
}

export function tryAssertPathAllowed(
  dirPath: string,
  allowedDirs: string[]
): true | { error: string; status: 403 } {
  try {
    assertPathAllowed(dirPath, allowedDirs);
    return true;
  } catch (error) {
    if (error instanceof DirectoryNotAllowedError) {
      return { error: "directory not allowed", status: 403 };
    }
    throw error;
  }
}

export function findFirstExisting(...paths: string[]): string | null {
  for (const p of paths) {
    if (existsSync(p)) {
      return p;
    }
  }
  return null;
}
