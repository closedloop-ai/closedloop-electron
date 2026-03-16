import { execSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  OperationDispatcher,
  OperationRequestContext,
} from "../operation-dispatcher.js";
import { assertPathAllowed, DirectoryNotAllowedError } from "../security.js";
import { findPluginScript } from "./plugin-cache.js";
import {
  expandHome,
  resolveWorktreeParentDir,
} from "./symphony-utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoopCommand = "PLAN" | "EXECUTE" | "REQUEST_CHANGES" | "DECOMPOSE";

const VALID_COMMANDS = new Set<LoopCommand>(["PLAN", "EXECUTE", "REQUEST_CHANGES", "DECOMPOSE"]);

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
  apiBaseUrl: string;
  artifacts: LoopArtifact[];
  repo?: LoopRepo;
  committer?: LoopCommitter;
  parentBranchName?: string;
  parentSessionId?: string;
  /** The loop's own session ID from a previous run (for --resume). */
  sessionId?: string;
  prompt?: string;
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
 * Validate apiBaseUrl to prevent SSRF to private/metadata/loopback endpoints.
 * Uses deny-by-default for IP literals: extracts the IPv4 address (including
 * from IPv4-mapped IPv6 like ::ffff:127.0.0.1) and checks it against
 * private/reserved ranges. Non-IP hostnames are allowed except "localhost".
 */
function validateApiBaseUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }
  // WHATWG URL parser strips brackets from IPv6, so hostname is e.g. "::1"
  const hostname = parsed.hostname;

  if (hostname === "localhost") {
    return false;
  }

  // Extract IPv4 for range checking. Handles plain IPv4, IPv4-mapped IPv6
  // (::ffff:1.2.3.4), and IPv4-compatible IPv6 (::1.2.3.4).
  const ipv4 = extractIPv4(hostname);
  if (ipv4) {
    return !isPrivateIPv4(ipv4);
  }

  // Pure IPv6 (not IPv4-mapped): block loopback (::1) and all-zeros (::)
  if (hostname.includes(":")) {
    const normalized = hostname.replace(/^\[|]$/g, "");
    if (normalized === "::1" || normalized === "::" || normalized === "0:0:0:0:0:0:0:0" || normalized === "0:0:0:0:0:0:0:1") {
      return false;
    }
    // Block any remaining IPv6 with embedded IPv4-mapped prefix
    if (/^::ffff:/i.test(normalized) || /^0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:ffff:/i.test(normalized)) {
      return false;
    }
    // Block ULA (fc00::/7) and link-local (fe80::/10)
    if (/^f[cd]/i.test(normalized) || /^fe[89ab]/i.test(normalized)) {
      return false;
    }
  }

  return true;
}

/** Extract the IPv4 dotted-quad from a hostname, handling IPv4-mapped IPv6. */
function extractIPv4(hostname: string): string | null {
  // Plain IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return hostname;
  }
  // IPv4-mapped IPv6: "::ffff:1.2.3.4" or "[::ffff:1.2.3.4]"
  const stripped = hostname.replace(/^\[|]$/g, "");
  const mapped = /::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(stripped);
  if (mapped) {
    return mapped[1];
  }
  return null;
}

/** Check if an IPv4 dotted-quad is in a private/reserved range. */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed → treat as private (deny)
  }
  const [a, b] = parts;
  return (
    a === 0 ||            // 0.0.0.0/8
    a === 10 ||           // 10.0.0.0/8
    a === 127 ||          // 127.0.0.0/8 (loopback)
    (a === 169 && b === 254) || // 169.254.0.0/16 (link-local / cloud metadata)
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168)  // 192.168.0.0/16
  );
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
 * Prefers session ID for stable naming (matches ECS harness behavior).
 * Falls back to full artifact or loop ID if session ID is unavailable.
 */
function resolveLoopWorktreeDir(
  expandedRepoPath: string,
  stableId: string
): string {
  const repoName = path.basename(expandedRepoPath);
  const shortId = stableId.slice(0, 8);
  return path.join(
    resolveWorktreeParentDir(expandedRepoPath),
    `${repoName}-loop-${shortId}`
  );
}

/**
 * Pick the best stable ID for worktree naming.
 * Priority: sessionId > artifactId > loopId (all full, untruncated UUIDs).
 */
function pickStableId(body: LoopRequestBody): string {
  if (body.sessionId) {
    return body.sessionId;
  }
  return body.artifacts[0]?.id ?? body.loopId;
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
  loopLog(loopId, `POST event: ${eventBody.type}`, url);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-loop-event-nonce": crypto.randomUUID(),
      },
      body: JSON.stringify(eventBody),
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

