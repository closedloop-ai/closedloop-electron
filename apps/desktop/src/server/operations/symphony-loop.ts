import { execFileSync, execSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readLogTail,
  readTextFile,
  sanitizeErrorMessage,
} from "../../main/diagnostics-helpers.js";
import { gatewayLog } from "../../main/gateway-logger.js";
import type { JobStore, LocalJobCommand } from "../../main/job-store.js";
import {
  finalizeLoopFromRuntime,
  type LoopFinalizerDeps,
} from "../../main/loop-finalizer.js";
import type { LoopTokenStore } from "../../main/loop-token-store.js";
import { Observability } from "../../main/observability.js";
import {
  parseTokenUsage,
  type ModelTokenUsage,
} from "../../main/token-usage.js";
import type {
  OperationDispatcher,
  OperationRequestContext,
} from "../operation-dispatcher.js";
import { readJsonFileSync } from "../read-json-file-sync.js";
import { assertPathAllowed, DirectoryNotAllowedError } from "../security.js";
import { getShellEnv, getShellPath } from "../shell-path.js";
import { withMcpTools } from "./chat-tools.js";
import { findWorktreeForBranch as findWorktreeForBranchImpl } from "./git-helpers.js";
import { startOutputTailer } from "./output-tailer.js";
import {
  findPluginScript,
  findPluginVersions,
  getPluginCacheRoot,
} from "./plugin-cache.js";
import { sanitizeCommitMessage } from "./symphony-interactive.js";
import {
  expandHome,
  fetchOrigin,
  isProcessRunning,
  loopError,
  loopLog,
  resolveRef,
  resolveWorktreeParentDir,
  runLoopsSetupScript,
  tryAssertRepoAllowed,
} from "./symphony-utils.js";
export { readLogTail } from "../../main/diagnostics-helpers.js";

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
  branchExists(repoPath: string, branch: string): Promise<boolean>;
}

export const defaultWorktreeProvider: WorktreeProvider = {
  ensureWorktree: ensureWorktreeImpl,
  findWorktreeForBranch: findWorktreeForBranchImpl,
  removeWorktree: removeWorktreeImpl,
  getCurrentBranch: getCurrentBranchImpl,
  branchExists: branchExistsImpl,
};

// ---------------------------------------------------------------------------
// Claude binary resolution
// ---------------------------------------------------------------------------

/**
 * Cached absolute path to the `claude` binary, resolved once at first use.
 *
 * Resolution strategy (tried in order):
 *   1. `which claude` using the current process.env.PATH (fast; works in
 *      tests where PATH is set to a fake-bin directory, and in dev shells).
 *   2. `bash -lc 'which claude'` in a login shell so that nvm/homebrew/local
 *      bin directories are found even when Electron strips PATH at launch via
 *      the .app bundle, launchd (macOS), or systemd (Linux).
 *   3. Falls back to the bare string "claude" so that the caller can still
 *      attempt spawn and receive a descriptive ENOENT error.
 */
let resolvedClaudePath: string | null = null;

/**
 * Reset the cached claude binary path. Intended for use in tests where PATH
 * changes between test cases — production code should not call this.
 */
export function resetResolvedClaudePath(): void {
  resolvedClaudePath = null;
}

export function getResolvedClaudePath(): string {
  // If we have a cached path, return it only if the binary still exists on
  // disk. This handles test scenarios where a fake binary directory is cleaned
  // up between test cases, causing the cached path to become stale.
  if (resolvedClaudePath !== null && existsSync(resolvedClaudePath)) {
    return resolvedClaudePath;
  }
  // Invalidate stale cache entry before re-resolving
  resolvedClaudePath = null;

  // Strategy 1: which via current process PATH (works in tests and dev shells)
  try {
    const result = execFileSync("which", ["claude"], {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 5_000,
    }).trim();
    if (result) {
      resolvedClaudePath = result;
      return resolvedClaudePath;
    }
  } catch {
    // Not found in current PATH — try login shell
  }

  // Strategy 2: login shell which — sources ~/.nvm/nvm.sh and similar to
  // populate the full user PATH that Electron strips on launch.
  try {
    const result = execFileSync("bash", ["-lc", "which claude"], {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 5_000,
    }).trim();
    if (result) {
      resolvedClaudePath = result;
      return resolvedClaudePath;
    }
  } catch {
    // Login shell which also failed — fall through to bare name fallback
  }

  // Fall back to bare name; spawn will throw ENOENT with a descriptive message
  resolvedClaudePath = "claude";
  return resolvedClaudePath;
}

// ---------------------------------------------------------------------------
// Types — shared contract from @closedloop-ai/loops-api
// ---------------------------------------------------------------------------

import {
  LoopArtifactFile,
  LoopArtifactType,
} from "@closedloop-ai/loops-api/artifacts";
import { validateResultBundle } from "@closedloop-ai/loops-api/bundles";
import type { LoopCommand } from "@closedloop-ai/loops-api/commands";
import { validateCommandInputs } from "@closedloop-ai/loops-api/commands";
import type { ContextPackAttachment as SharedContextPackAttachment } from "@closedloop-ai/loops-api/context-pack";
import type { LoopRequestBody } from "@closedloop-ai/loops-api/desktop-request";
import { LoopErrorCode } from "@closedloop-ai/loops-api/error-codes";
import { LoopEventType } from "@closedloop-ai/loops-api/events";
import { parseExecutionResultFile } from "@closedloop-ai/loops-api/execution-result";

