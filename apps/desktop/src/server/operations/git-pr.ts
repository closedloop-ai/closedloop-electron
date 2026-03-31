import { execFile, spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { OperationDispatcher, OperationRequestContext } from "../operation-dispatcher.js";
import { getGhEnv, getGhToken, getShellEnv } from "../shell-path.js";
import { isNetworkError } from "../../main/gateway-logger.js";
import { DirectoryNotAllowedError } from "../security.js";
import { assertRepoAllowed } from "./symphony-utils.js";

const execFileAsync = promisify(execFile);
const PR_NUMBER_REGEX = /\/pull\/(\d+)/;
const GITHUB_REMOTE_REGEX = /github\.com[:/]([^/]+\/[^/\s]+?)(?:\.git)?$/;
const GIT_SUFFIX_REGEX = /\.git$/;

type PRComment = {
  id: string;
  databaseId: number;
  author: string;
  body: string;
  createdAt: string;
  path?: string;
  line?: number;
  isReview: boolean;
  url: string;
  inReplyToId?: number;
};

type GitHubApiOptions = {
  method?: string;
  body?: string;
  timeoutMs?: number;
};

let githubRequestQueue: Promise<unknown> = Promise.resolve();

export function registerGitPrRoutes(
  dispatcher: OperationDispatcher,
  getAllowedDirectories: () => string[]
): void {
  dispatcher.register("POST", "/api/engineer/git/pr", async (context) => {
    const body = parseBody(context);
    if (!body) {
      json(context, 400, { error: "Invalid JSON body" });
      return;
    }

    const repoPath = asString(body.repoPath);
    const title = asString(body.title);
    const description = asString(body.body) ?? "";
    const ticketUrl = asString(body.ticketUrl);

    if (!repoPath) {
      json(context, 400, { error: "repoPath is required" });
      return;
    }
    if (!title) {
      json(context, 400, { error: "title is required" });
      return;
    }

    let cwd: string;
    try {
      cwd = assertRepoAllowed(repoPath, getAllowedDirectories());
    } catch (error) {
      if (error instanceof DirectoryNotAllowedError) {
        json(context, 403, { error: "directory not allowed" });
        return;
      }
      throw error;
    }

    const fullBody = ticketUrl
      ? `${description}\n\n---\nLinear: ${ticketUrl}`.trim()
      : description;

    try {
      const currentBranch = await runRead(cwd, "git", ["rev-parse", "--abbrev-ref", "HEAD"]);
      await run(cwd, "git", ["push", "-u", "origin", currentBranch]);

      const createOutput = await runRead(cwd, "gh", [
        "pr",
        "create",
        "--head",
        currentBranch,
        "--title",
        title,
        "--body",
        fullBody
      ]);

      const parsedFromUrl = parsePrNumber(createOutput);
      if (parsedFromUrl) {
        json(context, 200, {
          success: true,
          url: createOutput,
          number: parsedFromUrl,
          message: `Created PR #${parsedFromUrl}`
        });
        return;
      }

      const view = await runRead(cwd, "gh", ["pr", "view", "--json", "url,number"]);
      const parsedView = JSON.parse(view) as { url?: string; number?: number };
      json(context, 200, {
        success: true,
        url: parsedView.url,
        number: parsedView.number,
        message: `Created PR #${parsedView.number ?? "unknown"}`
      });
    } catch (error) {
      const message = String(error);
      if (message.includes("already exists")) {
        try {
          const view = await runRead(cwd, "gh", ["pr", "view", "--json", "url,number"]);
          const parsedView = JSON.parse(view) as { url?: string; number?: number };
          json(context, 200, {
            success: true,
            url: parsedView.url,
            number: parsedView.number,
            message: `PR #${parsedView.number ?? "unknown"} already exists`
          });
          return;
        } catch {
          // fall through to mapped error response
        }
      }

      json(context, 500, { error: parseGhError(error) });
    }
  });

  dispatcher.register("GET", "/api/engineer/git/pr/list", async (context) => {
    const repoPath = context.query.get("repo");
    const state = context.query.get("state") ?? "open";

    if (!repoPath) {
      json(context, 400, { error: "Missing 'repo' query parameter" });
      return;
    }
    if (state !== "open" && state !== "merged") {
      json(context, 400, { error: "state must be 'open' or 'merged'" });
      return;
    }

    let cwd: string;
    try {
      cwd = assertRepoAllowed(repoPath, getAllowedDirectories());
    } catch (error) {
      if (error instanceof DirectoryNotAllowedError) {
        json(context, 403, { error: "directory not allowed" });
        return;
      }
      throw error;
    }

    try {
      const repoSlug = await getRepoSlug(cwd);
      if (!repoSlug) {
        json(context, 500, { error: "Could not determine repository" });
        return;
      }

      const closedState = state === "merged" ? "closed" : state;
      const rows = await githubGetPaginated<Array<{
        number: number;
        title: string;
        html_url: string;
        user?: { login?: string };
        state: string;
        created_at: string;
        head?: { ref?: string };
        merged_at?: string | null;
      }>>(`/repos/${repoSlug}/pulls?state=${closedState}&per_page=50`);

      const filteredRows = state === "merged"
        ? rows.filter((row) => Boolean(row.merged_at))
        : rows;

      json(context, 200, {
        prs: filteredRows.map((row) => ({
          number: row.number,
          title: row.title,
          url: row.html_url,
          author: row.user?.login ?? "unknown",
          state: row.state,
          createdAt: row.created_at,
          headRefName: row.head?.ref ?? ""
        }))
      });
    } catch (error) {
      json(context, 500, { error: parseGitHubError(error) });
    }
  });

  dispatcher.register("GET", "/api/engineer/git/pr/comments", async (context) => {
    const repoPath = context.query.get("repo");
    const prNumber = context.query.get("pr");

    if (!repoPath) {
      json(context, 400, { error: "Missing 'repo' query parameter" });
      return;
    }
    if (!prNumber) {
      json(context, 400, { error: "Missing 'pr' query parameter" });
      return;
    }
    if (!/^\d+$/.test(prNumber)) {
      json(context, 400, { error: "Invalid PR number" });
      return;
    }

    let cwd: string;
    try {
      cwd = assertRepoAllowed(repoPath, getAllowedDirectories());
    } catch (error) {
      if (error instanceof DirectoryNotAllowedError) {
        json(context, 403, { error: "directory not allowed" });
        return;
      }
      throw error;
    }

    try {
      const repoSlug = await getRepoSlug(cwd);
      if (!repoSlug) {
        json(context, 500, { error: "Could not determine repository" });
        return;
      }

      const prData = await githubGet<{
        number: number;
        html_url: string;
      }>(`/repos/${repoSlug}/pulls/${prNumber}`);
      const issueComments = await githubGetPaginated<Array<{
        id: number;
        user?: { login?: string };
        body: string;
        created_at: string;
        html_url: string;
      }>>(`/repos/${repoSlug}/issues/${prNumber}/comments?per_page=100`);
      const reviews = await githubGetPaginated<Array<{
        id: number;
        user?: { login?: string };
        body?: string;
        submitted_at?: string;
        state: string;
        html_url: string;
      }>>(`/repos/${repoSlug}/pulls/${prNumber}/reviews?per_page=100`);
      const inlineRows = await githubGetPaginated<Array<{
        id: number;
        user?: { login?: string };
        body: string;
        created_at: string;
        path: string;
        original_line?: number;
        line?: number;
        html_url: string;
        in_reply_to_id?: number;
        pull_request_review_id?: number;
      }>>(`/repos/${repoSlug}/pulls/${prNumber}/comments?per_page=100`);

      const comments: PRComment[] = [];
      const seenIds = new Set<string>();

      for (const comment of issueComments) {
        comments.push({
          id: `ICMT_${comment.id}`,
          databaseId: comment.id,
          author: comment.user?.login ?? "unknown",
          body: comment.body,
          createdAt: comment.created_at,
          isReview: false,
          url: comment.html_url
        });
        seenIds.add(`ICMT_${comment.id}`);
      }

      for (const review of reviews) {
        const reviewId = `RVW_${review.id}`;
        if (review.body?.trim()) {
          comments.push({
            id: reviewId,
            databaseId: 0,
            author: review.user?.login ?? "unknown",
            body: review.body,
            createdAt: review.submitted_at ?? "",
            isReview: true,
            url: review.html_url
          });
          seenIds.add(reviewId);
        }
      }

      for (const row of inlineRows) {
        const id = `IC_${row.id}`;
        if (seenIds.has(id)) {
          continue;
        }
        comments.push({
          id,
          databaseId: row.id,
          author: row.user?.login ?? "unknown",
          body: row.body,
          createdAt: row.created_at,
          path: row.path,
          line: row.original_line ?? row.line,
          isReview: true,
          url: row.html_url,
          inReplyToId: row.in_reply_to_id
        });
        seenIds.add(id);
      }

      comments.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      json(context, 200, {
        comments,
        prNumber: prData.number,
        prUrl: prData.html_url
      });
    } catch (error) {
      const message = String(error);
      if (message.includes("404")) {
        json(context, 404, { error: `PR #${prNumber} not found` });
        return;
      }
      json(context, 500, { error: parseGitHubError(error) });
    }
  });

  dispatcher.register("GET", "/api/engineer/git/pr/reviews", async (context) => {
    const owner = context.query.get("owner");
    const repo = context.query.get("repo");
    const number = context.query.get("number");

    if (!(owner && repo && number)) {
      json(context, 400, { error: "owner, repo, and number are required" });
      return;
    }

    try {
      const pr = await githubGet<{ review_decision?: string | null }>(`/repos/${owner}/${repo}/pulls/${number}`);
      const reviewsData = await githubGetPaginated<Array<{
        state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "PENDING" | "DISMISSED";
        submitted_at?: string;
        user?: { login?: string };
      }>>(`/repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`);

      const latestByAuthor = new Map<
        string,
        {
          author: string;
          state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "PENDING" | "DISMISSED";
          submittedAt: string;
        }
      >();

      for (const review of reviewsData) {
        if (!review.submitted_at) {
          continue;
        }
        const author = review.user?.login ?? "unknown";
        const existing = latestByAuthor.get(author);
        if (!existing || new Date(review.submitted_at) > new Date(existing.submittedAt)) {
          latestByAuthor.set(author, {
            author,
            state: review.state,
            submittedAt: review.submitted_at
          });
        }
      }

      const reviews = [...latestByAuthor.values()];
      const approvalCount = reviews.filter((review) => review.state === "APPROVED").length;
      const changesRequestedCount = reviews.filter((review) => review.state === "CHANGES_REQUESTED").length;

      json(context, 200, {
        reviewDecision: pr.review_decision ?? null,
        reviews,
        approvalCount,
        changesRequestedCount
      });
    } catch (error) {
      json(context, 500, { error: parseGitHubError(error) });
    }
  });

  dispatcher.register("POST", "/api/engineer/git/pr/reply", async (context) => {
    const body = parseBody(context);
    if (!body) {
      json(context, 400, { error: "Invalid JSON body" });
      return;
    }

    const repoPath = asString(body.repoPath);
    const replyBody = asString(body.body);
    const prNumber = asNumber(body.prNumber);
    const commentId = asNumber(body.commentId);
    const requestChanges = body.requestChanges === true;

    if (!repoPath) {
      json(context, 400, { error: "Missing 'repoPath' in request body" });
      return;
    }
    if (!replyBody) {
      json(context, 400, { error: "Missing 'body' in request body" });
      return;
    }
    if (!prNumber) {
      json(context, 400, { error: "prNumber is required" });
      return;
    }

    let cwd: string;
    try {
      cwd = assertRepoAllowed(repoPath, getAllowedDirectories());
    } catch (error) {
      if (error instanceof DirectoryNotAllowedError) {
        json(context, 403, { error: "directory not allowed" });
        return;
      }
      throw error;
    }

    try {
      const repoSlug = await getRepoSlug(cwd);

      // Submit as a "Request Changes" PR review
      if (requestChanges) {
        const args = ["pr", "review", String(prNumber), "--request-changes"];
        if (repoSlug) {
          args.push("-R", repoSlug);
        }
        const result = await ghPrCommentViaStdin(args, replyBody, cwd);
        json(context, 200, {
          success: true,
          message: "Changes requested",
          output: result.stdout.trim()
        });
        return;
      }

      if (commentId && commentId > 0 && repoSlug) {
        const result = await ghApiViaStdin(
          `repos/${repoSlug}/pulls/${prNumber}/comments/${commentId}/replies`,
          { body: replyBody },
          cwd
        );

        json(context, 200, {
          success: true,
          message: "Reply posted successfully",
          output: result.stdout.trim()
        });
        return;
      }

      const args = ["pr", "comment", String(prNumber)];
      if (repoSlug) {
        args.push("-R", repoSlug);
      }
      const result = await ghPrCommentViaStdin(args, replyBody, cwd);

      json(context, 200, {
        success: true,
        message: "Comment posted successfully",
        output: result.stdout.trim()
      });
    } catch (error) {
      json(context, 500, { error: parseGhError(error) });
    }
  });

  dispatcher.register("GET", "/api/engineer/git/pr/files", async (context) => {
    const repoPath = context.query.get("repo");
    const prNumber = context.query.get("pr");

    if (!(repoPath && prNumber)) {
      json(context, 400, { error: "repo and pr are required" });
      return;
    }

    let cwd: string;
    try {
      cwd = assertRepoAllowed(repoPath, getAllowedDirectories());
    } catch (error) {
      if (error instanceof DirectoryNotAllowedError) {
        json(context, 403, { error: "directory not allowed" });
        return;
      }
      throw error;
    }

    try {
      const repoSlug = await getRepoSlug(cwd);
      if (!repoSlug) {
        json(context, 500, { error: "Could not determine repository" });
        return;
      }

      const rows = await githubGetPaginated<Array<{ filename: string }>>(
        `/repos/${repoSlug}/pulls/${prNumber}/files?per_page=100`
      );
      const files = rows.map((row) => row.filename).filter(Boolean);
      json(context, 200, { files });
    } catch (error) {
      json(context, 500, { error: parseGitHubError(error) });
    }
  });

  dispatcher.register("GET", "/api/engineer/git/pr/head-sha", async (context) => {
    const repoPath = context.query.get("repo");
    const prNumber = context.query.get("pr");

    if (!(repoPath && prNumber)) {
      json(context, 400, { error: "repo and pr are required" });
      return;
    }

    let cwd: string;
    try {
      cwd = assertRepoAllowed(repoPath, getAllowedDirectories());
    } catch (error) {
      if (error instanceof DirectoryNotAllowedError) {
        json(context, 403, { error: "directory not allowed" });
        return;
      }
      throw error;
    }

    try {
      const repoSlug = await getRepoSlug(cwd);
      if (!repoSlug) {
        json(context, 500, { error: "Could not determine repository" });
        return;
      }

      const pr = await githubGet<{ head?: { sha?: string } }>(`/repos/${repoSlug}/pulls/${prNumber}`);
      const sha = pr.head?.sha?.trim() ?? "";

      if (!sha) {
        json(context, 500, { error: "Could not get head SHA" });
        return;
      }

      json(context, 200, { sha });
    } catch (error) {
      json(context, 500, { error: parseGitHubError(error) });
    }
  });

  dispatcher.register("POST", "/api/engineer/git/pr/inline-comment", async (context) => {
    const body = parseBody(context);
    if (!body) {
      json(context, 400, { error: "Invalid JSON body" });
      return;
    }

    const repoPath = asString(body.repoPath);
    const prNumber = asNumber(body.prNumber);
    const commentBody = asString(body.body);
    const filePath = asString(body.path);
    const line = asNumber(body.line);
    const commitSha = asString(body.commitSha);

    if (!repoPath) {
      json(context, 400, { error: "repoPath is required" });
      return;
    }
    if (!prNumber) {
      json(context, 400, { error: "prNumber is required" });
      return;
    }
    if (!commentBody) {
      json(context, 400, { error: "body is required" });
      return;
    }

    let cwd: string;
    try {
      cwd = assertRepoAllowed(repoPath, getAllowedDirectories());
    } catch (error) {
      if (error instanceof DirectoryNotAllowedError) {
        json(context, 403, { error: "directory not allowed" });
        return;
      }
      throw error;
    }

    try {
      const repoSlug = await getRepoSlug(cwd);
      if (!repoSlug) {
        json(context, 500, { error: "Could not determine repository" });
        return;
      }

      if (filePath && line && commitSha) {
        try {
          const result = await ghApiViaStdin(
            `repos/${repoSlug}/pulls/${prNumber}/comments`,
            {
              body: commentBody,
              path: filePath,
              line,
              commit_id: commitSha,
              side: "RIGHT"
            },
            cwd
          );
          json(context, 200, { success: true, output: result.stdout.trim() });
          return;
        } catch {
          // Fall through to file-level comment.
        }
      }

      if (filePath && commitSha) {
        try {
          const result = await ghApiViaStdin(
            `repos/${repoSlug}/pulls/${prNumber}/comments`,
            {
              body: commentBody,
              path: filePath,
              commit_id: commitSha,
              subject_type: "file"
            },
            cwd
          );
          json(context, 200, { success: true, output: result.stdout.trim() });
          return;
        } catch {
          // Fall through to general PR comment.
        }
      }

      const result = await ghPrCommentViaStdin(
        ["pr", "comment", String(prNumber), "-R", repoSlug],
        commentBody,
        cwd
      );
      json(context, 200, { success: true, output: result.stdout.trim() });
    } catch (error) {
      const execError = error as { stderr?: string; message?: string };
      json(context, 500, {
        error: execError.stderr || execError.message || "Failed to post comment"
      });
    }
  });

  dispatcher.register("GET", "/api/engineer/git/user", async (context) => {
    // Try direct GitHub API call first -- gh CLI hangs intermittently
    // in Electron's non-TTY context on macOS Tahoe 26.x.
    const token = await getGhToken();
    if (token) {
      try {
        const res = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "closedloop-desktop",
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const data = (await res.json()) as { login?: string };
          if (data.login) {
            json(context, 200, { login: data.login });
            return;
          }
        }
      } catch {
        // Fall through to gh CLI
      }
    }

    try {
      const login = await runRead(undefined, "gh", ["api", "user", "--jq", ".login"]);
      if (!login) {
        json(context, 500, { error: "Could not determine GitHub user" });
        return;
      }
      json(context, 200, { login });
    } catch {
      json(context, 500, {
        error: "Failed to get GitHub user. Ensure gh is installed and authenticated."
      });
    }
  });
}

