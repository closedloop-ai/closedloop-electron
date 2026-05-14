import type http from "node:http";
import { appendFileSync } from "node:fs";
import { WebSocketServer, type WebSocket } from "ws";
import pkg from "@xterm/headless";
const { Terminal } = pkg;
import {
  getSession,
  writeToPty,
  resizePty,
} from "../../main/pty-session-store.js";
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

// ---------------------------------------------------------------------------
// Headless terminal for clean text extraction
// ---------------------------------------------------------------------------

interface TerminalCapture {
  term: InstanceType<typeof Terminal>;
  lastLineCount: number;
  /** Recently emitted lines (stripped of spinner prefixes) for dedup. */
  recentLines: Set<string>;
  flushTimer: ReturnType<typeof setTimeout> | null;
  typingUntil: number;
  lastTokenCount: number;
}

const captures = new Map<string, TerminalCapture>();

/**
 * Feed PTY data into a headless xterm instance and periodically
 * extract clean text lines — no ANSI, no partial redraws, no
 * hand-rolled parsing.
 */
function feedAndExtract(loopId: string, data: string): void {
  let cap = captures.get(loopId);
  if (!cap) {
    const term = new Terminal({ cols: 120, rows: 40, scrollback: 1000, allowProposedApi: true });
    cap = { term, lastLineCount: 0, recentLines: new Set(), flushTimer: null, typingUntil: 0, lastTokenCount: 0 };
    captures.set(loopId, cap);
  }

  cap.term.write(data);

  // Debounce: extract after 1s of no new data
  if (cap.flushTimer) clearTimeout(cap.flushTimer);
  cap.flushTimer = setTimeout(() => {
    if (Date.now() < cap!.typingUntil) return;
    flushTerminalLines(loopId, cap!);
  }, 1000);
}

function flushTerminalLines(loopId: string, cap: TerminalCapture): void {
  const buf = cap.term.buffer.active;
  const newLines: string[] = [];

  // Read all lines from the terminal buffer
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (!line) continue;
    const text = line.translateToString(true).trim();
    if (!text) continue;
    newLines.push(text);
  }

  // Only emit lines we haven't seen
  const startFrom = cap.lastLineCount;
  cap.lastLineCount = newLines.length;

  for (let i = startFrom; i < newLines.length; i++) {
    const text = newLines[i];

    // Clean residual escape fragments and leading spinner symbols
    const cleaned = text.replace(/^\[?[A-Z]/, "").trim();
    if (!cleaned || cleaned.length < 3) continue;
    const stripped = cleaned.replace(/^[·✢✳✶✻✽⠀-⣿]\s*/, "");
    if (cap.recentLines.has(stripped)) continue;
    cap.recentLines.add(stripped);
    // Cap the set size to prevent unbounded growth
    if (cap.recentLines.size > 500) {
      const first = cap.recentLines.values().next().value;
      if (first !== undefined) cap.recentLines.delete(first);
    }

    // Extract token counts
    const tokenMatch = text.match(/(\d{3,})\s*tokens?/i);
    if (tokenMatch) {
      const currentTokens = parseInt(tokenMatch[1], 10);
      if (currentTokens > cap.lastTokenCount) {
        const delta = currentTokens - cap.lastTokenCount;
        cap.lastTokenCount = currentTokens;
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

    // Skip pure symbol noise
    if (/^[·✢✳✶✻✽⠀-⣿│─┌┐└┘├┤╭╮╰╯═║\s]+$/.test(cleaned)) continue;
    appendInteractiveEvent(loopId, "assistant", cleaned);
  }
}

function markTyping(loopId: string, isEnter: boolean): void {
  const cap = captures.get(loopId);
  if (!cap) return;
  cap.typingUntil = Date.now() + (isEnter ? 2000 : 500);
  if (isEnter) {
    // Reset the line counter to the current buffer length so
    // everything already in the buffer (including echoed keystrokes)
    // is treated as "already seen" and won't be emitted.
    cap.lastLineCount = cap.term.buffer.active.length;
  }
}

function cleanupCapture(loopId: string): void {
  const cap = captures.get(loopId);
  if (cap) {
    if (cap.flushTimer) clearTimeout(cap.flushTimer);
    cap.term.dispose();
    captures.delete(loopId);
  }
}

// ---------------------------------------------------------------------------
// WebSocket handler
// ---------------------------------------------------------------------------

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

      const baseLoopId = loopId.replace(/-interactive$/, "");

      // Forward live PTY data to the WebSocket and feed headless terminal
      const onData = (data: string): void => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "data", data }));
        }
        feedAndExtract(baseLoopId, data);
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
          cleanupCapture(baseLoopId);
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
            const isEnter = msg.data.includes("\r") || msg.data.includes("\n");
            markTyping(baseLoopId, isEnter);
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
            // Resize the headless terminal too
            const cap = captures.get(baseLoopId);
            if (cap) cap.term.resize(msg.cols, msg.rows);
          }
        } catch {
          // Ignore malformed messages
        }
      });

      // 5. Clean up listeners on close — do NOT kill the job
      ws.on("close", () => {
        session.dataListeners.delete(onData);
        session.exitListeners.delete(onExit);
        // Flush any remaining lines before cleanup
        const cap = captures.get(baseLoopId);
        if (cap) flushTerminalLines(baseLoopId, cap);
        cleanupCapture(baseLoopId);
      });
    },
  );
}
