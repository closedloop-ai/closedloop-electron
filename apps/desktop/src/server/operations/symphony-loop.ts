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
  prompt?: string;
}

/** Track running loop processes for cancellation. */
const runningLoops = new Map<string, number>();

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

/** Resolve worktree directory for a loop. Uses loop-{short-id} naming. */
function resolveLoopWorktreeDir(
  expandedRepoPath: string,
  loopId: string
): string {
  const repoName = path.basename(expandedRepoPath);
  const shortId = loopId.slice(0, 8);
  return path.join(
    resolveWorktreeParentDir(expandedRepoPath),
    `${repoName}-loop-${shortId}`
  );
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
  const url = `${apiBaseUrl}/api/loops/${loopId}/events`;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-loop-event-nonce": crypto.randomUUID(),
      },
      body: JSON.stringify(eventBody),
    });
  } catch (err) {
    console.error("[symphony-loop] Failed to post event:", err);
  }
}

async function uploadArtifacts(
  apiBaseUrl: string,
  loopId: string,
  token: string,
  body: Record<string, unknown>
): Promise<void> {
  const url = `${apiBaseUrl}/api/loops/${loopId}/upload-artifacts`;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("[symphony-loop] Failed to upload artifacts:", err);
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

// ---------------------------------------------------------------------------
// Per-command artifact writing
// ---------------------------------------------------------------------------

async function writeArtifactsForPlan(
  claudeWorkDir: string,
  artifacts: LoopArtifact[]
): Promise<void> {
  for (const artifact of artifacts) {
    if (artifact.type === "prd" || artifact.type === "artifact") {
      await fs.writeFile(path.join(claudeWorkDir, "prd.md"), artifact.content);
    }
  }
}

async function writeArtifactsForExecute(
  claudeWorkDir: string,
  artifacts: LoopArtifact[]
): Promise<void> {
  for (const artifact of artifacts) {
    if (artifact.type === "plan") {
      await fs.writeFile(
        path.join(claudeWorkDir, "plan.json"),
        artifact.content
      );
    } else if (artifact.type === "prd" || artifact.type === "artifact") {
      await fs.writeFile(path.join(claudeWorkDir, "prd.md"), artifact.content);
    }
  }
}

async function writeArtifactsForRequestChanges(
  claudeWorkDir: string,
  artifacts: LoopArtifact[],
  prompt?: string
): Promise<void> {
  for (const artifact of artifacts) {
    if (artifact.type === "plan") {
      await fs.writeFile(
        path.join(claudeWorkDir, "plan.json"),
        artifact.content
      );
    } else if (artifact.type === "prd" || artifact.type === "artifact") {
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

  runningLoops.delete(loopId);

  if (exitCode !== 0) {
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
  await uploadArtifacts(apiBaseUrl, loopId, closedLoopAuthToken, {
    artifacts,
    metadata,
  });

  // Post completed event
  const completedEvent: Record<string, unknown> = {
    type: "completed",
    result: { subtype: command.toLowerCase() },
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

  await postLoopEvent(apiBaseUrl, loopId, closedLoopAuthToken, completedEvent);

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
  // past the has() check. Replaced with real PID after spawn succeeds.
  runningLoops.set(body.loopId, -1);

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
      // PLAN: create new worktree from target branch
      const loopBranch = `symphony/loop-${body.loopId.slice(0, 8)}`;
      worktreeDir = resolveLoopWorktreeDir(expandedRepoPath, body.loopId);
      await ensureWorktree(
        expandedRepoPath,
        worktreeDir,
        loopBranch,
        body.repo?.branch ?? "main"
      );
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
      }
      if (!worktreeDir) {
        // Create new worktree
        const loopBranch = `symphony/loop-${body.loopId.slice(0, 8)}`;
        worktreeDir = resolveLoopWorktreeDir(expandedRepoPath, body.loopId);
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
        await writeArtifactsForExecute(claudeWorkDir, body.artifacts);
      } else {
        await writeArtifactsForRequestChanges(
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
    await postLoopEvent(
      body.apiBaseUrl,
      body.loopId,
      body.closedLoopAuthToken,
      { type: "started" }
    );

    // Spawn process
    const logFile = path.join(claudeWorkDir, "symphony-loop.log");
    const logFd = openSync(logFile, "a");
    let child: ReturnType<typeof spawn>;

    try {
      if (body.command === "DECOMPOSE") {
        // DECOMPOSE: write prompt to file and pass via stdin to avoid E2BIG
        const prdContent = readTextFile(path.join(claudeWorkDir, "prd.md")) ?? "";
        const decomposePrompt = body.prompt ?? `Decompose the following PRD into features:\n\n${prdContent}`;
        const promptFile = path.join(claudeWorkDir, "decompose-prompt.txt");
        await fs.writeFile(promptFile, decomposePrompt);

        const promptFd = openSync(promptFile, "r");
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
        closeSync(promptFd);
      } else {
        // PLAN, EXECUTE, REQUEST_CHANGES: spawn run-loop.sh
        const spawnEnv: Record<string, string> = {
          ...(process.env as Record<string, string>),
          CLOSEDLOOP_WORKDIR: claudeWorkDir,
          PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`,
        };

        if (body.parentSessionId) {
          spawnEnv.CLOSEDLOOP_SESSION_ID = body.parentSessionId;
        }

        child = spawn(scriptPath!, [claudeWorkDir], {
          cwd: worktreeDir!,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: spawnEnv,
        });
        child.unref();
      }
    } finally {
      closeSync(logFd);
    }

    // Guard against double-firing: both 'error' and 'close' can emit.
    let completionHandled = false;
    const onceComplete = (code: number) => {
      if (completionHandled) {
        return;
      }
      completionHandled = true;
      handleProcessCompletion(code, body, worktreeDir, claudeWorkDir).catch(
        (err) => console.error("[symphony-loop] Completion handler error:", err)
      );
    };

    // Prevent unhandled 'error' events (e.g. ENOENT if binary vanishes
    // between pre-flight check and spawn) from crashing Electron.
    child.on("error", (err) => {
      console.error("[symphony-loop] Spawn error:", err.message);
      onceComplete(1);
    });

    // Register close handler BEFORE any async work to avoid missing
    // fast-exiting processes that fire 'close' during an await yield.
    child.on("close", (code) => {
      onceComplete(code ?? 1);
    });

    const pid = child.pid ?? null;

    if (!pid) {
      // error handler above will fire asynchronously — respond immediately
      json(context, 500, { error: "Failed to spawn process" });
      return;
    }

    // Replace sentinel with real PID
    runningLoops.set(body.loopId, pid);
    spawnedSuccessfully = true;

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

  const pid = runningLoops.get(loopId);
  if (pid === undefined) {
    json(context, 404, { error: "No running process found for this loop" });
    return;
  }
  if (pid <= 0) {
    json(context, 409, { error: "Loop is still initializing, retry shortly" });
    return;
  }

  try {
    process.kill(pid, 0); // Check alive
    process.kill(-pid, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    try {
      process.kill(pid, 0);
      process.kill(-pid, "SIGKILL");
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
