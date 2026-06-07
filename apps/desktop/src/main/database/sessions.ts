import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type {
  KanbanPages,
  SessionPage,
  SessionPageRequest,
  SessionRow,
  SessionWithAgents,
} from "../../shared/agent-db-contract.js";

// Terminal session statuses (vendor + canonical AgentSession vocabulary). A
// session not in this set is treated as active. Writes are owned by
// `lifecycle.ts`; this store is read-only.
const TERMINAL_STATUSES = "('completed', 'abandoned', 'error')";
const TERMINAL_STATUS_SET = new Set(["completed", "abandoned", "error"]);
const MAX_SESSION_PAGE_LIMIT = 100;
const DEFAULT_SESSION_PAGE_LIMIT = 25;
// Correlated subqueries — efficient for bounded queries (LIMIT/single-row).
const SESSION_DETAIL_SELECT = `
  SELECT
    s.*,
    (SELECT COUNT(*) FROM agents a WHERE a.session_id = s.id) as agent_count,
    (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) as event_count,
    (
      SELECT COALESCE(SUM(COALESCE(t.input_tokens, 0) + COALESCE(t.output_tokens, 0)), 0)
      FROM token_usage t
      WHERE t.session_id = s.id
    ) as total_tokens
  FROM sessions s
`;
// CTE-based join — efficient for unbounded multi-row queries (active/historical).
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
  const getDetailsByIdStmt = db.prepare(`
    ${SESSION_DETAIL_SELECT}
    WHERE s.id = ?
  `);

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

  // Statement cache for dynamically-built page queries. Avoids re-preparing
  // on every IPC call while keeping the WHERE clause flexible.
  const stmtCache = new Map<string, ReturnType<typeof db.prepare>>();
  function getOrPrepare(key: string, sql: string) {
    let stmt = stmtCache.get(key);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(key, stmt);
    }
    return stmt;
  }

  function coercePageRequest(request: SessionPageRequest | undefined): {
    limit: number;
    offset: number;
    status: string | null;
    q: string | null;
  } {
    const requestedLimit = request?.limit;
    const limit = typeof requestedLimit === "number" && Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_SESSION_PAGE_LIMIT)
      : DEFAULT_SESSION_PAGE_LIMIT;
    const requestedOffset = request?.offset;
    const offset = typeof requestedOffset === "number" && Number.isInteger(requestedOffset)
      ? Math.max(requestedOffset, 0)
      : 0;
    const status =
      typeof request?.status === "string" && request.status.length > 0
        ? request.status
        : null;
    const q =
      typeof request?.q === "string" && request.q.trim().length > 0
        ? request.q.trim()
        : null;
    return { limit, offset, status, q };
  }

  function pageWhereClause(status: string | null, q: string | null): {
    whereSql: string;
    params: SQLInputValue[];
  } {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (status === "waiting") {
      where.push("s.status NOT IN ('completed', 'abandoned', 'error') AND s.awaiting_input_since IS NOT NULL");
    } else if (status === "running") {
      where.push("s.status NOT IN ('completed', 'abandoned', 'error') AND s.awaiting_input_since IS NULL");
    } else if (status && status !== "all") {
      where.push("s.status = ?");
      params.push(status);
    }
    if (q) {
      // Escape SQLite LIKE wildcards so user search for "%" or "_" does literal matching
      const escaped = q.replace(/[%_]/g, (ch) => `\\${ch}`);
      const like = `%${escaped}%`;
      where.push("(s.id LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\' OR s.cwd LIKE ? ESCAPE '\\' OR s.model LIKE ? ESCAPE '\\')");
      params.push(like, like, like, like);
    }
    return {
      whereSql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
      params,
    };
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

    getDetailsById(id: string): SessionWithAgents | undefined {
      const row = getDetailsByIdStmt.get(id) as Record<string, unknown> | undefined;
      return row ? detailRowsToList([row])[0] : undefined;
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

    getPage(request?: SessionPageRequest): SessionPage {
      const { limit, offset, status, q } = coercePageRequest(request);
      const { whereSql, params } = pageWhereClause(status, q);
      const countStmt = getOrPrepare(`page-count:${whereSql}`,
        `SELECT COUNT(*) as count FROM sessions s ${whereSql}`);
      const selectStmt = getOrPrepare(`page-select:${whereSql}`,
        `${SESSION_DETAIL_SELECT} ${whereSql} ORDER BY s.started_at DESC, s.id DESC LIMIT ? OFFSET ?`);

      const totalRow = countStmt.get(...params) as { count: number };
      const rows = selectStmt.all(...params, limit, offset) as Record<string, unknown>[];

      return {
        sessions: detailRowsToList(rows),
        total: totalRow.count,
        limit,
        offset,
      };
    },

    getKanbanPages(statuses: string[], limit: number): KanbanPages {
      const result: KanbanPages = {};
      for (const status of statuses) {
        result[status] = this.getPage({ limit, status });
      }
      return result;
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
