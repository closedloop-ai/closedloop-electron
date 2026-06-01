import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { EventRow, HookEventPayload, EventCountByType } from "./types.js";

export function createEventStore(db: DatabaseSync) {
  const insertStmt = db.prepare(`
    INSERT INTO events (id, session_id, agent_id, event_type, tool_name, summary, data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getBySessionStmt = db.prepare(
    "SELECT * FROM events WHERE session_id = ? ORDER BY created_at ASC",
  );

  const getBySessionAndAgentStmt = db.prepare(
    "SELECT * FROM events WHERE session_id = ? AND agent_id = ? ORDER BY created_at ASC",
  );

  const getAllStmt = db.prepare(
    "SELECT e.*, s.name as session_name FROM events e LEFT JOIN sessions s ON s.id = e.session_id ORDER BY e.created_at DESC LIMIT 200",
  );

  const getEventsWithSessionStmt = db.prepare(
    "SELECT e.*, s.name as session_name FROM events e LEFT JOIN sessions s ON s.id = e.session_id WHERE e.session_id = ? ORDER BY e.created_at ASC",
  );

  const getCountByTypeStmt = db.prepare(
    "SELECT event_type, COUNT(*) as count FROM events GROUP BY event_type ORDER BY count DESC",
  );

  function toRow(raw: Record<string, unknown> | undefined): EventRow | undefined {
    if (!raw) return undefined;
    return {
      id: raw.id as string,
      sessionId: raw.session_id as string,
      agentId: (raw.agent_id as string) ?? null,
      eventType: raw.event_type as string,
      toolName: (raw.tool_name as string) ?? null,
      summary: (raw.summary as string) ?? null,
      data: (raw.data as string) ?? null,
      createdAt: (raw.created_at as string) ?? null,
    };
  }

  function toEventWithSession(raw: Record<string, unknown> | undefined): (EventRow & { sessionName: string | null }) | undefined {
    if (!raw) return undefined;
    const row = toRow(raw);
    if (!row) return undefined;
    return { ...row, sessionName: (raw.session_name as string) ?? null };
  }

  function eventsWithSessionToList(raws: Record<string, unknown>[]): (EventRow & { sessionName: string | null })[] {
    return raws.map(toEventWithSession).filter(Boolean) as (EventRow & { sessionName: string | null })[];
  }

  function rowsToList(raws: Record<string, unknown>[]): EventRow[] {
    return raws.map(toRow).filter(Boolean) as EventRow[];
  }

  return {
    insert(payload: HookEventPayload): EventRow {
      const id = randomUUID();
      const now = new Date().toISOString();
      insertStmt.run(
        id,
        payload.sessionId ?? null,
        payload.agentId ?? null,
        payload.eventType ?? "unknown",
        payload.toolName ?? null,
        payload.summary ?? null,
        payload.data ?? null,
        now,
      );
      return {
        id,
        sessionId: payload.sessionId ?? "",
        agentId: payload.agentId ?? null,
        eventType: payload.eventType ?? "unknown",
        toolName: payload.toolName ?? null,
        summary: payload.summary ?? null,
        data: payload.data ?? null,
        createdAt: now,
      };
    },

    getBySession(sessionId: string): EventRow[] {
      return rowsToList(getBySessionStmt.all(sessionId) as Record<string, unknown>[]);
    },

    getBySessionAndAgent(sessionId: string, agentId: string): EventRow[] {
      return rowsToList(getBySessionAndAgentStmt.all(sessionId, agentId) as Record<string, unknown>[]);
    },

    getAll(): (EventRow & { sessionName: string | null })[] {
      return eventsWithSessionToList(getAllStmt.all() as Record<string, unknown>[]);
    },

    getWithSession(sessionId: string): (EventRow & { sessionName: string | null })[] {
      return eventsWithSessionToList(getEventsWithSessionStmt.all(sessionId) as Record<string, unknown>[]);
    },

    getCountByType(): EventCountByType[] {
      return getCountByTypeStmt.all() as unknown as EventCountByType[];
    },
  };
}
