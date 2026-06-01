import type { DatabaseSync } from "node:sqlite";
import type { SessionRow, SessionWithAgents, HookEventPayload } from "./types.js";

export function createSessionStore(db: DatabaseSync) {
  const insertStmt = db.prepare(`
    INSERT INTO sessions (id, name, status, cwd, model, started_at, updated_at, metadata, harness)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateStatusStmt = db.prepare(`
    UPDATE sessions SET status = ?, updated_at = ?, ended_at = ? WHERE id = ?
  `);

  const updateStmt = db.prepare(`
    UPDATE sessions SET name = ?, model = ?, cwd = ?, updated_at = ?, metadata = ? WHERE id = ?
  `);

  const getByIdStmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
  const getAllStmt = db.prepare("SELECT * FROM sessions ORDER BY started_at DESC");
  const getActiveStmt = db.prepare(
    "SELECT * FROM sessions WHERE status NOT IN ('completed', 'failed', 'stopped') ORDER BY started_at DESC",
  );

  const getAllWithDetailsStmt = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM agents a WHERE a.session_id = s.id) as agent_count,
      (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) as event_count,
      (SELECT COALESCE(SUM(COALESCE(t.input_tokens, 0) + COALESCE(t.output_tokens, 0)), 0) FROM token_usage t WHERE t.session_id = s.id) as total_tokens
    FROM sessions s ORDER BY s.started_at DESC
  `);

  function toRow(raw: Record<string, unknown> | undefined): SessionRow | undefined {
    if (!raw) return undefined;
    return {
      id: raw.id as string,
      name: (raw.name as string) ?? null,
      status: raw.status as string,
      cwd: (raw.cwd as string) ?? null,
      model: (raw.model as string) ?? null,
      startedAt: (raw.started_at as string) ?? null,
      updatedAt: (raw.updated_at as string) ?? null,
      endedAt: (raw.ended_at as string) ?? null,
      awaitingInputSince: (raw.awaiting_input_since as string) ?? null,
      metadata: (raw.metadata as string) ?? null,
      harness: (raw.harness as string) ?? null,
    };
  }

  function rowsToList(raws: Record<string, unknown>[]): SessionRow[] {
    return raws.map(toRow).filter(Boolean) as SessionRow[];
  }

  return {
    upsert(payload: HookEventPayload): SessionRow {
      if (!payload.sessionId) throw new Error("sessionId is required");

      const existing = toRow(getByIdStmt.get(payload.sessionId) as Record<string, unknown> | undefined);
      const now = new Date().toISOString();

      if (existing) {
        if (payload.status) {
          const endedAt = ["completed", "failed", "stopped"].includes(payload.status) ? now : null;
          updateStatusStmt.run(payload.status, now, endedAt, payload.sessionId);
        }
        if (payload.name || payload.model || payload.cwd || payload.metadata) {
          updateStmt.run(
            payload.name ?? existing.name,
            payload.model ?? existing.model,
            payload.cwd ?? existing.cwd,
            now,
            payload.metadata ? JSON.stringify(payload.metadata) : existing.metadata,
            payload.sessionId,
          );
        }
        return toRow(getByIdStmt.get(payload.sessionId) as Record<string, unknown>)!;
      }

      insertStmt.run(
        payload.sessionId,
        payload.name ?? null,
        payload.status ?? "running",
        payload.cwd ?? null,
        payload.model ?? null,
        now,
        now,
        payload.metadata ? JSON.stringify(payload.metadata) : null,
        null,
      );

      return toRow(getByIdStmt.get(payload.sessionId) as Record<string, unknown>)!;
    },

    getById(id: string): SessionRow | undefined {
      return toRow(getByIdStmt.get(id) as Record<string, unknown> | undefined);
    },

    getAll(): SessionRow[] {
      return rowsToList(getAllStmt.all() as Record<string, unknown>[]);
    },

    getActive(): SessionRow[] {
      return rowsToList(getActiveStmt.all() as Record<string, unknown>[]);
    },

    getAllWithDetails(): SessionWithAgents[] {
      return (getAllWithDetailsStmt.all() as Record<string, unknown>[]).map((raw) => {
        const base = toRow(raw)!;
        return {
          ...base,
          agentCount: raw.agent_count as number,
          eventCount: raw.event_count as number,
          totalTokens: raw.total_tokens as number,
        };
      });
    },
  };
}