/** Find any existing symphony loop worktree for a repo (reuse across loops). */
function findExistingLoopWorktree(
  expandedRepoPath: string
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
      if (line.startsWith("branch ") && line.includes("/symphony/loop-")) {
        return currentWorktree;
      }
    }
  } catch {
    // fall through
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-command artifact writing
// ---------------------------------------------------------------------------

async function writeArtifactsForPlan(
  claudeWorkDir: string,
  artifacts: LoopArtifact[]
): Promise<void> {
  const prdTypes = new Set(["prd", "PRD", "artifact", "FEATURE"]);
  for (const artifact of artifacts) {
    if (prdTypes.has(artifact.type)) {
      await fs.writeFile(path.join(claudeWorkDir, "prd.md"), artifact.content);
    }
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

async function writeArtifactsForDecompose(
  tmpDir: string,
  artifacts: LoopArtifact[]
): Promise<void> {
  for (const artifact of artifacts) {
    if (artifact.type === "prd" || artifact.type === "artifact") {
      await fs.writeFile(path.join(tmpDir, "prd.md"), artifact.content);
    }
  }
}

// ---------------------------------------------------------------------------
// Per-command output reading
// ---------------------------------------------------------------------------

function readJsonFile(filePath: string): unknown | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

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
  const plan = readJsonFile(path.join(claudeWorkDir, "plan.json"));
  const openQuestions = readTextFile(
    path.join(claudeWorkDir, "open-questions.md")
  );
  const judges = readJsonFile(path.join(claudeWorkDir, "judges.json"));

  return {
    plan: plan ?? undefined,
    openQuestions: openQuestions ?? undefined,
    judges: judges ?? undefined,
  };
}

function readExecuteOutputs(claudeWorkDir: string): Record<string, unknown> {
  const executionResult = readJsonFile(
    path.join(claudeWorkDir, "execution-result.json")
  );
  const codeJudges = readJsonFile(
    path.join(claudeWorkDir, "code-judges.json")
  );

  return {
    executionResult: executionResult ?? undefined,
    codeJudges: codeJudges ?? undefined,
  };
}

function readDecomposeOutputs(workDir: string): Record<string, unknown> {
  const features = readJsonFile(path.join(workDir, "features.json"));
  return { features: features ?? undefined };
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
  worktreeDir: string | null,
  claudeWorkDir: string
): Promise<void> {
  const { loopId, command, closedLoopAuthToken, apiBaseUrl, committer } = body;

  loopLog(loopId, `Process exited with code ${exitCode}, command=${command}`);
  runningLoops.delete(loopId);

  if (exitCode !== 0) {
    loopError(loopId, `Process failed with exit code ${exitCode}`);
    await postLoopEvent(apiBaseUrl, loopId, closedLoopAuthToken, {
      type: "error",
      error: { code: "PROCESS_FAILED", message: `Process exited with code ${exitCode}` },
    });
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

  // Post completed event
  const completedEvent: Record<string, unknown> = {
    type: "completed",
    result: { subtype: command.toLowerCase() },
    tokensUsed,
    timestamp: new Date().toISOString(),
  };

  if (command === "EXECUTE" && artifacts.executionResult) {
    const execResult = artifacts.executionResult as Record<string, unknown>;
    completedEvent.result = {
      subtype: "execute",
      pr_url: execResult.pr_url,
      pr_number: execResult.pr_number,
      branch_name: execResult.branch_name,
      has_changes: execResult.has_changes ?? false,
    };
  }

  if (metadata.sessionId) {
    completedEvent.sessionId = metadata.sessionId;
  }

  loopLog(loopId, "Posting completed event...");
  await postLoopEvent(apiBaseUrl, loopId, closedLoopAuthToken, completedEvent);
  loopLog(loopId, "Loop completed successfully");

  // Clean up DECOMPOSE temp directory after all reads and uploads are complete
  if (command === "DECOMPOSE") {
    fs.rm(claudeWorkDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Main route handler
// ---------------------------------------------------------------------------

async function handleLoopRequest(
  context: OperationRequestContext,
  getAllowedDirectories: () => string[]
): Promise<void> {
  const rawBody = parseJsonBody(context);
  if (!rawBody) {
    json(context, 400, { error: "Invalid JSON body" });
    return;
  }

  const body = rawBody as unknown as LoopRequestBody;

  if (!body.loopId || !body.command || !body.closedLoopAuthToken || !body.apiBaseUrl) {
    json(context, 400, {
      error: "Missing required fields: loopId, command, closedLoopAuthToken, apiBaseUrl",
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

  if (!validateApiBaseUrl(body.apiBaseUrl)) {
    json(context, 400, {
      error: "Invalid apiBaseUrl: must be a valid http(s) URL to a non-private host",
    });
    return;
  }

  if (runningLoops.has(body.loopId)) {
    json(context, 409, { error: "Loop is already running on this machine" });
    return;
  }

  // Claim the loopId immediately to prevent concurrent requests from racing
  // past the has() check. Replaced with real entry after spawn succeeds.
  runningLoops.set(body.loopId, { pid: -1, child: null as unknown as ReturnType<typeof spawn> });
  loopLog(body.loopId, `Received ${body.command} request, repo=${body.repo?.fullName ?? "none"}, stableId=${pickStableId(body).slice(0, 8)}, sessionId=${body.sessionId ?? "none"}, parentSessionId=${body.parentSessionId ?? "none"}`);

  let spawnedSuccessfully = false;
  try {
    const allowedDirs = getAllowedDirectories();
    let expandedRepoPath: string | null = null;

    if (body.repo?.fullName) {
      expandedRepoPath = findLocalRepo(body.repo.fullName, allowedDirs);
      if (!expandedRepoPath) {
        json(context, 404, {
          error: `Repository not found locally: ${body.repo.fullName}`,
        });
        return;
      }
      try {
        assertPathAllowed(expandedRepoPath, allowedDirs);
      } catch (err) {
        if (err instanceof DirectoryNotAllowedError) {
          json(context, 403, { error: "Repository path not allowed" });
          return;
        }
        throw err;
      }
    }

    let worktreeDir: string | null = null;
    let claudeWorkDir: string;

    if (body.command === "DECOMPOSE") {
      // DECOMPOSE: use temp dir, no worktree needed
      const tmpDir = path.join(
        os.tmpdir(),
        `symphony-decompose-${body.loopId.slice(0, 8)}`
      );
      await fs.mkdir(tmpDir, { recursive: true });
      claudeWorkDir = tmpDir;
      await writeArtifactsForDecompose(claudeWorkDir, body.artifacts);
    } else if (!expandedRepoPath) {
      json(context, 400, {
        error: "Repository required for PLAN, EXECUTE, and REQUEST_CHANGES commands",
      });
      return;
    } else if (body.command === "PLAN") {
      // PLAN: reuse existing symphony loop worktree if available, else create new
      worktreeDir = findExistingLoopWorktree(expandedRepoPath);
      if (worktreeDir) {
        loopLog(body.loopId, `Reusing existing loop worktree: ${worktreeDir}`);
        try {
          assertPathAllowed(worktreeDir, allowedDirs);
        } catch (e) {
          if (e instanceof DirectoryNotAllowedError) {
            json(context, 403, { error: `Worktree path not allowed: ${worktreeDir}` });
            return;
          }
          throw e;
        }
      } else {
        const loopBranch = `symphony/loop-${pickStableId(body).slice(0, 8)}`;
        worktreeDir = resolveLoopWorktreeDir(expandedRepoPath, pickStableId(body));
        await ensureWorktree(
          expandedRepoPath,
          worktreeDir,
          loopBranch,
          body.repo?.branch ?? "main"
        );
        loopLog(body.loopId, `Created new loop worktree: ${worktreeDir}`);
      }
      claudeWorkDir = path.join(worktreeDir, ".claude", "work");
      await fs.mkdir(claudeWorkDir, { recursive: true });
      await writeArtifactsForPlan(claudeWorkDir, body.artifacts);
    } else if (body.command === "EXECUTE" || body.command === "REQUEST_CHANGES") {
      // EXECUTE/REQUEST_CHANGES: reuse parent worktree if possible
      if (body.parentBranchName) {
        worktreeDir = findWorktreeForBranch(
          expandedRepoPath,
          body.parentBranchName
        );
        if (worktreeDir) {
          try {
            assertPathAllowed(worktreeDir, allowedDirs);
          } catch (e) {
            if (e instanceof DirectoryNotAllowedError) {
              json(context, 403, { error: `Worktree path not allowed: ${worktreeDir}` });
              return;
            }
            throw e;
          }
        }
      }
      if (!worktreeDir) {
        // Create new worktree
        const loopBranch = `symphony/loop-${pickStableId(body).slice(0, 8)}`;
        worktreeDir = resolveLoopWorktreeDir(expandedRepoPath, pickStableId(body));
        await ensureWorktree(
          expandedRepoPath,
          worktreeDir,
          loopBranch,
          body.repo?.branch ?? "main"
        );
      }
      claudeWorkDir = path.join(worktreeDir, ".claude", "work");
      await fs.mkdir(claudeWorkDir, { recursive: true });

      if (body.command === "EXECUTE") {
        await writeArtifactsForExecuteOrAmend(claudeWorkDir, body.artifacts);
      } else {
        await writeArtifactsForExecuteOrAmend(
          claudeWorkDir,
          body.artifacts,
          body.prompt
        );
      }
    } else {
      json(context, 400, { error: `Unknown command: ${body.command}` });
      return;
    }

    // Pre-flight: verify required binary exists BEFORE posting 'started' event
    let scriptPath: string | null = null;
    if (body.command === "DECOMPOSE") {
      try {
        execSync("which claude", { stdio: "pipe", timeout: 5000 });
      } catch {
        await postLoopEvent(
          body.apiBaseUrl,
          body.loopId,
          body.closedLoopAuthToken,
          {
            type: "error",
            error: { code: "BINARY_NOT_FOUND", message: "claude CLI not found in PATH" },
          }
        );
        json(context, 500, { error: "claude CLI not found in PATH" });
        return;
      }
    } else {
      scriptPath = findPluginScript("code", "run-loop.sh");
      if (!scriptPath) {
        await postLoopEvent(
          body.apiBaseUrl,
          body.loopId,
          body.closedLoopAuthToken,
          {
            type: "error",
            error: { code: "SCRIPT_NOT_FOUND", message: "run-loop.sh not found in plugin cache" },
          }
        );
        json(context, 500, { error: "run-loop.sh not found in plugin cache" });
        return;
      }
    }

    // Post "started" event — only after confirming we can proceed
    loopLog(body.loopId, "Posting started event...");
    await postLoopEvent(
      body.apiBaseUrl,
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
      await postLoopEvent(body.apiBaseUrl, body.loopId, body.closedLoopAuthToken, {
        type: "error",
        error: { code: "SPAWN_FAILED", message: `Cannot open log file: ${msg}` },
      });
      json(context, 500, { error: `Cannot open log file: ${msg}` });
      return;
    }
    let child: ReturnType<typeof spawn>;

    try {
      if (body.command === "DECOMPOSE") {
        // DECOMPOSE: write prompt to file and pass via stdin to avoid E2BIG
        const prdContent = readTextFile(path.join(claudeWorkDir, "prd.md")) ?? "";
        const decomposePrompt = body.prompt ?? `Decompose the following PRD into features:\n\n${prdContent}`;
        const promptFile = path.join(claudeWorkDir, "decompose-prompt.txt");
        await fs.writeFile(promptFile, decomposePrompt);

        const promptFd = openSync(promptFile, "r");
        try {
          child = spawn("claude", ["-p", "-", "--output-format", "json"], {
            cwd: claudeWorkDir,
            detached: true,
            stdio: [promptFd, logFd, logFd],
            env: {
              ...process.env,
              PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`,
            },
          });
          child.unref();
        } finally {
          closeSync(promptFd);
        }
      } else {
        // PLAN, EXECUTE, REQUEST_CHANGES: spawn run-loop.sh
        const spawnEnv: Record<string, string> = {
          ...(process.env as Record<string, string>),
          CLOSEDLOOP_WORKDIR: claudeWorkDir,
          PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`,
        };

        // Prefer loop's own session ID (re-run/resume), fall back to parent's
        const resumeSessionId = body.sessionId ?? body.parentSessionId;
        if (resumeSessionId) {
          spawnEnv.CLOSEDLOOP_SESSION_ID = resumeSessionId;
        }

        // Build args matching ECS harness-agent's buildRunLoopArgs():
        // 1. workdir (positional)
        // 2. --max-iterations (EXECUTE=150, others=50)
        // 3. --prd (always, when prd.md exists)
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
      await postLoopEvent(body.apiBaseUrl, body.loopId, body.closedLoopAuthToken, {
        type: "error",
        error: { code: "SPAWN_FAILED", message: msg },
      });
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
      handleProcessCompletion(code, body, worktreeDir, claudeWorkDir).catch(
        (err) => loopError(body.loopId, "Completion handler error:", err)
      );
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
  getAllowedDirectories: () => string[]
): void {
  dispatcher.register(
    "POST",
    "/api/engineer/symphony/loop",
    async (context) => {
      await handleLoopRequest(context, getAllowedDirectories);
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
