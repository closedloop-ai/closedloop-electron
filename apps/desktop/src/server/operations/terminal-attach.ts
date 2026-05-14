import type http from "node:http";
import { appendFileSync } from "node:fs";
import { WebSocketServer, type WebSocket } from "ws";
import {
  getSession,
  writeToPty,
  resizePty,
} from "../../main/pty-session-store.js";
import { stripAnsi } from "../../main/diagnostics-helpers.js";
import { safeEqualToken } from "../auth-utils.js";

/**
 * Initialise a WebSocket upgrade handler on the given HTTP server.
 *
 * Clients connect to `/api/engineer/jobs/:jobId/terminal` to attach to the
 * PTY backing a running (or recently exited) loop job.
 *
 * Protocol (JSON messages):
 *
 * Server -> Client:
 *   { type: "replay", data: string }   — buffered output replay on connect
 *   { type: "data",   data: string }   — live PTY output
 *   { type: "exit",   exitCode: number }
 *
 * Client -> Server:
 *   { type: "input",  data: string }   — keyboard input forwarded to PTY
 *   { type: "resize", cols: number, rows: number }
 */
/** Map of loopId → interactive JSONL path for event logging. */
const interactiveJsonlPaths = new Map<string, string>();

export function registerInteractiveJsonlPath(loopId: string, jsonlPath: string): void {
  interactiveJsonlPaths.set(loopId, jsonlPath);
}

/**
 * Write an event to the interactive JSONL file in the format the
 * output-tailer recognizes (type: "user"/"assistant" with content blocks).
 */
function appendInteractiveEvent(
  loopId: string,
  type: "user" | "assistant",
  text: string,
): void {
  const jsonlPath = interactiveJsonlPaths.get(loopId);
  if (!jsonlPath || !text.trim()) return;
  try {
    const record = {
      type,
      message: { content: [{ type: "text", text }] },
    };
    appendFileSync(jsonlPath, JSON.stringify(record) + "\n");
  } catch {
    // Best effort
  }
}

/** Buffer for accumulating PTY output and emitting complete lines. */
const outputLineBuffers = new Map<string, string>();

/**
 * Accumulate PTY output, strip ANSI/TUI artifacts, and emit each
 * complete line as a separate event. Partial lines stay in the buffer
 * until a newline arrives.
 */
function bufferAssistantOutput(loopId: string, data: string): void {
  const existing = outputLineBuffers.get(loopId) ?? "";
  const combined = existing + data;
  const lines = combined.split("\n");
  // Last element is the incomplete line — keep it in the buffer
  outputLineBuffers.set(loopId, lines.pop() ?? "");

  for (const raw of lines) {
    // Strip ANSI escape codes, then strip common TUI artifacts:
    // braille spinners (⠐⠂⠒⠰⠤⠆), status symbols (✢✳✶✻✽), box drawing, etc.
    const cleaned = stripAnsi(raw)
      .replace(/[⠀-⣿✢✳✶✻✽╭╮╰╯│─┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬·;]/g, "")
      .replace(/Claude Code/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length >= 10) {
      appendInteractiveEvent(loopId, "assistant", cleaned);
    }
  }
}

export function initTerminalAttachWebSocket(
  server: http.Server,
  getGatewayAuthToken?: () => string | undefined,
): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = request.url ?? "";
    const match = /^\/api\/engineer\/jobs\/([^/]+)\/terminal/.exec(url);
    if (!match) {
      // Not our upgrade — let other handlers deal with it.
      return;
    }

    // Enforce the same auth that GatewayRouter applies to HTTP requests.
    // Accept token from Authorization header or query param (browser
    // WebSocket API cannot set custom headers).
    const expectedToken = getGatewayAuthToken?.();
    if (expectedToken) {
      const authHeader = request.headers.authorization ?? "";
      let providedToken = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : "";
      if (!providedToken) {
        const queryToken = new URL(url, "http://localhost").searchParams.get("token");
        providedToken = queryToken ?? "";
      }
      if (!providedToken || !safeEqualToken(providedToken, expectedToken)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    const loopId = match[1];

    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      wss.emit("connection", ws, request, loopId);
    });
  });

  wss.on(
    "connection",
    (ws: WebSocket, _request: http.IncomingMessage, loopId: string) => {
      let userInputBuffer = "";
      const session = getSession(loopId);

      if (!session) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `No PTY session for loopId=${loopId}`,
          }),
        );
        ws.close();
        return;
      }

      // Forward live PTY data to the WebSocket and buffer for JSONL logging.
      // Suppress logging while the user is typing to avoid capturing
      // keystroke echoes as assistant output.
      const baseLoopId = loopId.replace(/-interactive$/, "");
      let typingUntil = 0;
      const onData = (data: string): void => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "data", data }));
        }
        if (Date.now() < typingUntil) return;
        bufferAssistantOutput(baseLoopId, data);
      };
      session.dataListeners.add(onData);

      // 1. Send replay buffer so the terminal shows historical output
      if (session.outputBuffer.length > 0) {
        ws.send(JSON.stringify({ type: "replay", data: session.outputBuffer }));
      }

      // 2. If already exited, send exit immediately and return — do NOT
      //    register an exit listener that would fire a second exit message
      //    when deferred notifyExitListeners() runs.
      if (session.exited) {
        ws.send(
          JSON.stringify({ type: "exit", exitCode: session.exitCode ?? 1 }),
        );
        ws.on("close", () => {
          session.dataListeners.delete(onData);
        });
        return;
      }

      // 3. Forward exit event
      const onExit = ({ exitCode }: { exitCode: number }): void => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "exit", exitCode }));
        }
      };
      session.exitListeners.add(onExit);

      // 4. Handle incoming messages from the client
      ws.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
        try {
          const msg = JSON.parse(String(raw)) as Record<string, unknown>;
          if (msg.type === "input" && typeof msg.data === "string") {
            writeToPty(loopId, msg.data);
            // Suppress assistant output logging for 1s after each keystroke
            // to avoid capturing PTY echo as assistant output.
            typingUntil = Date.now() + 1000;
            // Accumulate user keystrokes and log when Enter is pressed
            userInputBuffer = (userInputBuffer ?? "") + msg.data;
            if (msg.data.includes("\r") || msg.data.includes("\n")) {
              const line = userInputBuffer.replace(/[\r\n]+/g, "").trim();
              if (line.length > 0) {
                appendInteractiveEvent(baseLoopId, "user", line);
              }
              userInputBuffer = "";
            }
          } else if (
            msg.type === "resize" &&
            typeof msg.cols === "number" &&
            typeof msg.rows === "number"
          ) {
            resizePty(loopId, msg.cols, msg.rows);
          }
        } catch {
          // Ignore malformed messages
        }
      });

      // 5. Clean up listeners on close — do NOT kill the job
      ws.on("close", () => {
        session.dataListeners.delete(onData);
        session.exitListeners.delete(onExit);
      });
    },
  );
}