async function getRepoSlug(cwd: string): Promise<string> {
  try {
    const remoteUrl = await runRead(cwd, "git", ["remote", "get-url", "origin"]);
    const match = GITHUB_REMOTE_REGEX.exec(remoteUrl);
    return match ? match[1].replace(GIT_SUFFIX_REGEX, "") : "";
  } catch {
    return "";
  }
}

function parsePrNumber(url: string): number | null {
  const match = PR_NUMBER_REGEX.exec(url.trim());
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseGhError(error: unknown): string {
  const message = String(error);

  if (message.includes("not logged in") || message.includes("authentication")) {
    return "GitHub CLI not authenticated. Run 'gh auth login' in terminal.";
  }
  if (message.includes("already exists")) {
    return "A pull request already exists for this branch.";
  }
  if (message.includes("No commits between") || message.includes("no commits")) {
    return "No commits to create a PR. Make sure changes are committed first.";
  }
  if (message.includes("uncommitted changes")) {
    return "You have uncommitted changes. Commit them first.";
  }
  if (message.includes("not a git repository")) {
    return "Not a git repository.";
  }
  if (message.includes("permission denied") || message.includes("403")) {
    return "Permission denied. Check your GitHub access.";
  }
  if (message.includes("not found") || message.includes("404")) {
    return "Repository not found or no access.";
  }
  if (message.includes("network") || isNetworkError(message)) {
    return "Network error. Check your connection.";
  }

  return "Failed to complete GitHub operation. Check logs for details.";
}

function parseGitHubError(error: unknown): string {
  const message = String(error);

  if (message.includes("timed out") || message.includes("TimeoutError") || message.includes("aborted")) {
    return "GitHub API request timed out.";
  }
  if (message.includes("401") || message.includes("403")) {
    return "Permission denied. Check your GitHub access.";
  }
  if (message.includes("404")) {
    return "Repository or pull request not found.";
  }
  if (message.includes("rate limit")) {
    return "GitHub API rate limit exceeded.";
  }
  if (message.includes("network") || isNetworkError(message)) {
    return "Network error. Check your connection.";
  }

  return "Failed to complete GitHub operation. Check logs for details.";
}

async function runRead(
  cwd: string | undefined,
  command: string,
  args: string[],
  timeoutMs = 15_000
): Promise<string> {
  const label = `${command} ${args.slice(0, 3).join(" ")}`;
  const env = await envForCommand(command);
  if (command === "gh") {
    console.log(`[runRead] gh env check: GH_TOKEN=${env.GH_TOKEN ? `set (${String(env.GH_TOKEN).length} chars)` : "MISSING"}`);
  }
  console.log(`[runRead] start: ${label}`);
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd,
      encoding: "utf-8",
      timeout: timeoutMs,
      env,
    });
    console.log(`[runRead] done: ${label} (${stdout.length} bytes)`);
    return stdout.trim();
  } catch (e: unknown) {
    const err = e as { killed?: boolean; signal?: string; code?: unknown; message?: string; stderr?: string };
    console.error(`[runRead] failed: ${label}`, {
      killed: err.killed,
      signal: err.signal,
      code: err.code,
      message: err.message?.slice(0, 200),
      stderr: err.stderr?.slice(0, 500),
    });
    throw e;
  }
}

