import os from "node:os";
import path from "node:path";
import { DirectoryNotAllowedError, assertPathAllowed } from "../security.js";

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
  if (configuredParent && configuredParent.trim()) {
    return expandHome(configuredParent);
  }

  return path.dirname(expandedRepoPath);
}

export function resolveWorktreeDir(expandedRepoPath: string, ticketId: string): string {
  const sanitizedTicket = ticketId.replaceAll(/[^a-zA-Z0-9-_]/g, "_");
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

