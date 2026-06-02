import type { DatabaseSync } from "node:sqlite";
import type { SessionRow, SessionWithAgents } from "./types.js";

// Terminal session statuses (vendor + canonical AgentSession vocabulary). A
// session not in this set is treated as active. Writes are owned by
// `lifecycle.ts`; this store is read-only.
const TERMINAL_STATUSES = "('completed', 'abandoned', 'error')";

export function createSessionStore(db: DatabaseSync) {
  const getByIdStmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
  const getAllStmt = db.prepare("SELECT * FROM sessions ORDER BY started_at DESC");
  const getActiveStmt = db.prepare(
    `SELECT * FROM sessions WHERE status NOT IN ${TERMINAL_STATUSES} ORDER BY started_at DESC`,
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
      billingMode: (raw.billing_mode as string) ?? null,
    };
  }

  function rowsToList(raws: Record<string, unknown>[]): SessionRow[] {
    return raws.map(toRow).filter(Boolean) as SessionRow[];
  }

  return {
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
