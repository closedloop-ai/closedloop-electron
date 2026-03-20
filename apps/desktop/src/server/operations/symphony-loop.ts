import { execSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { JobStore, LocalJobCommand } from "../../main/job-store.js";
import type {
  OperationDispatcher,
  OperationRequestContext,
} from "../operation-dispatcher.js";
import { readJsonFileSync } from "../read-json-file-sync.js";
import { assertPathAllowed, DirectoryNotAllowedError } from "../security.js";
import { findPluginScript, findPluginVersions, getPluginCacheRoot } from "./plugin-cache.js";
import {
  readEvaluatePrdOutputs,
  writePrdArtifact,
} from "./symphony-prd-artifacts.js";
import {
  expandHome,
  resolveWorktreeParentDir,
  tryAssertRepoAllowed,
} from "./symphony-utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoopCommand =
  | "PLAN"
  | "EXECUTE"
  | "REQUEST_CHANGES"
  | "DECOMPOSE"
  | "EVALUATE_PRD"
  | "GENERATE_PRD";

const VALID_COMMANDS = new Set<LoopCommand>([
  "PLAN",
  "EXECUTE",
  "REQUEST_CHANGES",
  "DECOMPOSE",
  "EVALUATE_PRD",
  "GENERATE_PRD",
]);
type RepoRequirement = "REQUIRED" | "OPTIONAL" | "NOT_REQUIRED";
const REPO_REQUIREMENT_BY_COMMAND: Record<LoopCommand, RepoRequirement> = {
  PLAN: "REQUIRED",
  EXECUTE: "REQUIRED",
  REQUEST_CHANGES: "REQUIRED",
  EVALUATE_PRD: "OPTIONAL",
  GENERATE_PRD: "REQUIRED",
  DECOMPOSE: "NOT_REQUIRED",
};

interface LoopArtifact {
  id?: string;
  type: string;
  title?: string;
  content: string;
}

interface LoopRepo {
  fullName: string;
  branch: string;
}

interface LoopCommitter {
  name: string;
  email: string;
}

interface LoopRequestBody {
  loopId: string;
  command: LoopCommand;
  closedLoopAuthToken: string;
  /** @deprecated Ignored. The gateway uses its configured API origin instead. */
  apiBaseUrl?: string;
  artifacts: LoopArtifact[];
  repo?: LoopRepo;
  committer?: LoopCommitter;
  artifactSlug?: string;
  parentLoopId?: string;
  parentBranchName?: string;
  parentSessionId?: string;
  prompt?: string;
  /** Local filesystem checkout root. When present and sandbox-allowed, used as checkout root for worktree creation/reuse instead of repo.fullName lookup. */
  localRepoPath?: string;
}

/** Track running loop processes for cancellation and to prevent GC of ChildProcess. */
interface RunningLoop {
  pid: number;
  child: ReturnType<typeof spawn>;
}
const runningLoops = new Map<string, RunningLoop>();

function loopLog(loopId: string, ...args: unknown[]): void {
  const short = loopId.slice(0, 8);
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[symphony-loop][${ts}][${short}]`, ...args);
}

function loopError(loopId: string, ...args: unknown[]): void {
  const short = loopId.slice(0, 8);
  const ts = new Date().toISOString().slice(11, 23);
  console.error(`[symphony-loop][${ts}][${short}]`, ...args);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(
  context: OperationRequestContext,
  status: number,
  payload: unknown
): void {
  context.response.statusCode = status;
  context.response.setHeader("content-type", "application/json");
  context.response.end(JSON.stringify(payload));
}

function parseJsonBody(
  context: OperationRequestContext
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
    if (existsSync(p)) { return p; }
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
  stdinFile?: string
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
    return { cmd: "bash", args: ["-c", pipeline] };
  }

  // No formatter — run claude directly (raw stream-json to stdout)
  if (stdinFile) {
    return { cmd: "bash", args: ["-c", claudeCmd] };
  }
  return { cmd: "claude", args: claudeArgs };
}
/** Find the local repo path for a given fullName (e.g. "org/repo"). */
function findLocalRepo(
  fullName: string,
  allowedDirs: string[]
): string | null {
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
function resolveLoopWorktreeDir(
  expandedRepoPath: string,
  stableId: string
): string {
  const repoName = path.basename(expandedRepoPath);
  return path.join(
    resolveWorktreeParentDir(expandedRepoPath),
    `${repoName}-loop-${stableId}`
  );
}

/**
 * Slugify a loop ID for worktree/branch naming.
 * Matches ECS harness convention: lowercase, non-alnum to dashes, max 50 chars.
 */
function slugifyLoopId(loopId: string): string {
  return loopId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
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
  eventBody: Record<string, unknown>
): Promise<void> {
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
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-loop-event-nonce": crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      loopError(loopId, `Event POST failed: ${resp.status} ${resp.statusText}`, text);
    } else {
      loopLog(loopId, `Event POST success: ${resp.status}`);
    }
  } catch (err) {
    loopError(loopId, "Failed to post event:", err);
  }
}

async function uploadArtifacts(
  apiBaseUrl: string,
  loopId: string,
  token: string,
  body: Record<string, unknown>
): Promise<void> {
  const url = `${apiBaseUrl}/loops/${loopId}/upload-artifacts`;
  loopLog(loopId, "Uploading artifacts...", url);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      loopError(loopId, `Upload failed: ${resp.status} ${resp.statusText}`, text);
    } else {
      loopLog(loopId, `Upload success: ${resp.status}`);
    }
  } catch (err) {
    loopError(loopId, "Failed to upload artifacts:", err);
  }
}

// ---------------------------------------------------------------------------
// Worktree management
// ---------------------------------------------------------------------------

async function ensureWorktree(
  expandedRepoPath: string,
  worktreeDir: string,
  branchName: string,
  baseBranch: string
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
    }
  );
}

/** Find existing worktree for a branch name. */
function findWorktreeForBranch(
  expandedRepoPath: string,
  branchName: string
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

// findExistingLoopWorktree was removed — it greedy-matched ANY loop worktree
// from ANY prior loop, causing new PLAN loops to reuse stale worktrees.
// PLAN always creates a fresh worktree. EXECUTE/REQUEST_CHANGES reuse via
// findWorktreeForBranch(parentBranchName) which matches the specific parent.

/**
 * Remove a GENERATE_PRD worktree via git worktree remove, falling back to
 * fs.rm + git worktree prune. Used from both handleProcessCompletion and
 * early-return cleanup in handleLoopRequest.
 */
async function cleanupGeneratePrdWorktree(
  worktreeDir: string,
  expandedRepoPath: string,
  loopId?: string
): Promise<void> {
  try {
    execSync(`git worktree remove --force ${shellEscape(worktreeDir)}`, {
      cwd: expandedRepoPath,
      stdio: "pipe",
      timeout: 15_000,
    });
  } catch {
    if (loopId) {
      loopLog(loopId, `git worktree remove failed for GENERATE_PRD, falling back to fs.rm`);
    }
    await fs.rm(worktreeDir, { recursive: true, force: true });
    try {
      execSync("git worktree prune", { cwd: expandedRepoPath, stdio: "pipe", timeout: 10_000 });
    } catch {
      // Best-effort
    }
  }
}

// ---------------------------------------------------------------------------
// Per-command artifact writing
// ---------------------------------------------------------------------------

/**
 * Write PRD for PLAN command.
 * Matches ECS harness writePrdFile(): prompt first, then PRD artifact, then FEATURE.
 */
async function writeArtifactsForPlan(
  claudeWorkDir: string,
  artifacts: LoopArtifact[],
  prompt?: string
): Promise<void> {
  // Priority: explicit prompt > PRD artifact > FEATURE artifact (matches harness)
  let prdContent = prompt ?? null;

  if (!prdContent) {
    const prdArtifact = artifacts.find((a) => a.type === "PRD" || a.type === "prd");
    const featureArtifact = prdArtifact
      ? null
      : artifacts.find((a) => a.type === "FEATURE" || a.type === "artifact");
    const source = prdArtifact ?? featureArtifact;
    if (source?.content) {
      prdContent = source.content;
    }
  }

  if (prdContent) {
    await fs.writeFile(path.join(claudeWorkDir, "prd.md"), prdContent);
  }
}

async function writeArtifactsForExecuteOrAmend(
  claudeWorkDir: string,
  artifacts: LoopArtifact[],
  prompt?: string
): Promise<void> {
  for (const artifact of artifacts) {
    if (artifact.type === "IMPLEMENTATION_PLAN" || artifact.type === "plan") {
      // Sync plan content like ECS harness's syncPlanFromContextPack():
      // If plan.json already exists (from parent PLAN loop), update only the
      // .content field — preserving tasks, openQuestions, metadata, etc.
      // This picks up manual edits the user made in the Liveblocks editor.
      const planJsonPath = path.join(claudeWorkDir, "plan.json");
      if (existsSync(planJsonPath)) {
        try {
          const existing = JSON.parse(readFileSync(planJsonPath, "utf-8")) as Record<string, unknown>;
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
            JSON.stringify({ content: artifact.content }, null, 2)
          );
        }
      }
    } else if (artifact.type === "prd" || artifact.type === "artifact" || artifact.type === "PRD" || artifact.type === "FEATURE") {
      await fs.writeFile(path.join(claudeWorkDir, "prd.md"), artifact.content);
    }
  }
  if (prompt) {
    await fs.writeFile(path.join(claudeWorkDir, "prompt.md"), prompt);
  }
}

/**
 * Write context pack files for GENERATE_PRD command.
 * Mirrors writeContextPackFiles in harness-agent.mjs (lines 744-816).
 * Files go under worktreeDir/.claude/context/ (NOT claudeWorkDir).
 */
async function writeArtifactsForGeneratePrd(
  worktreeDir: string,
  artifacts: LoopArtifact[],
  prompt: string,
  repo?: unknown
): Promise<void> {
  const contextDir = path.join(worktreeDir, ".claude", "context");
  const artifactsDir = path.join(contextDir, "artifacts");
  await fs.mkdir(artifactsDir, { recursive: true });

  // Write prompt
  await fs.writeFile(path.join(contextDir, "prompt.md"), prompt);

  // Write repo-info.json when present
  if (repo) {
    await fs.writeFile(
      path.join(contextDir, "repo-info.json"),
      JSON.stringify(repo, null, 2)
    );
  }

  // Write each artifact
  for (const artifact of artifacts) {
    const safeName = artifact.type.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    const safeId = (artifact.id ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
    const header = `# ${artifact.title ?? "Untitled"}\n\n`;
    await fs.writeFile(
      path.join(artifactsDir, `${safeName}-${safeId}.md`),
      header + artifact.content
    );
  }
}
// ---------------------------------------------------------------------------
// Per-command output reading
// ---------------------------------------------------------------------------

