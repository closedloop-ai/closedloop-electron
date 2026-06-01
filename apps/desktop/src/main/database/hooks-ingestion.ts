import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { AgentDatabase } from "./index.js";
import type { HookEventPayload } from "./types.js";

const HookEventSchema = z.object({
  sessionId: z.string().optional(),
  agentId: z.string().optional(),
  eventType: z.string().optional(),
  toolName: z.string().optional(),
  summary: z.string().optional(),
  data: z.string().optional(),
  status: z.string().optional(),
  name: z.string().optional(),
  model: z.string().optional(),
  cwd: z.string().optional(),
  task: z.string().optional(),
  type: z.string().optional(),
  subagentType: z.string().optional(),
  parentAgentId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

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
    const raw = JSON.parse(body);
    const result = HookEventSchema.safeParse(raw);
    if (!result.success) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: result.error.message }));
      return;
    }
    const payload: HookEventPayload = result.data;

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
