import type http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import {
  getSession,
  writeToPty,
  resizePty,
} from "../../main/pty-session-store.js";

// ---------------------------------------------------------------------------
// Terminal WebSocket attach endpoint
// ---------------------------------------------------------------------------

function safeEqualToken(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) {
    return false;
  }
  return timingSafeEqual(leftBuf, rightBuf);
}

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

      // 1. Send replay buffer so the terminal shows historical output
      if (session.outputBuffer.length > 0) {
        ws.send(JSON.stringify({ type: "replay", data: session.outputBuffer }));
      }

      // 2. If already exited, send exit immediately
      if (session.exited) {
        ws.send(
          JSON.stringify({ type: "exit", exitCode: session.exitCode ?? 1 }),
        );
      }

      // 3. Forward live PTY data to the WebSocket
      const onData = (data: string): void => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "data", data }));
        }
      };
      session.dataListeners.add(onData);

      // 4. Forward exit event
      const onExit = ({ exitCode }: { exitCode: number }): void => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "exit", exitCode }));
        }
      };
      session.exitListeners.add(onExit);

      // 5. Handle incoming messages from the client
      ws.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
        try {
          const msg = JSON.parse(String(raw)) as Record<string, unknown>;
          if (msg.type === "input" && typeof msg.data === "string") {
            writeToPty(loopId, msg.data);
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

      // 6. Clean up listeners on close — do NOT kill the job
      ws.on("close", () => {
        session.dataListeners.delete(onData);
        session.exitListeners.delete(onExit);
      });
    },
  );
}
