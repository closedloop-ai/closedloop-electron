import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { ServerResponse } from "node:http";
import type { OperationDispatcher, OperationRequestContext } from "../operation-dispatcher.js";
import { DirectoryNotAllowedError, assertPathAllowed } from "../security.js";
import { ENGINEER_CHAT_TOOLS, withMcpTools } from "./chat-tools.js";
import { loadJsonFile, saveJsonFile } from "./chat-history-store.js";
import { createStreamState, processStreamEvent, type ContentBlock } from "./stream-events.js";
import { assertRepoAllowed, resolveWorktreeDir } from "./symphony-utils.js";

const CODEX_SESSION_ID_REGEX = /session id:\s*([0-9a-f-]{36})/i;
const FINDINGS_CODE_BLOCK_REGEX = /```json\s*\n([\s\S]*?)\n\s*```/;
const FINDINGS_ARRAY_REGEX = /\[[\s\S]*\]/;

type ReviewState = {
  status: "running" | "completed" | "failed" | "stopped";
  pid?: number;
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
  provider: "claude" | "codex";
  sessionId?: string;
  config: {
    model: string;
    reasoningEffort: string;
    reviewMode: "uncommitted" | "base";
    baseBranch: string;
    instructions?: string;
  };
};

type PersistedFinding = {
  severity: string;
  priority?: string;
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
  commented: boolean;
};

type FindingsFile = {
  provider: string;
  model: string;
  findings: PersistedFinding[];
};

type CodexChatState = {
  sessionId?: string;
  messageCount: number;
};

type FindingChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  blocks?: ContentBlock[];
  responded?: boolean;
};

type FindingChatHistory = {
  messages: FindingChatMessage[];
  ticketId: string;
  repoPath: string;
  findingId: string;
  findingContext?: {
    severity: string;
    priority?: string;
    file?: string;
    line?: number;
    message: string;
    suggestion?: string;
  };
  sessionId?: string;
  contextPercent?: number | null;
};

