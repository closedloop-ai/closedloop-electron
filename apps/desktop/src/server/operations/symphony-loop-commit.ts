import { execSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { gatewayLog } from "../../main/gateway-logger.js";
import type { JobStore } from "../../main/job-store.js";
import { assertPathAllowed, DirectoryNotAllowedError } from "../security.js";
import { getShellEnv } from "../shell-path.js";
import { loopError, loopLog } from "./symphony-utils.js";
import { sanitizeCommitMessage } from "./symphony-interactive.js";
import {
  LoopArtifactFile,
} from "@closedloop-ai/loops-api/artifacts";
import type { ExecutionResult, LoopCommitter } from "./symphony-loop-types.js";
import { isExecutionResult } from "./symphony-loop-types.js";
import { getResolvedClaudePath } from "./symphony-loop-pipeline.js";
import { shellEscape } from "./symphony-loop-pipeline.js";
import { runningLoops } from "./symphony-loop-process.js";

// ---------------------------------------------------------------------------
// LLM-assisted commit (EXECUTE only)
// ---------------------------------------------------------------------------

export async function attemptLlmCommit(
  worktreeDir: string,
  baseBranch: string,
  loopId: string,
  command: string,
  artifactSlug: string | undefined,
  webAppOrigin: string,
  committer: LoopCommitter | undefined,
  getAllowedDirectories: () => string[],
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
    // sanitizeCommitMessage() + newline stripping -- no backticks that would
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
    : "No artifact slug is available -- use a descriptive title without a prefix.";

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
    "   If you cannot quickly fix it, the commit fails -- do not bypass hooks.",
    "5. Push to origin with: git push -u origin HEAD",
    "6. Check if a PR already exists for this branch: gh pr list --head <branch>",
    "   - If NO PR exists:",
    "     a. Check if the repo has a PR template at .github/pull_request_template.md",
    "        If a template exists, use it as the base for the PR body -- fill in every section appropriately.",
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
    "- Keep it quick -- commit, push, PR, write result file, done",
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
  const spawnArgs = [
    "-p",
    prompt,
    "--allowedTools",
    "Bash,Read,Write,Glob,Grep",
  ];
  loopLog(
    loopId,
    `LLM commit spawn: binary=${claudeBinary} args=["-p", "<prompt omitted>", "--allowedTools", "Bash,Read,Write,Glob,Grep"] cwd=${worktreeDir} PATH=${spawnEnv.PATH ?? "(unset)"}`,
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
        ? ` -- '${claudeBinary}' binary not found; PATH=${spawnEnv.PATH ?? "(unset)"}`
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
        loopError(loopId, "LLM commit timed out after 30m -- sending SIGTERM");
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
          ? ` -- '${claudeBinary}' binary not found; PATH=${spawnEnv.PATH ?? "(unset)"}`
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

export type GitOperationResult =
  | {
      status: "success";
      prUrl: string;
      prNumber: number;
      branchName: string;
      commitSha: string;
    }
  | { status: "no-changes" }
  | { status: "error"; reason: string };

export function executeGitOperations(
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
      // No template found -- use simple metadata body
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
      // No existing PR -- create one using --body-file to avoid shell escaping.
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

      // Best-effort label attachment -- non-fatal if the label doesn't exist
      if (prNumber) {
        try {
          execSync(`gh pr edit ${prNumber} --add-label symphony`, {
            cwd: worktreeDir,
            stdio: "pipe",
            env,
            timeout: 15_000,
          });
        } catch {
          // Label may not exist on this repo -- not critical
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
      // Only update if the footer isn't already present -- append only the
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
      // Non-critical -- PR exists, metadata is best-effort
    }

    return { status: "success", prUrl, prNumber, branchName, commitSha };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { status: "error", reason };
  }
}
