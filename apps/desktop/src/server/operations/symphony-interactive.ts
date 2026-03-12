import { execFile, execSync, spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import fs from "node:fs/promises";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import type {
  OperationDispatcher,
  OperationRequestContext,
} from "../operation-dispatcher.js";
import { assertPathAllowed, DirectoryNotAllowedError } from "../security.js";
import { loadJsonFile, saveJsonFile } from "./chat-history-store.js";
import { ENGINEER_CHAT_TOOLS, withMcpTools } from "./chat-tools.js";
import { findPluginScript } from "./plugin-cache.js";
import {
  type ContentBlock,
  createStreamState,
  processStreamEvent,
} from "./stream-events.js";
import {
  acquireLaunchLock,
  assertRepoAllowed,
  chatHistoryFilename,
  cleanStaleLock,
  expandHome,
  getLockDir,
  isProcessRunning,
  readLaunchMetadata,
  readProcessPidSync,
  releaseLaunchLock,
  resolveWorktreeDir,
  resolveWorktreeParentDir,
  tryAssertPathAllowed,
  tryAssertRepoAllowed,
  VALID_PROVIDERS,
  writeLaunchMetadata,
} from "./symphony-utils.js";

const execFileAsync = promisify(execFile);
const COMMIT_JSON_REGEX = /\{[\s\S]*"title"[\s\S]*"description"[\s\S]*\}/;

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  blocks?: ContentBlock[];
  sender?: "claude" | "codex";
  responded?: boolean;
};

type TicketChatHistory = {
  messages: ChatMessage[];
  ticketId: string;
  repoPath: string;
  sessionId?: string;
  contextPercent?: number | null;
};

type CommentChatHistory = {
  messages: ChatMessage[];
  ticketId: string;
  repoPath: string;
  commentId: string;
  commentContext?: {
    author: string;
    body: string;
    path?: string;
    line?: number;
    url?: string;
    replies?: Array<{ author: string; body: string }>;
  };
  sessionId?: string;
  contextPercent?: number | null;
};

function assertAllReposAllowed(
  repoPaths: string[],
  allowedDirs: string[]
): { error: string; status: 403 } | null {
  for (const repoPath of repoPaths) {
    const result = tryAssertRepoAllowed(repoPath, allowedDirs);
    if ("error" in result) return result;
  }
  return null;
}

