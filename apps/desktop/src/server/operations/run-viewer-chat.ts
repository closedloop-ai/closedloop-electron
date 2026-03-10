import os from "node:os";
import path from "node:path";
import type { ServerResponse } from "node:http";
import type { OperationDispatcher, OperationRequestContext } from "../operation-dispatcher.js";
import type { ProcessManager } from "../process-manager.js";
import { DirectoryNotAllowedError, assertPathAllowed } from "../security.js";
import { loadJsonFile, saveJsonFile } from "./chat-history-store.js";
import { READONLY_CODEBASE_TOOLS, WEB_ONLY_TOOLS } from "./chat-tools.js";
import { createStreamState, processStreamEvent } from "./stream-events.js";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

type RunViewerChatHistory = {
  messages: ChatMessage[];
  claudeSessionId?: string;
};

export function registerRunViewerChatRoutes(
  dispatcher: OperationDispatcher,
  processManager: ProcessManager,
  getAllowedDirectories: () => string[],
  getSymphonyDir: () => string
): void {
  dispatcher.register("GET", "/api/engineer/run-viewer-chat", async (context) => {
    const dir = getSymphonyDir();
    const history = await loadChatHistory(dir);
    json(context, 200, history);
  });

  dispatcher.register("DELETE", "/api/engineer/run-viewer-chat", async (context) => {
    await saveChatHistory(getSymphonyDir(), { messages: [] });
    json(context, 200, { success: true });
  });

  dispatcher.register("POST", "/api/engineer/run-viewer-chat", async (context) => {
    const body = parseBody(context);
    if (!body) {
      json(context, 400, { error: "Invalid JSON body" });
      return;
    }

    const message = typeof body.message === "string" ? body.message : null;
    const runDir = typeof body.runDir === "string" ? body.runDir : undefined;
    if (!message) {
      json(context, 400, { error: "message is required" });
      return;
    }

    let validatedRunDir: string | undefined;
    if (runDir) {
      try {
        assertPathAllowed(runDir, getAllowedDirectories());
        validatedRunDir = path.resolve(runDir);
      } catch (error) {
        if (error instanceof DirectoryNotAllowedError) {
          json(context, 403, { error: "directory not allowed" });
          return;
        }
        throw error;
      }
    }

    const dir = getSymphonyDir();
    const history = await loadChatHistory(dir);
    history.messages.push({
      id: `user-${Date.now()}`,
      role: "user",
      content: message,
      timestamp: new Date().toISOString()
    });
    await saveChatHistory(dir, history);

    const isResuming = Boolean(history.claudeSessionId);
    const allowedTools = validatedRunDir ? READONLY_CODEBASE_TOOLS : WEB_ONLY_TOOLS;
    const systemPrompt = buildRunViewerSystemPrompt(validatedRunDir);
    const prompt = isResuming ? message : `${systemPrompt}\n\n---\n\nUser: ${message}`;

    setStreamingHeaders(context.response);
    writeEvent(context.response, { type: "status", status: "spawning", mode: "claude" });

    await new Promise<void>((resolve) => {
      const streamState = createStreamState(async (sessionId) => {
        if (!history.claudeSessionId) {
          history.claudeSessionId = sessionId;
          await saveChatHistory(dir, history);
        }
      });

      let handled = false;
      const finish = async () => {
        if (handled) {
          return;
        }
        handled = true;

        if (streamState.assistantContent.trim()) {
          history.messages.push({
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: streamState.assistantContent.trim(),
            timestamp: new Date().toISOString()
          });
          await saveChatHistory(dir, history);
        }

        writeEvent(context.response, { type: "done" });
        context.response.end();
        resolve();
      };

      void processManager
        .spawnStreaming({
          command: "claude",
          args: [
            "-p",
            "--verbose",
            "--output-format",
            "stream-json",
            `--allowedTools=${allowedTools}`,
            ...(isResuming && history.claudeSessionId
              ? ["--resume", history.claudeSessionId]
              : [])
          ],
          cwd: validatedRunDir ?? os.homedir(),
          input: prompt,
          onLine: (line) => {
            try {
              const parsed = JSON.parse(line) as Record<string, unknown>;
              processStreamEvent(parsed as never, streamState, (msg) =>
                context.response.write(`${msg}\n`)
              );
            } catch {
              // Skip malformed JSON lines.
            }
          },
          onError: (error) => {
            writeEvent(context.response, { type: "error", error: error.message });
          },
          onExit: (exitCode) => {
            writeEvent(context.response, {
              type: "result",
              success: exitCode === 0
            });
            void finish();
          }
        })
        .then((handle) => {
          writeEvent(context.response, {
            type: "status",
            status: "running",
            mode: "claude",
            pid: handle.pid
          });
        })
        .catch((error) => {
          writeEvent(context.response, { type: "error", error: error.message });
          void finish();
        });
    });
  });
}

function getChatsRootDir(symphonyDir: string): string {
  return path.join(symphonyDir, "chats");
}

function getHistoryPath(symphonyDir: string): string {
  return path.join(getChatsRootDir(symphonyDir), "_run-viewer", "chat-history.json");
}

async function loadChatHistory(symphonyDir: string): Promise<RunViewerChatHistory> {
  return loadJsonFile<RunViewerChatHistory>(getHistoryPath(symphonyDir), { messages: [] });
}

async function saveChatHistory(symphonyDir: string, history: RunViewerChatHistory): Promise<void> {
  await saveJsonFile(getHistoryPath(symphonyDir), history);
}

function buildRunViewerSystemPrompt(runDir?: string): string {
  const parts = [
    "You are analyzing artifacts from a Symphony AI run.",
    "Help the user understand plans, logs, and outputs."
  ];
  if (runDir) {
    parts.push(`Run directory: ${runDir}`);
  }
  return parts.join("\n");
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

function setStreamingHeaders(response: ServerResponse): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
}

function writeEvent(response: ServerResponse, payload: Record<string, unknown>): void {
  response.write(`${JSON.stringify(payload)}\n`);
}

function json(context: OperationRequestContext, status: number, payload: unknown): void {
  context.response.statusCode = status;
  context.response.setHeader("content-type", "application/json");
  context.response.end(JSON.stringify(payload));
}