export function registerCodexRoutes(
  dispatcher: OperationDispatcher,
  getAllowedDirectories: () => string[]
): void {
  dispatcher.register("GET", "/api/engineer/codex/available", async (context) => {
    try {
      const output = await runCommand("codex", ["--version"]);
      const match = /codex-cli\s+([\d.]+)/i.exec(output);
      json(context, 200, {
        available: true,
        version: match?.[1] ?? "unknown"
      });
    } catch {
      json(context, 200, { available: false });
    }
  });

  dispatcher.register("GET", "/api/engineer/codex/status/:ticketId", async (context) => {
    const ticketId = context.params.ticketId;
    const repoPath = context.query.get("repo");
    const requestedProvider = context.query.get("provider");

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
        hasReview: false,
        worktreeDir,
        message: "Worktree not found"
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

    const workDir = path.join(worktreeDir, ".claude", "work");
    const provider =
      requestedProvider && (requestedProvider === "claude" || requestedProvider === "codex")
        ? requestedProvider
        : resolveProvider(workDir);

    if (!provider) {
      json(context, 200, {
        hasReview: false,
        worktreeDir,
        message: "No review has been started"
      });
      return;
    }

    const { statePath, logPath } = getReviewPaths(worktreeDir, provider);
    if (!existsSync(statePath)) {
      json(context, 200, {
        hasReview: false,
        worktreeDir,
        message: "No review has been started"
      });
      return;
    }

    try {
      const state = JSON.parse(await fs.readFile(statePath, "utf-8")) as ReviewState;
      let processRunning = false;
      if (state.status === "running" && state.pid) {
        processRunning = isProcessRunning(state.pid);
        if (!processRunning) {
          state.status = "stopped";
        }
      }

      let log = "";
      let logSize = 0;
      if (existsSync(logPath)) {
        const logStats = await fs.stat(logPath);
        logSize = logStats.size;
        if (logSize > 100 * 1024) {
          const content = await fs.readFile(logPath, "utf-8");
          log = content.slice(-100 * 1024);
        } else {
          log = await fs.readFile(logPath, "utf-8");
        }
      }

      json(context, 200, {
        hasReview: true,
        worktreeDir,
        status: state.status,
        processRunning,
        pid: state.pid,
        provider: state.provider,
        startedAt: state.startedAt,
        completedAt: state.completedAt,
        exitCode: state.exitCode,
        config: state.config,
        log,
        logSize
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      json(context, 500, { error: `Failed to read status: ${message}` });
    }
  });

  dispatcher.register("DELETE", "/api/engineer/codex/status/:ticketId", async (context) => {
    const ticketId = context.params.ticketId;
    const repoPath = context.query.get("repo");
    const provider = context.query.get("provider");

    if (!(ticketId && repoPath)) {
      json(context, 400, { error: "ticketId and repo are required" });
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
    const providers = provider ? [provider] : ["claude", "codex"];

    await Promise.all(
      providers.flatMap((name) => {
        const { statePath, logPath, pidPath, findingsPath } = getReviewPaths(worktreeDir, name);
        return [statePath, logPath, pidPath, findingsPath].map(async (targetPath) => {
          await fs.rm(targetPath, { force: true });
        });
      })
    );

    json(context, 200, { success: true });
  });

  dispatcher.register("POST", "/api/engineer/codex/stop/:ticketId", async (context) => {
    const ticketId = context.params.ticketId;
    const body = parseBody(context);
    if (!body) {
      json(context, 400, { error: "Invalid JSON body" });
      return;
    }

    const repoPath = asString(body.repo);
    const provider = asProvider(body.provider) ?? "codex";

    if (!ticketId) {
      json(context, 400, { error: "ticketId is required" });
      return;
    }
    if (!repoPath) {
      json(context, 400, { error: "repo is required in body" });
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
    const { statePath } = getReviewPaths(worktreeDir, provider);

    if (!existsSync(statePath)) {
      json(context, 404, { error: "No review found" });
      return;
    }

    try {
      const state = JSON.parse(await fs.readFile(statePath, "utf-8")) as ReviewState;
      if (state.status !== "running") {
        json(context, 200, {
          stopped: false,
          message: `Review is not running (status: ${state.status})`
        });
        return;
      }

      if (!state.pid) {
        json(context, 400, { error: "No PID found for review" });
        return;
      }

      try {
        process.kill(state.pid, "SIGTERM");
      } catch {
        // Process may have already exited.
      }

      const updatedState: ReviewState = {
        ...state,
        status: "stopped",
        completedAt: new Date().toISOString()
      };
      await fs.writeFile(statePath, JSON.stringify(updatedState, null, 2), "utf-8");

      json(context, 200, { stopped: true, pid: state.pid });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      json(context, 500, { error: `Failed to stop review: ${message}` });
    }
  });

  dispatcher.register("DELETE", "/api/engineer/codex/stop/:ticketId", async (context) => {
    const ticketId = context.params.ticketId;
    const repoPath = context.query.get("repo");
    const provider = context.query.get("provider");

    if (!repoPath) {
      json(context, 400, { error: "repo query param is required" });
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

    const providers = provider ? [provider] : ["claude", "codex"];
    const deleted: string[] = [];

    for (const name of providers) {
      const worktreeDir = resolveWorktreeDir(expandedRepoPath, ticketId);
      const { statePath, logPath, pidPath, findingsPath } = getReviewPaths(worktreeDir, name);

      if (existsSync(statePath)) {
        try {
          const state = JSON.parse(await fs.readFile(statePath, "utf-8")) as ReviewState;
          if (state.status === "running" && state.pid) {
            try {
              process.kill(state.pid, "SIGTERM");
            } catch {
              // Process already dead.
            }
          }
        } catch {
          // Ignore corrupted state.
        }
      }

      for (const targetPath of [statePath, logPath, pidPath, findingsPath]) {
        if (!existsSync(targetPath)) {
          continue;
        }
        await fs.rm(targetPath, { force: true });
        deleted.push(path.basename(targetPath));
      }
    }

    json(context, 200, { deleted });
  });

  dispatcher.register("GET", "/api/engineer/codex/review-findings/:ticketId", async (context) => {
    const ticketId = context.params.ticketId;
    const repoPath = context.query.get("repo");
    const provider = context.query.get("provider") ?? "codex";

    if (!(ticketId && repoPath)) {
      json(context, 400, { error: "ticketId and repo are required" });
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

    const findingsPath = getReviewPaths(resolveWorktreeDir(expandedRepoPath, ticketId), provider).findingsPath;
    if (!existsSync(findingsPath)) {
      json(context, 200, { findings: [] });
      return;
    }

    try {
      const content = await fs.readFile(findingsPath, "utf-8");
      json(context, 200, JSON.parse(content));
    } catch {
      json(context, 200, { findings: [] });
    }
  });

  dispatcher.register("POST", "/api/engineer/codex/review-findings/:ticketId", async (context) => {
    const ticketId = context.params.ticketId;
    const repoPath = context.query.get("repo");
    const provider = context.query.get("provider") ?? "codex";
    const body = parseBody(context);

    if (!(ticketId && repoPath)) {
      json(context, 400, { error: "ticketId and repo are required" });
      return;
    }
    if (!body) {
      json(context, 400, { error: "Invalid JSON body" });
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

    const findingsPath = getReviewPaths(resolveWorktreeDir(expandedRepoPath, ticketId), provider).findingsPath;

    if (typeof body.commentedIndex === "number") {
      if (!existsSync(findingsPath)) {
        json(context, 404, { error: "No findings file found" });
        return;
      }

      try {
        const data = JSON.parse(await fs.readFile(findingsPath, "utf-8")) as FindingsFile;
        if (body.commentedIndex < 0 || body.commentedIndex >= data.findings.length) {
          json(context, 400, { error: "Index out of range" });
          return;
        }

        data.findings[body.commentedIndex].commented = true;
        await fs.writeFile(findingsPath, JSON.stringify(data, null, 2), "utf-8");
        json(context, 200, { success: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        json(context, 500, { error: `Failed to update findings: ${message}` });
      }
      return;
    }

    if (!Array.isArray(body.findings)) {
      json(context, 400, { error: "Invalid request body" });
      return;
    }

    const findings = (body.findings as Array<Record<string, unknown>>).map((finding) => ({
      severity: asString(finding.severity) ?? "info",
      priority: asString(finding.priority) ?? undefined,
      file: asString(finding.file) ?? undefined,
      line: asNumber(finding.line) ?? undefined,
      message: asString(finding.message) ?? "",
      suggestion: asString(finding.suggestion) ?? undefined,
      commented: Boolean(finding.commented)
    }));

    const data: FindingsFile = {
      provider: asString(body.provider) ?? provider,
      model: asString(body.model) ?? "unknown",
      findings
    };

    await fs.mkdir(path.dirname(findingsPath), { recursive: true });
    await fs.writeFile(findingsPath, JSON.stringify(data, null, 2), "utf-8");

    json(context, 200, {
      success: true,
      count: findings.length
    });
  });

  dispatcher.register("POST", "/api/engineer/codex/review-dedup/:ticketId", async (context) => {
    const body = parseBody(context);
    if (!body) {
      json(context, 400, { error: "Invalid or empty JSON body" });
      return;
    }

    const repoPath = asString(body.repoPath);
    const providerA = asString(body.providerA);
    const providerB = asString(body.providerB);
    const findingsA = Array.isArray(body.findingsA) ? body.findingsA : [];
    const findingsB = Array.isArray(body.findingsB) ? body.findingsB : [];

    if (!(repoPath && providerA && providerB)) {
      json(context, 400, {
        error: "repoPath, providerA, and providerB are required"
      });
      return;
    }

    try {
      assertRepoAllowed(repoPath, getAllowedDirectories());
    } catch (error) {
      if (error instanceof DirectoryNotAllowedError) {
        json(context, 403, { error: "directory not allowed" });
        return;
      }
      throw error;
    }

    if (findingsA.length === 0 || findingsB.length === 0) {
      json(context, 200, { duplicates: [] });
      return;
    }

    const duplicates = findDuplicatePairs(
      findingsA as Array<Record<string, unknown>>,
      findingsB as Array<Record<string, unknown>>
    );
    json(context, 200, { duplicates });
  });

  dispatcher.register("POST", "/api/engineer/codex/review-extract/:ticketId", async (context) => {
    const ticketId = context.params.ticketId;
    const body = parseBody(context);
    if (!body) {
      json(context, 400, { error: "Invalid or empty JSON body" });
      return;
    }

    const repoPath = asString(body.repoPath);
    const sessionId = asString(body.sessionId);

    if (!(repoPath && sessionId)) {
      json(context, 400, { error: "repoPath and sessionId are required" });
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
    const workDir = path.join(worktreeDir, ".claude", "work");

    let raw = "";
    for (const fileName of ["codex-review-claude.log", "codex-review-codex.log"]) {
      const candidate = path.join(workDir, fileName);
      if (!existsSync(candidate)) {
        continue;
      }
      raw = await fs.readFile(candidate, "utf-8");
      if (raw.trim()) {
        break;
      }
    }

    const findings = parseFindingsFromText(raw);
    json(context, 200, { findings });
  });

  dispatcher.register("POST", "/api/engineer/codex/review/:ticketId", async (context) => {
    const ticketId = context.params.ticketId;
    const body = parseBody(context);

    if (!body) {
      json(context, 400, { error: "Invalid JSON body" });
      return;
    }

    const repoPath = asString(body.repoPath);
    const model = asString(body.model) ?? "gpt-5.3-codex";
    const reasoningEffort = asString(body.reasoningEffort) ?? "medium";
    const reviewMode = body.reviewMode === "uncommitted" ? "uncommitted" : "base";
    const baseBranch = asString(body.baseBranch) ?? "main";
    const instructions = asString(body.instructions) ?? undefined;
    const provider = asProvider(body.provider) ?? "codex";

    if (!repoPath) {
      json(context, 400, { error: "repoPath is required" });
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

    const defaultWorktreeDir = resolveWorktreeDir(expandedRepoPath, ticketId);
    const worktreeDir = existsSync(defaultWorktreeDir) ? defaultWorktreeDir : expandedRepoPath;

    try {
      assertPathAllowed(worktreeDir, getAllowedDirectories());
    } catch (error) {
      if (error instanceof DirectoryNotAllowedError) {
        json(context, 403, { error: "directory not allowed" });
        return;
      }
      throw error;
    }

    const { statePath, logPath, pidPath } = getReviewPaths(worktreeDir, provider);
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(logPath, "", "utf-8");

    setStreamingHeaders(context.response);

    try {
      const child = spawnReviewProcess(provider, {
        worktreeDir,
        model,
        reasoningEffort,
        reviewMode,
        baseBranch,
        instructions
      });

      if (!child.pid) {
        throw new Error("failed to start review process");
      }

      const state: ReviewState = {
        status: "running",
        pid: child.pid,
        startedAt: new Date().toISOString(),
        provider,
        config: {
          model,
          reasoningEffort,
          reviewMode,
          baseBranch,
          ...(instructions ? { instructions } : {})
        }
      };

      await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
      await fs.writeFile(pidPath, String(child.pid), "utf-8");

      writeEvent(context.response, {
        type: "status",
        status: "running",
        pid: child.pid,
        provider
      });

      const sessionIdHolder: { value: string | undefined } = { value: undefined };

      if (provider === "claude") {
        await streamClaudeReview(child, context.response, logPath, sessionIdHolder);
      } else {
        await streamCodexReview(child, context.response, logPath, sessionIdHolder);
      }

      const exitCode = await waitForExit(child);
      const finalState: ReviewState = {
        ...state,
        status: exitCode === 0 ? "completed" : "failed",
        completedAt: new Date().toISOString(),
        exitCode,
        ...(sessionIdHolder.value ? { sessionId: sessionIdHolder.value } : {})
      };
      await fs.writeFile(statePath, JSON.stringify(finalState, null, 2), "utf-8");
      await fs.rm(pidPath, { force: true });

      if (sessionIdHolder.value && provider === "codex") {
        const chatStatePath = path.join(worktreeDir, ".claude", "work", "codex-chat.json");
        await saveJsonFile(chatStatePath, {
          sessionId: sessionIdHolder.value,
          messageCount: 0
        } satisfies CodexChatState);
      }

      writeEvent(context.response, { type: "result", success: exitCode === 0 });
      writeEvent(context.response, { type: "done" });
      context.response.end();
    } catch (error) {
      writeEvent(context.response, {
        type: "error",
        error: error instanceof Error ? error.message : "Unknown error"
      });
      writeEvent(context.response, { type: "done" });
      context.response.end();
    }
  });

  dispatcher.register("POST", "/api/engineer/codex/argue/:ticketId", async (context) => {
    const ticketId = context.params.ticketId;
    const repoQuery = context.query.get("repo");
    const body = parseBody(context);
    if (!body) {
      json(context, 400, { error: "Invalid JSON body" });
      return;
    }

    const repoPath = repoQuery ?? asString(body.repoPath);
    const claudeArgument = asString(body.claudeArgument);
    const findingSummary = asString(body.findingSummary);
    const model = asString(body.model) ?? "gpt-5.3-codex";

    if (!repoPath) {
      json(context, 400, { error: "repo parameter is required" });
      return;
    }

    if (!(claudeArgument && findingSummary)) {
      json(context, 400, {
        error: "claudeArgument and findingSummary are required"
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

    const worktreeDir = resolveWorktreeDir(expandedRepoPath, ticketId);
    if (!existsSync(worktreeDir)) {
      json(context, 404, { error: "Work directory not found" });
      return;
    }

    const debateStatePath = path.join(worktreeDir, ".claude", "work", "codex-debate.json");
    const debateState = await loadJsonFile<{ sessionId?: string; rounds: number }>(debateStatePath, {
      rounds: 0
    });

    const prompt = [
      "You are OpenAI Codex in a structured debate with Claude about a review finding.",
      "Focus on concrete code evidence and keep your response concise.",
      "Finding:",
      findingSummary,
      "Claude's argument:",
      claudeArgument
    ].join("\n\n");

    setStreamingHeaders(context.response);

    const args = debateState.sessionId
      ? ["exec", "resume", debateState.sessionId, prompt, "--full-auto", "--json", "-m", model]
      : ["exec", "--full-auto", "--json", "-m", model, prompt];

    await streamCodexConversation(
      context.response,
      worktreeDir,
      args,
      async (sessionId) => {
        debateState.sessionId = sessionId;
        debateState.rounds += 1;
        await saveJsonFile(debateStatePath, debateState);
      }
    );
  });

  dispatcher.register("POST", "/api/engineer/codex/chat/:ticketId", async (context) => {
    const ticketId = context.params.ticketId;
    const body = parseBody(context);
    if (!body) {
      json(context, 400, { error: "Invalid JSON body" });
      return;
    }

    const prompt = asString(body.prompt);
    const repoPath = asString(body.repoPath);
    const model = asString(body.model) ?? "gpt-5.3-codex";

    if (!(prompt && repoPath)) {
      json(context, 400, { error: "prompt and repoPath are required" });
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

    const defaultWorktreeDir = resolveWorktreeDir(expandedRepoPath, ticketId);
    const worktreeDir = existsSync(defaultWorktreeDir) ? defaultWorktreeDir : expandedRepoPath;

    const statePath = path.join(worktreeDir, ".claude", "work", "codex-chat.json");
    const chatState = await loadJsonFile<CodexChatState>(statePath, { messageCount: 0 });

    const args = chatState.sessionId
      ? ["exec", "resume", chatState.sessionId, prompt, "--full-auto", "--json", "-m", model]
      : ["exec", "--full-auto", "--json", "-m", model, prompt];

    setStreamingHeaders(context.response);

    await streamCodexConversation(
      context.response,
      worktreeDir,
      args,
      async (sessionId) => {
        chatState.sessionId = sessionId;
        chatState.messageCount += 1;
        await saveJsonFile(statePath, chatState);
      }
    );
  });

  dispatcher.register("GET", "/api/engineer/codex/finding-chat/:findingId", async (context) => {
    const findingId = context.params.findingId;
    const ticketId = context.query.get("ticketId");
    const repoPath = context.query.get("repo");

    if (!(ticketId && repoPath)) {
      json(context, 400, { error: "ticketId and repo parameters are required" });
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

    const historyPath = getFindingHistoryPath(ticketId, expandedRepoPath, findingId);
    const history = await loadJsonFile<FindingChatHistory>(historyPath, {
      messages: [],
      ticketId,
      repoPath,
      findingId
    });

    json(context, 200, history);
  });

  dispatcher.register("POST", "/api/engineer/codex/finding-chat/:findingId", async (context) => {
    const findingId = context.params.findingId;
    const ticketId = context.query.get("ticketId");
    const repoPath = context.query.get("repo");

    if (!(ticketId && repoPath)) {
      json(context, 400, { error: "ticketId and repo parameters are required" });
      return;
    }

    const body = parseBody(context);
    if (!body) {
      json(context, 400, { error: "Invalid JSON body" });
      return;
    }

    const message = asString(body.message);
    const displayMessage = asString(body.displayMessage);
    const findingContext =
      body.findingContext && typeof body.findingContext === "object"
        ? (body.findingContext as FindingChatHistory["findingContext"])
        : undefined;

    if (!message) {
      json(context, 400, { error: "message is required" });
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
      json(context, 404, { error: "Work directory not found" });
      return;
    }

    const historyPath = getFindingHistoryPath(ticketId, expandedRepoPath, findingId);
    const history = await loadJsonFile<FindingChatHistory>(historyPath, {
      messages: [],
      ticketId,
      repoPath,
      findingId,
      ...(findingContext ? { findingContext } : {})
    });

    if (findingContext) {
      history.findingContext = findingContext;
    }

    const userMessage: FindingChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: displayMessage ?? message,
      timestamp: new Date().toISOString()
    };

    history.messages.push(userMessage);
    await saveJsonFile(historyPath, history);

    setStreamingHeaders(context.response);

    const streamState = createStreamState(async (sessionId) => {
      history.sessionId = sessionId;
      await saveJsonFile(historyPath, history);
    });

    const prompt = buildFindingPrompt(history.findingContext, message, history.messages);

    const args = [
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--allowedTools",
      withMcpTools(ENGINEER_CHAT_TOOLS),
      ...(history.sessionId ? ["--resume", history.sessionId] : [])
    ];

    try {
      const child = spawn("claude", args, {
        cwd: worktreeDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`
        }
      });

      if (!child.pid) {
        throw new Error("failed to spawn claude process");
      }

      writeEvent(context.response, {
        type: "status",
        status: "running",
        pid: child.pid
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
            processStreamEvent(event as never, streamState, (msg) => context.response.write(`${msg}\n`));
          } catch {
            // Ignore malformed lines.
          }
        }
      });

      child.stderr.setEncoding("utf-8");
      child.stderr.on("data", (chunk: string | Buffer) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
        writeEvent(context.response, { type: "error", error: text });
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
          blocks: streamState.assistantBlocks
        });
      }
      history.contextPercent = streamState.contextPercent;
      await saveJsonFile(historyPath, history);

      writeEvent(context.response, {
        type: "result",
        success: exitCode === 0
      });
      writeEvent(context.response, { type: "done" });
      context.response.end();
    } catch (error) {
      writeEvent(context.response, {
        type: "error",
        error: error instanceof Error ? error.message : "Unknown error"
      });
      writeEvent(context.response, { type: "done" });
      context.response.end();
    }
  });

  dispatcher.register("PATCH", "/api/engineer/codex/finding-chat/:findingId", async (context) => {
    const findingId = context.params.findingId;
    const ticketId = context.query.get("ticketId");
    const repoPath = context.query.get("repo");

    if (!(ticketId && repoPath)) {
      json(context, 400, { error: "ticketId and repo parameters are required" });
      return;
    }

    const body = parseBody(context);
    if (!body) {
      json(context, 400, { error: "Invalid JSON body" });
      return;
    }

    const messageId = asString(body.messageId);
    const responded = typeof body.responded === "boolean" ? body.responded : true;

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

    const historyPath = getFindingHistoryPath(ticketId, expandedRepoPath, findingId);
    const history = await loadJsonFile<FindingChatHistory>(historyPath, {
      messages: [],
      ticketId,
      repoPath,
      findingId
    });

    if (messageId) {
      const target = history.messages.find((message) => message.id === messageId);
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
  });

  dispatcher.register("DELETE", "/api/engineer/codex/finding-chat/:findingId", async (context) => {
    const findingId = context.params.findingId;
    const ticketId = context.query.get("ticketId");
    const repoPath = context.query.get("repo");

    if (!(ticketId && repoPath)) {
      json(context, 400, { error: "ticketId and repo parameters are required" });
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

    const historyPath = getFindingHistoryPath(ticketId, expandedRepoPath, findingId);
    await fs.rm(historyPath, { force: true });
    json(context, 200, { success: true });
  });
}

function asProvider(value: unknown): "claude" | "codex" | null {
  if (value === "claude" || value === "codex") {
    return value;
  }
  return null;
}

function resolveProvider(workDir: string): "claude" | "codex" | null {
  const claudeState = path.join(workDir, "codex-review-claude.json");
  if (existsSync(claudeState)) {
    return "claude";
  }

  const codexState = path.join(workDir, "codex-review-codex.json");
  if (existsSync(codexState)) {
    return "codex";
  }

  return null;
}

function getReviewPaths(worktreeDir: string, provider: string): {
  workDir: string;
  statePath: string;
  logPath: string;
  pidPath: string;
  findingsPath: string;
} {
  const workDir = path.join(worktreeDir, ".claude", "work");
  return {
    workDir,
    statePath: path.join(workDir, `codex-review-${provider}.json`),
    logPath: path.join(workDir, `codex-review-${provider}.log`),
    pidPath: path.join(workDir, `codex-review-${provider}.pid`),
    findingsPath: path.join(workDir, `review-findings-${provider}.json`)
  };
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseFindingsFromText(text: string): PersistedFinding[] {
  const jsonContent = extractJsonArray(text);
  if (!jsonContent) {
    return [];
  }

  try {
    const parsed = JSON.parse(jsonContent) as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((entry) => {
      const severity = normalizeSeverity(asString(entry.severity) ?? "low");
      return {
        severity,
        priority: mapPriority(severity),
        file: asString(entry.file) ?? undefined,
        line: asNumber(entry.line) ?? undefined,
        message: buildMessage(asString(entry.title), asString(entry.description)),
        suggestion: asString(entry.suggestion) ?? undefined,
        commented: false
      };
    });
  } catch {
    return [];
  }
}

function extractJsonArray(text: string): string | null {
  const codeBlock = FINDINGS_CODE_BLOCK_REGEX.exec(text);
  if (codeBlock?.[1]) {
    return codeBlock[1];
  }

  const arrayMatch = FINDINGS_ARRAY_REGEX.exec(text);
  if (arrayMatch?.[0]) {
    return arrayMatch[0];
  }

  return null;
}

function buildMessage(title: string | null, description: string | null): string {
  if (title && description) {
    return `${title}\n${description}`;
  }
  return title ?? description ?? "";
}

function normalizeSeverity(value: string): string {
  const lower = value.toLowerCase();
  if (lower === "critical" || lower === "high" || lower === "medium" || lower === "low") {
    return lower;
  }
  return "low";
}

function mapPriority(severity: string): string {
  if (severity === "critical") {
    return "P0";
  }
  if (severity === "high") {
    return "P1";
  }
  if (severity === "medium") {
    return "P2";
  }
  return "P3";
}

function findDuplicatePairs(
  findingsA: Array<Record<string, unknown>>,
  findingsB: Array<Record<string, unknown>>
): Array<[number, number]> {
  const usedB = new Set<number>();
  const duplicates: Array<[number, number]> = [];

  for (let indexA = 0; indexA < findingsA.length; indexA += 1) {
    const findingA = findingsA[indexA];
    const messageA = normalizeFindingText(asString(findingA.message) ?? "");
    const fileA = asString(findingA.file) ?? "";

    let matchedIndexB: number | null = null;
    let bestScore = 0;

    for (let indexB = 0; indexB < findingsB.length; indexB += 1) {
      if (usedB.has(indexB)) {
        continue;
      }

      const findingB = findingsB[indexB];
      const messageB = normalizeFindingText(asString(findingB.message) ?? "");
      const fileB = asString(findingB.file) ?? "";

      const score = similarityScore(messageA, messageB, fileA, fileB);
      if (score > bestScore) {
        bestScore = score;
        matchedIndexB = indexB;
      }
    }

    if (matchedIndexB !== null && bestScore >= 0.6) {
      duplicates.push([indexA, matchedIndexB]);
      usedB.add(matchedIndexB);
    }
  }

  return duplicates;
}

function normalizeFindingText(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function similarityScore(messageA: string, messageB: string, fileA: string, fileB: string): number {
  if (!messageA || !messageB) {
    return 0;
  }

  const wordsA = new Set(messageA.split(" ").filter(Boolean));
  const wordsB = new Set(messageB.split(" ").filter(Boolean));
  const intersection = [...wordsA].filter((word) => wordsB.has(word)).length;
  const union = new Set([...wordsA, ...wordsB]).size;

  let score = union > 0 ? intersection / union : 0;
  if (fileA && fileB && fileA === fileB) {
    score += 0.25;
  }
  if (messageA.slice(0, 80) === messageB.slice(0, 80)) {
    score += 0.25;
  }

  return Math.min(score, 1);
}

function spawnReviewProcess(
  provider: "claude" | "codex",
  options: {
    worktreeDir: string;
    model: string;
    reasoningEffort: string;
    reviewMode: "uncommitted" | "base";
    baseBranch: string;
    instructions?: string;
  }
): ChildProcess {
  if (provider === "claude") {
    const prompt = [
      "Perform a detailed code review of current changes.",
      "Return a summary and include a JSON array of findings in a ```json fenced block.",
      options.instructions ?? ""
    ]
      .filter(Boolean)
      .join("\n\n");

    const child = spawn(
      "claude",
      [
        "-p",
        "--verbose",
        "--output-format",
        "stream-json",
        "--model",
        options.model,
        "--allowedTools",
        withMcpTools("Bash,Read,Glob,Grep,Task,TodoWrite")
      ],
      {
        cwd: options.worktreeDir,
        detached: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`
        }
      }
    );

    child.stdin.write(prompt);
    child.stdin.end();
    return child;
  }

  const args: string[] = ["review"];
  if (options.reviewMode === "uncommitted") {
    args.push("--uncommitted");
  } else {
    args.push("--base", options.baseBranch);
  }

  args.push("-c", `model=${options.model}`, "-c", `model_reasoning_effort=${options.reasoningEffort}`);

  return spawn("codex", args, {
    cwd: options.worktreeDir,
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      FORCE_COLOR: "0"
    }
  });
}

async function streamClaudeReview(
  child: ChildProcess,
  response: ServerResponse,
  logPath: string,
  sessionIdHolder: { value: string | undefined }
): Promise<void> {
  const streamState = createStreamState((sessionId) => {
    sessionIdHolder.value = sessionId;
  });

  child.stdout?.setEncoding("utf-8");
  let buffer = "";

  child.stdout?.on("data", (chunk: string | Buffer) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      void fs.appendFile(logPath, `${line}\n`, "utf-8");
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        processStreamEvent(event as never, streamState, (message) => response.write(`${message}\n`));
      } catch {
        response.write(`${JSON.stringify({ type: "text", content: line })}\n`);
      }
    }
  });

  child.stderr?.setEncoding("utf-8");
  child.stderr?.on("data", (chunk: string | Buffer) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    void fs.appendFile(logPath, text, "utf-8");
    writeEvent(response, { type: "error", error: text });
  });
}

async function streamCodexReview(
  child: ChildProcess,
  response: ServerResponse,
  logPath: string,
  sessionIdHolder: { value: string | undefined }
): Promise<void> {
  child.stdout?.setEncoding("utf-8");
  child.stdout?.on("data", (chunk: string | Buffer) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    void fs.appendFile(logPath, text, "utf-8");

    const sessionMatch = CODEX_SESSION_ID_REGEX.exec(text);
    if (sessionMatch?.[1] && !sessionIdHolder.value) {
      sessionIdHolder.value = sessionMatch[1];
      writeEvent(response, { type: "status", sessionId: sessionMatch[1] });
    }

    writeEvent(response, { type: "text", content: text });
  });

  child.stderr?.setEncoding("utf-8");
  child.stderr?.on("data", (chunk: string | Buffer) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    void fs.appendFile(logPath, text, "utf-8");
    writeEvent(response, { type: "error", error: text });
  });
}

async function streamCodexConversation(
  response: ServerResponse,
  cwd: string,
  args: string[],
  onSessionId: (sessionId: string) => Promise<void>
): Promise<void> {
  try {
    const child = spawn("codex", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        FORCE_COLOR: "0"
      }
    });

    if (!child.pid) {
      throw new Error("failed to spawn codex process");
    }

    writeEvent(response, {
      type: "status",
      status: "running",
      pid: child.pid
    });

    let capturedSessionId: string | null = null;

    child.stdout?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string | Buffer) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      const lines = text.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        const extractedText = extractCodexText(trimmed);
        if (extractedText) {
          writeEvent(response, { type: "text", content: extractedText });
        }

        const sessionId = extractCodexSessionId(trimmed);
        if (sessionId && sessionId !== capturedSessionId) {
          capturedSessionId = sessionId;
          void onSessionId(sessionId);
          writeEvent(response, { type: "status", sessionId });
        }
      }
    });

    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk: string | Buffer) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      writeEvent(response, { type: "error", error: text });
    });

    const exitCode = await waitForExit(child);
    writeEvent(response, {
      type: "result",
      success: exitCode === 0
    });
    writeEvent(response, { type: "done" });
    response.end();
  } catch (error) {
    writeEvent(response, {
      type: "error",
      error: error instanceof Error ? error.message : "Unknown error"
    });
    writeEvent(response, { type: "done" });
    response.end();
  }
}

function extractCodexText(line: string): string {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;

    if (typeof parsed.output_text === "string") {
      return parsed.output_text;
    }

    if (typeof parsed.text === "string") {
      return parsed.text;
    }

    const item = parsed.item as Record<string, unknown> | undefined;
    if (item && typeof item.text === "string") {
      return item.text;
    }

    return "";
  } catch {
    return line;
  }
}

function extractCodexSessionId(line: string): string | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;

    const candidates = [
      parsed.session_id,
      (parsed.item as Record<string, unknown> | undefined)?.session_id,
      (parsed.item as Record<string, unknown> | undefined)?.sessionId
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
    }
  } catch {
    const match = CODEX_SESSION_ID_REGEX.exec(line);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function buildFindingPrompt(
  findingContext: FindingChatHistory["findingContext"],
  userMessage: string,
  messages: FindingChatMessage[]
): string {
  const parts: string[] = [
    "You are helping a developer reason about a code review finding.",
    "Assess whether the finding is valid and propose next steps."
  ];

  if (findingContext) {
    parts.push("Finding context:");
    parts.push(`Severity: ${findingContext.severity}`);
    if (findingContext.file) {
      parts.push(`File: ${findingContext.file}${findingContext.line ? `:${findingContext.line}` : ""}`);
    }
    parts.push(`Message: ${findingContext.message}`);
    if (findingContext.suggestion) {
      parts.push(`Suggestion: ${findingContext.suggestion}`);
    }
  }

  if (messages.length > 0) {
    parts.push("Recent conversation:");
    for (const message of messages.slice(-8)) {
      const role = message.role === "user" ? "User" : "Assistant";
      parts.push(`${role}: ${message.content}`);
    }
  }

  parts.push("Latest message:");
  parts.push(userMessage);

  return parts.join("\n\n");
}

function getFindingHistoryPath(ticketId: string, expandedRepoPath: string, findingId: string): string {
  const worktreeDir = resolveWorktreeDir(expandedRepoPath, ticketId);
  const sanitizedFindingId = findingId.replaceAll(/[^a-zA-Z0-9-_]/g, "_");

  return path.join(
    worktreeDir,
    ".claude",
    "work",
    "finding-chats",
    `${sanitizedFindingId}.json`
  );
}

async function waitForExit(child: ChildProcess): Promise<number> {
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

async function runCommand(command: string, args: string[]): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`
      }
    });

    let output = "";
    let errorOutput = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(output.trim());
        return;
      }
      reject(new Error(errorOutput || `${command} exited with code ${code}`));
    });
  });
}

function setStreamingHeaders(response: ServerResponse): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
}

function writeEvent(response: ServerResponse, payload: Record<string, unknown>): void {
  response.write(`${JSON.stringify(payload)}\n`);
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
