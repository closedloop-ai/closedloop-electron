import type { LoopCommand } from "@closedloop-ai/loops-api/commands";
import type { ContextPackAttachment as SharedContextPackAttachment } from "@closedloop-ai/loops-api/context-pack";
import { LoopArtifactType } from "@closedloop-ai/loops-api/artifacts";
import type { spawn } from "node:child_process";

// ---------------------------------------------------------------------------
// WorktreeProvider: abstraction over git worktree operations for testability
// ---------------------------------------------------------------------------

export interface WorktreeProvider {
  ensureWorktree(
    repoPath: string,
    worktreeDir: string,
    branchName: string,
    baseBranch: string,
    loopId: string,
  ): Promise<void>;
  findWorktreeForBranch(repoPath: string, branchName: string): string | null;
  removeWorktree(
    worktreeDir: string,
    repoPath: string,
    loopId?: string,
  ): Promise<void>;
  getCurrentBranch(worktreeDir: string): string | null;
}

// ---------------------------------------------------------------------------
// Types — shared contract from @closedloop-ai/loops-api
// ---------------------------------------------------------------------------

export interface LoopArtifact {
  id?: string;
  type: LoopArtifactType;
  title?: string;
  content: string;
}

export interface LoopCommitter {
  name: string;
  email: string;
}

export type ContextPackAttachment = SharedContextPackAttachment;

export interface ExecutionResult {
  prUrl: string;
  prNumber: number;
  branchName: string;
  commitSha: string;
}

export function isExecutionResult(value: unknown): value is ExecutionResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (
    typeof v.prUrl !== "string" ||
    typeof v.prNumber !== "number" ||
    typeof v.branchName !== "string" ||
    typeof v.commitSha !== "string"
  ) {
    return false;
  }
  // Sanity-check field shapes to reject garbage values from the LLM
  if (!/^https?:\/\//.test(v.prUrl)) return false;
  if (!/^[a-f0-9]{7,}$/i.test(v.commitSha)) return false;
  if (!v.branchName.trim()) return false;
  return true;
}

/** Track running loop processes for cancellation and to prevent GC of ChildProcess. */
export interface RunningLoop {
  pid: number;
  child?: ReturnType<typeof spawn>;
  stage: "running" | "post-processing";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Commands that have full spawn/dispatch support in this gateway version. */
export const SUPPORTED_COMMANDS = new Set<LoopCommand>([
  "PLAN",
  "EXECUTE",
  "REQUEST_CHANGES",
  "DECOMPOSE",
  "EVALUATE_PRD",
  "GENERATE_PRD",
  "EVALUATE_PLAN",
  "EVALUATE_CODE",
]);
export const VALID_COMMANDS = SUPPORTED_COMMANDS;

export type RepoRequirement = "REQUIRED" | "OPTIONAL" | "NOT_REQUIRED";
export const REPO_REQUIREMENT_BY_COMMAND: Record<LoopCommand, RepoRequirement> =
  {
    PLAN: "REQUIRED",
    EXECUTE: "REQUIRED",
    CHAT: "NOT_REQUIRED",
    EXPLORE: "NOT_REQUIRED",
    REQUEST_CHANGES: "REQUIRED",
    REQUEST_PRD_CHANGES: "REQUIRED",
    EVALUATE_PRD: "OPTIONAL",
    GENERATE_PRD: "REQUIRED",
    DECOMPOSE: "NOT_REQUIRED",
    EVALUATE_PLAN: "REQUIRED",
    EVALUATE_CODE: "REQUIRED",
  };

/** Artifact types that represent an implementation plan. */
export const PLAN_ARTIFACT_TYPES: readonly LoopArtifactType[] = [
  LoopArtifactType.ImplementationPlan,
] as const;