async function run(
  cwd: string | undefined,
  command: string,
  args: string[],
  timeoutMs = 15_000
): Promise<void> {
  await execFileAsync(command, args, {
    cwd,
    encoding: "utf-8",
    timeout: timeoutMs,
    env: await envForCommand(command)
  });
}

/**
 * Build the child-process environment for a command.
 * For `gh` commands, inject GH_TOKEN so the CLI skips the macOS Keychain
 * (broken on Tahoe 26.x for non-terminal processes).
 * Other commands get the standard shell env without the token.
 */
async function envForCommand(command: string): Promise<NodeJS.ProcessEnv> {
  if (command === "gh") {
    return getGhEnv();
  }
  return getShellEnv();
}

async function githubGet<T>(apiPath: string, options: GitHubApiOptions = {}): Promise<T> {
  return runGitHubRequest(async () => {
    const token = await getGhToken();
    if (!token) {
      throw new Error("GitHub token unavailable");
    }

    const timeoutMs = options.timeoutMs ?? 30_000;
    console.log(`[github] start ${options.method ?? "GET"} ${apiPath} timeout=${timeoutMs}`);
    try {
      const { statusCode, body } = await curlGitHub(apiPath, token, {
        method: options.method ?? "GET",
        body: options.body,
        timeoutMs,
      });

      if (statusCode < 200 || statusCode >= 300) {
        throw new Error(`GitHub API ${statusCode}: ${body}`);
      }

      console.log(`[github] done ${apiPath} status=${statusCode}`);
      return JSON.parse(body) as T;
    } catch (error) {
      console.error(`[github] failed ${apiPath}`, error);
      if (error instanceof Error && /timed out/i.test(error.message)) {
        throw new Error(`GitHub API request timed out for ${apiPath}`);
      }
      throw error;
    }
  });
}

