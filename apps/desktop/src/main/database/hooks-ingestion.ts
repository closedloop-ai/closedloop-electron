import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentDatabase } from "./index.js";
import type { HookEventPayload } from "./types.js";

/**
 * Handles incoming hook events from Claude Code.
 * POST /api/hooks/event with JSON body
 */
export function handleHookEvent(
  req: IncomingMessage,
  res: ServerResponse,
  db: AgentDatabase,
  body: string,
): void {
  try {
    const payload: HookEventPayload = JSON.parse(body);

    if (payload.sessionId) {
      db.sessions.upsert(payload);

      if (payload.agentId) {
        db.agents.upsert(payload);
      }

      db.events.insert(payload);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: message }));
  }
}

export function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
