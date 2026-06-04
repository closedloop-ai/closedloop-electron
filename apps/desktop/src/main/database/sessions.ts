import type { DatabaseSync } from "node:sqlite";
import type { SessionRow, SessionWithAgents } from "../../shared/agent-db-contract.js";

// Terminal session statuses (vendor + canonical AgentSession vocabulary). A
// session not in this set is treated as active. Writes are owned by
// `lifecycle.ts`; this store is read-only.
const TERMINAL_STATUSES = "('completed', 'abandoned', 'error')";
const TERMINAL_STATUS_SET = new Set(["completed", "abandoned", "error"]);
const SESSION_DETAILS_CTES = `
  WITH agent_counts AS (
    SELECT session_id, COUNT(*) as agent_count
    FROM agents
    GROUP BY session_id
  ),
  event_counts AS (
    SELECT session_id, COUNT(*) as event_count
    FROM events
    GROUP BY session_id
  ),
  token_totals AS (
    SELECT
      session_id,
      COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) as total_tokens
    FROM token_usage
    GROUP BY session_id
  )
`;

export function createSessionStore(db: DatabaseSync) {
  const getByIdStmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
  const getAllStmt = db.prepare("SELECT * FROM sessions ORDER BY started_at DESC");
  const getActiveStmt = db.prepare(
    `SELECT * FROM sessions WHERE status NOT IN ${TERMINAL_STATUSES} ORDER BY started_at DESC`,
  );

  const getActiveWithDetailsStmt = db.prepare(`
    ${SESSION_DETAILS_CTES}
    SELECT
      s.*,
      COALESCE(ac.agent_count, 0) as agent_count,
      COALESCE(ec.event_count, 0) as event_count,
      COALESCE(tt.total_tokens, 0) as total_tokens
    FROM sessions s
    LEFT JOIN agent_counts ac ON ac.session_id = s.id
    LEFT JOIN event_counts ec ON ec.session_id = s.id
    LEFT JOIN token_totals tt ON tt.session_id = s.id
    WHERE s.status NOT IN ${TERMINAL_STATUSES}
    ORDER BY s.started_at DESC
  `);
  const getHistoricalWithDetailsStmt = db.prepare(`
    ${SESSION_DETAILS_CTES}
    SELECT
      s.*,
      COALESCE(ac.agent_count, 0) as agent_count,
      COALESCE(ec.event_count, 0) as event_count,
      COALESCE(tt.total_tokens, 0) as total_tokens
    FROM sessions s
    LEFT JOIN agent_counts ac ON ac.session_id = s.id
    LEFT JOIN event_counts ec ON ec.session_id = s.id
    LEFT JOIN token_totals tt ON tt.session_id = s.id
    WHERE s.status IN ${TERMINAL_STATUSES}
    ORDER BY s.started_at DESC
  `);
  let historicalDetailsCache: SessionWithAgents[] | null = null;

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

  function detailRowsToList(raws: Record<string, unknown>[]): SessionWithAgents[] {
    return raws.map((raw) => {
      const base = toRow(raw)!;
      return {
        ...base,
        agentCount: raw.agent_count as number,
        eventCount: raw.event_count as number,
        totalTokens: raw.total_tokens as number,
      };
    });
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

    getActiveWithDetails(): SessionWithAgents[] {
      return detailRowsToList(
        getActiveWithDetailsStmt.all() as Record<string, unknown>[],
      );
    },

    getHistoricalWithDetails(): SessionWithAgents[] {
      if (historicalDetailsCache) {
        return historicalDetailsCache;
      }
      historicalDetailsCache = detailRowsToList(
        getHistoricalWithDetailsStmt.all() as Record<string, unknown>[],
      );
      return historicalDetailsCache;
    },

    getAllWithDetails(): SessionWithAgents[] {
      return [
        ...this.getActiveWithDetails(),
        ...this.getHistoricalWithDetails(),
      ];
    },

    invalidateHistoricalDetails(): void {
      historicalDetailsCache = null;
    },

    handleSessionMutation(sessionId: string): void {
      const session = this.getById(sessionId);
      if (!session || TERMINAL_STATUS_SET.has(session.status)) {
        historicalDetailsCache = null;
      }
    },
  };
}