function readTextFile(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function readPlanOutputs(claudeWorkDir: string): Record<string, unknown> {
  const plan = readJsonFileSync(path.join(claudeWorkDir, "plan.json"));
  const openQuestions = readTextFile(
    path.join(claudeWorkDir, "open-questions.md")
  );
  const judges = readJsonFileSync(path.join(claudeWorkDir, "judges.json"));

  return {
    plan: plan ?? undefined,
    openQuestions: openQuestions ?? undefined,
    judges: judges ?? undefined,
  };
}

function readExecuteOutputs(claudeWorkDir: string): Record<string, unknown> {
  const executionResult = readJsonFileSync(
    path.join(claudeWorkDir, "execution-result.json")
  );
  const codeJudges = readJsonFileSync(
    path.join(claudeWorkDir, "code-judges.json")
  );

  return {
    executionResult: executionResult ?? undefined,
    codeJudges: codeJudges ?? undefined,
  };
}

function readDecomposeOutputs(workDir: string): Record<string, unknown> {
  const features = readJsonFileSync(path.join(workDir, "features.json"));
  return { features: features ?? undefined };
}

function readGeneratePrdOutputs(worktreeDir: string): Record<string, unknown> {
  const prdContent = readTextFile(path.join(worktreeDir, "prd.md"));
  return { prd: prdContent ? { content: prdContent } : undefined };
}

/** Parse token usage from claude-output.jsonl (JSONL stream output). */
function parseTokenUsage(claudeWorkDir: string): { input: number; output: number } {
  const totals = { input: 0, output: 0 };
  const outputFile = path.join(claudeWorkDir, "claude-output.jsonl");
  if (!existsSync(outputFile)) {
    return totals;
  }
  try {
    const content = readFileSync(outputFile, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.type === "assistant") {
          const message = entry.message as Record<string, unknown> | undefined;
          const usage = message?.usage as Record<string, number> | undefined;
          if (usage) {
            totals.input +=
              (usage.input_tokens ?? 0) +
              (usage.cache_creation_input_tokens ?? 0) +
              (usage.cache_read_input_tokens ?? 0);
            totals.output += usage.output_tokens ?? 0;
          }
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file read error
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Git operations (EXECUTE only)
// ---------------------------------------------------------------------------

function executeGitOperations(
  worktreeDir: string,
  committer: LoopCommitter | undefined,
  baseBranch: string
): { prUrl: string; prNumber: number; branchName: string; commitSha: string } | null {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (committer) {
    env.GIT_AUTHOR_NAME = committer.name;
    env.GIT_AUTHOR_EMAIL = committer.email;
    env.GIT_COMMITTER_NAME = committer.name;
    env.GIT_COMMITTER_EMAIL = committer.email;
  }

  // Check for changes
  try {
    const status = execSync("git status --porcelain", {
      cwd: worktreeDir,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 10_000,
    }).trim();

    if (!status) {
      return null; // No changes
    }
  } catch {
    return null;
  }

  // Stage, commit, push
  try {
    execSync("git add -A", {
      cwd: worktreeDir,
      stdio: "pipe",
      env,
      timeout: 10_000,
    });

    execSync('git commit -m "Symphony: implement plan"', {
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
        }
      ).trim();
      const parsed = JSON.parse(existingPr) as { url: string; number: number };
      prUrl = parsed.url;
      prNumber = parsed.number;
    } catch {
      // No existing PR — create one
      const prOutput = execSync(
        `gh pr create --title "Symphony: implement plan" --body "Automated PR from Symphony loop" --base ${shellEscape(baseBranch)}`,
        {
          cwd: worktreeDir,
          encoding: "utf-8",
          stdio: "pipe",
          env,
          timeout: 30_000,
        }
      ).trim();
      prUrl = prOutput;
      const prNumberMatch = /\/pull\/(\d+)/.exec(prUrl);
      prNumber = prNumberMatch ? Number.parseInt(prNumberMatch[1], 10) : 0;
    }

    return { prUrl, prNumber, branchName, commitSha };
  } catch (err) {
    console.error("[symphony-loop] Git operations failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Process completion handler (async, runs after spawn)
// ---------------------------------------------------------------------------

async function handleProcessCompletion(
  exitCode: number,
  body: LoopRequestBody,
  apiBaseUrl: string,
  worktreeDir: string | null,
  claudeWorkDir: string,
  usedTempDir: boolean,
  expandedRepoPath: string | null,
  jobStore?: JobStore
): Promise<void> {
  const { loopId, command, closedLoopAuthToken, committer } = body;

  loopLog(loopId, `Process exited with code ${exitCode}, command=${command}`);
  runningLoops.delete(loopId);

  if (exitCode !== 0) {
    loopError(loopId, `Process failed with exit code ${exitCode}`);
    // Error shape matches ECS harness: top-level code/message, not nested error object
    await postLoopEvent(apiBaseUrl, loopId, closedLoopAuthToken, {
      type: "error",
      code: "PROCESS_FAILED",
      message: `Process exited with code ${exitCode}`,
      loopId,
    });
    if (jobStore) {
      const existingJob = jobStore.getByLoopId(loopId);
      if (existingJob) {
        const now = new Date().toISOString();
        jobStore.upsert({
          ...existingJob,
          status: "FAILED",
          exitCode,
          updatedAt: now,
          completedAt: now,
        });
      }
    }
    if (usedTempDir) {
      fs.rm(claudeWorkDir, { recursive: true, force: true }).catch(() => {});
    } else if (command === "GENERATE_PRD" && worktreeDir && expandedRepoPath) {
      await cleanupGeneratePrdWorktree(worktreeDir, expandedRepoPath, loopId);
    }
    return;
  }

  // Read outputs per command
  let artifacts: Record<string, unknown> = {};
  const metadata: Record<string, unknown> = {};

  if (command === "PLAN" || command === "REQUEST_CHANGES") {
    artifacts = readPlanOutputs(claudeWorkDir);
  } else if (command === "EXECUTE") {
    artifacts = readExecuteOutputs(claudeWorkDir);

    // Git operations for EXECUTE
    if (worktreeDir) {
      const baseBranch = body.repo?.branch ?? "main";
      const gitResult = executeGitOperations(
        worktreeDir,
        committer,
        baseBranch
      );
      if (gitResult) {
        // Merge git info into execution result
        const execResult =
          (artifacts.executionResult as Record<string, unknown>) ?? {};
        execResult.pr_url = gitResult.prUrl;
        execResult.pr_number = gitResult.prNumber;
        execResult.branch_name = gitResult.branchName;
        execResult.commit_sha = gitResult.commitSha;
        execResult.has_changes = true;
        execResult.base_branch = baseBranch;
        artifacts.executionResult = execResult;
        metadata.branchName = gitResult.branchName;
      }
    }
  } else if (command === "DECOMPOSE") {
    artifacts = readDecomposeOutputs(claudeWorkDir);
  } else if (command === "EVALUATE_PRD") {
    artifacts = readEvaluatePrdOutputs(claudeWorkDir);
  } else if (command === "GENERATE_PRD") {
    artifacts = readGeneratePrdOutputs(worktreeDir ?? claudeWorkDir);
  }

  // Read session ID if available
  const sessionFile = path.join(claudeWorkDir, "session-id.txt");
  const sessionId = readTextFile(sessionFile);
  if (sessionId) {
    metadata.sessionId = sessionId.trim();
  }

  // Upload artifacts
  loopLog(loopId, "Artifact keys:", Object.keys(artifacts));
  await uploadArtifacts(apiBaseUrl, loopId, closedLoopAuthToken, {
    artifacts,
    metadata,
  });

  // Parse token usage from claude output
  const tokensUsed = parseTokenUsage(claudeWorkDir);
  loopLog(loopId, `Tokens used: input=${tokensUsed.input}, output=${tokensUsed.output}`);

  // Post completed event — shape matches ECS harness reportFinalStatus()
  const result: Record<string, unknown> = {
    exitCode,
    subtype: command.toLowerCase(),
  };

  if (command === "EXECUTE" && artifacts.executionResult) {
    const execResult = artifacts.executionResult as Record<string, unknown>;
    result.prUrl = execResult.pr_url;
    result.prNumber = execResult.pr_number;
    result.branchName = execResult.branch_name;
    result.has_changes = execResult.has_changes ?? false;
  }

  // Include worktree branch name for all commands that use a worktree.
  // The server persists this on the loop record for display/debugging.
  if (worktreeDir && !result.branchName) {
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: worktreeDir,
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 5_000,
      }).trim();
      if (branch) {
        result.branchName = branch;
      }
    } catch {
      // Non-critical — worktree may already be cleaned up
    }
  }

  // sessionId inside result (matches harness)
  if (metadata.sessionId) {
    result.sessionId = metadata.sessionId;
  }

  const completedEvent: Record<string, unknown> = {
    type: "completed",
    result,
    tokensUsed,
    loopId,
  };

  loopLog(loopId, "Posting completed event...");
  await postLoopEvent(apiBaseUrl, loopId, closedLoopAuthToken, completedEvent);
  loopLog(loopId, "Loop completed successfully");

  if (jobStore) {
    const existingJob = jobStore.getByLoopId(loopId);
    if (existingJob) {
      const now = new Date().toISOString();
      jobStore.upsert({
        ...existingJob,
        status: "COMPLETED",
        exitCode: 0,
        updatedAt: now,
        completedAt: now,
      });
    }
  }

  // Clean up temp claude workdir after all reads and uploads are complete
  if (usedTempDir) {
    fs.rm(claudeWorkDir, { recursive: true, force: true }).catch(() => {});
  } else if (command === "GENERATE_PRD" && worktreeDir && expandedRepoPath) {
    await cleanupGeneratePrdWorktree(worktreeDir, expandedRepoPath, loopId);
  }
}

// ---------------------------------------------------------------------------
// Main route handler
// ---------------------------------------------------------------------------

async function handleLoopRequest(
  context: OperationRequestContext,
  getAllowedDirectories: () => string[],
  getApiOrigin?: () => string,
  jobStore?: JobStore
): Promise<void> {
  // Derive the callback URL from the gateway's trusted configuration.
  // body.apiBaseUrl is ignored -- the caller does not control where
  // loop events and artifact uploads are sent.
  const apiBaseUrl = getApiOrigin?.();
  if (!apiBaseUrl) {
    json(context, 503, { error: "API origin not configured" });
    return;
  }

  const rawBody = parseJsonBody(context);
  if (!rawBody) {
    json(context, 400, { error: "Invalid JSON body" });
    return;
  }

  const body = rawBody as unknown as LoopRequestBody;
  const repoRequirement = REPO_REQUIREMENT_BY_COMMAND[body.command] ?? "NOT_REQUIRED";

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

  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.loopId)) {
    json(context, 400, { error: "loopId must be a valid UUID" });
    return;
  }

  if (!Array.isArray(body.artifacts)) {
    json(context, 400, { error: "artifacts must be an array" });
    return;
  }

  if (body.command === "GENERATE_PRD" && (typeof body.prompt !== "string" || !body.prompt.trim())) {
    json(context, 400, { error: "No prompt found for GENERATE_PRD" });
    return;
  }

  if (runningLoops.has(body.loopId)) {
    json(context, 409, { error: "Loop is already running on this machine" });
    return;
  }

  // Claim the loopId immediately to prevent concurrent requests from racing
  // past the has() check. Replaced with real entry after spawn succeeds.
  runningLoops.set(body.loopId, { pid: -1, child: null as unknown as ReturnType<typeof spawn> });
  loopLog(body.loopId, `Received ${body.command} request, repo=${body.repo?.fullName ?? "none"}, stableId=${pickStableId(body)}, parentSessionId=${body.parentSessionId ?? "none"}`);

  let spawnedSuccessfully = false;
  try {
    const allowedDirs = getAllowedDirectories();
    let expandedRepoPath: string | null = null;

    if (repoRequirement !== "NOT_REQUIRED" && body.localRepoPath) {
      // localRepoPath takes precedence over repo.fullName lookup when present
      try {
        const repoResult = tryAssertRepoAllowed(body.localRepoPath, allowedDirs);
        if ("error" in repoResult) {
          if (repoRequirement === "REQUIRED") {
            json(context, repoResult.status, { error: repoResult.error });
            return;
          }
          loopLog(
            body.loopId,
            `Ignoring localRepoPath for ${body.command}: ${repoResult.error}`
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
          `Ignoring localRepoPath for ${body.command} after resolution error: ${repoPathError instanceof Error ? repoPathError.message : String(repoPathError)}`
        );
      }
    } else if (repoRequirement !== "NOT_REQUIRED" && body.repo?.fullName) {
      expandedRepoPath = findLocalRepo(body.repo.fullName, allowedDirs);
      if (!expandedRepoPath) {
        if (repoRequirement === "REQUIRED") {
          json(context, 404, {
            error: `Repository not found locally: ${body.repo.fullName}`,
          });
          return;
        }
        loopLog(
          body.loopId,
          `Ignoring repo.fullName for ${body.command}: not found locally (${body.repo.fullName})`
        );
      } else {
        try {
          assertPathAllowed(expandedRepoPath, allowedDirs);
        } catch (err) {
          if (err instanceof DirectoryNotAllowedError) {
            if (repoRequirement === "REQUIRED") {
              json(context, 403, { error: "Repository path not allowed" });
              return;
            }
            loopLog(
              body.loopId,
              `Ignoring repo.fullName for ${body.command}: repository path not allowed (${expandedRepoPath})`
            );
            expandedRepoPath = null;
          } else {
            throw err;
          }
        }
      }
    }

    let worktreeDir: string | null = null;
    let claudeWorkDir: string;
    let usedTempDir = false;

    if (body.command === "DECOMPOSE") {
      // DECOMPOSE: use temp dir, no worktree needed
      usedTempDir = true;
      const tmpDir = path.join(
        os.tmpdir(),
        `symphony-decompose-${body.loopId.slice(0, 8)}`
      );
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.mkdir(tmpDir, { recursive: true });
      claudeWorkDir = tmpDir;
      await writePrdArtifact(claudeWorkDir, body.artifacts, body.prompt);
    } else if (body.command === "EVALUATE_PRD") {
      // EVALUATE_PRD: use temp dir, no worktree needed.
      // Temp dir is intentionally exempt from assertPathAllowed.
      usedTempDir = true;
      const tmpDir = path.join(
        os.tmpdir(),
        `symphony-evaluate-prd-${body.loopId.slice(0, 8)}`
      );
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.mkdir(tmpDir, { recursive: true });
      claudeWorkDir = tmpDir;
      await writePrdArtifact(claudeWorkDir, body.artifacts, body.prompt);
    } else if (repoRequirement === "REQUIRED" && !expandedRepoPath) {
      json(context, 400, {
        error: "Repository required for PLAN, EXECUTE, REQUEST_CHANGES, and GENERATE_PRD commands",
      });
      return;
    } else if (body.command === "PLAN" || body.command === "EXECUTE" || body.command === "REQUEST_CHANGES") {
      const repoPath = expandedRepoPath;
      if (!repoPath) {
        json(context, 400, {
          error: "Repository required for PLAN, EXECUTE, and REQUEST_CHANGES commands",
        });
        return;
      }

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
        const staleWorktree = findWorktreeForBranch(repoPath, branchName);
        if (staleWorktree) {
          loopLog(body.loopId, `Removing stale worktree for fresh PLAN: ${staleWorktree}`);
          try {
            execSync(`git worktree remove --force ${shellEscape(staleWorktree)}`, {
              cwd: repoPath,
              stdio: "pipe",
              timeout: 15_000,
            });
          } catch (wtErr) {
            loopLog(body.loopId, `git worktree remove failed, falling back to fs.rm: ${wtErr instanceof Error ? wtErr.message : wtErr}`);
            // Force-remove the directory so ensureWorktree can recreate it
            await fs.rm(staleWorktree, { recursive: true, force: true });
            // Prune stale worktree entries from git's tracking
            try {
              execSync("git worktree prune", { cwd: repoPath, stdio: "pipe", timeout: 10_000 });
            } catch {
              // Best-effort
            }
          }
        }
        await ensureWorktree(
          repoPath,
          worktreeDir,
          branchName,
          body.repo?.branch ?? "main"
        );
        loopLog(body.loopId, `Created fresh worktree for PLAN: ${worktreeDir} (branch: ${branchName})`);
      } else {
        // EXECUTE/REQUEST_CHANGES: reuse existing worktree.
        // Try artifact slug first, then parentLoopId fallback, then create new.
        const existingWorktree = findWorktreeForBranch(repoPath, branchName);
        if (existingWorktree) {
          worktreeDir = existingWorktree;
          loopLog(body.loopId, `Reusing worktree via artifact slug: ${worktreeDir} (branch: ${branchName})`);
        } else if (body.parentLoopId) {
          // Fallback: try parent's loopId-based branch (pre-slug deployments or missing slug)
          const parentBranch = `symphony/loop-${slugifyLoopId(body.parentLoopId)}`;
          const parentWorktree = findWorktreeForBranch(repoPath, parentBranch);
          if (parentWorktree) {
            worktreeDir = parentWorktree;
            loopLog(body.loopId, `Reusing worktree via parentLoopId fallback: ${worktreeDir} (branch: ${parentBranch})`);
          }
        }
        if (!worktreeDir || !existsSync(worktreeDir)) {
          // No existing worktree found — create new
          worktreeDir = resolveLoopWorktreeDir(repoPath, worktreeKey);
          await ensureWorktree(
            repoPath,
            worktreeDir,
            branchName,
            body.repo?.branch ?? "main"
          );
          loopLog(body.loopId, `Created new worktree: ${worktreeDir} (branch: ${branchName})`);
        }
      }

      try {
        assertPathAllowed(worktreeDir, allowedDirs);
      } catch (e) {
        if (e instanceof DirectoryNotAllowedError) {
          json(context, 403, { error: `Worktree path not allowed: ${worktreeDir}` });
          return;
        }
        throw e;
      }
      claudeWorkDir = path.join(worktreeDir, ".claude", "work");
      await fs.mkdir(claudeWorkDir, { recursive: true });

      if (body.command === "PLAN") {
        await writeArtifactsForPlan(claudeWorkDir, body.artifacts, body.prompt);
      } else if (body.command === "EXECUTE") {
        await writeArtifactsForExecuteOrAmend(claudeWorkDir, body.artifacts);
      } else {
        // REQUEST_CHANGES
        await writeArtifactsForExecuteOrAmend(
          claudeWorkDir,
          body.artifacts,
          body.prompt
        );
      }
    } else if (body.command === "GENERATE_PRD") {
      const repoPath = expandedRepoPath;
      if (!repoPath) {
        json(context, 400, {
          error: "Repository required for GENERATE_PRD command",
        });
        return;
      }

      // Use a dedicated branch namespace to avoid collisions with PLAN/EXECUTE worktrees.
      // GENERATE_PRD always starts fresh -- it must not inherit a prior PLAN worktree.
      const sanitizedSlug = body.artifactSlug
        ? slugifyLoopId(body.artifactSlug)
        : null;
      const worktreeKey = sanitizedSlug ?? pickStableId(body);
      const branchName = sanitizedSlug
        ? `symphony/generate-prd-${sanitizedSlug}`
        : `symphony/generate-prd-${pickStableId(body)}`;

      worktreeDir = resolveLoopWorktreeDir(repoPath, `generate-prd-${worktreeKey}`);

      // Always start fresh: remove any stale worktree for this branch before creation.
      const staleWorktree = findWorktreeForBranch(repoPath, branchName);
      if (staleWorktree) {
        loopLog(body.loopId, `Removing stale worktree for fresh GENERATE_PRD: ${staleWorktree}`);
        await cleanupGeneratePrdWorktree(staleWorktree, repoPath, body.loopId);
      }

      await ensureWorktree(
        repoPath,
        worktreeDir,
        branchName,
        body.repo?.branch ?? "main"
      );
      loopLog(body.loopId, `Created worktree for GENERATE_PRD: ${worktreeDir} (branch: ${branchName})`);

      try {
        assertPathAllowed(worktreeDir, allowedDirs);
      } catch (e) {
        if (e instanceof DirectoryNotAllowedError) {
          await cleanupGeneratePrdWorktree(worktreeDir, repoPath, body.loopId);
          json(context, 403, { error: `Worktree path not allowed: ${worktreeDir}` });
          return;
        }
        throw e;
      }

      // claudeWorkDir is a separate operational dir inside the worktree (same pattern as PLAN/EXECUTE).
      // Spawn uses cwd: worktreeDir so Claude writes prd.md to the repo root.
      // Logs, PID, and prompt file go to claudeWorkDir, not the repo root.
      claudeWorkDir = path.join(worktreeDir, ".claude", "work");
      await fs.mkdir(claudeWorkDir, { recursive: true });
      await writeArtifactsForGeneratePrd(worktreeDir, body.artifacts, body.prompt!, body.repo);
    } else {
      json(context, 400, { error: `Unknown command: ${body.command}` });
      return;
    }

    const cleanupTempClaudeWorkDir = (): void => {
      fs.rm(claudeWorkDir, { recursive: true, force: true }).catch(() => {});
    };

    // Pre-flight: verify required binary exists BEFORE posting 'started' event.
    // PLAN and EXECUTE use run-loop.sh; REQUEST_CHANGES and DECOMPOSE use claude CLI directly.
    const usesRunLoop = body.command === "PLAN" || body.command === "EXECUTE";
    const usesClaude =
      body.command === "REQUEST_CHANGES" ||
      body.command === "DECOMPOSE" ||
      body.command === "EVALUATE_PRD" ||
      body.command === "GENERATE_PRD";
    let scriptPath: string | null = null;

    if (usesClaude) {
      try {
        execSync("which claude", { stdio: "pipe", timeout: 5000 });
      } catch {
        await postLoopEvent(
          apiBaseUrl,
          body.loopId,
          body.closedLoopAuthToken,
          {
            type: "error",
            code: "BINARY_NOT_FOUND",
            message: "claude CLI not found in PATH",
          }
        );
        if (usedTempDir) {
          cleanupTempClaudeWorkDir();
        }
        if (body.command === "GENERATE_PRD" && worktreeDir && expandedRepoPath) {
          await cleanupGeneratePrdWorktree(worktreeDir, expandedRepoPath, body.loopId);
        }
        json(context, 500, { error: "claude CLI not found in PATH" });
        return;
      }
    } else if (usesRunLoop) {
      scriptPath = findPluginScript("code", "run-loop.sh");
      if (!scriptPath) {
        await postLoopEvent(
          apiBaseUrl,
          body.loopId,
          body.closedLoopAuthToken,
          {
            type: "error",
            code: "SCRIPT_NOT_FOUND",
            message: "run-loop.sh not found in plugin cache",
          }
        );
        json(context, 500, { error: "run-loop.sh not found in plugin cache" });
        return;
      }
    }

    // Post "started" event — only after confirming we can proceed
    loopLog(body.loopId, "Posting started event...");
    await postLoopEvent(
      apiBaseUrl,
      body.loopId,
      body.closedLoopAuthToken,
      { type: "started" }
    );

    // Spawn process
    const logFile = path.join(claudeWorkDir, "symphony-loop.log");
    let logFd: number;
    try {
      logFd = openSync(logFile, "a");
    } catch (logErr) {
      const msg = logErr instanceof Error ? logErr.message : String(logErr);
      await postLoopEvent(apiBaseUrl, body.loopId, body.closedLoopAuthToken, {
        type: "error",
        code: "SPAWN_FAILED",
        message: `Cannot open log file: ${msg}`,
      });
      if (usedTempDir) {
        cleanupTempClaudeWorkDir();
      }
      if (body.command === "GENERATE_PRD" && worktreeDir && expandedRepoPath) {
        await cleanupGeneratePrdWorktree(worktreeDir, expandedRepoPath, body.loopId);
      }
      json(context, 500, { error: `Cannot open log file: ${msg}` });
      return;
    }
    let child: ReturnType<typeof spawn>;

    try {
      const spawnEnv: Record<string, string> = {
        ...(process.env as Record<string, string>),
        CLOSEDLOOP_WORKDIR: claudeWorkDir,
        PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`,
      };

      if (body.command === "DECOMPOSE") {
        // DECOMPOSE: write prompt to file and pass via stdin to avoid E2BIG
        const prdContent = readTextFile(path.join(claudeWorkDir, "prd.md")) ?? "";
        const decomposePrompt = body.prompt ?? `Decompose the following PRD into features:\n\n${prdContent}`;
        const promptFile = path.join(claudeWorkDir, "decompose-prompt.txt");
        await fs.writeFile(promptFile, decomposePrompt);

        const claudeArgs = [
          "-p", "-",
          "--output-format", "stream-json",
          "--verbose",
          "--allowedTools",
          "Bash,Glob,Grep,Read,Write,Edit,Task,Skill,SlashCommand,TodoWrite",
          "--max-turns", "200",
        ];
        const pipeline = buildClaudePipeline(claudeArgs, claudeWorkDir, promptFile);
        child = spawn(pipeline.cmd, pipeline.args, {
          cwd: claudeWorkDir,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: spawnEnv,
        });
        child.unref();
      } else if (body.command === "EVALUATE_PRD") {
        // REPO_PATH only when a target repo is linked (expandedRepoPath).
        let evaluatePrdPrompt =
          `Activate judges:run-judges skill --artifact-type prd --workdir ${claudeWorkDir}.\n`;
        if (expandedRepoPath) {
          evaluatePrdPrompt += `REPO_PATH=${expandedRepoPath} (search here for relevant code).\n`;
        }
        const promptFile = path.join(claudeWorkDir, "evaluate-prd-prompt.txt");
        await fs.writeFile(promptFile, evaluatePrdPrompt);
        const claudeArgs = [
          "-p", "-",
          "--output-format", "stream-json",
          "--verbose",
          "--allowedTools",
          "Bash,Glob,Grep,Read,Write,Edit,Task,Skill,SlashCommand,TodoWrite",
          "--max-turns", "200",
        ];
        const pipeline = buildClaudePipeline(claudeArgs, claudeWorkDir, promptFile);
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
        const claudeArgs: string[] = [
          "-p",
          "--output-format", "stream-json",
          "--verbose",
          "--allowedTools",
          "Bash,Glob,Grep,Read,Write,Edit,Task,Skill,SlashCommand,TodoWrite",
          "--max-turns", "200",
        ];

        // Resume from parent session if available (matches harness --resume)
        if (body.parentSessionId) {
          claudeArgs.push("--resume", body.parentSessionId);
        }

        // Build /code:amend-plan invocation matching harness
        const promptFile = path.join(claudeWorkDir, "prompt.md");
        let amendPrompt = "Please amend the plan based on the requested changes.";
        if (existsSync(promptFile)) {
          amendPrompt = readFileSync(promptFile, "utf-8");
        }
        // Sanitize prompt matching harness's prepare-message step
        const sanitized = amendPrompt
          .replace(/[\n\r]+/g, " ")
          .replace(/\s{2,}/g, " ")
          .replace(/"/g, '\\"');
        claudeArgs.push(
          `/code:amend-plan --workdir ${claudeWorkDir} --message "${sanitized}"`
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

        const claudeArgs = [
          "-p", "-",
          "--output-format", "stream-json",
          "--verbose",
          "--allowedTools",
          "Bash,Glob,Grep,Read,Write,Edit,Task,Skill,SlashCommand,TodoWrite",
          "--max-turns", "200",
        ];
        const pipeline = buildClaudePipeline(claudeArgs, claudeWorkDir, promptFile);
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

        const prdPath = path.join(claudeWorkDir, "prd.md");
        if (existsSync(prdPath)) {
          scriptArgs.push("--prd", prdPath);
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
      const msg = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
      await postLoopEvent(apiBaseUrl, body.loopId, body.closedLoopAuthToken, {
        type: "error",
        code: "SPAWN_FAILED",
        message: msg,
      });
      if (usedTempDir) {
        cleanupTempClaudeWorkDir();
      }
      if (body.command === "GENERATE_PRD" && worktreeDir && expandedRepoPath) {
        await cleanupGeneratePrdWorktree(worktreeDir, expandedRepoPath, body.loopId);
      }
      json(context, 500, { error: `Failed to spawn process: ${msg}` });
      return;
    }
    closeSync(logFd);

    // Guard against double-firing: both 'error' and 'exit' can emit.
    let completionHandled = false;
    const onceComplete = (code: number) => {
      if (completionHandled) {
        return;
      }
      completionHandled = true;
      loopLog(body.loopId, `onceComplete fired, code=${code}`);
      handleProcessCompletion(
        code,
        body,
        apiBaseUrl,
        worktreeDir,
        claudeWorkDir,
        usedTempDir,
        expandedRepoPath,
        jobStore
      ).catch((err) => loopError(body.loopId, "Completion handler error:", err));
    };

    // Prevent unhandled 'error' events (e.g. ENOENT if binary vanishes
    // between pre-flight check and spawn) from crashing Electron.
    child.on("error", (err) => {
      loopError(body.loopId, "Spawn error:", err.message);
      onceComplete(1);
    });

    // Use 'exit' instead of 'close' — with detached processes using
    // inherited file descriptors (not pipes), 'close' may never fire
    // because there are no Node.js streams to track closure of.
    child.on("exit", (code) => {
      loopLog(body.loopId, `Process exit event, code=${code}`);
      onceComplete(code ?? 1);
    });

    const pid = child.pid ?? null;

    if (!pid) {
      // error handler above will fire asynchronously — respond immediately
      json(context, 500, { error: "Failed to spawn process" });
      return;
    }

    // Replace sentinel with real entry — storing `child` prevents GC of the
    // ChildProcess handle which would silently drop the exit listener.
    runningLoops.set(body.loopId, { pid, child });
    spawnedSuccessfully = true;
    loopLog(body.loopId, `Spawned pid=${pid}, worktree=${worktreeDir}`);

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
        ...(existing ?? {}),
        worktreeDir: worktreeDir ?? undefined,
        claudeWorkDir,
        logPath,
        jsonlPath,
        statePath,
        pid,
        status: "RUNNING",
        updatedAt: now,
        startedAt: existing?.startedAt ?? now,
      });
    }

    // Write PID file (safe to await now — close handler is already registered)
    await fs.writeFile(
      path.join(claudeWorkDir, "process.pid"),
      String(pid)
    );

    json(context, 200, {
      success: true,
      loopId: body.loopId,
      pid,
      worktreePath: worktreeDir,
    });
  } finally {
    // Clean up sentinel if we never reached a successful spawn
    if (!spawnedSuccessfully) {
      runningLoops.delete(body.loopId);
    }
  }
}

// ---------------------------------------------------------------------------
// Kill handler
// ---------------------------------------------------------------------------

async function handleLoopKill(
  context: OperationRequestContext
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
    json(context, 404, { error: "No running process found for this loop" });
    return;
  }
  if (entry.pid <= 0) {
    json(context, 409, { error: "Loop is still initializing, retry shortly" });
    return;
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
  jobStore?: JobStore
): void {
  dispatcher.register(
    "POST",
    "/api/engineer/symphony/loop",
    async (context) => {
      await handleLoopRequest(context, getAllowedDirectories, getApiOrigin, jobStore);
    }
  );

  dispatcher.register(
    "POST",
    "/api/engineer/symphony/loop/kill",
    async (context) => {
      await handleLoopKill(context);
    }
  );
}