/** Commands that have full spawn/dispatch support in this gateway version. */
const SUPPORTED_COMMANDS = new Set<LoopCommand>([
  "PLAN",
  "EXECUTE",
  "REQUEST_CHANGES",
  "DECOMPOSE",
  "EVALUATE_PRD",
  "GENERATE_PRD",
  "EVALUATE_PLAN",
  "EVALUATE_CODE",
]);
const VALID_COMMANDS = SUPPORTED_COMMANDS;
type RepoRequirement = "REQUIRED" | "OPTIONAL" | "NOT_REQUIRED";
const REPO_REQUIREMENT_BY_COMMAND: Record<LoopCommand, RepoRequirement> = {
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

interface LoopArtifact {
  id?: string;
  type: LoopArtifactType;
  title?: string;
  content: string;
}

/** Artifact types that represent an implementation plan. */
export const PLAN_ARTIFACT_TYPES: readonly LoopArtifactType[] = [
  LoopArtifactType.ImplementationPlan,
] as const;

/**
 * Write prd.md to a work directory from a list of artifacts and an optional
 * explicit prompt.
 *
 * The PRD artifact content is always preferred for prd.md when present.
 * Fallback priority: PRD artifact > FEATURE artifact > prompt.
 *
 * When a prompt is provided alongside a PRD artifact, both are written:
 * - prd.md  ← artifact content (what Claude needs to read)
 * - prompt.md ← decompose/evaluate instructions (written by caller)
 */
export async function writePrdArtifact(
  workDir: string,
  artifacts: LoopArtifact[],
  prompt?: string,
): Promise<void> {
  const prdArtifact = artifacts.find((a) => a.type === LoopArtifactType.Prd);
  const featureArtifact = prdArtifact
    ? null
    : artifacts.find((a) => a.type === LoopArtifactType.Feature);
  const source = prdArtifact ?? featureArtifact;

  const prdContent = source?.content || prompt || "";

  if (prdContent) {
    await fs.writeFile(path.join(workDir, LoopArtifactFile.Prd), prdContent);
  }
}

/** Internal helper: writes plan.md to workDir from the first matching plan artifact. */
async function writePlanFileToWorkDir(
  workDir: string,
  artifacts: LoopArtifact[],
): Promise<void> {
  const artifact = artifacts.find((a) =>
    (PLAN_ARTIFACT_TYPES as readonly string[]).includes(a.type),
  );
  if (artifact?.content) {
    await fs.writeFile(
      path.join(workDir, LoopArtifactFile.PlanMarkdown),
      artifact.content,
    );
  }
}

/** Write both prd.md and plan.md to a work directory from a list of artifacts. */
export async function writePlanArtifact(
  workDir: string,
  artifacts: LoopArtifact[],
  prompt?: string,
): Promise<void> {
  await writePrdArtifact(workDir, artifacts, prompt);
  await writePlanFileToWorkDir(workDir, artifacts);
}

/** Write plan.md to a work directory from a list of artifacts. */
export async function writeCodeArtifact(
  workDir: string,
  artifacts: LoopArtifact[],
): Promise<void> {
  await writePlanFileToWorkDir(workDir, artifacts);
}

/**
 * Read outputs produced by an EVALUATE_{type} loop iteration.
 * Returns undefined values for missing or unreadable files.
 */
function readEvaluateOutputs(
  workDir: string,
  artifactType: string,
): Record<string, unknown> {
  const judges = readJsonFileSync(
    path.join(workDir, `${artifactType}-judges.json`),
  );
  return { [`${artifactType}Judges`]: judges ?? undefined };
}

export function readEvaluatePrdOutputs(
  workDir: string,
): Record<string, unknown> {
  return readEvaluateOutputs(workDir, "prd");
}

export function readEvaluatePlanOutputs(
  workDir: string,
): Record<string, unknown> {
  return readEvaluateOutputs(workDir, "plan");
}

export function readEvaluateCodeOutputs(
  workDir: string,
): Record<string, unknown> {
  return readEvaluateOutputs(workDir, "code");
}

interface LoopCommitter {
  name: string;
  email: string;
}

type ContextPackAttachment = SharedContextPackAttachment;

interface ExecutionResult {
  prUrl: string;
  prNumber: number;
  branchName: string;
  commitSha: string;
}

function isExecutionResult(value: unknown): value is ExecutionResult {
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
interface RunningLoop {
  pid: number;
  child?: ReturnType<typeof spawn>;
  stage: "running" | "post-processing";
}
const runningLoops = new Map<string, RunningLoop>();

export function getActiveLoopPid(loopId: string): number | null {
  const entry = runningLoops.get(loopId);
  return entry?.pid ?? null;
}

export function registerRecoveredLoop(loopId: string, pid: number): void {
  runningLoops.set(loopId, { pid, stage: "running" });
}

export function unregisterLoop(loopId: string): void {
  runningLoops.delete(loopId);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(
  context: OperationRequestContext,
  status: number,
  payload: unknown,
): void {
  context.response.statusCode = status;
  context.response.setHeader("content-type", "application/json");
  context.response.end(JSON.stringify(payload));
}

function parseJsonBody(
  context: OperationRequestContext,
): Record<string, unknown> | null {
  if (!context.body.trim()) {
    return null;
  }
  try {
    return JSON.parse(context.body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function shellEscape(value: string): string {
  return "'" + value.replaceAll("'", String.raw`'\''`) + "'";
}

/**
 * Find the stream_formatter.py script from the code plugin.
 * Reuses getPluginCacheRoot() and findPluginVersions() from plugin-cache.ts.
 * Falls back to null if not installed — caller should degrade gracefully.
 */
function findStreamFormatter(): string | null {
  // Unit/integration tests set this to exercise the raw `claude` bash wrapper
  // without grep/tee/python (stub claude output is not a full formatter stream).
  if (process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE === "1") {
    return null;
  }
  const pluginDir = path.join(getPluginCacheRoot(), "code");
  const versions = findPluginVersions(pluginDir);
  for (const v of versions) {
    const p = path.join(pluginDir, v, "tools", "python", "stream_formatter.py");
    if (existsSync(p)) {
      return p;
    }
  }
  return null;
}

/**
 * Build a bash pipeline command that runs claude with stream-json output,
 * filters JSON lines, tees to a jsonl log, and formats for human reading.
 * Falls back to raw claude if formatter is not available.
 */
function buildClaudePipeline(
  claudeArgs: string[],
  claudeWorkDir: string,
  stdinFile?: string,
): { cmd: string; args: string[] } {
  const formatter = findStreamFormatter();
  const stderrFile = path.join(claudeWorkDir, "claude-stderr.log");
  const jsonlFile = path.join(claudeWorkDir, "claude-output.jsonl");

  // Build the claude command with properly escaped args
  const escapedArgs = claudeArgs.map(shellEscape).join(" ");
  const claudeCmd = stdinFile
    ? `claude ${escapedArgs} < ${shellEscape(stdinFile)}`
    : `claude ${escapedArgs}`;

  if (formatter) {
    // Full pipeline matching run-loop.sh:
    // claude ... 2>stderr | grep JSON | tee jsonl | formatter
    const pipeline = [
      `${claudeCmd} 2>${shellEscape(stderrFile)}`,
      "grep --line-buffered '^{'",
      `tee -a ${shellEscape(jsonlFile)}`,
      `python3 ${shellEscape(formatter)}`,
    ].join(" | ");
    return { cmd: "bash", args: ["-c", `${pipeline}; exit \${PIPESTATUS[0]}`] };
  }

  // No formatter — wrap in bash pipeline so grep|tee still writes claude-output.jsonl
  const pipeline = [
    `${claudeCmd} 2>${shellEscape(stderrFile)}`,
    "grep --line-buffered '^{'",
    `tee -a ${shellEscape(jsonlFile)}`,
  ].join(" | ");
  return { cmd: "bash", args: ["-c", `${pipeline}; exit \${PIPESTATUS[0]}`] };
}

/** Find the local repo path for a given fullName (e.g. "org/repo"). */
function findLocalRepo(fullName: string, allowedDirs: string[]): string | null {
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

// ---------------------------------------------------------------------------
// Additional repos
// ---------------------------------------------------------------------------

/** Shape returned by resolveAdditionalRepos for each validated entry. */
export interface ResolvedAdditionalRepo {
  readonly repoPath: string;
  readonly branch: string;
}

/** Typed error thrown when an additional repo entry fails validation. */
export class AdditionalRepoError extends Error {
  constructor(
    public readonly code: LoopErrorCode,
    public readonly repoRef: string,
    message: string,
  ) {
    super(message);
    this.name = "AdditionalRepoError";
  }
}

const ADDITIONAL_REPOS_MAX = 5;

/**
 * Best-effort cleanup of additional repo worktree directories.
 * Errors are logged but never re-thrown so callers can use this in
 * both success and error teardown paths without try/catch.
 */
async function cleanupAdditionalWorktrees(
  entries: readonly { dir: string; repoPath: string }[],
  loopId: string,
  wt: WorktreeProvider,
  logPrefix = "cleanup additional worktree failed:",
): Promise<void> {
  for (const entry of entries) {
    await wt.removeWorktree(entry.dir, entry.repoPath, loopId).catch((err) =>
      loopError(loopId, logPrefix, err),
    );
  }
}

/** Resolve an additional repo entry to a validated local path, or throw. */
function resolveAndValidateRepoPath(
  entry: { localRepoPath?: string; fullName?: string },
  allowedDirs: string[],
  repoRef: string,
): string {
  let candidate: string;
  if (entry.localRepoPath) {
    candidate = expandHome(entry.localRepoPath);
  } else if (entry.fullName) {
    const found = findLocalRepo(entry.fullName, allowedDirs);
    if (!found) {
      throw new AdditionalRepoError(
        LoopErrorCode.RepoNotFound,
        entry.fullName,
        `Additional repo not found locally: ${entry.fullName}`,
      );
    }
    candidate = found;
  } else {
    throw new AdditionalRepoError(
      LoopErrorCode.RepoNotFound,
      repoRef,
      "Additional repo entry must have localRepoPath or fullName",
    );
  }

  const result = tryAssertRepoAllowed(candidate, allowedDirs);
  if ("error" in result) {
    throw new AdditionalRepoError(
      LoopErrorCode.RepoNotAllowed,
      repoRef,
      `Additional repo path not allowed: ${repoRef}`,
    );
  }
  return result.path;
}

/** Validate and resolve additionalRepos entries. Throws AdditionalRepoError on failure. */
export async function resolveAdditionalRepos(
  entries: NonNullable<LoopRequestBody["additionalRepos"]>,
  allowedDirs: string[],
  wt: WorktreeProvider,
): Promise<ResolvedAdditionalRepo[]> {
  if (entries.length === 0) {
    return [];
  }

  if (entries.length > ADDITIONAL_REPOS_MAX) {
    throw new AdditionalRepoError(
      LoopErrorCode.PreRunValidationFailed,
      "",
      `additionalRepos exceeds maximum of ${ADDITIONAL_REPOS_MAX} entries (got ${entries.length})`,
    );
  }

  const resolved: ResolvedAdditionalRepo[] = [];

  for (const entry of entries) {
    const repoRef = entry.localRepoPath ?? entry.fullName ?? "";
    const resolvedPath = resolveAndValidateRepoPath(entry, allowedDirs, repoRef);
    const canonicalPath = path.resolve(resolvedPath);

    const branchFound = await wt.branchExists(canonicalPath, entry.branch);
    if (!branchFound) {
      throw new AdditionalRepoError(
        LoopErrorCode.RepoNotFound,
        repoRef,
        `Branch "${entry.branch}" not found in additional repo: ${resolvedPath}`,
      );
    }

    resolved.push({ repoPath: canonicalPath, branch: entry.branch });
  }

  return resolved;
}

/**
 * Resolve worktree directory for a loop.
 * Uses full untruncated stable ID for directory naming.
 */
function resolveLoopWorktreeDir(
  expandedRepoPath: string,
  stableId: string,
): string {
  const repoName = path.basename(expandedRepoPath);
  return path.join(
    resolveWorktreeParentDir(expandedRepoPath),
    `${repoName}-loop-${stableId}`,
  );
}

export function additionalRepoDisambiguator(repoPath: string): string {
  return crypto
    .createHash("sha1")
    .update(path.resolve(repoPath))
    .digest("hex")
    .slice(0, 8);
}

/**
 * Slugify a loop ID for worktree/branch naming.
 * Matches ECS harness convention: lowercase, non-alnum to dashes, max 50 chars.
 */
function slugifyLoopId(loopId: string): string {
  return loopId
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/g, "-")
    .slice(0, 50);
}

/**
 * Pick the stable ID for worktree/branch naming.
 * Uses loopId (matching ECS harness branch/run-dir naming).
 */
function pickStableId(body: LoopRequestBody): string {
  return slugifyLoopId(body.loopId);
}

// ---------------------------------------------------------------------------
// API communication (events + artifact upload)
// ---------------------------------------------------------------------------

async function postLoopEvent(
  apiBaseUrl: string,
  loopId: string,
  token: string,
  eventBody: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ success: boolean; error?: string }> {
  const url = `${apiBaseUrl}/loops/${loopId}/events`;
  // Auto-inject timestamp on every event (matches ECS harness reportEvent())
  const payload: Record<string, unknown> = {
    ...eventBody,
    timestamp: eventBody.timestamp ?? new Date().toISOString(),
  };
  loopLog(loopId, `POST event: ${payload.type}`, url);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-loop-event-nonce": crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
      signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      loopError(
        loopId,
        `Event POST failed: ${resp.status} ${resp.statusText}`,
        text,
      );
      gatewayLog.error(
        "loop-event",
        `POST ${payload.type} to ${url} failed: ${resp.status} ${resp.statusText} ${text}`,
      );
      return {
        success: false,
        error: "HTTP " + resp.status + " " + resp.statusText,
      };
    }
    loopLog(loopId, `Event POST success: ${resp.status}`);
    gatewayLog.info(
      "loop-event",
      `POST ${payload.type} for loopId=${loopId}: ${resp.status}`,
    );
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    loopError(loopId, "Failed to post event:", err);
    gatewayLog.error(
      "loop-event",
      `POST ${payload.type} network error: ${msg}`,
    );
    return { success: false, error: msg };
  }
}

async function postLoopEventBounded(
  apiBaseUrl: string,
  loopId: string,
  token: string,
  eventBody: Record<string, unknown>,
  timeoutMs = 1000,
): Promise<{ success: boolean; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await postLoopEvent(
      apiBaseUrl,
      loopId,
      token,
      eventBody,
      controller.signal,
    );
  } catch {
    return { success: false, error: "timeout" };
  } finally {
    clearTimeout(timer);
  }
}

async function uploadArtifacts(
  apiBaseUrl: string,
  loopId: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  const url = `${apiBaseUrl}/loops/${loopId}/upload-artifacts`;
  loopLog(loopId, "Uploading artifacts...", url);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      loopError(
        loopId,
        `Upload failed: ${resp.status} ${resp.statusText}`,
        text,
      );
      gatewayLog.error(
        "loop-upload",
        `Artifact upload to ${url} failed: ${resp.status} ${resp.statusText} ${text}`,
      );
      return {
        success: false,
        error: `HTTP ${resp.status} ${resp.statusText}`,
      };
    }
    loopLog(loopId, `Upload success: ${resp.status}`);
    gatewayLog.info(
      "loop-upload",
      `Artifact upload for loopId=${loopId}: ${resp.status}`,
    );
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    loopError(loopId, "Failed to upload artifacts:", err);
    gatewayLog.error("loop-upload", `Artifact upload network error: ${msg}`);
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Worktree management
// ---------------------------------------------------------------------------

async function ensureWorktreeImpl(
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

/** Check whether a branch exists locally or on the remote. */
async function branchExistsImpl(repoPath: string, branch: string): Promise<boolean> {
  fetchOrigin(repoPath);
  return resolveRef(repoPath, branch) !== null;
}

// findExistingLoopWorktree was removed — it greedy-matched ANY loop worktree
// from ANY prior loop, causing new PLAN loops to reuse stale worktrees.
// PLAN always creates a fresh worktree. EXECUTE/REQUEST_CHANGES reuse via
// findWorktreeForBranch(parentBranchName) which matches the specific parent.

/**
 * Remove a worktree via git worktree remove, falling back to
 * fs.rm + git worktree prune. Used from both handleProcessCompletion and
 * early-return cleanup in handleLoopRequest.
 */
async function removeWorktreeImpl(
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
function getCurrentBranchImpl(worktreeDir: string): string | null {
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

// ---------------------------------------------------------------------------
// Per-command artifact writing
// ---------------------------------------------------------------------------

/**
 * Download attachment files to {claudeWorkDir}/attachments/{attachmentId}-{sanitizedFilename}.
 * Non-fatal: logs warnings and skips individual failures without aborting.
 */
async function downloadAttachmentsToDisk(
  claudeWorkDir: string,
  attachments?: ContextPackAttachment[],
): Promise<void> {
  if (!attachments || attachments.length === 0) {
    return;
  }

  const attachmentsDir = path.join(claudeWorkDir, "attachments");
  mkdirSync(attachmentsDir, { recursive: true });

  for (const attachment of attachments) {
    try {
      const expiresAt = new Date(attachment.signedUrlExpiresAt);
      if (expiresAt <= new Date()) {
        console.warn(
          `[downloadAttachmentsToDisk] Attachment ${attachment.id} signedUrl expired at ${attachment.signedUrlExpiresAt}, skipping`,
        );
        continue;
      }

      const safeName = path
        .basename(attachment.filename)
        .replaceAll(/[^a-zA-Z0-9._-]/g, "_");
      const diskName = `${attachment.id}-${safeName}`;
      const diskPath = path.resolve(attachmentsDir, diskName);

      if (
        !diskPath.startsWith(attachmentsDir + path.sep) &&
        diskPath !== attachmentsDir
      ) {
        console.warn(
          `[downloadAttachmentsToDisk] Attachment ${attachment.id} resolved path escapes attachmentsDir, skipping`,
        );
        continue;
      }

      const response = await fetch(attachment.signedUrl);
      if (!response.ok) {
        console.warn(
          `[downloadAttachmentsToDisk] Attachment ${attachment.id} fetch failed: ${response.status} ${response.statusText}, skipping`,
        );
        continue;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length > attachment.sizeBytes) {
        console.warn(
          `[downloadAttachmentsToDisk] Attachment ${attachment.id} buffer size ${buffer.length} exceeds declared sizeBytes ${attachment.sizeBytes}, skipping`,
        );
        continue;
      }
      if (buffer.length < attachment.sizeBytes) {
        console.warn(
          `[downloadAttachmentsToDisk] Attachment ${attachment.id} downloaded ${buffer.length} bytes but expected ${attachment.sizeBytes}, may be truncated — writing anyway`,
        );
      }

      writeFileSync(diskPath, buffer);
    } catch (err) {
      console.warn(
        `[downloadAttachmentsToDisk] Failed to download attachment ${attachment.id}:`,
        err,
      );
    }
  }
}

/**
 * Write PRD for PLAN command.
 * Matches ECS harness writePrdFile(): prompt first, then PRD artifact, then FEATURE.
 */
async function writeArtifactsForPlan(
  claudeWorkDir: string,
  artifacts: LoopArtifact[],
  prdContent: string | null = null,
  userContext?: string,
  attachments?: ContextPackAttachment[],
): Promise<void> {
  // Priority: explicit prompt > PRD artifact > FEATURE artifact (matches harness)

  if (!prdContent) {
    const prdArtifact = artifacts.find((a) => a.type === LoopArtifactType.Prd);
    const featureArtifact = prdArtifact
      ? null
      : artifacts.find((a) => a.type === LoopArtifactType.Feature);
    const source = prdArtifact ?? featureArtifact;
    if (source?.content) {
      prdContent = source.content;
    }
  }

  // Append user-supplied Additional Context to the PRD so the planning agent
  // sees it as part of the requirements (guaranteed to be read). Written as a
  // clearly delineated section at the end of prd.md.
  const safeUserContext =
    typeof userContext === "string" ? userContext.trim() : "";
  if (safeUserContext) {
    const section =
      "\n\n---\n\n## User Context / Additional Constraints\n\n" +
      safeUserContext +
      "\n";
    prdContent = prdContent ? prdContent + section : section;
  }

  if (prdContent) {
    await fs.writeFile(
      path.join(claudeWorkDir, LoopArtifactFile.Prd),
      prdContent,
    );
  }

  await downloadAttachmentsToDisk(claudeWorkDir, attachments);
}

async function writeArtifactsForExecuteOrAmend(
  claudeWorkDir: string,
  artifacts: LoopArtifact[],
  prompt?: string,
  attachments?: ContextPackAttachment[],
): Promise<void> {
  for (const artifact of artifacts) {
    if (artifact.type === LoopArtifactType.ImplementationPlan) {
      // Sync plan content like ECS harness's syncPlanFromContextPack():
      // If plan.json already exists (from parent PLAN loop), update only the
      // .content field — preserving tasks, openQuestions, metadata, etc.
      // This picks up manual edits the user made in the Liveblocks editor.
      const planJsonPath = path.join(claudeWorkDir, LoopArtifactFile.Plan);
      if (existsSync(planJsonPath)) {
        try {
          const existing = JSON.parse(
            readFileSync(planJsonPath, "utf-8"),
          ) as Record<string, unknown>;
          existing.content = artifact.content;
          await fs.writeFile(planJsonPath, JSON.stringify(existing, null, 2));
        } catch {
          // If existing plan.json is corrupt, overwrite entirely
          await fs.writeFile(planJsonPath, artifact.content);
        }
      } else {
        // No existing plan.json — write the content as-is.
        // If it's valid JSON, write directly. Otherwise wrap it.
        try {
          JSON.parse(artifact.content);
          await fs.writeFile(planJsonPath, artifact.content);
        } catch {
          await fs.writeFile(
            planJsonPath,
            JSON.stringify({ content: artifact.content }, null, 2),
          );
        }
      }
    } else if (
      artifact.type === LoopArtifactType.Prd ||
      artifact.type === LoopArtifactType.Feature
    ) {
      await fs.writeFile(
        path.join(claudeWorkDir, LoopArtifactFile.Prd),
        artifact.content,
      );
    }
  }
  if (prompt) {
    await fs.writeFile(path.join(claudeWorkDir, "prompt.md"), prompt);
  }

  await downloadAttachmentsToDisk(claudeWorkDir, attachments);
}

/**
 * Write context pack files for GENERATE_PRD command.
 * Mirrors writeContextPackFiles in harness-agent.mjs (lines 744-816).
 * Files go under worktreeDir/.closedloop-ai/context/ (NOT claudeWorkDir).
 */
async function writeArtifactsForGeneratePrd(
  worktreeDir: string,
  artifacts: LoopArtifact[],
  prompt: string,
  repo?: unknown,
): Promise<void> {
  const contextDir = path.join(worktreeDir, ".closedloop-ai", "context");
  const artifactsDir = path.join(contextDir, "artifacts");
  await fs.mkdir(artifactsDir, { recursive: true });

  // Write prompt
  await fs.writeFile(path.join(contextDir, "prompt.md"), prompt);

  // Write repo-info.json when present
  if (repo) {
    await fs.writeFile(
      path.join(contextDir, "repo-info.json"),
      JSON.stringify(repo, null, 2),
    );
  }

  // Write each artifact
  for (const artifact of artifacts) {
    const safeName = artifact.type
      .toLowerCase()
      .replaceAll(/[^a-z0-9_-]/g, "_");
    const safeId = (artifact.id ?? "unknown").replaceAll(
      /[^a-zA-Z0-9_-]/g,
      "_",
    );
    const header = `# ${artifact.title ?? "Untitled"}\n\n`;
    await fs.writeFile(
      path.join(artifactsDir, `${safeName}-${safeId}.md`),
      header + artifact.content,
    );
  }
}
// ---------------------------------------------------------------------------
// Per-command output reading
// ---------------------------------------------------------------------------

function readPlanOutputs(claudeWorkDir: string): Record<string, unknown> {
  const plan = readJsonFileSync(
    path.join(claudeWorkDir, LoopArtifactFile.Plan),
  );
  const openQuestions = readTextFile(
    path.join(claudeWorkDir, LoopArtifactFile.OpenQuestions),
  );
  const judges = readJsonFileSync(
    path.join(claudeWorkDir, LoopArtifactFile.Judges),
  );

  return {
    plan: plan ?? undefined,
    openQuestions: openQuestions ?? undefined,
    judges: judges ?? undefined,
  };
}

function readExecuteOutputs(claudeWorkDir: string): Record<string, unknown> {
  const executionResult = readJsonFileSync(
    path.join(claudeWorkDir, LoopArtifactFile.ExecutionResult),
  );
  const codeJudges = readJsonFileSync(
    path.join(claudeWorkDir, LoopArtifactFile.CodeJudges),
  );

  return {
    executionResult: executionResult ?? undefined,
    codeJudges: codeJudges ?? undefined,
  };
}

function readDecomposeOutputs(workDir: string): Record<string, unknown> {
  const features = readJsonFileSync(
    path.join(workDir, LoopArtifactFile.Features),
  );
  return { features: features ?? undefined };
}

function readGeneratePrdOutputs(worktreeDir: string): Record<string, unknown> {
  const prdContent = readTextFile(path.join(worktreeDir, LoopArtifactFile.Prd));
  return { prd: prdContent ? { content: prdContent } : undefined };
}

// ---------------------------------------------------------------------------
// Failure diagnostics helpers
// ---------------------------------------------------------------------------

/**
 * Patterns matching common credential / secret formats.
 * Applied to log tail before including in telemetry events.
 * Each entry is a [pattern, replacement] tuple with a string replacement.
 */
const CREDENTIAL_PATTERNS: Array<[RegExp, string]> = [
  // AWS keys: AKIA... style (20 uppercase alphanum after AKIA/ASIA/AROA prefix)
  [/\b(AKIA|ASIA|AROA)[A-Z0-9]{16}\b/g, "[REDACTED_AWS_KEY]"],
  // Generic bearer / API tokens: "Bearer <token>"
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/g, "Bearer [REDACTED]"],
  // sk- prefixed API keys (OpenAI, Anthropic, etc.)
  [/\bsk-[A-Za-z0-9\-_]{10,}/g, "[REDACTED_SK_KEY]"],
  // GitHub personal access tokens: ghp_, gho_, ghs_, ghr_
  [/\b(ghp|gho|ghs|ghr)_[A-Za-z0-9]{36,}/g, "[REDACTED_GH_TOKEN]"],
  // Generic "password=..." or "secret=..." in query strings / env
  [
    /\b(password|secret|passwd|api_key|apikey|auth_token)=[^\s&"']+/gi,
    "$1=[REDACTED]",
  ],
];

/**
 * Apply credential-pattern filters to redact common secret formats from a string.
 */
function redactCredentials(text: string): string {
  let result = text;
  for (const [pattern, replacement] of CREDENTIAL_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Collect failure diagnostics for a failed loop process.
 * Returns an object suitable for inclusion in the error telemetry event.
 */
function collectFailureDiagnostics(claudeWorkDir: string): {
  logTail: string | undefined;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
  tokensByModel: Record<string, ModelTokenUsage>;
  diagnosticsVersion: number;
} {
  const logPath = path.join(claudeWorkDir, "symphony-loop.log");
  const rawTail = readLogTail(logPath);
  const logTail = rawTail ? redactCredentials(rawTail) : undefined;
  const {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    tokensByModel,
  } = parseTokenUsage(claudeWorkDir);
  return {
    logTail,
    tokenUsage: {
      inputTokens,
      outputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
    },
    tokensByModel,
    diagnosticsVersion: 1,
  };
}

/** Pattern that matches known session/context limit error messages. */
export const SESSION_LIMIT_PATTERN =
  /prompt is too long|exceed context limit|context limit reached|conversation too long/i;

/**
 * Scan claude-output.jsonl for a result record with `is_error: true` whose
 * message matches a known session/context limit pattern.
 * Returns the error text (e.g. "Prompt is too long") or null if not found
 * or if the error is unrelated to context limits.
 */
export function detectSessionLimitFromJsonl(
  claudeWorkDir: string,
): string | null {
  const outputFile = path.join(claudeWorkDir, "claude-output.jsonl");
  if (!existsSync(outputFile)) {
    return null;
  }
  try {
    const content = readFileSync(outputFile, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (
          entry.type === "result" &&
          entry.is_error === true &&
          typeof entry.result === "string" &&
          SESSION_LIMIT_PATTERN.test(entry.result)
        ) {
          return entry.result;
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file read error
  }
  return null;
}

/**
 * Check whether a log tail string contains Claude Code session/context limit
 * error patterns. The log file contains both stdout and stderr.
 */
export function isSessionLimitError(logTail: string): boolean {
  return SESSION_LIMIT_PATTERN.test(logTail);
}

// ---------------------------------------------------------------------------
// Auth challenge detection
// ---------------------------------------------------------------------------

/** Pattern that matches known auth/rate-limit/billing error messages from Claude CLI. */
export const AUTH_CHALLENGE_PATTERN =
  /authentication_error|invalid bearer token|rate_limit_error|rate limit reached|usage limit|billing_error|permission_error|overloaded_error|api overloaded|\bunauthorized\b|token.*expired/i;

/**
 * Scan claude-output.jsonl for a result record with `is_error: true` whose
 * message matches a known auth/rate-limit/billing pattern.
 * Returns the error text or null if not found.
 */
export function detectAuthChallengeFromJsonl(
  claudeWorkDir: string,
): string | null {
  const outputFile = path.join(claudeWorkDir, "claude-output.jsonl");
  if (!existsSync(outputFile)) {
    return null;
  }
  try {
    const content = readFileSync(outputFile, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (
          entry.type === "result" &&
          entry.is_error === true &&
          typeof entry.result === "string" &&
          AUTH_CHALLENGE_PATTERN.test(entry.result)
        ) {
          return entry.result;
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file read error
  }
  return null;
}

/**
 * Check whether a log tail string contains Claude CLI auth/rate-limit/billing
 * error patterns.
 */
export function isAuthChallengeError(logTail: string): boolean {
  return AUTH_CHALLENGE_PATTERN.test(logTail);
}

// ---------------------------------------------------------------------------
// LLM-assisted commit (EXECUTE only)
// ---------------------------------------------------------------------------

async function attemptLlmCommit(
  worktreeDir: string,
  baseBranch: string,
  loopId: string,
  command: string,
  artifactSlug: string | undefined,
  webAppOrigin: string,
  committer: LoopCommitter | undefined,
  getAllowedDirectories: () => string[],
  expectedMcpUrl?: string,
  onTimeout?: () => void,
  jobStore?: JobStore,
  claudeWorkDir?: string,
): Promise<ExecutionResult | null> {
  // Build metadata footer for PR body
  // Strip newlines from user-controlled fields to prevent prompt injection
  const safeBranch = baseBranch.replace(/[\r\n]/g, "");
  const safeLoopId = sanitizeCommitMessage(loopId).replace(/[\r\n]/g, "");
  const safeSlug = artifactSlug
    ? sanitizeCommitMessage(artifactSlug).replace(/[\r\n]/g, "")
    : null;

  let footer: string;
  if (safeSlug) {
    // safeSlug contains only alphanumerics, hyphens, and underscores after
    // sanitizeCommitMessage() + newline stripping — no backticks that would
    // break shell heredocs or prompt injection via template literals.
    const artifactLink = `${webAppOrigin}/implementation-plans/${safeSlug}`;
    footer = `---\nLoop ID: ${safeLoopId}\nArtifact: ${artifactLink}`;
  } else {
    footer = `---\nLoop ID: ${safeLoopId}`;
  }

  // Build slug instruction for the prompt
  const slugInstruction = safeSlug
    ? `The artifact slug is ${safeSlug}. ` +
      `You MUST prefix the PR title with "${safeSlug}: " ` +
      `(e.g., "${safeSlug}: Add feature X"). ` +
      `Also prefix the commit message the same way.`
    : "No artifact slug is available — use a descriptive title without a prefix.";

  const prompt = [
    `You are a commit assistant finalizing work from a ClosedLoop.AI ${command} loop.`,
    "",
    slugInstruction,
    "",
    "Review all uncommitted changes in this repository and create a proper commit, push it, and create a pull request.",
    "",
    "STEPS:",
    "1. Run `git status` and `git diff --stat` to understand what changed",
    "2. Stage all changed/new files EXCEPT the .claude/ and .closedloop-ai/ directories:",
    "   git add -- . ':!.claude' ':!.closedloop-ai'",
    "3. Write a clear, descriptive commit message based on the actual code changes",
    "   - Summarize WHAT changed and WHY (not just 'ClosedLoop.AI loop output')",
    "   - Use conventional commit style if the changes have a clear category",
    "   - If an artifact slug is provided, prefix the commit message with it",
    "4. Run `git commit` (do NOT use --no-verify). If pre-commit hooks fail, attempt to fix",
    "   the issue (e.g., run the linter/formatter if the error message tells you how).",
    "   If you cannot quickly fix it, the commit fails — do not bypass hooks.",
    "5. Push to origin with: git push -u origin HEAD",
    "6. Check if a PR already exists for this branch: gh pr list --head <branch>",
    "   - If NO PR exists:",
    "     a. Check if the repo has a PR template at .github/pull_request_template.md",
    "        If a template exists, use it as the base for the PR body — fill in every section appropriately.",
    "        If no template exists, write a summary of what changed and why.",
    "     b. Append the following metadata footer on its own lines at the end:",
    `        ${footer}`,
    "     c. Write the complete PR body to pr-body.md",
    `     d. Create the PR: gh pr create --label symphony --base ${shellEscape(safeBranch)} --title '<slug-prefixed descriptive title>' --body-file pr-body.md`,
    "   - If a PR already exists, get its URL with: gh pr view --json url,number",
    "     Fetch the current body: gh pr view <number> --json body --jq .body",
    "     If any required template sections are missing, append them.",
    `     Write the full updated body to pr-body.md and run: gh pr edit <number> --body-file pr-body.md`,
    "7. ONLY after a successful commit AND push, write this EXACT JSON file:",
    "   File path: execution-result.json",
    "   ```json",
    "   {",
    '     "prUrl": "<full GitHub PR URL>",',
    '     "prNumber": <PR number as integer>,',
    '     "branchName": "<current branch name>",',
    '     "commitSha": "<output of git rev-parse HEAD>"',
    "   }",
    "   ```",
    "   Run `git rev-parse HEAD` to get the commit SHA.",
    "",
    "RULES:",
    "- NEVER stage or commit the .claude/ or .closedloop-ai/ directories",
    "- Do NOT use --no-verify on git commit",
    "- Do NOT modify any source code except to fix pre-commit hook failures (formatting, lint)",
    "- Do NOT write execution-result.json unless you successfully committed AND pushed",
    "- Keep it quick — commit, push, PR, write result file, done",
  ].join("\n");

  loopLog(loopId, "Attempting LLM-assisted commit...");

  // Sandbox gate: verify the worktree directory is within an allowed path
  // before spawning any child process on it. This mirrors the assertPathAllowed
  // check performed in handleLoopRequest before the main loop spawn.
  try {
    assertPathAllowed(worktreeDir, getAllowedDirectories());
  } catch (sandboxErr) {
    if (sandboxErr instanceof DirectoryNotAllowedError) {
      loopError(
        loopId,
        `LLM commit aborted: worktreeDir not in allowed sandbox: ${worktreeDir}`,
      );
      return null;
    }
    throw sandboxErr;
  }

  const spawnEnv: Record<string, string> = await getShellEnv();
  if (committer) {
    spawnEnv.GIT_AUTHOR_NAME = committer.name;
    spawnEnv.GIT_AUTHOR_EMAIL = committer.email;
    spawnEnv.GIT_COMMITTER_NAME = committer.name;
    spawnEnv.GIT_COMMITTER_EMAIL = committer.email;
  }

  // Resolve the absolute path to the `claude` binary once at first use.
  // Electron strips PATH to a minimal system set when launching via the .app
  // bundle or launchd (macOS) / systemd (Linux), so the bare name "claude"
  // typically resolves to ENOENT even though it works in a terminal. Running
  // `which claude` in a login shell picks up the full user PATH including
  // nvm/homebrew/local bin directories. getResolvedClaudePath() caches the
  // result for the process lifetime.
  const claudeBinary = getResolvedClaudePath();
  const allowedTools = await withMcpTools(
    "Bash,Read,Write,Glob,Grep",
    expectedMcpUrl,
  );
  const spawnArgs = [
    "-p",
    prompt,
    "--allowedTools",
    allowedTools,
  ];
  loopLog(
    loopId,
    `LLM commit spawn: binary=${claudeBinary} args=["-p", "<prompt omitted>", "--allowedTools", "${allowedTools}"] cwd=${worktreeDir} PATH=${spawnEnv.PATH ?? "(unset)"}`,
  );

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(claudeBinary, spawnArgs, {
      cwd: worktreeDir,
      detached: true,
      stdio: "pipe",
      env: spawnEnv,
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "unknown";
    const enoentDetail =
      code === "ENOENT"
        ? ` — '${claudeBinary}' binary not found; PATH=${spawnEnv.PATH ?? "(unset)"}`
        : "";
    loopError(
      loopId,
      `LLM commit spawn failed [code=${code}${enoentDetail}]`,
      err,
    );
    return null;
  }

  const pid = child.pid ?? null;
  if (!pid) {
    loopError(loopId, "LLM commit: spawn returned no PID");
    return null;
  }

  // Track the LLM commit PID so kill routes and snapshot enrichment see the current process
  const existing = runningLoops.get(loopId);
  if (existing) {
    runningLoops.set(loopId, { pid, child, stage: "post-processing" });
  }
  if (jobStore) {
    const existingJob = jobStore.getByLoopId(loopId);
    if (existingJob) {
      jobStore.upsert({
        ...existingJob,
        pid,
        updatedAt: new Date().toISOString(),
      });
    }
  }
  // Update on-disk PID file so readProcessPidSync (used by plan-loop cancel and
  // status endpoint liveness checks) sees the LLM commit child, not the dead
  // main-loop PID.  Write atomically via a .pid.tmp temp file renamed into
  // place to prevent a concurrent reader from observing a partial write.
  if (claudeWorkDir) {
    try {
      const pidFilePath = path.join(claudeWorkDir, "process.pid");
      const pidTmpPath = path.join(claudeWorkDir, "process.pid.tmp");
      writeFileSync(pidTmpPath, String(pid));
      renameSync(pidTmpPath, pidFilePath);
    } catch {
      loopLog(loopId, "Failed to update process.pid for LLM commit child");
    }
  }

  return new Promise<ExecutionResult | null>((resolve) => {
    let killed = false;

    // Process group kill behavior:
    // The child is spawned with `detached: true`, which places it in its own
    // process group (pgid === child.pid on POSIX). Sending SIGTERM/SIGKILL to
    // -pid (negative PID) targets the entire process group, ensuring that any
    // subprocesses spawned by claude (git, gh, etc.) are also terminated and
    // do not become orphans when the timeout fires or cancel is requested.
    const killTimer = setTimeout(() => {
      if (!killed) {
        killed = true;
        loopError(loopId, "LLM commit timed out after 30m — sending SIGTERM");
        onTimeout?.();
        try {
          process.kill(-pid, "SIGTERM");
        } catch (killErr) {
          loopError(loopId, "Failed to kill LLM commit process:", killErr);
        }
        // Escalate to SIGKILL after 5s if the process group survives SIGTERM
        setTimeout(() => {
          try {
            process.kill(pid, 0); // check alive
            process.kill(-pid, "SIGKILL");
          } catch {
            // Already gone
          }
        }, 5_000);
      }
    }, 30 * 60_000);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("close", (code: number | null) => {
      clearTimeout(killTimer);

      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      if (stdout) {
        loopLog(loopId, `LLM commit stdout (tail): ${stdout.slice(-2000)}`);
      }
      if (stderr) {
        loopLog(loopId, `LLM commit stderr (tail): ${stderr.slice(-1000)}`);
      }

      // code is null when the process was killed by a signal
      if (killed || code == null || code !== 0) {
        loopError(loopId, `LLM commit exited with code ${code ?? "killed"}`);
        resolve(null);
        return;
      }

      // Read execution-result.json written by the LLM, then clean up scratch
      // files unconditionally so they never leak into subsequent worktree runs.
      const resultFilePath = path.join(
        worktreeDir,
        LoopArtifactFile.ExecutionResult,
      );
      const prBodyFilePath = path.join(worktreeDir, "pr-body.md");
      let result: ExecutionResult | null = null;
      try {
        const raw = readFileSync(resultFilePath, "utf-8");
        const parsed: unknown = JSON.parse(raw);
        if (isExecutionResult(parsed)) {
          loopLog(
            loopId,
            `LLM commit wrote execution-result.json, pr=${parsed.prUrl}`,
          );
          result = parsed;
        } else {
          loopError(
            loopId,
            "LLM execution-result.json failed type guard, returning null",
          );
        }
      } catch (err) {
        loopError(
          loopId,
          "LLM commit: failed to read execution-result.json:",
          err,
        );
      }
      // Always remove LLM scratch files from the worktree
      try {
        unlinkSync(resultFilePath);
      } catch {
        /* may not exist */
      }
      try {
        unlinkSync(prBodyFilePath);
      } catch {
        /* may not exist */
      }
      resolve(result);
    });

    child.on("error", (err: Error) => {
      clearTimeout(killTimer);
      const code = (err as NodeJS.ErrnoException).code ?? "unknown";
      const enoentDetail =
        code === "ENOENT"
          ? ` — '${claudeBinary}' binary not found; PATH=${spawnEnv.PATH ?? "(unset)"}`
          : "";
      loopError(
        loopId,
        `LLM commit process error [code=${code}${enoentDetail}]:`,
        err,
      );
      resolve(null);
    });

    // unref AFTER event listeners are attached so the ChildProcess handle
    // is not garbage-collected before exit/error events fire.
    child.unref();
  });
}

// ---------------------------------------------------------------------------
// Git operations (EXECUTE only)
// ---------------------------------------------------------------------------

type GitOperationResult =
  | {
      status: "success";
      prUrl: string;
      prNumber: number;
      branchName: string;
      commitSha: string;
    }
  | { status: "no-changes" }
  | { status: "error"; reason: string };

function executeGitOperations(
  worktreeDir: string,
  committer: LoopCommitter | undefined,
  baseBranch: string,
  loopId: string,
  command: string,
  artifactSlug?: string,
  webAppOrigin?: string,
  shellPath?: string,
): GitOperationResult {
  const shortId = loopId.slice(0, 8);
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(shellPath ? { PATH: shellPath } : {}),
  };
  if (committer) {
    env.GIT_AUTHOR_NAME = committer.name;
    env.GIT_AUTHOR_EMAIL = committer.email;
    env.GIT_COMMITTER_NAME = committer.name;
    env.GIT_COMMITTER_EMAIL = committer.email;
  }

  // Check for changes, excluding .claude/ and .closedloop-ai/ which are written
  // by the gateway itself (work dir, artifacts) and must never be committed.
  try {
    const status = execSync(
      "git status --porcelain -- . ':!.claude' ':!.closedloop-ai'",
      {
        cwd: worktreeDir,
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 10_000,
      },
    ).trim();

    if (!status) {
      return { status: "no-changes" }; // No changes
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { status: "error", reason };
  }

  // Stage, commit, push
  try {
    execSync("git add -- . ':!.claude' ':!.closedloop-ai'", {
      cwd: worktreeDir,
      stdio: "pipe",
      env,
      timeout: 10_000,
    });

    const commitPrefix = artifactSlug ? `${artifactSlug}: ` : "";
    const fallbackTitle = `${commitPrefix}Automated changes from loop ${shortId}`;
    execSync(`git commit -m ${shellEscape(fallbackTitle)}`, {
      cwd: worktreeDir,
      stdio: "pipe",
      env,
      timeout: 30_000,
    });

    const branchName = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: worktreeDir,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 10_000,
    }).trim();

    execSync(`git push -u origin ${shellEscape(branchName)}`, {
      cwd: worktreeDir,
      stdio: "pipe",
      env,
      timeout: 60_000,
    });

    const commitSha = execSync("git rev-parse HEAD", {
      cwd: worktreeDir,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 10_000,
    }).trim();

    // Build PR body using the repo's PR template if one exists, otherwise
    // fall back to a simple metadata body. Written to a temp file to avoid
    // shell escaping issues with special characters (--body-file approach).
    const artifactLine =
      artifactSlug && webAppOrigin
        ? `\nArtifact: ${webAppOrigin}/implementation-plans/${artifactSlug}`
        : "";
    const metadataFooter = `---\nLoop ID: ${loopId}\nCommand: ${command}${artifactLine}`;

    let prBody: string;
    const templatePath = path.join(
      worktreeDir,
      ".github",
      "pull_request_template.md",
    );
    try {
      const template = readFileSync(templatePath, "utf-8");
      prBody = [
        `Automated PR created by ClosedLoop.AI loop runner.`,
        "",
        `**Loop:** \`${loopId}\``,
        `**Command:** \`${command}\``,
        "",
        template,
        "",
        metadataFooter,
      ].join("\n");
    } catch {
      // No template found — use simple metadata body
      prBody = [
        `Automated PR created by ClosedLoop.AI loop runner.`,
        "",
        `**Loop:** \`${loopId}\``,
        `**Command:** \`${command}\``,
        "",
        metadataFooter,
      ].join("\n");
    }
    const bodyFile = path.join(
      worktreeDir,
      ".closedloop-ai",
      "work",
      "pr-body.md",
    );
    mkdirSync(path.dirname(bodyFile), { recursive: true });
    writeFileSync(bodyFile, prBody);

    // Check for existing PR before creating (handles retries gracefully)
    let prUrl: string;
    let prNumber: number;
    try {
      const existingPr = execSync(
        `gh pr view --json url,number ${shellEscape(branchName)}`,
        {
          cwd: worktreeDir,
          encoding: "utf-8",
          stdio: "pipe",
          env,
          timeout: 15_000,
        },
      ).trim();
      const parsedUnknown: unknown = JSON.parse(existingPr);
      if (
        typeof parsedUnknown !== "object" ||
        parsedUnknown === null ||
        typeof (parsedUnknown as Record<string, unknown>).url !== "string" ||
        typeof (parsedUnknown as Record<string, unknown>).number !== "number"
      ) {
        throw new Error("Unexpected shape from gh pr view JSON");
      }
      const parsed = parsedUnknown as { url: string; number: number };
      prUrl = parsed.url;
      prNumber = parsed.number;
    } catch {
      // No existing PR — create one using --body-file to avoid shell escaping.
      // Create without --label first so the PR still succeeds on repos where the
      // 'symphony' label doesn't exist yet, then attach the label best-effort.
      const prOutput = execSync(
        `gh pr create --title ${shellEscape(fallbackTitle)} --body-file ${shellEscape(bodyFile)} --base ${shellEscape(baseBranch)}`,
        {
          cwd: worktreeDir,
          encoding: "utf-8",
          stdio: "pipe",
          env,
          timeout: 30_000,
        },
      ).trim();
      prUrl = prOutput;
      const prNumberMatch = /\/pull\/(\d+)/.exec(prUrl);
      prNumber = prNumberMatch ? Number.parseInt(prNumberMatch[1], 10) : 0;

      // Best-effort label attachment — non-fatal if the label doesn't exist
      if (prNumber) {
        try {
          execSync(`gh pr edit ${prNumber} --add-label symphony`, {
            cwd: worktreeDir,
            stdio: "pipe",
            env,
            timeout: 15_000,
          });
        } catch {
          // Label may not exist on this repo — not critical
        }
      }
    }

    // Ensure the metadata footer is present on the PR body.  For existing PRs,
    // fetch the current body and append the metadata instead of replacing it.
    try {
      const currentBody = execSync(
        `gh pr view ${prNumber} --json body --jq .body`,
        {
          cwd: worktreeDir,
          encoding: "utf-8",
          stdio: "pipe",
          env,
          timeout: 15_000,
        },
      ).trim();
      // Only update if the footer isn't already present — append only the
      // metadata footer, not the full template body, to avoid duplication.
      if (!currentBody.includes(`Loop ID: ${loopId}`)) {
        const updatedBody = currentBody
          ? `${currentBody}\n\n${metadataFooter}`
          : prBody;
        writeFileSync(bodyFile, updatedBody);
        execSync(
          `gh pr edit ${prNumber} --body-file ${shellEscape(bodyFile)}`,
          { cwd: worktreeDir, stdio: "pipe", env, timeout: 15_000 },
        );
      }
    } catch {
      // Non-critical — PR exists, metadata is best-effort
    }

    return { status: "success", prUrl, prNumber, branchName, commitSha };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { status: "error", reason };
  }
}

// ---------------------------------------------------------------------------
// Process completion handler (async, runs after spawn)
// ---------------------------------------------------------------------------

function isCancelled(jobStore: JobStore | undefined, loopId: string): boolean {
  const status = jobStore?.getByLoopId(loopId)?.status;
  return status === "CANCEL_PENDING" || status === "CANCELLED";
}

export async function handleProcessCompletion(
  exitCode: number,
  body: LoopRequestBody,
  apiBaseUrl: string,
  worktreeDir: string | null,
  claudeWorkDir: string,
  usedTempDir: boolean,
  expandedRepoPath: string | null,
  getAllowedDirectories: () => string[],
  expectedMcpUrl?: string,
  jobStore?: JobStore,
  webAppOrigin?: string,
  commandId?: string,
  operationId?: string,
  wt: WorktreeProvider = defaultWorktreeProvider,
  loopTokenStore?: LoopTokenStore,
  additionalWorktreeDirs: { dir: string; repoPath: string }[] = [],
): Promise<void> {
  const { loopId, command, closedLoopAuthToken, committer } = body;
  // Temp-dir commands (DECOMPOSE, EVALUATE_*) need the entire temp tree removed on cleanup.
  const tempCleanupDir = usedTempDir ? (worktreeDir ?? claudeWorkDir) : null;

  loopLog(loopId, `Process exited with code ${exitCode}, command=${command}`);

  if (exitCode !== 0) {
    // Collect diagnostics (log tail + token usage) for the failure event
    const diagnostics = collectFailureDiagnostics(claudeWorkDir);
    const sessionFileForTelemetry = path.join(claudeWorkDir, "session-id.txt");
    const rawSessionId = readTextFile(sessionFileForTelemetry);
    const failureSessionId = rawSessionId ? rawSessionId.trim() : undefined;
    runningLoops.delete(loopId);
    const existingJob = jobStore?.getByLoopId(loopId);
    const wasCancelled =
      existingJob?.status === "CANCEL_PENDING" ||
      existingJob?.status === "CANCELLED";

    if (wasCancelled) {
      Observability.jobCancelled(
        commandId ?? existingJob?.commandId,
        operationId ?? existingJob?.operationId,
        loopId,
        exitCode,
        diagnostics,
        failureSessionId,
      );
      await postLoopEvent(apiBaseUrl, loopId, closedLoopAuthToken, {
        type: LoopEventType.Error,
        code: LoopErrorCode.Cancelled,
        message: "Loop cancelled",
        loopId,
        sessionId: failureSessionId,
        tokenUsage: diagnostics.tokenUsage,
        tokensByModel: diagnostics.tokensByModel,
        logTail: diagnostics.logTail,
        diagnosticsVersion: String(diagnostics.diagnosticsVersion),
      });
    } else {
      Observability.jobFailed(
        commandId ?? existingJob?.commandId,
        operationId ?? existingJob?.operationId,
        loopId,
        exitCode,
        diagnostics,
        failureSessionId,
      );
    }

    // Detect context/session limit errors (exit code 2, JSONL is_error, or
    // stderr patterns) and surface a specific error code.
    const jsonlError = detectSessionLimitFromJsonl(claudeWorkDir);
    const isContextLimit =
      exitCode === 2 ||
      jsonlError !== null ||
      (diagnostics.logTail != null && isSessionLimitError(diagnostics.logTail));

    // Detect auth/rate-limit/billing errors from JSONL or stderr.
    const jsonlAuthError = detectAuthChallengeFromJsonl(claudeWorkDir);
    const isAuthChallenge =
      !isContextLimit &&
      (jsonlAuthError !== null ||
        (diagnostics.logTail != null &&
          isAuthChallengeError(diagnostics.logTail)));

    if (!wasCancelled) {
      if (isContextLimit) {
        const limitMsg = jsonlError ?? "Context limit exceeded";
        loopError(loopId, `Context limit detected: ${limitMsg}`);
        gatewayLog.error(
          "loop-harness",
          `${command} hit context limit, loopId=${loopId}: ${limitMsg}`,
        );
        await postLoopEvent(apiBaseUrl, loopId, closedLoopAuthToken, {
          type: LoopEventType.Error,
          code: LoopErrorCode.ContextLimitExceeded,
          message: limitMsg,
          loopId,
          sessionId: failureSessionId,
          tokenUsage: diagnostics.tokenUsage,
          tokensByModel: diagnostics.tokensByModel,
          logTail: diagnostics.logTail,
          diagnosticsVersion: String(diagnostics.diagnosticsVersion),
        });
      } else if (isAuthChallenge) {
        const authMsg = jsonlAuthError ?? "Claude auth challenge detected";
        loopError(loopId, `Auth challenge detected: ${authMsg}`);
        gatewayLog.error(
          "loop-harness",
          `${command} hit auth challenge, loopId=${loopId}: ${authMsg}`,
        );
        Observability.jobAuthChallenge(
          commandId ?? existingJob?.commandId,
          operationId ?? existingJob?.operationId,
          loopId,
          exitCode,
          diagnostics,
          failureSessionId,
        );
        await postLoopEvent(apiBaseUrl, loopId, closedLoopAuthToken, {
          type: LoopEventType.Error,
          code: LoopErrorCode.AuthChallenge,
          message: authMsg,
          loopId,
          sessionId: failureSessionId,
          tokenUsage: diagnostics.tokenUsage,
          tokensByModel: diagnostics.tokensByModel,
          logTail: diagnostics.logTail,
          diagnosticsVersion: String(diagnostics.diagnosticsVersion),
        });
      } else {
        loopError(loopId, `Process failed with exit code ${exitCode}`);
        gatewayLog.error(
          "loop-harness",
          `${command} failed with exit code ${exitCode}, loopId=${loopId}`,
        );
        await postLoopEvent(apiBaseUrl, loopId, closedLoopAuthToken, {
          type: LoopEventType.Error,
          code: LoopErrorCode.ProcessFailed,
          message: `Process exited with code ${exitCode}`,
          loopId,
          sessionId: failureSessionId,
          tokenUsage: diagnostics.tokenUsage,
          tokensByModel: diagnostics.tokensByModel,
          logTail: diagnostics.logTail,
          diagnosticsVersion: String(diagnostics.diagnosticsVersion),
        });
      }
    }

    if (existingJob && jobStore) {
      const now = new Date().toISOString();
      jobStore.upsert({
        ...existingJob,
        status: wasCancelled ? "CANCELLED" : "FAILED",
        liveActivity:
          !wasCancelled && isContextLimit
            ? "Context limit exceeded"
            : !wasCancelled && isAuthChallenge
              ? `Auth challenge: ${jsonlAuthError ?? "authentication error"}`
              : undefined,
        exitCode,
        updatedAt: now,
        completedAt: now,
      });
    }
    if (tempCleanupDir) {
      fs.rm(tempCleanupDir, { recursive: true, force: true }).catch(() => {});
    } else if (command === "GENERATE_PRD" && worktreeDir && expandedRepoPath) {
      await wt.removeWorktree(worktreeDir, expandedRepoPath, loopId);
    }
    await cleanupAdditionalWorktrees(additionalWorktreeDirs, loopId, wt, "cleanup additional worktree failed (on error):");
    loopTokenStore?.deleteLoopToken(loopId);
    return;
  }

  // exitCode === 0 success path -- keep in runningLoops until post-processing completes
  try {
    // Read outputs per command
    gatewayLog.info(
      "loop-harness",
      `${command} succeeded (exit 0), reading artifacts for loopId=${loopId}`,
    );
    let artifacts: Record<string, unknown> = {};
    const metadata: Record<string, unknown> = {};
    const warnings: string[] = [];

    if (command === "PLAN" || command === "REQUEST_CHANGES") {
      artifacts = readPlanOutputs(claudeWorkDir);
    } else if (command === "EXECUTE") {
      artifacts = readExecuteOutputs(claudeWorkDir);

      // Git operations for EXECUTE
      if (worktreeDir) {
        const baseBranch = body.repo?.branch ?? "main";

        // Cancellation gate: skip git operations if cancelled during main process
        if (isCancelled(jobStore, loopId)) {
          const cancelJob = jobStore?.getByLoopId(loopId);
          if (cancelJob && jobStore) {
            const now = new Date().toISOString();
            jobStore.upsert({
              ...cancelJob,
              status: "CANCELLED",
              updatedAt: now,
              completedAt: now,
            });
          }
          if (tempCleanupDir) {
            fs.rm(tempCleanupDir, { recursive: true, force: true }).catch(
              () => {},
            );
          }
          loopTokenStore?.deleteLoopToken(loopId);
          return;
        }

        // Try LLM-assisted commit first; fall back to executeGitOperations if it
        // returns null.  Never call both.
        const llmResult = await attemptLlmCommit(
          worktreeDir,
          baseBranch,
          loopId,
          command,
          body.artifactSlug,
          webAppOrigin ?? "",
          committer,
          getAllowedDirectories,
          expectedMcpUrl,
          () => {
            warnings.push(
              sanitizeErrorMessage("LLM commit timed out after 30m"),
            );
          },
          jobStore,
          claudeWorkDir,
        );

        // Clean up any remaining LLM scratch files before fallback to prevent
        // them from being committed by executeGitOperations.  attemptLlmCommit
        // already cleans up on success, but these guards cover edge cases where
        // the process was killed before the cleanup ran.
        if (!llmResult) {
          try {
            unlinkSync(
              path.join(worktreeDir, LoopArtifactFile.ExecutionResult),
            );
          } catch {
            /* may not exist */
          }
          try {
            unlinkSync(path.join(worktreeDir, "pr-body.md"));
          } catch {
            /* may not exist */
          }
        }

        // Cancellation gate: skip fallback git operations if cancelled during LLM commit
        if (isCancelled(jobStore, loopId)) {
          const cancelJob = jobStore?.getByLoopId(loopId);
          if (cancelJob && jobStore) {
            const now = new Date().toISOString();
            jobStore.upsert({
              ...cancelJob,
              status: "CANCELLED",
              updatedAt: now,
              completedAt: now,
            });
          }
          if (tempCleanupDir) {
            fs.rm(tempCleanupDir, { recursive: true, force: true }).catch(
              () => {},
            );
          }
          loopTokenStore?.deleteLoopToken(loopId);
          return;
        }

        const gitShellPath = await getShellPath();
        const gitResult: GitOperationResult = llmResult
          ? { status: "success" as const, ...llmResult }
          : executeGitOperations(
              worktreeDir,
              committer,
              baseBranch,
              loopId,
              command,
              body.artifactSlug,
              webAppOrigin ?? "",
              gitShellPath,
            );

        if (gitResult.status === "success") {
          // Merge git info into execution result
          const execResult =
            (artifacts.executionResult as Record<string, unknown>) ?? {};
          execResult.pr_url = gitResult.prUrl;
          execResult.pr_number = gitResult.prNumber;
          execResult.branch_name = gitResult.branchName;
          execResult.commit_sha = gitResult.commitSha;
          execResult.has_changes = true;
          execResult.base_ref = baseBranch;
          artifacts.executionResult = execResult;
          metadata.branchName = gitResult.branchName;
          // Persist merged execute metadata for reboot-time finalization replay.
          try {
            writeFileSync(
              path.join(claudeWorkDir, LoopArtifactFile.ExecutionResult),
              JSON.stringify(execResult),
            );
          } catch (err) {
            loopLog(loopId, "Failed to persist execution-result.json:", err);
          }
        } else if (gitResult.status === "no-changes") {
          gatewayLog.info(
            "loop-harness",
            "no local changes detected, skipping PR creation, loopId=" + loopId,
          );
        } else if (gitResult.status === "error") {
          gatewayLog.warn(
            "loop-harness",
            "git operations failed: " +
              sanitizeErrorMessage(gitResult.reason) +
              ", loopId=" +
              loopId,
          );
          warnings.push("GIT_PUSH_FAILED");
        }
      }
    } else if (command === "DECOMPOSE") {
      artifacts = readDecomposeOutputs(worktreeDir ?? claudeWorkDir);
    } else if (command === "EVALUATE_PRD") {
      artifacts = readEvaluatePrdOutputs(claudeWorkDir);
    } else if (command === "EVALUATE_PLAN") {
      artifacts = readEvaluatePlanOutputs(claudeWorkDir);
    } else if (command === "EVALUATE_CODE") {
      artifacts = readEvaluateCodeOutputs(claudeWorkDir);
    } else if (command === "GENERATE_PRD") {
      artifacts = readGeneratePrdOutputs(worktreeDir ?? claudeWorkDir);
    }

    // Validate result bundle — warn if required artifacts are missing for this command
    const artifactDir = worktreeDir ?? claudeWorkDir;
    const presentFiles = Object.values(LoopArtifactFile).filter(
      (f) =>
        existsSync(path.join(artifactDir, f)) ||
        existsSync(path.join(claudeWorkDir, f)),
    );
    const missingRequired = validateResultBundle(command, presentFiles);
    if (missingRequired.length > 0) {
      gatewayLog.warn(
        "loop-harness",
        `Missing required artifacts for ${command}: ${missingRequired.join(", ")}, loopId=${loopId}`,
      );
    }

    // Read session ID if available
    const sessionFile = path.join(claudeWorkDir, "session-id.txt");
    const sessionId = readTextFile(sessionFile);
    if (sessionId) {
      metadata.sessionId = sessionId.trim();
    }

    // JobStore-backed loops: `finalizeLoopFromRuntime` owns artifact upload + completed event.
    if (!jobStore) {
      const artifactKeys = Object.keys(artifacts);
      loopLog(loopId, "Artifact keys:", artifactKeys);
      gatewayLog.info(
        "loop-harness",
        `Uploading artifacts for ${command} loopId=${loopId}: [${artifactKeys.join(", ")}]`,
      );
      const uploadResult = await uploadArtifacts(
        apiBaseUrl,
        loopId,
        closedLoopAuthToken,
        {
          artifacts,
          metadata,
        },
      );
      if (!uploadResult.success) {
        gatewayLog.warn(
          "loop-harness",
          "Artifact upload failed: " +
            (uploadResult.error ?? "unknown error") +
            ", loopId=" +
            loopId,
        );
        warnings.push("ARTIFACT_UPLOAD_FAILED");
      }
    }

    // Parse token usage from claude output
    const {
      inputTokens,
      outputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
      turns,
      models,
      tokensByModel,
    } = parseTokenUsage(claudeWorkDir);
    const tokensUsed = {
      inputTokens,
      outputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
      turns,
      models,
    };
    loopLog(
      loopId,
      `Tokens used: input=${tokensUsed.inputTokens}, output=${tokensUsed.outputTokens}, cacheCreation=${tokensUsed.cacheCreationInputTokens}, cacheRead=${tokensUsed.cacheReadInputTokens}, turns=${tokensUsed.turns}`,
    );

    // Detect 0-token EXECUTE completions as failures (ghost loop)
    if (
      command === "EXECUTE" &&
      tokensUsed.inputTokens === 0 &&
      tokensUsed.outputTokens === 0 &&
      tokensUsed.cacheCreationInputTokens === 0 &&
      tokensUsed.cacheReadInputTokens === 0
    ) {
      const noWorkMsg =
        "EXECUTE loop completed with 0 tokens -- no work was done";
      loopError(loopId, noWorkMsg);
      gatewayLog.error("loop-harness", `${noWorkMsg}, loopId=${loopId}`);
      runningLoops.delete(loopId);
      await postLoopEvent(apiBaseUrl, loopId, closedLoopAuthToken, {
        type: LoopEventType.Error,
        code: LoopErrorCode.NoWorkProduced,
        message: noWorkMsg,
        loopId,
      });
      if (jobStore) {
        const existingJob = jobStore.getByLoopId(loopId);
        if (existingJob) {
          const now = new Date().toISOString();
          jobStore.upsert({
            ...existingJob,
            status: "FAILED",
            liveActivity: "Error: Loop produced no output (0 tokens)",
            exitCode: 0,
            updatedAt: now,
            completedAt: now,
          });
        }
      }
      if (tempCleanupDir) {
        fs.rm(tempCleanupDir, { recursive: true, force: true }).catch(() => {});
      }
      loopTokenStore?.deleteLoopToken(loopId);
      return;
    }

    // Cancellation gate: skip completed event if cancelled during post-processing
    if (isCancelled(jobStore, loopId)) {
      const cancelJob = jobStore?.getByLoopId(loopId);
      if (cancelJob && jobStore) {
        const now = new Date().toISOString();
        jobStore.upsert({
          ...cancelJob,
          status: "CANCELLED",
          updatedAt: now,
          completedAt: now,
        });
      }
      if (tempCleanupDir) {
        fs.rm(tempCleanupDir, { recursive: true, force: true }).catch(() => {});
      } else if (
        command === "GENERATE_PRD" &&
        worktreeDir &&
        expandedRepoPath
      ) {
        await wt.removeWorktree(worktreeDir, expandedRepoPath, loopId);
      }
      await cleanupAdditionalWorktrees(additionalWorktreeDirs, loopId, wt);
      loopTokenStore?.deleteLoopToken(loopId);
      return;
    }

    if (warnings.length > 0 && jobStore) {
      const existingJob = jobStore.getByLoopId(loopId);
      if (existingJob) {
        const existingWarnings = existingJob.warning
          ? existingJob.warning
              .split(";")
              .map((value) => value.trim())
              .filter((value) => value.length > 0)
          : [];
        const mergedWarnings = [...new Set([...existingWarnings, ...warnings])];
        jobStore.upsert({
          ...existingJob,
          warning: mergedWarnings.map(sanitizeErrorMessage).join("; "),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    runningLoops.delete(loopId);
    const existingJob = jobStore?.getByLoopId(loopId);
    if (existingJob && jobStore) {
      gatewayLog.info(
        "loop-harness",
        `Finalizing ${command} via JobStore, loopId=${loopId}`,
      );
      const finalizerDeps: LoopFinalizerDeps = {
        jobStore,
        telemetry: { emit: () => {} },
        apiAuthToken: closedLoopAuthToken,
        apiBaseUrl,
        isProcessRunning,
        loopTokenStore,
      };
      const outcome = await finalizeLoopFromRuntime(
        existingJob,
        "live-exit",
        finalizerDeps,
      );
      if (!outcome.cloudFinalized) {
        gatewayLog.error(
          "loop-harness",
          `Cloud finalization failed for ${command} loopId=${loopId}: ${outcome.error ?? "unknown"}, retryable=${outcome.retryableFailure}`,
        );
      }
      const sessionId = readTextFile(
        path.join(claudeWorkDir, "session-id.txt"),
      );
      const normalizedSessionId = sessionId?.trim();
      Observability.jobCompleted(
        commandId ?? existingJob.commandId,
        operationId ?? existingJob.operationId,
        loopId,
        undefined,
        normalizedSessionId && normalizedSessionId.length > 0
          ? normalizedSessionId
          : undefined,
      );
    } else {
      // Legacy completion path: route-level behavior when no JobStore is present.
      // Upload already ran above (no jobStore branch).
      const result: Record<string, unknown> = {
        exitCode,
        subtype: command.toLowerCase(),
      };
      if (command === "EXECUTE" && artifacts.executionResult) {
        const parsed = parseExecutionResultFile(artifacts.executionResult);
        if (parsed) {
          result.prUrl = parsed.prUrl;
          result.prNumber = parsed.prNumber;
          result.branchName = parsed.branchName;
          result.has_changes = parsed.hasChanges;
        }
      }
      if (worktreeDir && !result.branchName) {
        const branch = wt.getCurrentBranch(worktreeDir);
        if (branch) {
          result.branchName = branch;
        }
      }
      const legacySessionId = sessionId?.trim();
      if (legacySessionId) {
        result.sessionId = legacySessionId;
      }

      const completedEvent: Record<string, unknown> = {
        type: LoopEventType.Completed,
        result,
        tokensUsed: {
          input: tokensUsed.inputTokens,
          output: tokensUsed.outputTokens,
          cacheCreationInputTokens: tokensUsed.cacheCreationInputTokens,
          cacheReadInputTokens: tokensUsed.cacheReadInputTokens,
          turns: tokensUsed.turns,
          models: tokensUsed.models,
        },
        tokensByModel,
        loopId,
        ...(warnings.length > 0 ? { warnings } : {}),
      };

      const eventResult = await postLoopEvent(
        apiBaseUrl,
        loopId,
        closedLoopAuthToken,
        completedEvent,
      );
      if (!eventResult.success) {
        warnings.push("EVENT_POST_FAILED");
      }

      Observability.jobCompleted(
        commandId,
        operationId,
        loopId,
        undefined,
        legacySessionId,
      );
      loopTokenStore?.deleteLoopToken(loopId);
    }

    // Clean up temp claude workdir after all reads and uploads are complete
    if (tempCleanupDir) {
      fs.rm(tempCleanupDir, { recursive: true, force: true }).catch(() => {});
    } else if (command === "GENERATE_PRD" && worktreeDir && expandedRepoPath) {
      await wt.removeWorktree(worktreeDir, expandedRepoPath, loopId);
    }

    await cleanupAdditionalWorktrees(additionalWorktreeDirs, loopId, wt);
  } finally {
    runningLoops.delete(loopId);
  }
}

// ---------------------------------------------------------------------------
// Main route handler
// ---------------------------------------------------------------------------

async function handleLoopRequest(
  context: OperationRequestContext,
  getAllowedDirectories: () => string[],
  getApiOrigin?: () => string,
  jobStore?: JobStore,
  getWebAppOrigin?: () => string,
  worktreeProvider?: WorktreeProvider,
  loopTokenStore?: LoopTokenStore,
): Promise<void> {
  const wt = worktreeProvider ?? defaultWorktreeProvider;
  // Derive the callback URL from the gateway's trusted configuration.
  // body.apiBaseUrl is ignored -- the caller does not control where
  // loop events and artifact uploads are sent.
  const apiBaseUrl = getApiOrigin?.();
  if (!apiBaseUrl) {
    json(context, 503, { error: "API origin not configured" });
    return;
  }
  const webAppOrigin = getWebAppOrigin?.() ?? "";

  const rawBody = parseJsonBody(context);
  if (!rawBody) {
    json(context, 400, { error: "Invalid JSON body" });
    return;
  }

  const body = rawBody as unknown as LoopRequestBody;
  const expectedMcpUrl =
    typeof rawBody.expectedMcpUrl === "string"
      ? rawBody.expectedMcpUrl
      : undefined;

  // Extract tracing headers forwarded by the cloud command executor.
  // Use typeof guards because IncomingMessage headers values are string | string[] | undefined.
  const commandId =
    typeof context.request?.headers?.["x-desktop-command-id"] === "string"
      ? context.request.headers["x-desktop-command-id"]
      : undefined;
  const operationId =
    typeof context.request?.headers?.["x-desktop-operation-id"] === "string"
      ? context.request.headers["x-desktop-operation-id"]
      : undefined;

  const repoRequirement =
    REPO_REQUIREMENT_BY_COMMAND[body.command] ?? "NOT_REQUIRED";

  if (!body.loopId || !body.command || !body.closedLoopAuthToken) {
    json(context, 400, {
      error: "Missing required fields: loopId, command, closedLoopAuthToken",
    });
    return;
  }

  if (!VALID_COMMANDS.has(body.command)) {
    json(context, 400, { error: `Invalid command: ${body.command}` });
    return;
  }

  if (
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
      body.loopId,
    )
  ) {
    json(context, 400, { error: "loopId must be a valid UUID" });
    return;
  }

  if (!Array.isArray(body.artifacts)) {
    json(context, 400, { error: "artifacts must be an array" });
    return;
  }

  // Shared input validation (prompt/artifacts requirements per command)
  const hasPrompt =
    typeof body.prompt === "string" && body.prompt.trim().length > 0;
  const hasArtifacts = body.artifacts.length > 0;
  const inputError = validateCommandInputs(
    body.command,
    hasPrompt,
    hasArtifacts,
  );
  if (inputError) {
    json(context, 400, { error: inputError });
    return;
  }

  if (body.command === "EVALUATE_PLAN") {
    const hasPrdArtifact = body.artifacts.some(
      (a) =>
        a.type === LoopArtifactType.Prd || a.type === LoopArtifactType.Feature,
    );
    const hasPlanArtifact = body.artifacts.some((a) =>
      PLAN_ARTIFACT_TYPES.includes(a.type),
    );
    if ((!hasPrdArtifact && !body.prompt) || !hasPlanArtifact) {
      json(context, 400, {
        error:
          "EVALUATE_PLAN requires a PRD artifact (or prompt) and an implementation plan artifact",
      });
      return;
    }
    if (!body.localRepoPath && !body.repo?.fullName) {
      json(context, 400, {
        error:
          "EVALUATE_PLAN requires a repository (repo.fullName or localRepoPath)",
      });
      return;
    }
  }

  if (body.command === "EVALUATE_CODE") {
    const hasPlanArtifact = body.artifacts.some((a) =>
      PLAN_ARTIFACT_TYPES.includes(a.type),
    );
    if (!hasPlanArtifact) {
      json(context, 400, {
        error: "EVALUATE_CODE requires an implementation plan artifact",
      });
      return;
    }
    if (!body.localRepoPath && !body.repo?.fullName) {
      json(context, 400, {
        error:
          "EVALUATE_CODE requires a repository (repo.fullName or localRepoPath)",
      });
      return;
    }
  }

  if (runningLoops.has(body.loopId)) {
    json(context, 409, { error: "Loop is already running on this machine" });
    return;
  }

  // Claim the loopId immediately to prevent concurrent requests from racing
  // past the has() check. Replaced with real entry after spawn succeeds.
  runningLoops.set(body.loopId, {
    pid: -1,
    child: null as unknown as ReturnType<typeof spawn>,
    stage: "running",
  });
  const requestSource =
    context.request?.headers?.["x-desktop-source"] === "cloud-socket"
      ? "relay"
      : "local";
  loopLog(
    body.loopId,
    `Received ${body.command} request, repo=${body.repo?.fullName ?? "none"}, stableId=${pickStableId(body)}, parentSessionId=${body.parentSessionId ?? "none"}`,
  );
  gatewayLog.info(
    "loop-harness",
    `${body.command} request via ${requestSource}, loopId=${body.loopId}, repo=${body.repo?.fullName ?? "none"}`,
  );

  let spawnedSuccessfully = false;
  let expandedRepoPath: string | null = null;
  const additionalWorktreeDirs: { dir: string; repoPath: string }[] = [];
  try {
    const allowedDirs = getAllowedDirectories();

    if (repoRequirement !== "NOT_REQUIRED" && body.localRepoPath) {
      // localRepoPath takes precedence over repo.fullName lookup when present
      try {
        const repoResult = tryAssertRepoAllowed(
          body.localRepoPath,
          allowedDirs,
        );
        if ("error" in repoResult) {
          if (repoRequirement === "REQUIRED") {
            await postLoopEventBounded(
              apiBaseUrl,
              body.loopId,
              body.closedLoopAuthToken,
              {
                type: LoopEventType.Error,
                code: LoopErrorCode.RepoNotAllowed,
                message: "Repository path not allowed by sandbox policy",
              },
            );
            // runningLoops.delete handled by finally block
            json(context, repoResult.status, { error: repoResult.error });
            return;
          }
          loopLog(
            body.loopId,
            `Ignoring localRepoPath for ${body.command}: ${repoResult.error}`,
          );
        } else {
          expandedRepoPath = repoResult.path;
          loopLog(body.loopId, `Using localRepoPath: ${expandedRepoPath}`);
        }
      } catch (repoPathError) {
        if (repoRequirement === "REQUIRED") {
          throw repoPathError;
        }
        loopLog(
          body.loopId,
          `Ignoring localRepoPath for ${body.command} after resolution error: ${repoPathError instanceof Error ? repoPathError.message : String(repoPathError)}`,
        );
      }
    } else if (repoRequirement !== "NOT_REQUIRED" && body.repo?.fullName) {
      expandedRepoPath = findLocalRepo(body.repo.fullName, allowedDirs);
      if (expandedRepoPath) {
        try {
          assertPathAllowed(expandedRepoPath, allowedDirs);
        } catch (err) {
          if (err instanceof DirectoryNotAllowedError) {
            if (repoRequirement === "REQUIRED") {
              await postLoopEventBounded(
                apiBaseUrl,
                body.loopId,
                body.closedLoopAuthToken,
                {
                  type: LoopEventType.Error,
                  code: LoopErrorCode.RepoNotAllowed,
                  message: "Repository path not allowed by sandbox policy",
                },
              );
              // runningLoops.delete handled by finally block
              json(context, 403, { error: "Repository path not allowed" });
              return;
            }
            loopLog(
              body.loopId,
              `Ignoring repo.fullName for ${body.command}: repository path not allowed (${expandedRepoPath})`,
            );
            expandedRepoPath = null;
          } else {
            throw err;
          }
        }
      } else {
        if (repoRequirement === "REQUIRED") {
          await postLoopEventBounded(
            apiBaseUrl,
            body.loopId,
            body.closedLoopAuthToken,
            {
              type: LoopEventType.Error,
              code: LoopErrorCode.RepoNotFound,
              message: `Repository not found locally: ${body.repo.fullName}`,
            },
          );
          // runningLoops.delete handled by finally block (spawnedSuccessfully remains false)
          json(context, 404, {
            error: `Repository not found locally: ${body.repo.fullName}`,
          });
          return;
        }
        loopLog(
          body.loopId,
          `Ignoring repo.fullName for ${body.command}: not found locally (${body.repo.fullName})`,
        );
      }
    }

    let resolvedAdditionalRepos: ResolvedAdditionalRepo[] = [];
    if (body.command === "PLAN" && body.additionalRepos && body.additionalRepos.length > 0) {
      try {
        resolvedAdditionalRepos = await resolveAdditionalRepos(
          body.additionalRepos,
          allowedDirs,
          wt,
        );
      } catch (err) {
        if (err instanceof AdditionalRepoError) {
          await postLoopEventBounded(
            apiBaseUrl,
            body.loopId,
            body.closedLoopAuthToken,
            {
              type: LoopEventType.Error,
              code: err.code,
              message: err.message,
            },
          );
          gatewayLog.error(
            "loop-harness",
            `additionalRepo validation failed for loopId=${body.loopId}: ${err.repoRef} — ${err.message}`,
          );
          json(context, 400, { error: err.message });
          return;
        }
        throw err;
      }
    }

    let worktreeDir: string | null = null;
    let claudeWorkDir: string;
    let usedTempDir = false;

    if (body.command === "DECOMPOSE") {
      // DECOMPOSE uses a single temp dir for everything: context pack, logs, and output.
      // No repo/worktree needed — artifacts go to .closedloop-ai/context/artifacts/
      // so Claude's prompt can reference them by relative path.
      usedTempDir = true;
      const tmpDir = path.join(
        os.tmpdir(),
        `symphony-decompose-${body.loopId.slice(0, 8)}`,
      );
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.mkdir(tmpDir, { recursive: true });
      claudeWorkDir = tmpDir;
      try {
        await writeArtifactsForGeneratePrd(
          tmpDir,
          body.artifacts,
          body.prompt ?? "Decompose the PRD into features.",
          body.repo,
        );
      } catch (artifactErr) {
        await fs.rm(tmpDir, { recursive: true, force: true });
        await postLoopEvent(apiBaseUrl, body.loopId, body.closedLoopAuthToken, {
          type: LoopEventType.Error,
          code: LoopErrorCode.ArtifactWriteFailed,
          message:
            artifactErr instanceof Error
              ? artifactErr.message
              : String(artifactErr),
        });
        json(context, 500, { error: "Failed to write artifacts to workdir" });
        return;
      }
    } else if (
      body.command === "EVALUATE_PRD" ||
      body.command === "EVALUATE_PLAN" ||
      body.command === "EVALUATE_CODE"
    ) {
      // EVALUATE_PRD, EVALUATE_PLAN, and EVALUATE_CODE: use temp dir, no worktree needed.
      // Temp dir is intentionally exempt from assertPathAllowed.
      usedTempDir = true;
      const label = body.command.toLowerCase().replace(/_/g, "-");
      const tmpDir = path.join(
        os.tmpdir(),
        `symphony-${label}-${body.loopId.slice(0, 8)}`,
      );
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.mkdir(tmpDir, { recursive: true });
      claudeWorkDir = tmpDir;
      try {
        if (body.command === "EVALUATE_PRD") {
          await writePrdArtifact(claudeWorkDir, body.artifacts, body.prompt);
        } else if (body.command === "EVALUATE_PLAN") {
          await writePlanArtifact(claudeWorkDir, body.artifacts, body.prompt);
        } else if (body.command === "EVALUATE_CODE") {
          await writeCodeArtifact(claudeWorkDir, body.artifacts);
        }
      } catch (artifactErr) {
        await fs.rm(claudeWorkDir, { recursive: true, force: true });
        await postLoopEvent(apiBaseUrl, body.loopId, body.closedLoopAuthToken, {
          type: LoopEventType.Error,
          code: LoopErrorCode.ArtifactWriteFailed,
          message:
            artifactErr instanceof Error
              ? artifactErr.message
              : String(artifactErr),
        });
        json(context, 500, { error: "Failed to write artifacts to workdir" });
        return;
      }
    } else if (repoRequirement === "REQUIRED" && !expandedRepoPath) {
      json(context, 400, {
        error:
          "Repository required for PLAN, EXECUTE, REQUEST_CHANGES, and GENERATE_PRD commands",
      });
      return;
    } else if (
      body.command === "PLAN" ||
      body.command === "EXECUTE" ||
      body.command === "REQUEST_CHANGES"
    ) {
      // expandedRepoPath is guaranteed non-null here: the repoRequirement === "REQUIRED"
      // guard above already returned 400 when it was missing.
      const repoPath = expandedRepoPath!;

      // Worktree keyed by artifact slug (e.g., symphony/PLAN-5).
      // PLAN always creates fresh; EXECUTE/REQUEST_CHANGES reuse.
      // Sanitize slug the same way we sanitize loopId to prevent path traversal.
      const sanitizedSlug = body.artifactSlug
        ? slugifyLoopId(body.artifactSlug)
        : null;
      const worktreeKey = sanitizedSlug ?? pickStableId(body);
      const branchName = sanitizedSlug
        ? `symphony/${sanitizedSlug}`
        : `symphony/loop-${pickStableId(body)}`;

      worktreeDir = resolveLoopWorktreeDir(repoPath, worktreeKey);

      if (body.command === "PLAN") {
        // PLAN always starts fresh — remove stale worktree if it exists.
        // PLAN has requiresParent: false, so it must not inherit prior state.
        const staleWorktree = wt.findWorktreeForBranch(repoPath, branchName);
        if (staleWorktree) {
          loopLog(
            body.loopId,
            `Removing stale worktree for fresh PLAN: ${staleWorktree}`,
          );
          await wt.removeWorktree(staleWorktree, repoPath, body.loopId);
        }
        await wt.ensureWorktree(
          repoPath,
          worktreeDir,
          branchName,
          body.repo?.branch ?? "main",
          body.loopId,
        );
        loopLog(
          body.loopId,
          `Created fresh worktree for PLAN: ${worktreeDir} (branch: ${branchName})`,
        );

        // Create additional repo worktrees for PLAN command.
        // Mirror the primary-repo pattern: create a fresh scratch branch
        // based on the user-specified branch so loop work does not mutate it.
        for (const addRepo of resolvedAdditionalRepos) {
          const addRepoSlug = slugifyLoopId(addRepo.branch);
          const addRepoKey = `${worktreeKey}-${addRepoSlug}-${additionalRepoDisambiguator(addRepo.repoPath)}`;
          const addWorktreeDir = resolveLoopWorktreeDir(
            addRepo.repoPath,
            addRepoKey,
          );
          const addBranchName = `symphony/${addRepoKey}`;
          try {
            const staleAddWorktree = wt.findWorktreeForBranch(addRepo.repoPath, addBranchName);
            if (staleAddWorktree) {
              loopLog(
                body.loopId,
                `Removing stale additional-repo worktree for fresh PLAN: ${staleAddWorktree}`,
              );
              await wt.removeWorktree(staleAddWorktree, addRepo.repoPath, body.loopId);
            }
            await wt.ensureWorktree(addRepo.repoPath, addWorktreeDir, addBranchName, addRepo.branch, body.loopId);
          } catch (checkoutErr) {
            const msg = checkoutErr instanceof Error ? checkoutErr.message : String(checkoutErr);
            loopError(body.loopId, `ensureWorktree failed for additional repo ${addRepo.repoPath}:`, checkoutErr);
            await wt.removeWorktree(addWorktreeDir, addRepo.repoPath, body.loopId).catch(() => {});
            await wt.removeWorktree(worktreeDir, repoPath, body.loopId).catch(() => {});
            await postLoopEventBounded(
              apiBaseUrl,
              body.loopId,
              body.closedLoopAuthToken,
              {
                type: LoopEventType.Error,
                code: LoopErrorCode.BranchCreateFailed,
                message: `Failed to checkout additional repo worktree: ${msg}`,
              },
            );
            json(context, 500, { error: `Failed to checkout additional repo worktree: ${msg}` });
            return;
          }
          try {
            assertPathAllowed(addWorktreeDir, allowedDirs);
          } catch (e) {
            if (e instanceof DirectoryNotAllowedError) {
              await wt.removeWorktree(addWorktreeDir, addRepo.repoPath, body.loopId).catch(() => {});
              await wt.removeWorktree(worktreeDir, repoPath, body.loopId).catch(() => {});
              await postLoopEventBounded(
                apiBaseUrl,
                body.loopId,
                body.closedLoopAuthToken,
                {
                  type: LoopEventType.Error,
                  code: LoopErrorCode.RepoNotAllowed,
                  message: `Additional repo worktree path not allowed: ${addWorktreeDir}`,
                },
              );
              json(context, 403, { error: `Additional repo worktree path not allowed: ${addWorktreeDir}` });
              return;
            }
            throw e;
          }
          additionalWorktreeDirs.push({ dir: addWorktreeDir, repoPath: addRepo.repoPath });
          loopLog(body.loopId, `Created additional repo worktree: ${addWorktreeDir} (branch: ${addBranchName} based on ${addRepo.branch})`);
        }
      } else {
        // EXECUTE/REQUEST_CHANGES: reuse existing worktree.
        // Try artifact slug first, then parentLoopId fallback, then create new.
        const existingWorktree = wt.findWorktreeForBranch(repoPath, branchName);
        if (existingWorktree) {
          worktreeDir = existingWorktree;
          loopLog(
            body.loopId,
            `Reusing worktree via artifact slug: ${worktreeDir} (branch: ${branchName})`,
          );
        } else if (body.parentLoopId) {
          // Fallback: try parent's loopId-based branch (pre-slug deployments or missing slug)
          const parentBranch = `symphony/loop-${slugifyLoopId(body.parentLoopId)}`;
          const parentWorktree = wt.findWorktreeForBranch(
            repoPath,
            parentBranch,
          );
          if (parentWorktree) {
            worktreeDir = parentWorktree;
            loopLog(
              body.loopId,
              `Reusing worktree via parentLoopId fallback: ${worktreeDir} (branch: ${parentBranch})`,
            );
          }
        }
        if (!worktreeDir || !existsSync(worktreeDir)) {
          // No existing worktree found — create new
          worktreeDir = resolveLoopWorktreeDir(repoPath, worktreeKey);
          await wt.ensureWorktree(
            repoPath,
            worktreeDir,
            branchName,
            body.repo?.branch ?? "main",
            body.loopId,
          );
          loopLog(
            body.loopId,
            `Created new worktree: ${worktreeDir} (branch: ${branchName})`,
          );
        }
      }

      try {
        assertPathAllowed(worktreeDir, allowedDirs);
      } catch (e) {
        if (e instanceof DirectoryNotAllowedError) {
          json(context, 403, {
            error: `Worktree path not allowed: ${worktreeDir}`,
          });
          return;
        }
        throw e;
      }
      claudeWorkDir = path.join(worktreeDir, ".closedloop-ai", "work");
      await fs.mkdir(claudeWorkDir, { recursive: true });

      if (body.command === "PLAN") {
        await writeArtifactsForPlan(
          claudeWorkDir,
          body.artifacts,
          body.prompt,
          body.userContext,
          body.attachments,
        );
      } else if (body.command === "EXECUTE") {
        await writeArtifactsForExecuteOrAmend(
          claudeWorkDir,
          body.artifacts,
          undefined,
          body.attachments,
        );
      } else {
        // REQUEST_CHANGES
        await writeArtifactsForExecuteOrAmend(
          claudeWorkDir,
          body.artifacts,
          body.prompt,
          body.attachments,
        );
      }
    } else if (body.command === "GENERATE_PRD") {
      // expandedRepoPath is guaranteed non-null here: the repoRequirement === "REQUIRED"
      // guard above already returned 400 when it was missing.
      const repoPath = expandedRepoPath!;

      // Use a dedicated branch namespace to avoid collisions with PLAN/EXECUTE worktrees.
      // GENERATE_PRD always starts fresh -- it must not inherit a prior PLAN worktree.
      const sanitizedSlug = body.artifactSlug
        ? slugifyLoopId(body.artifactSlug)
        : null;
      const worktreeKey = sanitizedSlug ?? pickStableId(body);
      const branchName = sanitizedSlug
        ? `symphony/generate-prd-${sanitizedSlug}`
        : `symphony/generate-prd-${pickStableId(body)}`;

      worktreeDir = resolveLoopWorktreeDir(
        repoPath,
        `generate-prd-${worktreeKey}`,
      );

      // Always start fresh: remove any stale worktree for this branch before creation.
      const staleWorktree = wt.findWorktreeForBranch(repoPath, branchName);
      if (staleWorktree) {
        loopLog(
          body.loopId,
          `Removing stale worktree for fresh GENERATE_PRD: ${staleWorktree}`,
        );
        await wt.removeWorktree(staleWorktree, repoPath, body.loopId);
      }

      await wt.ensureWorktree(
        repoPath,
        worktreeDir,
        branchName,
        body.repo?.branch ?? "main",
        body.loopId,
      );
      loopLog(
        body.loopId,
        `Created worktree for GENERATE_PRD: ${worktreeDir} (branch: ${branchName})`,
      );

      try {
        assertPathAllowed(worktreeDir, allowedDirs);
      } catch (e) {
        if (e instanceof DirectoryNotAllowedError) {
          await wt.removeWorktree(worktreeDir, repoPath, body.loopId);
          json(context, 403, {
            error: `Worktree path not allowed: ${worktreeDir}`,
          });
          return;
        }
        throw e;
      }

      // claudeWorkDir is a separate operational dir inside the worktree (same pattern as PLAN/EXECUTE).
      // Spawn uses cwd: worktreeDir so Claude writes prd.md to the repo root.
      // Logs, PID, and prompt file go to claudeWorkDir, not the repo root.
      claudeWorkDir = path.join(worktreeDir, ".closedloop-ai", "work");
      await fs.mkdir(claudeWorkDir, { recursive: true });
      await writeArtifactsForGeneratePrd(
        worktreeDir,
        body.artifacts,
        body.prompt!,
        body.repo,
      );
    } else {
      json(context, 400, { error: `Unknown command: ${body.command}` });
      return;
    }

    /** Clean up temporary resources on early-return error paths. */
    const tempRootDir = usedTempDir ? (worktreeDir ?? claudeWorkDir) : null;
    const cleanupOnError = async (): Promise<void> => {
      if (tempRootDir) {
        await fs
          .rm(tempRootDir, { recursive: true, force: true })
          .catch(() => {});
      }
      if (body.command === "GENERATE_PRD" && worktreeDir && expandedRepoPath) {
        await wt.removeWorktree(worktreeDir, expandedRepoPath, body.loopId);
      }
      await cleanupAdditionalWorktrees(additionalWorktreeDirs, body.loopId, wt);
    };

    // Pre-flight: verify required binary exists BEFORE posting 'started' event.
    // PLAN and EXECUTE use run-loop.sh; REQUEST_CHANGES and DECOMPOSE use claude CLI directly.
    const usesRunLoop = body.command === "PLAN" || body.command === "EXECUTE";
    const usesClaude =
      body.command === "REQUEST_CHANGES" ||
      body.command === "DECOMPOSE" ||
      body.command === "EVALUATE_PRD" ||
      body.command === "GENERATE_PRD" ||
      body.command === "EVALUATE_PLAN" ||
      body.command === "EVALUATE_CODE";
    let scriptPath: string | null = null;

    if (usesClaude) {
      try {
        const whichEnv = { ...process.env, PATH: await getShellPath() };
        execSync("which claude", {
          stdio: "pipe",
          timeout: 5000,
          env: whichEnv,
        });
      } catch {
        await postLoopEvent(apiBaseUrl, body.loopId, body.closedLoopAuthToken, {
          type: LoopEventType.Error,
          code: LoopErrorCode.BinaryNotFound,
          message: "claude CLI not found in PATH",
        });
        Observability.preflightBinaryNotFound(
          commandId,
          operationId,
          body.loopId,
        );
        await cleanupOnError();
        json(context, 500, { error: "claude CLI not found in PATH" });
        return;
      }
    } else if (usesRunLoop) {
      scriptPath = findPluginScript("code", "run-loop.sh");
      if (!scriptPath) {
        await postLoopEvent(apiBaseUrl, body.loopId, body.closedLoopAuthToken, {
          type: LoopEventType.Error,
          code: LoopErrorCode.ScriptNotFound,
          message: "run-loop.sh not found in plugin cache",
        });
        Observability.preflightScriptNotFound(
          commandId,
          operationId,
          body.loopId,
        );
        json(context, 500, { error: "run-loop.sh not found in plugin cache" });
        return;
      }
    }

    try {
      if (loopTokenStore) {
        loopTokenStore.setLoopToken(body.loopId, body.closedLoopAuthToken);
      }
    } catch (err) {
      loopLog(
        body.loopId,
        `Failed to persist loop auth token: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Post "started" event — only after confirming we can proceed
    loopLog(body.loopId, "Posting started event...");
    await postLoopEvent(apiBaseUrl, body.loopId, body.closedLoopAuthToken, {
      type: LoopEventType.Started,
    });

    // Spawn process
    const logFile = path.join(claudeWorkDir, "symphony-loop.log");
    let logFd: number;
    try {
      logFd = openSync(logFile, "a");
    } catch (logErr) {
      const msg = logErr instanceof Error ? logErr.message : String(logErr);
      await postLoopEvent(apiBaseUrl, body.loopId, body.closedLoopAuthToken, {
        type: LoopEventType.Error,
        code: LoopErrorCode.SpawnFailed,
        message: `Cannot open log file: ${msg}`,
      });
      Observability.preflightSpawnFailed(
        commandId,
        operationId,
        body.loopId,
        `Cannot open log file: ${msg}`,
      );
      await cleanupOnError();
      json(context, 500, { error: `Cannot open log file: ${msg}` });
      return;
    }
    let child: ReturnType<typeof spawn>;

    try {
      const spawnEnv: Record<string, string> = await getShellEnv({
        CLOSEDLOOP_WORKDIR: claudeWorkDir,
      });

      // Shared claude CLI args for commands that run claude directly.
      // REQUEST_CHANGES omits "-" (stdin) because it passes the prompt as a CLI argument.
      const allowedTools = await withMcpTools(
        "Bash,Glob,Grep,Read,Write,Edit,Task,Skill,SlashCommand,TodoWrite",
        expectedMcpUrl,
      );
      const baseClaudeArgs: string[] = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--allowedTools",
        allowedTools,
        "--max-turns",
        "200",
      ];
      const stdinClaudeArgs = ["-p", "-", ...baseClaudeArgs.slice(1)];

      if (body.command === "DECOMPOSE") {
        // DECOMPOSE: prompt piped via stdin, cwd is the temp dir which contains
        // .closedloop-ai/context/artifacts/ so Claude can find them by relative path.
        const promptFile = path.join(claudeWorkDir, "decompose-prompt.txt");
        await fs.writeFile(
          promptFile,
          body.prompt ?? "Decompose the PRD into features.",
        );

        const pipeline = buildClaudePipeline(
          stdinClaudeArgs,
          claudeWorkDir,
          promptFile,
        );
        child = spawn(pipeline.cmd, pipeline.args, {
          cwd: claudeWorkDir,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: spawnEnv,
        });
        child.unref();
      } else if (body.command === "EVALUATE_PRD") {
        // REPO_PATH only when a target repo is linked (expandedRepoPath).
        let evaluatePrdPrompt = `Activate judges:run-judges skill --artifact-type prd --workdir ${claudeWorkDir}.\n`;
        if (expandedRepoPath) {
          evaluatePrdPrompt += `REPO_PATH=${expandedRepoPath} (search here for relevant code).\n`;
        }
        const promptFile = path.join(claudeWorkDir, "evaluate-prd-prompt.txt");
        await fs.writeFile(promptFile, evaluatePrdPrompt);

        const pipeline = buildClaudePipeline(
          stdinClaudeArgs,
          claudeWorkDir,
          promptFile,
        );
        child = spawn(pipeline.cmd, pipeline.args, {
          cwd: claudeWorkDir,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: spawnEnv,
        });
        child.unref();
      } else if (
        body.command === "EVALUATE_PLAN" ||
        body.command === "EVALUATE_CODE"
      ) {
        // EVALUATE_PLAN and EVALUATE_CODE share identical spawn logic,
        // differing only in the artifact type passed to run-judges.
        // Unlike EVALUATE_PRD (where REPO_PATH is optional—only added when a repo is linked),
        // plan and code judges need the implementation tree, so the request must resolve to
        // a local repo and expandedRepoPath is always set on this path.
        const artifactType = body.command === "EVALUATE_PLAN" ? "plan" : "code";
        const label = `evaluate-${artifactType}`;
        const prompt =
          `Activate judges:run-judges skill --artifact-type ${artifactType} --workdir ${claudeWorkDir}.\n` +
          `REPO_PATH=${expandedRepoPath}\n`;
        const promptFile = path.join(claudeWorkDir, `${label}-prompt.txt`);
        await fs.writeFile(promptFile, prompt);

        const pipeline = buildClaudePipeline(
          stdinClaudeArgs,
          claudeWorkDir,
          promptFile,
        );
        child = spawn(pipeline.cmd, pipeline.args, {
          cwd: claudeWorkDir,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: spawnEnv,
        });
        child.unref();
      } else if (body.command === "REQUEST_CHANGES") {
        // REQUEST_CHANGES: use claude directly with /code:amend-plan.
        // Must use -p (headless mode) so --allowedTools grants full permission
        // without prompting. Pipes through stream_formatter.py for readable logs.
        const claudeArgs = [...baseClaudeArgs];

        // Resume from parent session if available (matches harness --resume)
        if (body.parentSessionId) {
          claudeArgs.push("--resume", body.parentSessionId);
        }

        // Build /code:amend-plan invocation matching harness
        const promptFile = path.join(claudeWorkDir, "prompt.md");
        let amendPrompt =
          "Please amend the plan based on the requested changes.";
        if (existsSync(promptFile)) {
          amendPrompt = readFileSync(promptFile, "utf-8");
        }
        // Sanitize prompt matching harness's prepare-message step
        const sanitized = amendPrompt
          .replaceAll(/[\n\r]+/g, " ")
          .replaceAll(/\s{2,}/g, " ")
          .replaceAll(/"/g, '\\"');
        claudeArgs.push(
          `/code:amend-plan --workdir ${claudeWorkDir} --message "${sanitized}"`,
        );

        const pipeline = buildClaudePipeline(claudeArgs, claudeWorkDir);
        child = spawn(pipeline.cmd, pipeline.args, {
          cwd: worktreeDir!,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: spawnEnv,
        });
        child.unref();
      } else if (body.command === "GENERATE_PRD") {
        const promptFile = path.join(claudeWorkDir, "generate-prd-prompt.txt");
        await fs.writeFile(promptFile, body.prompt!);

        const pipeline = buildClaudePipeline(
          stdinClaudeArgs,
          claudeWorkDir,
          promptFile,
        );
        child = spawn(pipeline.cmd, pipeline.args, {
          cwd: worktreeDir!,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: spawnEnv,
        });
        child.unref();
      } else {
        // PLAN, EXECUTE: spawn run-loop.sh
        // Build args matching ECS harness-agent's buildRunLoopArgs():
        // 1. workdir (positional)
        // 2. --max-iterations (EXECUTE=150, PLAN=50)
        // 3. --prd (when prd.md exists)
        const scriptArgs = [claudeWorkDir];

        const maxIterations = body.command === "EXECUTE" ? "150" : "50";
        scriptArgs.push("--max-iterations", maxIterations);

        const prdPath = path.join(claudeWorkDir, LoopArtifactFile.Prd);
        if (existsSync(prdPath)) {
          scriptArgs.push("--prd", prdPath);
        }

        if (body.command === "PLAN") {
          for (const addEntry of additionalWorktreeDirs) {
            scriptArgs.push("--add-dir", addEntry.dir);
          }
        }

        child = spawn(scriptPath!, scriptArgs, {
          cwd: worktreeDir!,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: spawnEnv,
        });
        child.unref();
      }
    } catch (spawnErr) {
      closeSync(logFd);
      const msg =
        spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
      await postLoopEvent(apiBaseUrl, body.loopId, body.closedLoopAuthToken, {
        type: LoopEventType.Error,
        code: LoopErrorCode.SpawnFailed,
        message: msg,
      });
      Observability.preflightSpawnFailed(
        commandId,
        operationId,
        body.loopId,
        msg,
      );
      await cleanupOnError();
      json(context, 500, { error: `Failed to spawn process: ${msg}` });
      return;
    }
    closeSync(logFd);

    const tailerJsonlPath = path.join(claudeWorkDir, "claude-output.jsonl");
    const jsonlPreSpawnOffset = existsSync(tailerJsonlPath)
      ? statSync(tailerJsonlPath).size
      : 0;

    // Guard against double-firing: both 'error' and 'exit' can emit.
    let completionHandled = false;
    let stopTailer: { stop: () => void; flush: () => Promise<void> } = {
      stop: () => {},
      flush: () => Promise.resolve(),
    };
    const onceComplete = async (code: number): Promise<void> => {
      if (completionHandled) return;
      completionHandled = true;
      loopLog(body.loopId, `onceComplete fired, code=${code}`);
      try {
        await stopTailer.flush();
      } catch (err) {
        loopError(body.loopId, "Tailer flush error:", err);
      }
      handleProcessCompletion(
        code,
        body,
        apiBaseUrl,
        worktreeDir,
        claudeWorkDir,
        usedTempDir,
        expandedRepoPath,
        getAllowedDirectories,
        expectedMcpUrl,
        jobStore,
        webAppOrigin,
        commandId,
        operationId,
        wt,
        loopTokenStore,
        additionalWorktreeDirs,
      ).catch((err) => {
        loopError(body.loopId, "Completion handler error:", err);
        gatewayLog.error(
          "loop-harness",
          `Completion handler error for loopId=${body.loopId}: ${err instanceof Error ? err.message : err}`,
        );
      });
    };

    // Prevent unhandled 'error' events (e.g. ENOENT if binary vanishes
    // between pre-flight check and spawn) from crashing Electron.
    child.on("error", (err) => {
      loopError(body.loopId, "Spawn error:", err.message);
      void onceComplete(1);
    });

    // Use 'exit' instead of 'close' — with detached processes using
    // inherited file descriptors (not pipes), 'close' may never fire
    // because there are no Node.js streams to track closure of.
    child.on("exit", (code) => {
      loopLog(body.loopId, `Process exit event, code=${code}`);
      void onceComplete(code ?? 1);
    });

    const pid = child.pid ?? null;

    if (!pid) {
      // error handler above will fire asynchronously — respond immediately
      json(context, 500, { error: "Failed to spawn process" });
      return;
    }

    // Replace sentinel with real entry — storing `child` prevents GC of the
    // ChildProcess handle which would silently drop the exit listener.
    runningLoops.set(body.loopId, { pid, child, stage: "running" });
    stopTailer = startOutputTailer(
      tailerJsonlPath,
      apiBaseUrl,
      body.loopId,
      body.closedLoopAuthToken,
      jsonlPreSpawnOffset,
      jobStore
        ? (offset) => {
            // Persist replay-safe JSONL offset (framed + POST ok when output is emitted).
            const job = jobStore.getByLoopId(body.loopId);
            if (job) {
              jobStore.upsert({ ...job, lastObservedJsonlOffset: offset });
            }
          }
        : undefined,
    );
    spawnedSuccessfully = true;
    loopLog(body.loopId, `Spawned pid=${pid}, worktree=${worktreeDir}`);
    gatewayLog.debug(
      "loop-harness",
      `Spawned ${body.command} pid=${pid}, loopId=${body.loopId}, worktree=${worktreeDir}` +
        (additionalWorktreeDirs.length > 0
          ? `, additionalDirs=${additionalWorktreeDirs.map((e) => e.dir).join(",")}`
          : ""),
    );

    // Bind runtime details to an existing LocalJob or create a new one for this loop
    if (jobStore) {
      const existing = jobStore.getByLoopId(body.loopId);
      const now = new Date().toISOString();
      const logPath = path.join(claudeWorkDir, "symphony-loop.log");
      const jsonlPath = path.join(claudeWorkDir, "claude-output.jsonl");
      const statePath = path.join(claudeWorkDir, "state.json");
      const command = body.command as LocalJobCommand;
      jobStore.upsert({
        id: body.loopId,
        kind: "SYMPHONY_LOOP",
        loopId: body.loopId,
        command,
        ...existing,
        ...(commandId ? { commandId } : {}),
        ...(operationId ? { operationId } : {}),
        worktreeDir: worktreeDir ?? undefined,
        claudeWorkDir,
        logPath,
        jsonlPath,
        statePath,
        pid,
        status: "RUNNING",
        updatedAt: now,
        startedAt: existing?.startedAt ?? now,
        apiBaseUrl,
        lastObservedJsonlOffset:
          existing?.lastObservedJsonlOffset ?? jsonlPreSpawnOffset,
      });
    }

    Observability.jobStarted(commandId, operationId, body.loopId, pid);

    // Write PID file (safe to await now — close handler is already registered)
    await fs.writeFile(path.join(claudeWorkDir, "process.pid"), String(pid));

    json(context, 200, {
      success: true,
      loopId: body.loopId,
      pid,
      worktreePath: worktreeDir,
    });
  } finally {
    // Clean up sentinel and persisted token if we never reached a successful spawn
    if (!spawnedSuccessfully) {
      runningLoops.delete(body.loopId);
      loopTokenStore?.deleteLoopToken(body.loopId);
      // Best-effort cleanup of any additional repo worktrees created before spawn failed
      void cleanupAdditionalWorktrees(additionalWorktreeDirs, body.loopId, wt, "finally: cleanup additional worktree failed:");
    }
  }
}

// ---------------------------------------------------------------------------
// Kill handler
// ---------------------------------------------------------------------------

async function handleLoopKill(
  context: OperationRequestContext,
  jobStore?: JobStore,
): Promise<void> {
  const rawBody = parseJsonBody(context);
  if (!rawBody) {
    json(context, 400, { error: "Invalid JSON body" });
    return;
  }

  const loopId = typeof rawBody.loopId === "string" ? rawBody.loopId : null;
  if (!loopId) {
    json(context, 400, { error: "loopId is required" });
    return;
  }

  const entry = runningLoops.get(loopId);
  if (entry === undefined) {
    // Post-restart fallback: check JobStore for a live PID
    if (jobStore) {
      const job = jobStore.getByLoopId(loopId);
      if (job?.pid != null) {
        let processWasAlive = false;
        try {
          process.kill(job.pid, 0); // alive?
          processWasAlive = true;
          process.kill(-job.pid, "SIGTERM");
          await new Promise((resolve) => setTimeout(resolve, 3000));
          try {
            process.kill(job.pid, 0);
            process.kill(-job.pid, "SIGKILL");
          } catch {
            /* gone */
          }
        } catch {
          /* already dead */
        }
        jobStore.upsert({
          ...job,
          status: processWasAlive ? "CANCEL_PENDING" : "CANCELLED",
          updatedAt: new Date().toISOString(),
          ...(!processWasAlive
            ? { completedAt: new Date().toISOString() }
            : {}),
        });
        json(context, 200, {
          success: true,
          message: "Loop process terminated (restart fallback)",
        });
        return;
      }
    }
    json(context, 404, { error: "No running process found for this loop" });
    return;
  }
  if (entry.pid <= 0) {
    json(context, 409, { error: "Loop is still initializing, retry shortly" });
    return;
  }

  // Set CANCEL_PENDING before sending signals so handleProcessCompletion
  // sees the cancellation intent when the exit event fires.
  if (jobStore) {
    const existingJob = jobStore.getByLoopId(loopId);
    if (existingJob) {
      jobStore.upsert({
        ...existingJob,
        status: "CANCEL_PENDING",
        updatedAt: new Date().toISOString(),
      });
    }
  }

  try {
    process.kill(entry.pid, 0); // Check alive
    process.kill(-entry.pid, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    try {
      process.kill(entry.pid, 0);
      process.kill(-entry.pid, "SIGKILL");
    } catch {
      // Already gone
    }
  } catch {
    // Process already terminated
  }

  runningLoops.delete(loopId);
  json(context, 200, { success: true, message: "Loop process terminated" });
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerSymphonyLoopRoutes(
  dispatcher: OperationDispatcher,
  getAllowedDirectories: () => string[],
  getApiOrigin?: () => string,
  jobStore?: JobStore,
  getWebAppOrigin?: () => string,
  worktreeProvider?: WorktreeProvider,
  loopTokenStore?: LoopTokenStore,
): void {
  dispatcher.register(
    "POST",
    "/api/gateway/symphony/loop",
    async (context) => {
      await handleLoopRequest(
        context,
        getAllowedDirectories,
        getApiOrigin,
        jobStore,
        getWebAppOrigin,
        worktreeProvider,
        loopTokenStore,
      );
    },
  );

  dispatcher.register(
    "POST",
    "/api/gateway/symphony/loop/kill",
    async (context) => {
      await handleLoopKill(context, jobStore);
    },
  );
}