async function githubGetPaginated<T>(apiPath: string, timeoutMs = 15_000): Promise<T extends Array<infer U> ? U[] : never> {
  return runGitHubRequest(async () => {
    const token = await getGhToken();
    if (!token) {
      throw new Error("GitHub token unavailable");
    }

    const rows: unknown[] = [];
    let nextPath: string | null = apiPath;
    const requestTimeoutMs = Math.max(timeoutMs, 30_000);

    while (nextPath) {
      console.log(`[github] start GET ${nextPath} timeout=${requestTimeoutMs}`);
      try {
        const { statusCode, body, headers } = await curlGitHub(nextPath, token, {
          method: "GET",
          timeoutMs: requestTimeoutMs,
        });

        if (statusCode < 200 || statusCode >= 300) {
          throw new Error(`GitHub API ${statusCode}: ${body}`);
        }

        const pageRows = JSON.parse(body) as unknown[];
        if (!Array.isArray(pageRows)) {
          throw new Error("Unexpected GitHub API pagination shape");
        }
        rows.push(...pageRows);
        nextPath = parseGitHubNextLink(headers.link ?? null);
      } catch (error) {
        console.error(`[github] failed ${nextPath}`, error);
        if (error instanceof Error && /timed out/i.test(error.message)) {
          throw new Error(`GitHub API request timed out for ${apiPath}`);
        }
        throw error;
      }
    }

    return rows as T extends Array<infer U> ? U[] : never;
  });
}

