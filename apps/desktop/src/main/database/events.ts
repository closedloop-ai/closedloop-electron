import type { DatabaseSync } from "node:sqlite";
import type { EventRow, EventCountByType, EventWithSession } from "../../shared/agent-db-contract.js";

// Read-only event store; event writes are owned by `lifecycle.ts`.
export function createEventStore(db: DatabaseSync) {
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

  function toEventWithSession(raw: Record<string, unknown> | undefined): EventWithSession | undefined {
    if (!raw) return undefined;
    const row = toRow(raw);
    if (!row) return undefined;
    return { ...row, sessionName: (raw.session_name as string) ?? null };
  }

  function eventsWithSessionToList(raws: Record<string, unknown>[]): EventWithSession[] {
    return raws.map(toEventWithSession).filter(Boolean) as EventWithSession[];
  }

  function rowsToList(raws: Record<string, unknown>[]): EventRow[] {
    return raws.map(toRow).filter(Boolean) as EventRow[];
  }

  return {
    getBySession(sessionId: string): EventRow[] {
      return rowsToList(getBySessionStmt.all(sessionId) as Record<string, unknown>[]);
    },

    getBySessionAndAgent(sessionId: string, agentId: string): EventRow[] {
      return rowsToList(getBySessionAndAgentStmt.all(sessionId, agentId) as Record<string, unknown>[]);
    },

    getAll(): EventWithSession[] {
      return eventsWithSessionToList(getAllStmt.all() as Record<string, unknown>[]);
    },

    getWithSession(sessionId: string): EventWithSession[] {
      return eventsWithSessionToList(getEventsWithSessionStmt.all(sessionId) as Record<string, unknown>[]);
    },

    getCountByType(): EventCountByType[] {
      return getCountByTypeStmt.all() as unknown as EventCountByType[];
    },
  };
}
