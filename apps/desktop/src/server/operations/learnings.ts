import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OperationDispatcher, OperationRequestContext } from "../operation-dispatcher.js";
import { findPluginScript } from "./plugin-cache.js";
import { DirectoryNotAllowedError, assertPathAllowed } from "../security.js";
import { assertRepoAllowed, resolveWorktreeDir } from "./symphony-utils.js";

type ParsedLearningPattern = {
  id: string;
  summary: string;
  raw: string;
};

type LearningUsed = {
  summary: string;
};

export function registerLearningsRoutes(
  dispatcher: OperationDispatcher,
  getAllowedDirectories: () => string[]
): void {
  dispatcher.register("GET", "/api/engineer/learnings", async (context) => {
    const filePath = path.join(os.homedir(), ".claude", ".learnings", "org-patterns.toon");

    try {
      const content = await fs.readFile(filePath, "utf-8");
      json(context, 200, { patterns: parseToon(content) });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        json(context, 200, { patterns: [] });
        return;
      }

      const message = error instanceof Error ? error.message : "Unknown error";
      json(context, 500, { error: `Failed to read learnings: ${message}` });
    }
  });

  dispatcher.register("POST", "/api/engineer/symphony/extract-learnings", async (context) => {
    const body = parseBody(context);
    if (!body) {
      json(context, 400, { error: "Invalid JSON body" });
      return;
    }

    const ticketId = asString(body.ticketId);
    const repoPath = asString(body.repoPath);
    const activeTab = asString(body.activeTab) ?? undefined;
    const chatFile = asString(body.chatFile) ?? "chat-history.json";

    if (!(ticketId && repoPath)) {
      json(context, 400, { error: "ticketId and repoPath are required" });
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

    const claudeWorkDir = path.join(worktreeDir, ".claude", "work");
    const chatHistoryPath = path.join(claudeWorkDir, chatFile);

    try {
      assertPathAllowed(claudeWorkDir, getAllowedDirectories());
      assertPathAllowed(chatHistoryPath, getAllowedDirectories());
    } catch (error) {
      if (error instanceof DirectoryNotAllowedError) {
        json(context, 403, { error: "directory not allowed" });
        return;
      }
      throw error;
    }

    if (!existsSync(chatHistoryPath)) {
      json(context, 404, { error: "No chat history found", path: chatFile });
      return;
    }

    const learningsDir = path.join(claudeWorkDir, ".learnings");
    await fs.mkdir(learningsDir, { recursive: true });

    const statusPath = path.join(learningsDir, "chat-extraction-status.json");
    await fs.writeFile(
      statusPath,
      JSON.stringify({
        status: "processing",
        ticketId,
        activeTab: activeTab ?? null,
        timestamp: new Date().toISOString()
      }),
      "utf-8"
    );

    void (async () => {
      await sleep(250);
      await fs.writeFile(
        statusPath,
        JSON.stringify({
          status: "completed",
          count: 0,
          ticketId,
          activeTab: activeTab ?? null,
          timestamp: new Date().toISOString()
        }),
        "utf-8"
      );
    })();

    json(context, 200, { status: "processing" });
  });

  dispatcher.register("GET", "/api/engineer/symphony/process-learnings", async (context) => {
    const ticketId = context.query.get("ticketId");
    const repoPath = context.query.get("repo");

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
    const statusPath = path.join(
      worktreeDir,
      ".claude",
      "work",
      ".learnings",
      "processing-status.json"
    );

    if (!existsSync(statusPath)) {
      json(context, 200, { status: "none" });
      return;
    }

    try {
      const content = await fs.readFile(statusPath, "utf-8");
      json(context, 200, JSON.parse(content));
    } catch {
      json(context, 200, { status: "none" });
    }
  });

  dispatcher.register("POST", "/api/engineer/symphony/process-learnings", async (context) => {
    const body = parseBody(context);
    if (!body) {
      json(context, 400, { error: "Invalid JSON body" });
      return;
    }

    const ticketId = asString(body.ticketId);
    const repoPath = asString(body.repoPath);
    const waitForExtraction = Boolean(body.waitForExtraction);

    if (!(ticketId && repoPath)) {
      json(context, 400, { error: "ticketId and repoPath are required" });
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

    const claudeWorkDir = path.join(worktreeDir, ".claude", "work");
    const learningsDir = path.join(claudeWorkDir, ".learnings");
    const pendingDir = path.join(learningsDir, "pending");
    const processingStatusPath = path.join(learningsDir, "processing-status.json");

    try {
      assertPathAllowed(claudeWorkDir, getAllowedDirectories());
    } catch (error) {
      if (error instanceof DirectoryNotAllowedError) {
        json(context, 403, { error: "directory not allowed" });
        return;
      }
      throw error;
    }

    await fs.mkdir(learningsDir, { recursive: true });

    if (waitForExtraction) {
      await fs.writeFile(
        processingStatusPath,
        JSON.stringify({ status: "waiting", timestamp: new Date().toISOString() }),
        "utf-8"
      );
      json(context, 200, { status: "waiting" });
      return;
    }

    if (!existsSync(pendingDir)) {
      json(context, 200, { status: "skipped", reason: "No pending learnings directory" });
      return;
    }

    const pendingFiles = await fs
      .readdir(pendingDir)
      .then((entries) => entries.filter((entry) => entry.endsWith(".json")))
      .catch(() => []);

    if (pendingFiles.length === 0) {
      json(context, 200, { status: "skipped", reason: "No pending learning files" });
      return;
    }

    await fs.writeFile(
      processingStatusPath,
      JSON.stringify({ status: "processing", timestamp: new Date().toISOString() }),
      "utf-8"
    );

    const scriptPath = findPluginScript("code", "process-chat-learnings.sh");
    if (scriptPath) {
      const logFile = path.join(claudeWorkDir, "process-learnings.log");
      const child = spawn(scriptPath, [claudeWorkDir], {
        detached: true,
        stdio: "ignore",
        cwd: worktreeDir,
        env: {
          ...process.env,
          PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`,
          SYMPHONY_WORKDIR: claudeWorkDir
        }
      });
      child.unref();
      json(context, 200, { status: "processing", pid: child.pid, logFile });
      return;
    }

    void (async () => {
      await sleep(300);
      await fs.writeFile(
        processingStatusPath,
        JSON.stringify({
          status: "completed",
          processed: pendingFiles.length,
          timestamp: new Date().toISOString()
        }),
        "utf-8"
      );
    })();

    json(context, 200, { status: "processing", pid: null });
  });

  dispatcher.register("GET", "/api/engineer/symphony/learnings-status/:ticketId", async (context) => {
    const ticketId = context.params.ticketId;
    const repoPath = context.query.get("repo");

    if (!repoPath) {
      json(context, 400, { error: "repo parameter is required" });
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
    const statusPath = path.join(
      worktreeDir,
      ".claude",
      "work",
      ".learnings",
      "chat-extraction-status.json"
    );

    if (!existsSync(statusPath)) {
      json(context, 200, { status: "none", count: 0 });
      return;
    }

    try {
      const content = await fs.readFile(statusPath, "utf-8");
      json(context, 200, JSON.parse(content));
    } catch {
      json(context, 200, { status: "none", count: 0 });
    }
  });

  dispatcher.register("POST", "/api/engineer/symphony/record-learning-use", async (context) => {
    const body = parseBody(context);
    if (!body) {
      json(context, 400, { error: "Invalid JSON body" });
      return;
    }

    const ticketId = asString(body.ticketId);
    const repoPath = asString(body.repoPath);
    const learnings = Array.isArray(body.learnings)
      ? body.learnings.filter((entry): entry is LearningUsed => {
        if (!(entry && typeof entry === "object")) {
          return false;
        }
        return typeof (entry as LearningUsed).summary === "string";
      })
      : [];

    if (!(ticketId && repoPath)) {
      json(context, 400, { error: "ticketId and repoPath are required" });
      return;
    }

    if (learnings.length === 0) {
      json(context, 400, {
        error: "learnings array is required and must not be empty"
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

    const claudeWorkDir = path.join(worktreeDir, ".claude", "work");
    const learningsDir = path.join(claudeWorkDir, ".learnings");

    try {
      assertPathAllowed(claudeWorkDir, getAllowedDirectories());
    } catch (error) {
      if (error instanceof DirectoryNotAllowedError) {
        json(context, 403, { error: "directory not allowed" });
        return;
      }
      throw error;
    }

    await fs.mkdir(learningsDir, { recursive: true });

    const outcomesPath = path.join(learningsDir, "outcomes.log");
    const timestamp = new Date().toISOString();
    const runId = `chat-${ticketId.replaceAll(/[^a-zA-Z0-9-_]/g, "_")}`;

    const lines = learnings.map((learning) => {
      const summary = learning.summary.replaceAll("|", "/");
      return `${timestamp}|${runId}|0|interactive-chat|${summary}|applied|`;
    });

    await fs.appendFile(outcomesPath, `${lines.join("\n")}\n`, "utf-8");
    triggerSuccessRateComputation(claudeWorkDir);

    json(context, 200, {
      status: "recorded",
      count: learnings.length
    });
  });
}

function parseToon(content: string): ParsedLearningPattern[] {
  const chunks = content
    .split(/\n\s*\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return chunks.map((chunk, index) => {
    const firstLine = chunk.split("\n")[0]?.trim() ?? "";
    const summary = firstLine.replaceAll(/^[-*#\s]+/, "").slice(0, 240);
    return {
      id: `pattern-${index + 1}`,
      summary: summary || `Pattern ${index + 1}`,
      raw: chunk
    };
  });
}

function triggerSuccessRateComputation(workDir: string): void {
  const runLoopPath = findPluginScript("code", "run-loop.sh");
  if (!runLoopPath) {
    return;
  }

  const pluginRoot = path.dirname(path.dirname(runLoopPath));
  const ratesScript = path.join(pluginRoot, "tools", "python", "compute_success_rates.py");
  if (!existsSync(ratesScript)) {
    return;
  }

  const child = spawn("python3", [ratesScript, "--workdir", workDir], {
    stdio: "ignore",
    detached: true,
    env: {
      ...process.env,
      PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`
    }
  });
  child.unref();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function json(context: OperationRequestContext, status: number, payload: unknown): void {
  context.response.statusCode = status;
  context.response.setHeader("content-type", "application/json");
  context.response.end(JSON.stringify(payload));
}