function runGitHubRequest<T>(task: () => Promise<T>): Promise<T> {
  const run = githubRequestQueue.then(task, task);
  githubRequestQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function curlGitHub(
  apiPath: string,
  token: string,
  options: GitHubApiOptions
): Promise<{ statusCode: number; body: string; headers: Record<string, string> }> {
  const url = apiPath.startsWith("http") ? apiPath : `https://api.github.com${apiPath}`;
  const timeoutSeconds = Math.max(1, Math.ceil((options.timeoutMs ?? 30_000) / 1000));
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "closedloop-gh-curl-"));
  const headersPath = path.join(tempDir, "headers.txt");

  try {
    const args = [
      "--silent",
      "--show-error",
      "--location",
      "--http1.1",
      "--dump-header", headersPath,
      "--request", options.method ?? "GET",
      "--connect-timeout", String(timeoutSeconds),
      "--max-time", String(timeoutSeconds),
      "--header", `Authorization: Bearer ${token}`,
      "--header", "Accept: application/vnd.github+json",
      "--header", "User-Agent: closedloop-desktop",
    ];

    if (options.body) {
      args.push("--header", "Content-Type: application/json", "--data", options.body);
    }

    args.push(url);

    const { stdout } = await execFileAsync("curl", args, {
      encoding: "utf-8",
      timeout: (options.timeoutMs ?? 30_000) + 2_000,
      env: await getShellEnv(),
      maxBuffer: 10 * 1024 * 1024,
    });

    const rawHeaders = await fs.readFile(headersPath, "utf-8");
    const { statusCode, headers } = parseCurlHeaders(rawHeaders);
    return { statusCode, body: stdout, headers };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function parseCurlHeaders(rawHeaders: string): { statusCode: number; headers: Record<string, string> } {
  const sections = rawHeaders
    .split(/\r?\n\r?\n/)
    .map((section) => section.trim())
    .filter(Boolean);
  const finalSection = sections.at(-1) ?? "";
  const lines = finalSection.split(/\r?\n/);
  const statusMatch = /^HTTP\/\d+(?:\.\d+)?\s+(\d+)/i.exec(lines[0] ?? "");
  const statusCode = statusMatch ? Number.parseInt(statusMatch[1], 10) : 0;
  const headers: Record<string, string> = {};

  for (const line of lines.slice(1)) {
    const idx = line.indexOf(":");
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    headers[key] = value;
  }

  return { statusCode, headers };
}

function parseGitHubNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }

  for (const part of linkHeader.split(",")) {
    const trimmed = part.trim();
    if (trimmed.endsWith('rel="next"')) {
      const match = /^<([^>]+)>/.exec(trimmed);
      if (match) {
        return match[1];
      }
    }
  }

  return null;
}

