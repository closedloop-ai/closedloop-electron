import { existsSync } from "node:fs";
import path from "node:path";
import type { LoopRequestBody } from "@closedloop-ai/loops-api/desktop-request";
import {
  expandHome,
  resolveWorktreeParentDir,
} from "./symphony-utils.js";

// ---------------------------------------------------------------------------
// Repository resolution
// ---------------------------------------------------------------------------

/** Find the local repo path for a given fullName (e.g. "org/repo"). */
export function findLocalRepo(fullName: string, allowedDirs: string[]): string | null {
  const repoName = fullName.split("/").pop();
  if (!repoName) {
    return null;
  }

  for (const dir of allowedDirs) {
    const expanded = expandHome(dir);
    // Check if the directory itself is the repo
    if (path.basename(expanded) === repoName && existsSync(expanded)) {
      return expanded;
    }
    // Check subdirectory
    const candidate = path.join(expanded, repoName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Resolve worktree directory for a loop.
 * Uses full untruncated stable ID for directory naming.
 */
export function resolveLoopWorktreeDir(
  expandedRepoPath: string,
  stableId: string,
): string {
  const repoName = path.basename(expandedRepoPath);
  return path.join(
    resolveWorktreeParentDir(expandedRepoPath),
    `${repoName}-loop-${stableId}`,
  );
}

/**
 * Slugify a loop ID for worktree/branch naming.
 * Matches ECS harness convention: lowercase, non-alnum to dashes, max 50 chars.
 */
export function slugifyLoopId(loopId: string): string {
  return loopId
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/g, "-")
    .slice(0, 50);
}

/**
 * Pick the stable ID for worktree/branch naming.
 * Uses loopId (matching ECS harness branch/run-dir naming).
 */
export function pickStableId(body: LoopRequestBody): string {
  return slugifyLoopId(body.loopId);
}
