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
/**
 * Write an event to the interactive JSONL in the same format as
 * --output-format stream-json so parseTokenUsage and the output-tailer
 * both recognize it. Includes estimated token usage based on text length.
 */
function appendInteractiveEvent(
  loopId: string,
  type: "user" | "assistant",
  text: string,
): void {
  const jsonlPath = interactiveJsonlPaths.get(loopId);
  if (!jsonlPath || !text.trim()) return;
  try {
    // Don't include token usage on text events — real token counts
    // come from the TUI token counter extracted in bufferAssistantOutput.
    const record = {
      type,
      message: { content: [{ type: "text", text }] },
    };
    appendFileSync(jsonlPath, JSON.stringify(record) + "\n");
  } catch {
    // Best effort
  }
}

/** Track last seen token count per loop for delta computation. */
const lastTokenCounts = new Map<string, number>();

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
    const cleaned = stripAnsi(raw).replace(/\s+/g, " ").trim();

    // Extract token counts from TUI status lines (e.g. "esctointerrupt52215tokens")
    const tokenMatch = cleaned.match(/(\d{3,})tokens?/i);
    if (tokenMatch) {
      const currentTokens = parseInt(tokenMatch[1], 10);
      const lastTokens = lastTokenCounts.get(loopId) ?? 0;
      if (currentTokens > lastTokens) {
        const delta = currentTokens - lastTokens;
        lastTokenCounts.set(loopId, currentTokens);
        // Emit a token usage record with the delta
        const jsonlPath = interactiveJsonlPaths.get(loopId);
        if (jsonlPath) {
          try {
            const record = {
              type: "assistant",
              message: {
                content: [],
                usage: {
                  input_tokens: Math.ceil(delta * 0.8),
                  output_tokens: Math.ceil(delta * 0.2),
                  cache_creation_input_tokens: 0,
                  cache_read_input_tokens: 0,
                },
              },
            };
            appendFileSync(jsonlPath, JSON.stringify(record) + "\n");
          } catch { /* best effort */ }
        }
      }
      continue;
    }

    if (cleaned.length < 20) continue;
    // Skip TUI chrome: key hints, symbol-only lines
    if (/^(esc|enter|ctrl)\w*to/i.test(cleaned)) continue;
    if (/^[·✢✳✶✻✽⠀-⣿\s]+$/.test(cleaned)) continue;
    if (/esctointerrupt/i.test(cleaned)) continue;
    appendInteractiveEvent(loopId, "assistant", cleaned);
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
            // Suppress assistant output logging while typing. Extend to 3s
            // after Enter to skip the echoed input and TUI redraw before
            // Claude's actual response starts.
            const isEnter = msg.data.includes("\r") || msg.data.includes("\n");
            typingUntil = Date.now() + (isEnter ? 3000 : 1000);
            if (isEnter) {
              // Clear the assistant line buffer — everything in it is
              // echoed user keystrokes, not Claude's response.
              outputLineBuffers.delete(baseLoopId);
            }
            // Accumulate user keystrokes and log when Enter is pressed
            userInputBuffer = (userInputBuffer ?? "") + msg.data;
            if (isEnter) {
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