export function registerSymphonyInteractiveRoutes(
  dispatcher: OperationDispatcher,
  getAllowedDirectories: () => string[]
): void {
  dispatcher.register(
    "POST",
    "/api/engineer/symphony/chat/:ticketId",
    async (context) => {
      const ticketId = context.params.ticketId;
      const body = parseBody(context);

      if (!body) {
        json(context, 400, { error: "Invalid JSON body" });
        return;
      }

      const message = asString(body.message);
      const repoInput = asString(body.repoPath) ?? context.query.get("repo");
      const contextRepoPaths = Array.isArray(body.contextRepoPaths)
        ? body.contextRepoPaths.filter(
            (entry): entry is string => typeof entry === "string"
          )
        : [];

      if (!(message && repoInput)) {
        json(context, 400, { error: "message and repoPath are required" });
        return;
      }

      let expandedRepoPath: string;
      try {
        expandedRepoPath = assertRepoAllowed(
          repoInput,
          getAllowedDirectories()
        );
        for (const contextRepoPath of contextRepoPaths) {
          assertRepoAllowed(contextRepoPath, getAllowedDirectories());
        }
      } catch (error) {
        if (error instanceof DirectoryNotAllowedError) {
          json(context, 403, { error: "directory not allowed" });
          return;
        }
        throw error;
      }

      const defaultWorktreeDir = resolveWorktreeDir(expandedRepoPath, ticketId);
      const worktreeDir = existsSync(defaultWorktreeDir)
        ? defaultWorktreeDir
        : expandedRepoPath;

      try {
        assertPathAllowed(worktreeDir, getAllowedDirectories());
      } catch (error) {
        if (error instanceof DirectoryNotAllowedError) {
          json(context, 403, { error: "directory not allowed" });
          return;
        }
        throw error;
      }

      const provider = asString(body.provider);
      if (provider && !VALID_PROVIDERS.has(provider)) {
        json(context, 400, { error: "unsupported provider" });
        return;
      }
      const historyPath = path.join(
        worktreeDir,
        ".claude",
        "work",
        chatHistoryFilename(provider)
      );
      const history = await loadJsonFile<TicketChatHistory>(historyPath, {
        messages: [],
        ticketId,
        repoPath: repoInput,
      });

      history.messages.push({
        id: `user-${Date.now()}`,
        role: "user",
        content: message,
        timestamp: new Date().toISOString(),
      });
      await saveJsonFile(historyPath, history);

      setStreamingHeaders(context.response);
      await streamClaudeChat({
        response: context.response,
        cwd: worktreeDir,
        history,
        historyPath,
        prompt: buildSymphonyPrompt(message, contextRepoPaths),
        tools: withMcpTools(ENGINEER_CHAT_TOOLS),
      });
    }
  );

  dispatcher.register(
    "GET",
    "/api/engineer/symphony/comment-chat/:commentId",
    async (context) => {
      const commentId = context.params.commentId;
      const ticketId = context.query.get("ticketId");
      const repoPath = context.query.get("repo");

      if (!(ticketId && repoPath)) {
        json(context, 400, {
          error: "ticketId and repo parameters are required",
        });
        return;
      }

      let expandedRepoPath: string;
      try {
        expandedRepoPath = assertRepoAllowed(repoPath, getAllowedDirectories());
      } catch (error) {
        if (error instanceof DirectoryNotAllowedError) {
          json(context, 403, { error: "directory not allowed" });
          return;
        }
        throw error;
      }

      const historyPath = getCommentHistoryPath(
        ticketId,
        expandedRepoPath,
        commentId
      );
      const history = await loadJsonFile<CommentChatHistory>(historyPath, {
        messages: [],
        ticketId,
        repoPath,
        commentId,
      });

      json(context, 200, history);
    }
  );

  dispatcher.register(
    "POST",
    "/api/engineer/symphony/comment-chat/:commentId",
    async (context) => {
      const commentId = context.params.commentId;
      const ticketId = context.query.get("ticketId");
      const repoPath = context.query.get("repo");

      if (!(ticketId && repoPath)) {
        json(context, 400, {
          error: "ticketId and repo parameters are required",
        });
        return;
      }

      const body = parseBody(context);
      if (!body) {
        json(context, 400, { error: "Invalid JSON body" });
        return;
      }

      const message = asString(body.message);
      if (!message) {
        json(context, 400, { error: "message is required" });
        return;
      }

      const commentContext =
        body.commentContext && typeof body.commentContext === "object"
          ? (body.commentContext as CommentChatHistory["commentContext"])
          : undefined;

      let expandedRepoPath: string;
      try {
        expandedRepoPath = assertRepoAllowed(repoPath, getAllowedDirectories());
      } catch (error) {
        if (error instanceof DirectoryNotAllowedError) {
          json(context, 403, { error: "directory not allowed" });
          return;
        }
        throw error;
      }

      const worktreeDir = resolveWorktreeForComment(ticketId, expandedRepoPath);
      if (!existsSync(worktreeDir)) {
        json(context, 404, { error: "Work directory not found" });
        return;
      }

      const historyPath = getCommentHistoryPath(
        ticketId,
        expandedRepoPath,
        commentId
      );
      const history = await loadJsonFile<CommentChatHistory>(historyPath, {
        messages: [],
        ticketId,
        repoPath,
        commentId,
        ...(commentContext ? { commentContext } : {}),
      });

      if (commentContext) {
        history.commentContext = commentContext;
      }

      history.messages.push({
        id: `user-${Date.now()}`,
        role: "user",
        content: message,
        timestamp: new Date().toISOString(),
      });
      await saveJsonFile(historyPath, history);

      setStreamingHeaders(context.response);
      await streamClaudeChat({
        response: context.response,
        cwd: worktreeDir,
        history,
        historyPath,
        prompt: buildCommentPrompt(message, history.commentContext),
        tools: withMcpTools(ENGINEER_CHAT_TOOLS),
      });
    }
  );

  dispatcher.register(
    "PATCH",
    "/api/engineer/symphony/comment-chat/:commentId",
    async (context) => {
      const commentId = context.params.commentId;
      const ticketId = context.query.get("ticketId");
      const repoPath = context.query.get("repo");

      if (!(ticketId && repoPath)) {
        json(context, 400, {
          error: "ticketId and repo parameters are required",
        });
        return;
      }

      const body = parseBody(context);
      if (!body) {
        json(context, 400, { error: "Invalid JSON body" });
        return;
      }

      const messageId = asString(body.messageId);
      const responded =
        typeof body.responded === "boolean" ? body.responded : true;

      const repoResult = tryAssertRepoAllowed(
        repoPath,
        getAllowedDirectories()
      );
      if ("error" in repoResult) {
        json(context, repoResult.status, { error: repoResult.error });
        return;
      }

      const historyPath = getCommentHistoryPath(
        ticketId,
        repoResult.path,
        commentId
      );
      const history = await loadJsonFile<CommentChatHistory>(historyPath, {
        messages: [],
        ticketId,
        repoPath,
        commentId,
      });

      if (messageId) {
        const target = history.messages.find(
          (message) => message.id === messageId
        );
        if (target) {
          target.responded = responded;
        }
      } else {
        for (let index = history.messages.length - 1; index >= 0; index -= 1) {
          if (history.messages[index].role === "assistant") {
            history.messages[index].responded = responded;
            break;
          }
        }
      }

      await saveJsonFile(historyPath, history);
      json(context, 200, { success: true });
    }
  );

  dispatcher.register(
    "DELETE",
    "/api/engineer/symphony/comment-chat/:commentId",
    async (context) => {
      const commentId = context.params.commentId;
      const ticketId = context.query.get("ticketId");
      const repoPath = context.query.get("repo");

      if (!(ticketId && repoPath)) {
        json(context, 400, {
          error: "ticketId and repo parameters are required",
        });
        return;
      }

      let expandedRepoPath: string;
      try {
        expandedRepoPath = assertRepoAllowed(repoPath, getAllowedDirectories());
      } catch (error) {
        if (error instanceof DirectoryNotAllowedError) {
          json(context, 403, { error: "directory not allowed" });
          return;
        }
        throw error;
      }

      const historyPath = getCommentHistoryPath(
        ticketId,
        expandedRepoPath,
        commentId
      );
      await fs.rm(historyPath, { force: true });
      json(context, 200, { success: true });
    }
  );

  dispatcher.register(
    "GET",
    "/api/engineer/symphony/commit-message/:ticketId",
    async (context) => {
      const ticketId = context.params.ticketId;
      const repoPath = context.query.get("repo");

      if (!ticketId) {
        json(context, 400, { error: "ticketId is required" });
        return;
      }

      if (!repoPath) {
        json(context, 400, { error: "repo query parameter is required" });
        return;
      }

      let expandedRepoPath: string;
      try {
        expandedRepoPath = assertRepoAllowed(repoPath, getAllowedDirectories());
      } catch (error) {
        if (error instanceof DirectoryNotAllowedError) {
          json(context, 403, { error: "directory not allowed" });
          return;
        }
        throw error;
      }

      const worktreeDir = resolveWorktreeDir(expandedRepoPath, ticketId);
      if (!existsSync(worktreeDir)) {
        json(context, 200, {
          title: `Work on ${ticketId}`,
          description: "",
          source: "default",
        });
        return;
      }

      try {
        assertPathAllowed(worktreeDir, getAllowedDirectories());
      } catch (error) {
        if (error instanceof DirectoryNotAllowedError) {
          json(context, 403, { error: "directory not allowed" });
          return;
        }
        throw error;
      }

      const diff = getGitDiff(worktreeDir);
      if (!diff) {
        json(context, 200, {
          title: `Work on ${ticketId}`,
          description: "",
          source: "default",
        });
        return;
      }

      try {
        const generated = await generateCommitWithClaude(
          worktreeDir,
          ticketId,
          diff
        );
        json(context, 200, {
          ...generated,
          source: "claude",
        });
      } catch {
        json(context, 200, {
          title: `Work on ${ticketId}`,
          description: summarizeDiff(diff),
          source: "default",
        });
      }
    }
  );

  dispatcher.register(
    "POST",
    "/api/engineer/symphony/launch",
    async (context) => {
      const body = parseBody(context);
      if (!body) {
        json(context, 400, { error: "Invalid JSON body" });
        return;
      }

      const ticketIdentifier = asString(body.ticketIdentifier);
      const repoPath = asString(body.repoPath);
      const baseBranch = asString(body.baseBranch);
      const ticket =
        body.ticket && typeof body.ticket === "object"
          ? (body.ticket as Record<string, unknown>)
          : null;

      if (!ticketIdentifier) {
        json(context, 400, {
          error: "ticketIdentifier is required and must be a string",
        });
        return;
      }

      if (!repoPath) {
        json(context, 400, {
          error: "repoPath is required and must be a string",
        });
        return;
      }

      const repoResult = tryAssertRepoAllowed(
        repoPath,
        getAllowedDirectories()
      );
      if ("error" in repoResult) {
        json(context, repoResult.status, { error: repoResult.error });
        return;
      }
      const expandedRepoPath = repoResult.path;

      const contextRepoPaths = Array.isArray(ticket?.contextRepoPaths)
        ? ticket.contextRepoPaths.filter(
            (entry): entry is string => typeof entry === "string"
          )
        : [];
      const contextError = assertAllReposAllowed(
        contextRepoPaths,
        getAllowedDirectories()
      );
      if (contextError) {
        json(context, contextError.status, { error: contextError.error });
        return;
      }

      const branchName = sanitizeBranchName(ticketIdentifier);
      const worktreeDir = resolveWorktreeDir(
        expandedRepoPath,
        ticketIdentifier
      );

      const pathResult = tryAssertPathAllowed(
        path.dirname(worktreeDir),
        getAllowedDirectories()
      );
      if (pathResult !== true) {
        json(context, pathResult.status, { error: pathResult.error });
        return;
      }

      const repoName = path.basename(expandedRepoPath);
      const worktreeParentDir = resolveWorktreeParentDir(expandedRepoPath);
      const sanitizedTicket = ticketIdentifier.replaceAll(
        /[^a-zA-Z0-9-_]/g,
        "_"
      );
      const lockDir = getLockDir(worktreeParentDir, repoName, sanitizedTicket);

      // Fast path: if worktree exists and process is alive, return alreadyRunning
      if (existsSync(worktreeDir)) {
        const existingPid = readProcessPidSync(worktreeDir);
        if (existingPid !== null && isProcessRunning(existingPid)) {
          // Refresh PRD (harmless to running process)
          if (ticket) {
            const claudeWorkDir = path.join(worktreeDir, ".claude", "work");
            await fs.mkdir(claudeWorkDir, { recursive: true });
            await createPrdFile(claudeWorkDir, ticket, expandedRepoPath);
          }

          const meta = readLaunchMetadata(worktreeDir);
          const logFile = path.join(
            worktreeDir,
            ".claude",
            "work",
            "symphony-launch.log"
          );

          json(context, 200, {
            success: true,
            ticketId: ticketIdentifier,
            branchName,
            worktreePath: worktreeDir,
            pid: existingPid,
            logFile,
            prdFile: path.join(worktreeDir, ".claude", "work", "prd.md"),
            baseBranch: meta?.baseBranch,
            parentTicketId: meta?.parentTicketId,
            alreadyRunning: true,
          });
          return;
        }
      }

      // Clean stale locks before acquiring
      cleanStaleLock(lockDir);

      // Acquire atomic lock to prevent duplicate launches
      const lock = acquireLaunchLock(lockDir);
      if (!lock) {
        json(context, 409, { error: "Launch already in progress" });
        return;
      }

      try {
        let resolvedBaseBranch: string | undefined;

        if (!existsSync(worktreeDir)) {
          const result = await createWorktree(
            expandedRepoPath,
            worktreeDir,
            branchName,
            baseBranch
          );
          resolvedBaseBranch = result.resolvedBaseBranch;
        }

        const claudeWorkDir = path.join(worktreeDir, ".claude", "work");
        await fs.mkdir(claudeWorkDir, { recursive: true });

        if (ticket) {
          await createPrdFile(claudeWorkDir, ticket, expandedRepoPath);
        }

        // Write metadata BEFORE PID (ordering guarantee).
        // Merge preserves existing values when new ones are undefined.
        writeLaunchMetadata(worktreeDir, {
          baseBranch: resolvedBaseBranch ?? baseBranch ?? undefined,
          parentTicketId: undefined,
        });

        // Read back merged metadata so the response includes preserved values
        const mergedMeta = readLaunchMetadata(worktreeDir);

        const logFile = path.join(claudeWorkDir, "symphony-launch.log");
        const scriptPath = findPluginScript("code", "run-loop.sh");

        let pid: number | null = null;
        if (scriptPath) {
          const logFd = openSync(logFile, "a");
          const child = spawn(scriptPath, [claudeWorkDir], {
            cwd: worktreeDir,
            detached: true,
            stdio: ["ignore", logFd, logFd],
            env: {
              ...process.env,
              CLOSEDLOOP_WORKDIR: claudeWorkDir,
              PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`,
            },
          });
          child.unref();
          pid = child.pid ?? null;

          // Close parent's copy of the log fd — the child inherited it via spawn
          closeSync(logFd);
        }

        // Write PID AFTER metadata
        if (pid) {
          await fs.writeFile(
            path.join(claudeWorkDir, "process.pid"),
            String(pid)
          );
        }

        json(context, 200, {
          success: true,
          ticketId: ticketIdentifier,
          branchName,
          worktreePath: worktreeDir,
          pid,
          logFile,
          prdFile: path.join(claudeWorkDir, "prd.md"),
          baseBranch: mergedMeta?.baseBranch,
          parentTicketId: mergedMeta?.parentTicketId,
        });
      } catch (error) {
        json(context, 500, {
          error: `Failed to launch Symphony: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      } finally {
        releaseLaunchLock(lockDir, lock.fd);
      }
    }
  );
}

async function streamClaudeChat(options: {
  response: ServerResponse;
  cwd: string;
  history: TicketChatHistory | CommentChatHistory;
  historyPath: string;
  prompt: string;
  tools: string;
}): Promise<void> {
  const { response, cwd, history, historyPath, prompt, tools } = options;

  const streamState = createStreamState(async (sessionId) => {
    history.sessionId = sessionId;
    await saveJsonFile(historyPath, history);
  });

  try {
    const child = spawn(
      "claude",
      [
        "-p",
        "--verbose",
        "--output-format",
        "stream-json",
        "--allowedTools",
        tools,
        ...(history.sessionId ? ["--resume", history.sessionId] : []),
      ],
      {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`,
        },
      }
    );

    if (!child.pid) {
      throw new Error("failed to spawn claude process");
    }

    writeEvent(response, {
      type: "status",
      status: "running",
      pid: child.pid,
    });

    child.stdout.setEncoding("utf-8");
    let buffer = "";
    child.stdout.on("data", (chunk: string | Buffer) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          processStreamEvent(event as never, streamState, (msg) =>
            response.write(`${msg}\n`)
          );
        } catch {
          // Ignore malformed stream lines.
        }
      }
    });

    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (chunk: string | Buffer) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      writeEvent(response, { type: "error", error: text });
    });

    child.stdin.write(prompt);
    child.stdin.end();

    const exitCode = await waitForExit(child);

    if (streamState.assistantContent.trim()) {
      history.messages.push({
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: streamState.assistantContent.trim(),
        timestamp: new Date().toISOString(),
        blocks: streamState.assistantBlocks,
      });
    }
    history.contextPercent = streamState.contextPercent;
    await saveJsonFile(historyPath, history);

    writeEvent(response, { type: "result", success: exitCode === 0 });
    writeEvent(response, { type: "done" });
    response.end();
  } catch (error) {
    writeEvent(response, {
      type: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    writeEvent(response, { type: "done" });
    response.end();
  }
}

async function waitForExit(child: ReturnType<typeof spawn>): Promise<number> {
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

function buildSymphonyPrompt(
  message: string,
  contextRepoPaths: string[]
): string {
  if (contextRepoPaths.length === 0) {
    return message;
  }

  return [
    "Additional context repositories are available:",
    ...contextRepoPaths.map((repoPath) => `- ${expandHome(repoPath)}`),
    "",
    message,
  ].join("\n");
}

function buildCommentPrompt(
  message: string,
  commentContext?: CommentChatHistory["commentContext"]
): string {
  if (!commentContext) {
    return message;
  }

  const parts = [
    `PR comment from @${commentContext.author}:`,
    commentContext.body,
    "",
    message,
  ];

  if (commentContext.path) {
    parts.unshift(
      "File: " +
        commentContext.path +
        (commentContext.line ? ":" + commentContext.line : "")
    );
  }

  return parts.join("\n");
}

function getCommentHistoryPath(
  ticketId: string,
  expandedRepoPath: string,
  commentId: string
): string {
  const worktreeDir = resolveWorktreeForComment(ticketId, expandedRepoPath);
  const sanitizedComment = commentId.replaceAll(/[^a-zA-Z0-9-_]/g, "_");

  return path.join(
    worktreeDir,
    ".claude",
    "work",
    "comment-chats",
    `${sanitizedComment}.json`
  );
}

function resolveWorktreeForComment(
  ticketId: string,
  expandedRepoPath: string
): string {
  const candidate = resolveWorktreeDir(expandedRepoPath, ticketId);
  if (existsSync(candidate)) {
    return candidate;
  }
  return expandedRepoPath;
}

function sanitizeCommitMessage(text: string): string {
  return text
    .replaceAll(/claude\s*code/gi, "")
    .replaceAll(/\bopus\b/gi, "")
    .replaceAll(/\bclaude\b/gi, "")
    .replaceAll(/\bsonnet\b/gi, "")
    .replaceAll(/\bhaiku\b/gi, "")
    .replaceAll(/\banthropic\b/gi, "")
    .replaceAll(/AI\s*assistant/gi, "")
    .replaceAll(/[ \t]{2,}/g, " ")
    .trim();
}

function getGitDiff(worktreeDir: string): string {
  try {
    const diff = execSync(
      "git diff HEAD --stat && echo '---' && git diff HEAD",
      {
        cwd: worktreeDir,
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
        timeout: 10_000,
      }
    );

    if (diff.length > 15_000) {
      return `${diff.slice(0, 15_000)}\n\n[diff truncated...]`;
    }

    return diff;
  } catch {
    return "";
  }
}

async function generateCommitWithClaude(
  worktreeDir: string,
  ticketId: string,
  diff: string
): Promise<{ title: string; description: string }> {
  const prompt = [
    `Generate a git commit message for ticket ${ticketId}.`,
    "",
    "Here is the diff of all changes:",
    "```diff",
    diff,
    "```",
    "",
    "Return ONLY a JSON object with this exact format:",
    '{"title": "Short title under 72 chars", "description": "Bullet points of what changed"}',
    "",
    "Do NOT include AI or assistant references.",
  ].join("\n");

  const { stdout } = await execFileAsync(
    "claude",
    ["--model", "haiku", "-p", prompt],
    {
      cwd: worktreeDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`,
      },
      timeout: 30_000,
    }
  );

  const match = COMMIT_JSON_REGEX.exec(stdout);
  if (match?.[0]) {
    const parsed = JSON.parse(match[0]) as {
      title?: string;
      description?: string;
    };
    return {
      title: sanitizeCommitMessage(parsed.title ?? `Work on ${ticketId}`),
      description: sanitizeCommitMessage(parsed.description ?? ""),
    };
  }

  return {
    title: `Work on ${ticketId}`,
    description: sanitizeCommitMessage(stdout.trim().slice(0, 500)),
  };
}

function summarizeDiff(diff: string): string {
  const statSection = diff.split("---")[0]?.trim() ?? "";
  return sanitizeCommitMessage(statSection);
}

function sanitizeBranchName(ticketId: string): string {
  const normalized = ticketId.replaceAll(/[^a-zA-Z0-9-_]/g, "-");
  return `feature/${normalized}`;
}

async function createWorktree(
  expandedRepoPath: string,
  worktreeDir: string,
  branchName: string,
  baseBranch?: string | null
): Promise<{ resolvedBaseBranch: string }> {
  await fs.mkdir(path.dirname(worktreeDir), { recursive: true });

  try {
    execSync("git fetch origin", {
      cwd: expandedRepoPath,
      stdio: "pipe",
    });
  } catch {
    // non-fatal
  }

  const resolvedBaseRef = resolveBaseRef(expandedRepoPath, baseBranch);
  execSync(
    `git worktree add -B ${shellEscapeArg(branchName)} ${shellEscapeArg(worktreeDir)} ${shellEscapeArg(resolvedBaseRef)}`,
    {
      cwd: expandedRepoPath,
      stdio: "pipe",
    }
  );

  return { resolvedBaseBranch: resolvedBaseRef };
}

function resolveBaseRef(
  expandedRepoPath: string,
  baseBranch?: string | null
): string {
  if (baseBranch) {
    const candidate = baseBranch.trim();
    if (/^[a-zA-Z0-9/_.-]+$/.test(candidate)) {
      try {
        execSync(`git rev-parse --verify ${shellEscapeArg(candidate)}`, {
          cwd: expandedRepoPath,
          stdio: "pipe",
        });
        return candidate;
      } catch {
        try {
          const originRef = `origin/${candidate}`;
          execSync(`git rev-parse --verify ${shellEscapeArg(originRef)}`, {
            cwd: expandedRepoPath,
            stdio: "pipe",
          });
          return originRef;
        } catch {
          // continue to default
        }
      }
    }
  }

  try {
    const ref = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      cwd: expandedRepoPath,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
    return ref.replace("refs/remotes/", "");
  } catch {
    return "HEAD";
  }
}

function shellEscapeArg(value: string): string {
  return "'" + value.replaceAll("'", String.raw`'\''`) + "'";
}

async function createPrdFile(
  claudeWorkDir: string,
  ticket: Record<string, unknown>,
  primaryRepoPath: string
): Promise<void> {
  const title = asString(ticket.title) ?? "Untitled Ticket";
  const identifier = asString(ticket.identifier) ?? "UNKNOWN";
  const url = asString(ticket.url) ?? "";
  const description = asString(ticket.description) ?? "";
  const additionalContext = asString(ticket.additionalContext);

  const contextRepoPaths = Array.isArray(ticket.contextRepoPaths)
    ? ticket.contextRepoPaths.filter(
        (entry): entry is string => typeof entry === "string"
      )
    : [];

  const primaryRepoName = path.basename(primaryRepoPath);
  const mentionedFiles = Array.isArray(ticket.mentionedFiles)
    ? (ticket.mentionedFiles.filter(
        (entry): entry is { repoPath: string; filePath: string } => {
          if (!(entry && typeof entry === "object")) {
            return false;
          }
          const raw = entry as Record<string, unknown>;
          return (
            typeof raw.repoPath === "string" && typeof raw.filePath === "string"
          );
        }
      ) as Array<{ repoPath: string; filePath: string }>)
    : [];

  const referencedFiles = mentionedFiles.map((file) => {
    const repoName = path.basename(expandHome(file.repoPath));
    if (repoName === primaryRepoName) {
      return path.join(path.dirname(claudeWorkDir), file.filePath);
    }

    return path.join(expandHome(file.repoPath), file.filePath);
  });

  const prdContent = [
    `# ${title}`,
    "",
    `**Ticket:** [${identifier}](${url})`,
    "",
    "## Description",
    "",
    description,
    additionalContext
      ? `\n## Additional Instructions\n\n${additionalContext}`
      : "",
    contextRepoPaths.length > 0
      ? "\n## Context Repositories\n\n" +
        contextRepoPaths
          .map((repoPath) => "- `" + expandHome(repoPath) + "`")
          .join("\n")
      : "",
    referencedFiles.length > 0
      ? "\n## Referenced Files\n\n" +
        referencedFiles.map((file) => "- `" + file + "`").join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "prd.md"), prdContent, "utf-8");
}

function setStreamingHeaders(response: ServerResponse): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
}

function writeEvent(
  response: ServerResponse,
  payload: Record<string, unknown>
): void {
  response.write(`${JSON.stringify(payload)}\n`);
}

function parseBody(
  context: OperationRequestContext
): Record<string, unknown> | null {
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

function json(
  context: OperationRequestContext,
  status: number,
  payload: unknown
): void {
  context.response.statusCode = status;
  context.response.setHeader("content-type", "application/json");
  context.response.end(JSON.stringify(payload));
}
