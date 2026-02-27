import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { OperationDispatcher, OperationRequestContext } from "../operation-dispatcher.js";
import { DirectoryNotAllowedError, assertPathAllowed } from "../security.js";
import { assertRepoAllowed, resolveWorktreeDir } from "./symphony-utils.js";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  sender?: "claude" | "codex";
};

type ChatHistory = {
  messages: ChatMessage[];
  ticketId: string;
  repoPath: string;
  sessionId?: string;
  contextPercent?: number | null;
};

export function registerSymphonyChatHistoryRoutes(
  dispatcher: OperationDispatcher,
  getAllowedDirectories: () => string[]
): void {
  dispatcher.register("GET", "/api/engineer/symphony/chat-history/:ticketId", async (context) => {
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

    const historyPath = getChatHistoryPath(ticketId, expandedRepoPath);

    if (!existsSync(historyPath)) {
      json(context, 200, {
        messages: [],
        ticketId,
        repoPath
      });
      return;
    }

    try {
      const content = await fs.readFile(historyPath, "utf-8");
      const history = JSON.parse(content) as ChatHistory;
      json(context, 200, history);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      json(context, 500, { error: `Failed to read chat history: ${message}` });
    }
  });

  dispatcher.register("POST", "/api/engineer/symphony/chat-history/:ticketId", async (context) => {
    const ticketId = context.params.ticketId;
    const repoPath = context.query.get("repo");

    if (!repoPath) {
      json(context, 400, { error: "repo parameter is required" });
      return;
    }

    const body = parseJsonBody(context);
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

    const message = parseMessage(body.message);
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;

    const historyPath = getChatHistoryPath(ticketId, expandedRepoPath);
    const historyDir = path.dirname(historyPath);

    try {
      assertPathAllowed(historyDir, getAllowedDirectories());
    } catch (error) {
      if (error instanceof DirectoryNotAllowedError) {
        json(context, 403, { error: "directory not allowed" });
        return;
      }
      throw error;
    }

    await fs.mkdir(historyDir, { recursive: true });

    let history: ChatHistory;
    if (existsSync(historyPath)) {
      try {
        const content = await fs.readFile(historyPath, "utf-8");
        history = JSON.parse(content) as ChatHistory;
      } catch {
        history = { messages: [], ticketId, repoPath };
      }
    } else {
      history = { messages: [], ticketId, repoPath };
    }

    if (sessionId && !message) {
      history.sessionId = sessionId;
      try {
        await fs.writeFile(historyPath, JSON.stringify(history, null, 2), "utf-8");
        json(context, 200, { success: true, sessionId });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Unknown error";
        json(context, 500, { error: `Failed to save session ID: ${messageText}` });
      }
      return;
    }

    if (!(message?.content && message.role)) {
      json(context, 400, { error: "message with content and role is required" });
      return;
    }

    history.messages.push(message);

    try {
      await fs.writeFile(historyPath, JSON.stringify(history, null, 2), "utf-8");
      json(context, 200, { success: true, history });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Unknown error";
      json(context, 500, { error: `Failed to save chat history: ${messageText}` });
    }
  });

  dispatcher.register("DELETE", "/api/engineer/symphony/chat-history/:ticketId", async (context) => {
    const ticketId = context.params.ticketId;
    const repoPath = context.query.get("repo");
    const indexParam = context.query.get("index");

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

    const historyPath = getChatHistoryPath(ticketId, expandedRepoPath);
    if (!existsSync(historyPath)) {
      json(context, 200, {
        success: true,
        message: "No history to delete"
      });
      return;
    }

    try {
      if (indexParam === null) {
        await fs.unlink(historyPath);

        const codexStatePath = path.join(path.dirname(historyPath), "codex-chat.json");
        if (existsSync(codexStatePath)) {
          await fs.unlink(codexStatePath);
        }

        json(context, 200, {
          success: true,
          message: "Chat history cleared"
        });
        return;
      }

      const index = Number.parseInt(indexParam, 10);
      if (Number.isNaN(index) || index < 0) {
        json(context, 400, { error: "Invalid index" });
        return;
      }

      const content = await fs.readFile(historyPath, "utf-8");
      const history = JSON.parse(content) as ChatHistory;

      if (index >= history.messages.length) {
        json(context, 404, { error: "Index out of bounds" });
        return;
      }

      history.messages.splice(index, 1);
      await fs.writeFile(historyPath, JSON.stringify(history, null, 2), "utf-8");
      json(context, 200, { success: true, history });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      json(context, 500, { error: `Failed to delete: ${message}` });
    }
  });
}

function getChatHistoryPath(ticketId: string, expandedRepoPath: string): string {
  return path.join(resolveWorktreeDir(expandedRepoPath, ticketId), ".claude", "work", "chat-history.json");
}

function parseJsonBody(context: OperationRequestContext): Record<string, unknown> | null {
  if (!context.body.trim()) {
    return {};
  }

  try {
    return JSON.parse(context.body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseMessage(value: unknown): ChatMessage | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    (candidate.role !== "user" && candidate.role !== "assistant") ||
    typeof candidate.content !== "string" ||
    typeof candidate.timestamp !== "string"
  ) {
    return undefined;
  }

  const parsed: ChatMessage = {
    id: candidate.id,
    role: candidate.role,
    content: candidate.content,
    timestamp: candidate.timestamp
  };

  if (candidate.sender === "claude" || candidate.sender === "codex") {
    parsed.sender = candidate.sender;
  }

  return parsed;
}

function json(context: OperationRequestContext, status: number, payload: unknown): void {
  context.response.statusCode = status;
  context.response.setHeader("content-type", "application/json");
  context.response.end(JSON.stringify(payload));
}