async function ghApiViaStdin(
  apiPath: string,
  payload: Record<string, unknown>,
  cwd: string
): Promise<{ stdout: string; stderr: string }> {
  const env = await envForCommand("gh");
  return new Promise((resolve, reject) => {
    const process = spawn("gh", ["api", apiPath, "--method", "POST", "--input", "-"], {
      cwd,
      env
    });

    let stdout = "";
    let stderr = "";

    process.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    process.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    process.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`gh api exited with code ${code}: ${stderr}`));
    });

    process.on("error", reject);

    process.stdin.write(JSON.stringify(payload));
    process.stdin.end();
  });
}

async function ghPrCommentViaStdin(
  args: string[],
  body: string,
  cwd: string
): Promise<{ stdout: string; stderr: string }> {
  const env = await envForCommand("gh");
  return new Promise((resolve, reject) => {
    const process = spawn("gh", [...args, "--body-file", "-"], {
      cwd,
      env
    });

    let stdout = "";
    let stderr = "";

    process.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    process.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    process.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`gh pr comment exited with code ${code}: ${stderr}`));
    });

    process.on("error", reject);

    process.stdin.write(body);
    process.stdin.end();
  });
}

function parseBody(context: OperationRequestContext): Record<string, unknown> | null {
  if (!context.body.trim()) {
    return {};
  }

  try {
    return JSON.parse(context.body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function json(context: OperationRequestContext, status: number, payload: unknown): void {
  context.response.statusCode = status;
  context.response.setHeader("content-type", "application/json");
  context.response.end(JSON.stringify(payload));
}
