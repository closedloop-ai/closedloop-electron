import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PGlite, type Results } from "@electric-sql/pglite";
import {
  type AgentHierarchyNode,
  type AgentRow,
  type AnalyticsData,
  type DashboardSummary,
  type DashboardCoreFeatures,
  type DashboardPackSummary,
  type DashboardPlanSummary,
  type DashboardPullRequestSummary,
  type DashboardSkillSummary,
  type DashboardSubAgentSummary,
  type DashboardToolSummary,
  type EventCountByType,
  type EventRow,
  type EventWithSession,
  type KanbanPages,
  type SessionPage,
  type SessionPageRequest,
  type SessionRow,
  type SessionWithAgents,
  type TokenAnalytics,
  type WorkflowQueryData,
} from "../../shared/agent-db-contract.js";
import { isMeteredApi } from "../../shared/billing-mode.js";
import { resolveBillingMode } from "../billing-mode-detector.js";
import type { MeteredUsageRow } from "../reconciliation-worker.js";
import {
  estimateTokenUsageCostUsd,
  parseJsonObjectText,
  parseJsonValueText,
  resolveBillingModeForRow,
  resolveSessionAttribution,
  type AgentSessionSyncSource,
  type SessionAttributionResolverCache,
  type SessionCursorRow,
} from "../agent-session-sync-service.js";
import type {
  SyncedAgentSession,
  SyncedAgentSessionTokenUsage,
} from "../agent-session-sync-contract.js";
import type {
  Harness,
  NormalizedSession,
  NormalizedToolUse,
} from "../collectors/types.js";
import type {
  HookData,
  ImportResult,
  Importer,
  TokenUsageCounts,
  TokenUsageRow,
} from "../agent-dashboard-db-types.js";
import {
  extractTranscriptTokens,
  type TranscriptExtract,
} from "./transcript.js";

const TERMINAL_STATUSES = "('completed', 'abandoned', 'error')";
const TERMINAL_STATUS_SET = new Set(["completed", "abandoned", "error"]);
const MAX_SESSION_PAGE_LIMIT = 100;
const DEFAULT_SESSION_PAGE_LIMIT = 25;
const COMPACTION_RE = /compact|compress|context.*(reduc|truncat|summar)/i;
const WAITING_INPUT_RE =
  /needs your permission|waiting for your input|is waiting|requires approval|permission to use/i;
const RECENT_ACTIVITY_MS = 10 * 60 * 1000;
const MAX_EVENT_DATA_BYTES = 64 * 1024;

const PGLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  cwd TEXT,
  model TEXT,
  started_at TEXT,
  updated_at TEXT,
  ended_at TEXT,
  awaiting_input_since TEXT,
  metadata TEXT,
  harness TEXT,
  billing_mode TEXT,
  user_id TEXT,
  organization_id TEXT
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT,
  type TEXT,
  subagent_type TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  task TEXT,
  current_tool TEXT,
  started_at TEXT,
  updated_at TEXT,
  ended_at TEXT,
  awaiting_input_since TEXT,
  parent_agent_id TEXT,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_agents_session_id ON agents(session_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(type);
CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_agent_id) WHERE parent_agent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT,
  event_type TEXT NOT NULL,
  tool_name TEXT,
  summary TEXT,
  data TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_agent_id ON events(agent_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_tool_name ON events(tool_name) WHERE tool_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_session_tool ON events(session_id, created_at) WHERE tool_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_tool_created ON events(created_at, tool_name) WHERE tool_name IS NOT NULL;

CREATE TABLE IF NOT EXISTS token_usage (
  session_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  raw_input INTEGER NOT NULL DEFAULT 0,
  raw_output INTEGER NOT NULL DEFAULT 0,
  raw_cache_read INTEGER NOT NULL DEFAULT 0,
  raw_cache_write INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (now()::text),
  updated_at TEXT,
  PRIMARY KEY (session_id, model)
);

CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status_started_at ON sessions(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_organization_id ON sessions(organization_id) WHERE organization_id IS NOT NULL;
`;

interface PgliteExecutor {
  exec(query: string): Promise<Results[]>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    params?: unknown[],
  ): Promise<Results<T>>;
}

interface PgliteClient extends PgliteExecutor {
  transaction<T>(callback: (tx: PgliteExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

interface SessionRowRaw extends Record<string, unknown> {
  id: string;
  status: string;
  harness: string | null;
  billing_mode: string | null;
  model: string | null;
}

interface AgentRowRaw extends Record<string, unknown> {
  id: string;
  status: string;
  type: string | null;
  parent_agent_id: string | null;
}

export interface PgliteAgentDatabase {
  backend: "pglite";
  connection: null;
  importer: Importer;
  syncSource: AgentSessionSyncSource;
  sessions: {
    getById(id: string): Promise<SessionRow | undefined>;
    getAll(): Promise<SessionRow[]>;
    getActive(): Promise<SessionRow[]>;
    getDetailsById(id: string): Promise<SessionWithAgents | undefined>;
    getActiveWithDetails(): Promise<SessionWithAgents[]>;
    getHistoricalWithDetails(): Promise<SessionWithAgents[]>;
    getAllWithDetails(): Promise<SessionWithAgents[]>;
    getPage(request?: SessionPageRequest): Promise<SessionPage>;
    getKanbanPages(statuses: string[], limit: number): Promise<KanbanPages>;
    invalidateHistoricalDetails(): void;
    handleSessionMutation(sessionId: string): Promise<void>;
  };
  agents: {
    getBySession(sessionId: string): Promise<AgentRow[]>;
    getBySessionWithChildren(sessionId: string): Promise<AgentHierarchyNode[]>;
  };
  events: {
    getBySession(sessionId: string): Promise<EventRow[]>;
    getBySessionAndAgent(sessionId: string, agentId: string): Promise<EventRow[]>;
    getAll(): Promise<EventWithSession[]>;
    getWithSession(sessionId: string): Promise<EventWithSession[]>;
    getCountByType(): Promise<EventCountByType[]>;
  };
  tokenUsage: {
    replace(
      sessionId: string,
      model: string,
      counts: TokenUsageCounts,
      now: string,
      tx?: PgliteExecutor,
    ): Promise<void>;
    getBySession(sessionId: string): Promise<TokenUsageRow[]>;
  };
  dashboard: {
    getTokenAnalytics(): Promise<TokenAnalytics>;
    getAnalytics(): Promise<AnalyticsData>;
    getWorkflowData(): Promise<WorkflowQueryData>;
    getCoreFeatures(): Promise<DashboardCoreFeatures>;
    getPacks(): Promise<DashboardPackSummary[]>;
    getSkills(): Promise<DashboardSkillSummary[]>;
    getTools(): Promise<DashboardToolSummary[]>;
    getSubAgents(): Promise<DashboardSubAgentSummary[]>;
    getPlans(): Promise<DashboardPlanSummary[]>;
    getPullRequests(): Promise<DashboardPullRequestSummary[]>;
  };
  getSummary(): Promise<DashboardSummary>;
  run(sql: string, ...params: unknown[]): Promise<void>;
  processEvent(hookType: string, data: HookData, harness: string): Promise<boolean>;
  loadMeteredUsageRows(cutoffIso: string): Promise<MeteredUsageRow[]>;
  close(): Promise<void>;
}

export interface OpenPgliteAgentDatabaseOptions {
  dataDir: string;
  detectBillingMode: (harness: string) => string;
  emit?: (sessionId: string) => void;
  extractTranscript?: (path: string) => TranscriptExtract | null;
  getUserIdentity?: () => { userId: string | null; organizationId: string | null } | null;
  log?: (message: string) => void;
  now?: () => string;
  staleMinutes?: number;
}

export async function openPgliteAgentDatabase(
  options: OpenPgliteAgentDatabaseOptions,
): Promise<PgliteAgentDatabase> {
  await mkdir(path.dirname(options.dataDir), { recursive: true });
  const db = await PGlite.create(options.dataDir) as PgliteClient;
  await db.exec(PGLITE_SCHEMA);

  const log = options.log ?? (() => {});
  const nowFn = options.now ?? (() => new Date().toISOString());
  const tokenUsage = createPgliteTokenUsageStore(db);
  const events = createPgliteEventStore(db);
  const sessions = createPgliteSessionStore(db);
  const agents = createPgliteAgentStore(db, events);
  const dashboard = createPgliteDashboardQueries(db);
  const queue = createWriteQueue();

  const database: PgliteAgentDatabase = {
    backend: "pglite",
    connection: null,
    importer: createPgliteImporter(db, queue, tokenUsage, {
      detectBillingMode: options.detectBillingMode,
      now: nowFn,
      log,
    }),
    syncSource: createPgliteSessionSyncSource(db),
    sessions,
    agents,
    events,
    tokenUsage,
    dashboard,
    getSummary: () => dashboard.getSummary(),
    run: async (sql: string, ...params: unknown[]) => {
      await db.query(sql, params);
    },
    processEvent: createPgliteLifecycle(db, queue, tokenUsage, {
      detectBillingMode: options.detectBillingMode,
      emit: options.emit,
      extractTranscript: options.extractTranscript,
      getUserIdentity: options.getUserIdentity,
      log,
      now: nowFn,
      staleMinutes: options.staleMinutes,
    }).processEvent,
    loadMeteredUsageRows: (cutoffIso: string) =>
      loadPgliteMeteredUsageRows(db, cutoffIso),
    close: () => db.close(),
  };

  return database;
}

function createWriteQueue() {
  let tail = Promise.resolve();
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const next = tail.then(fn, fn);
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}

function createPgliteSessionStore(db: PgliteClient) {
  let historicalDetailsCache: SessionWithAgents[] | null = null;

  return {
    async getById(id: string): Promise<SessionRow | undefined> {
      const result = await db.query("SELECT * FROM sessions WHERE id = $1", [id]);
      return toSessionRow(result.rows[0]);
    },
    async getAll(): Promise<SessionRow[]> {
      const result = await db.query("SELECT * FROM sessions ORDER BY started_at DESC");
      return result.rows.map(toSessionRow).filter(Boolean) as SessionRow[];
    },
    async getActive(): Promise<SessionRow[]> {
      const result = await db.query(
        `SELECT * FROM sessions WHERE status NOT IN ${TERMINAL_STATUSES} ORDER BY started_at DESC`,
      );
      return result.rows.map(toSessionRow).filter(Boolean) as SessionRow[];
    },
    async getDetailsById(id: string): Promise<SessionWithAgents | undefined> {
      const result = await db.query(`${sessionDetailsCtes()}
        SELECT
          s.*,
          COALESCE(ac.agent_count, 0)::int as agent_count,
          COALESCE(ec.event_count, 0)::int as event_count,
          COALESCE(tt.total_tokens, 0) as total_tokens
        FROM sessions s
        LEFT JOIN agent_counts ac ON ac.session_id = s.id
        LEFT JOIN event_counts ec ON ec.session_id = s.id
        LEFT JOIN token_totals tt ON tt.session_id = s.id
        WHERE s.id = $1
      `, [id]);
      return detailRowsToList(result.rows)[0];
    },
    async getActiveWithDetails(): Promise<SessionWithAgents[]> {
      const result = await db.query(`${sessionDetailsCtes()}
        SELECT
          s.*,
          COALESCE(ac.agent_count, 0)::int as agent_count,
          COALESCE(ec.event_count, 0)::int as event_count,
          COALESCE(tt.total_tokens, 0) as total_tokens
        FROM sessions s
        LEFT JOIN agent_counts ac ON ac.session_id = s.id
        LEFT JOIN event_counts ec ON ec.session_id = s.id
        LEFT JOIN token_totals tt ON tt.session_id = s.id
        WHERE s.status NOT IN ${TERMINAL_STATUSES}
        ORDER BY s.started_at DESC
      `);
      return detailRowsToList(result.rows);
    },
    async getHistoricalWithDetails(): Promise<SessionWithAgents[]> {
      if (historicalDetailsCache) {
        return historicalDetailsCache;
      }
      const result = await db.query(`${sessionDetailsCtes()}
        SELECT
          s.*,
          COALESCE(ac.agent_count, 0)::int as agent_count,
          COALESCE(ec.event_count, 0)::int as event_count,
          COALESCE(tt.total_tokens, 0) as total_tokens
        FROM sessions s
        LEFT JOIN agent_counts ac ON ac.session_id = s.id
        LEFT JOIN event_counts ec ON ec.session_id = s.id
        LEFT JOIN token_totals tt ON tt.session_id = s.id
        WHERE s.status IN ${TERMINAL_STATUSES}
        ORDER BY s.started_at DESC
      `);
      historicalDetailsCache = detailRowsToList(result.rows);
      return historicalDetailsCache;
    },
    async getAllWithDetails(): Promise<SessionWithAgents[]> {
      return [
        ...await this.getActiveWithDetails(),
        ...await this.getHistoricalWithDetails(),
      ];
    },
    async getPage(request?: SessionPageRequest): Promise<SessionPage> {
      const { limit, offset, status, q } = coercePageRequest(request);
      const { whereSql, params } = pageWhereClause(status, q);
      const totalResult = await db.query<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM sessions s ${whereSql}`,
        params,
      );
      const rowsResult = await db.query(`${sessionDetailsCtes()}
        SELECT
          s.*,
          COALESCE(ac.agent_count, 0)::int as agent_count,
          COALESCE(ec.event_count, 0)::int as event_count,
          COALESCE(tt.total_tokens, 0) as total_tokens
        FROM sessions s
        LEFT JOIN agent_counts ac ON ac.session_id = s.id
        LEFT JOIN event_counts ec ON ec.session_id = s.id
        LEFT JOIN token_totals tt ON tt.session_id = s.id
        ${whereSql}
        ORDER BY s.started_at DESC, s.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `, [...params, limit, offset]);

      return {
        sessions: detailRowsToList(rowsResult.rows),
        total: Number(totalResult.rows[0]?.count ?? 0),
        limit,
        offset,
      };
    },
    async getKanbanPages(statuses: string[], limit: number): Promise<KanbanPages> {
      const result: KanbanPages = {};
      for (const status of statuses) {
        result[status] = await this.getPage({ limit, status });
      }
      return result;
    },
    invalidateHistoricalDetails(): void {
      historicalDetailsCache = null;
    },
    async handleSessionMutation(sessionId: string): Promise<void> {
      const session = await this.getById(sessionId);
      if (!session || TERMINAL_STATUS_SET.has(session.status)) {
        historicalDetailsCache = null;
      }
    },
  };
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
  params: unknown[];
} {
  const where: string[] = [];
  const params: unknown[] = [];
  if (status === "waiting") {
    where.push("s.status NOT IN ('completed', 'abandoned', 'error') AND s.awaiting_input_since IS NOT NULL");
  } else if (status === "running") {
    where.push("s.status NOT IN ('completed', 'abandoned', 'error') AND s.awaiting_input_since IS NULL");
  } else if (status && status !== "all") {
    params.push(status);
    where.push(`s.status = $${params.length}`);
  }
  if (q) {
    const escaped = q.replace(/[%_]/g, (ch) => `\\${ch}`);
    const like = `%${escaped}%`;
    const start = params.length + 1;
    params.push(like, like, like, like);
    where.push(
      `(s.id LIKE $${start} ESCAPE '\\' OR s.name LIKE $${start + 1} ESCAPE '\\' OR s.cwd LIKE $${start + 2} ESCAPE '\\' OR s.model LIKE $${start + 3} ESCAPE '\\')`,
    );
  }
  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

function createPgliteAgentStore(
  db: PgliteClient,
  eventStore: ReturnType<typeof createPgliteEventStore>,
) {
  return {
    async getBySession(sessionId: string): Promise<AgentRow[]> {
      const result = await db.query(
        "SELECT * FROM agents WHERE session_id = $1 ORDER BY started_at ASC",
        [sessionId],
      );
      return result.rows.map(toAgentRow).filter(Boolean) as AgentRow[];
    },
    async getBySessionWithChildren(sessionId: string): Promise<AgentHierarchyNode[]> {
      const result = await db.query(
        `SELECT a.*,
          (SELECT COUNT(*)::int FROM agents child WHERE child.parent_agent_id = a.id) as children_count
        FROM agents a WHERE a.session_id = $1 ORDER BY a.started_at ASC`,
        [sessionId],
      );
      const allAgents = result.rows.map(toAgentRow).filter(Boolean) as AgentRow[];
      const eventsByAgent = new Map<string, AgentHierarchyNode["events"]>();
      for (const e of await eventStore.getBySession(sessionId)) {
        if (!e.agentId) continue;
        const list = eventsByAgent.get(e.agentId) ?? [];
        list.push({
          eventType: e.eventType,
          toolName: e.toolName,
          summary: e.summary,
          createdAt: e.createdAt,
        });
        eventsByAgent.set(e.agentId, list);
      }

      const agentMap = new Map<string, AgentHierarchyNode>();
      const roots: AgentHierarchyNode[] = [];
      for (const agent of allAgents) {
        agentMap.set(agent.id, {
          agentId: agent.id,
          name: agent.name,
          type: agent.type,
          subagentType: agent.subagentType,
          status: agent.status,
          task: agent.task,
          currentTool: agent.currentTool,
          children: [],
          events: eventsByAgent.get(agent.id) ?? [],
        });
      }
      for (const agent of allAgents) {
        const node = agentMap.get(agent.id)!;
        if (agent.parentAgentId && agentMap.has(agent.parentAgentId)) {
          agentMap.get(agent.parentAgentId)!.children.push(node);
        } else {
          roots.push(node);
        }
      }
      return roots;
    },
  };
}

function createPgliteEventStore(db: PgliteClient) {
  return {
    async getBySession(sessionId: string): Promise<EventRow[]> {
      const result = await db.query(
        "SELECT * FROM events WHERE session_id = $1 ORDER BY created_at ASC",
        [sessionId],
      );
      return result.rows.map(toEventRow).filter(Boolean) as EventRow[];
    },
    async getBySessionAndAgent(sessionId: string, agentId: string): Promise<EventRow[]> {
      const result = await db.query(
        "SELECT * FROM events WHERE session_id = $1 AND agent_id = $2 ORDER BY created_at ASC",
        [sessionId, agentId],
      );
      return result.rows.map(toEventRow).filter(Boolean) as EventRow[];
    },
    async getAll(): Promise<EventWithSession[]> {
      const result = await db.query(
        "SELECT e.*, s.name as session_name FROM events e LEFT JOIN sessions s ON s.id = e.session_id ORDER BY e.created_at DESC LIMIT 200",
      );
      return result.rows.map(toEventWithSession).filter(Boolean) as EventWithSession[];
    },
    async getWithSession(sessionId: string): Promise<EventWithSession[]> {
      const result = await db.query(
        "SELECT e.*, s.name as session_name FROM events e LEFT JOIN sessions s ON s.id = e.session_id WHERE e.session_id = $1 ORDER BY e.created_at ASC",
        [sessionId],
      );
      return result.rows.map(toEventWithSession).filter(Boolean) as EventWithSession[];
    },
    async getCountByType(): Promise<EventCountByType[]> {
      const result = await db.query(
        "SELECT event_type as event_type, COUNT(*)::int as count FROM events GROUP BY event_type ORDER BY count DESC",
      );
      return result.rows.map((row) => ({
        eventType: row.event_type as string,
        count: Number(row.count ?? 0),
      }));
    },
  };
}

function createPgliteTokenUsageStore(db: PgliteClient) {
  return {
    async replace(
      sessionId: string,
      model: string,
      counts: TokenUsageCounts,
      now: string,
      tx: PgliteExecutor = db,
    ): Promise<void> {
      if (
        counts.input === 0 &&
        counts.output === 0 &&
        counts.cacheRead === 0 &&
        counts.cacheWrite === 0
      ) {
        return;
      }
      await tx.query(
        `
          INSERT INTO token_usage (
            session_id, model,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
            raw_input, raw_output, raw_cache_read, raw_cache_write,
            created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $3, $4, $5, $6, $7, $7)
          ON CONFLICT (session_id, model) DO UPDATE SET
            input_tokens = token_usage.input_tokens + (CASE WHEN EXCLUDED.raw_input < token_usage.raw_input
              THEN EXCLUDED.raw_input ELSE EXCLUDED.raw_input - token_usage.raw_input END),
            output_tokens = token_usage.output_tokens + (CASE WHEN EXCLUDED.raw_output < token_usage.raw_output
              THEN EXCLUDED.raw_output ELSE EXCLUDED.raw_output - token_usage.raw_output END),
            cache_read_tokens = token_usage.cache_read_tokens + (CASE WHEN EXCLUDED.raw_cache_read < token_usage.raw_cache_read
              THEN EXCLUDED.raw_cache_read ELSE EXCLUDED.raw_cache_read - token_usage.raw_cache_read END),
            cache_write_tokens = token_usage.cache_write_tokens + (CASE WHEN EXCLUDED.raw_cache_write < token_usage.raw_cache_write
              THEN EXCLUDED.raw_cache_write ELSE EXCLUDED.raw_cache_write - token_usage.raw_cache_write END),
            raw_input = EXCLUDED.raw_input,
            raw_output = EXCLUDED.raw_output,
            raw_cache_read = EXCLUDED.raw_cache_read,
            raw_cache_write = EXCLUDED.raw_cache_write,
            updated_at = EXCLUDED.updated_at
        `,
        [
          sessionId,
          model,
          counts.input,
          counts.output,
          counts.cacheRead,
          counts.cacheWrite,
          now,
        ],
      );
    },
    async getBySession(sessionId: string): Promise<TokenUsageRow[]> {
      const result = await db.query(
        `SELECT session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
         FROM token_usage WHERE session_id = $1 ORDER BY model ASC`,
        [sessionId],
      );
      return result.rows.map(toTokenUsageRow);
    },
  };
}

function createPgliteDashboardQueries(db: PgliteClient) {
  return {
    async getSummary(): Promise<DashboardSummary> {
      const [
        totalSessions,
        activeSessions,
        totalAgents,
        totalEvents,
        eventTypeCount,
        totalTokens,
        recentSessions,
      ] = await Promise.all([
        count(db, "SELECT COUNT(*)::int as count FROM sessions"),
        count(db, `SELECT COUNT(*)::int as count FROM sessions WHERE status NOT IN ${TERMINAL_STATUSES}`),
        count(db, "SELECT COUNT(*)::int as count FROM agents"),
        count(db, "SELECT COUNT(*)::int as count FROM events"),
        count(db, "SELECT COUNT(DISTINCT event_type)::int as count FROM events"),
        scalarNumber(db, "SELECT COALESCE(SUM(input_tokens::bigint + output_tokens::bigint), 0) as total FROM token_usage", "total"),
        db.query<{
          id: string;
          name: string | null;
          status: string;
          model: string | null;
          cwd: string | null;
          started_at: string | null;
        }>("SELECT id, name, status, model, cwd, started_at FROM sessions ORDER BY started_at DESC LIMIT 10"),
      ]);
      return {
        totalSessions,
        activeSessions,
        totalAgents,
        totalEvents,
        eventTypeCount,
        totalTokens,
        recentSessions: recentSessions.rows.map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status,
          model: s.model,
          cwd: s.cwd,
          startedAt: s.started_at,
        })),
      };
    },
    async getTokenAnalytics(): Promise<TokenAnalytics> {
      const totals = await db.query<{
        total_input: number;
        total_output: number;
        total_cache_read: number;
        total_cache_write: number;
      }>(`
        SELECT COALESCE(SUM(input_tokens), 0) as total_input,
          COALESCE(SUM(output_tokens), 0) as total_output,
          COALESCE(SUM(cache_read_tokens), 0) as total_cache_read,
          COALESCE(SUM(cache_write_tokens), 0) as total_cache_write
        FROM token_usage
      `);
      const byModel = await db.query<{
        model: string;
        input_tokens: number;
        output_tokens: number;
        sessions: number;
      }>(`
        SELECT model,
          SUM(input_tokens) as input_tokens,
          SUM(output_tokens) as output_tokens,
          COUNT(DISTINCT session_id)::int as sessions
        FROM token_usage
        WHERE model IS NOT NULL
        GROUP BY model
        ORDER BY SUM(input_tokens::bigint + output_tokens::bigint) DESC
      `);
      const byDay = await db.query<{
        day: string;
        input_tokens: number;
        output_tokens: number;
      }>(`
        SELECT (created_at::timestamp::date)::text as day,
          SUM(input_tokens) as input_tokens,
          SUM(output_tokens) as output_tokens
        FROM token_usage
        WHERE created_at IS NOT NULL
        GROUP BY created_at::timestamp::date
        ORDER BY day DESC
        LIMIT 30
      `);
      const row = totals.rows[0];
      return {
        totalInputTokens: Number(row?.total_input ?? 0),
        totalOutputTokens: Number(row?.total_output ?? 0),
        totalCacheReadTokens: Number(row?.total_cache_read ?? 0),
        totalCacheWriteTokens: Number(row?.total_cache_write ?? 0),
        byModel: byModel.rows.map((r) => ({
          model: r.model,
          inputTokens: Number(r.input_tokens ?? 0),
          outputTokens: Number(r.output_tokens ?? 0),
          sessions: Number(r.sessions ?? 0),
        })),
        byDay: byDay.rows.map((r) => ({
          day: r.day,
          inputTokens: Number(r.input_tokens ?? 0),
          outputTokens: Number(r.output_tokens ?? 0),
        })),
      };
    },
    async getAnalytics(): Promise<AnalyticsData> {
      const [
        tokens,
        eventsByType,
        toolUsage,
        dailyEvents,
        sessionsByStatus,
        agentsByStatus,
        agentsByType,
        totalSessions,
        totalAgents,
        totalEvents,
      ] = await Promise.all([
        this.getTokenAnalytics(),
        db.query<{ event_type: string; count: number }>("SELECT event_type, COUNT(*)::int as count FROM events GROUP BY event_type ORDER BY count DESC"),
        db.query<{ tool_name: string; count: number }>("SELECT tool_name, COUNT(*)::int as count FROM events WHERE created_at::timestamp > now() - interval '30 days' AND tool_name IS NOT NULL GROUP BY tool_name ORDER BY count DESC LIMIT 20"),
        db.query<{ date: string; count: number }>("SELECT (created_at::timestamp::date)::text as date, COUNT(*)::int as count FROM events WHERE created_at::timestamp > now() - interval '365 days' GROUP BY created_at::timestamp::date ORDER BY date ASC"),
        db.query<{ status: string; count: number }>("SELECT status, COUNT(*)::int as count FROM sessions GROUP BY status"),
        db.query<{ status: string; count: number }>("SELECT status, COUNT(*)::int as count FROM agents GROUP BY status"),
        db.query<{ type: string; count: number }>("SELECT COALESCE(type, 'unknown') as type, COUNT(*)::int as count FROM agents GROUP BY type ORDER BY count DESC"),
        count(db, "SELECT COUNT(*)::int as count FROM sessions"),
        count(db, "SELECT COUNT(*)::int as count FROM agents"),
        count(db, "SELECT COUNT(*)::int as count FROM events"),
      ]);
      return {
        tokens,
        eventsByType: eventsByType.rows.map((r) => ({ eventType: r.event_type, count: Number(r.count ?? 0) })),
        toolUsage: toolUsage.rows.map((r) => ({ toolName: r.tool_name, count: Number(r.count ?? 0) })),
        dailyEvents: dailyEvents.rows.map((r) => ({ date: r.date, count: Number(r.count ?? 0) })),
        sessionsByStatus: sessionsByStatus.rows.map((r) => ({ status: r.status, count: Number(r.count ?? 0) })),
        agentsByStatus: agentsByStatus.rows.map((r) => ({ status: r.status, count: Number(r.count ?? 0) })),
        agentsByType: agentsByType.rows.map((r) => ({ type: r.type, count: Number(r.count ?? 0) })),
        totalSessions,
        totalAgents,
        totalEvents,
      };
    },
    async getWorkflowData(): Promise<WorkflowQueryData> {
      const totalSessions = await count(db, "SELECT COUNT(*)::int as count FROM sessions");
      const totalAgents = await count(db, "SELECT COUNT(*)::int as count FROM agents");
      const totalSubagents = await count(db, "SELECT COUNT(*)::int as count FROM agents WHERE type = 'subagent' OR parent_agent_id IS NOT NULL");
      const completedAgents = await count(db, "SELECT COUNT(*)::int as count FROM agents WHERE status = 'completed'");
      const errorAgents = await count(db, "SELECT COUNT(*)::int as count FROM agents WHERE status = 'failed' OR status = 'error'");
      const depthRows = await db.query<{ session_id: string; max_depth: number }>(`
        WITH RECURSIVE agent_depth(id, session_id, depth) AS (
          SELECT id, session_id, 0 FROM agents WHERE parent_agent_id IS NULL
          UNION ALL
          SELECT a.id, a.session_id, ad.depth + 1
          FROM agents a JOIN agent_depth ad ON a.parent_agent_id = ad.id
        )
        SELECT session_id, MAX(depth)::int as max_depth FROM agent_depth GROUP BY session_id
      `);
      const durationRow = await db.query<{ avg: number | null }>(`
        SELECT AVG(EXTRACT(EPOCH FROM ((COALESCE(ended_at, updated_at))::timestamp - started_at::timestamp))) as avg
        FROM sessions WHERE started_at IS NOT NULL
      `);
      const subagentTypes = await db.query<{
        subagent_type: string;
        count: number;
        completed: number;
        errors: number;
      }>(`
        SELECT COALESCE(agents.subagent_type, COALESCE(MAX(agents.name), 'unknown')) as subagent_type,
          COUNT(*)::int as count,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::int as completed,
          SUM(CASE WHEN status IN ('failed', 'error') THEN 1 ELSE 0 END)::int as errors
        FROM agents WHERE parent_agent_id IS NOT NULL OR type = 'subagent'
        GROUP BY agents.subagent_type ORDER BY count DESC
      `);
      const mainCount = await count(db, "SELECT COUNT(*)::int as count FROM agents WHERE parent_agent_id IS NULL AND (type IS NULL OR type != 'subagent')");
      const edges = await db.query<{ source: string; target: string; weight: number }>(`
        SELECT COALESCE(p.subagent_type, COALESCE(MAX(p.name), 'main')) as source,
          COALESCE(c.subagent_type, COALESCE(MAX(c.name), 'unknown')) as target,
          COUNT(*)::int as weight
        FROM agents c JOIN agents p ON c.parent_agent_id = p.id
        GROUP BY p.subagent_type, c.subagent_type ORDER BY weight DESC LIMIT 50
      `);
      const outcomes = await db.query<{ status: string; count: number }>("SELECT status, COUNT(*)::int as count FROM sessions GROUP BY status");
      const toolTransitions = await db.query<{ source: string; target: string; value: number }>(`
        WITH recent_tools AS (
          SELECT tool_name, session_id, created_at, id
          FROM events
          WHERE tool_name IS NOT NULL
            AND created_at::timestamp > now() - interval '7 days'
        ),
        tool_seq AS (
          SELECT tool_name,
            LEAD(tool_name) OVER (PARTITION BY session_id ORDER BY created_at, id) as next_tool
          FROM recent_tools
        )
        SELECT tool_name as source, next_tool as target, COUNT(*)::int as value
        FROM tool_seq
        WHERE next_tool IS NOT NULL
        GROUP BY source, target ORDER BY value DESC LIMIT 30
      `);
      const toolCounts = await db.query<{ tool_name: string; count: number }>("SELECT tool_name, COUNT(*)::int as count FROM events WHERE created_at::timestamp > now() - interval '30 days' AND tool_name IS NOT NULL GROUP BY tool_name ORDER BY count DESC LIMIT 20");
      const cooccurrence = await db.query<{ source: string; target: string; weight: number }>(`
        SELECT COALESCE(a1.subagent_type, COALESCE(MAX(a1.name), 'unknown')) as source,
          COALESCE(a2.subagent_type, COALESCE(MAX(a2.name), 'unknown')) as target,
          COUNT(DISTINCT a1.session_id)::int as weight
        FROM agents a1 JOIN agents a2 ON a1.session_id = a2.session_id AND a1.id < a2.id
        GROUP BY a1.subagent_type, a2.subagent_type ORDER BY weight DESC LIMIT 30
      `);
      const avgDepth = depthRows.rows.length > 0
        ? depthRows.rows.reduce((sum, row) => sum + Number(row.max_depth ?? 0), 0) / depthRows.rows.length
        : 0;
      const successRate = completedAgents + errorAgents > 0
        ? completedAgents / (completedAgents + errorAgents) * 100
        : 100;
      const mappedSubagentTypes = subagentTypes.rows.map((row) => ({
        subagentType: row.subagent_type,
        count: Number(row.count ?? 0),
        completed: Number(row.completed ?? 0),
        errors: Number(row.errors ?? 0),
      }));
      return {
        stats: {
          totalSessions,
          totalAgents,
          totalSubagents,
          avgSubagents: totalSessions > 0 ? totalSubagents / totalSessions : 0,
          successRate,
          avgDepth,
          avgDurationSec: Number(durationRow.rows[0]?.avg ?? 0),
          totalCompactions: 0,
          avgCompactions: 0,
          topFlow: toolTransitions.rows.length > 0
            ? {
                source: toolTransitions.rows[0].source,
                target: toolTransitions.rows[0].target,
                count: Number(toolTransitions.rows[0].value ?? 0),
              }
            : null,
        },
        orchestration: {
          sessionCount: totalSessions,
          mainCount,
          subagentTypes: mappedSubagentTypes,
          edges: edges.rows.map((r) => ({ source: r.source, target: r.target, weight: Number(r.weight ?? 0) })),
          outcomes: outcomes.rows.map((r) => ({ status: r.status, count: Number(r.count ?? 0) })),
          compactions: { total: 0, sessions: 0 },
        },
        toolFlow: {
          transitions: toolTransitions.rows.map((r) => ({ source: r.source, target: r.target, value: Number(r.value ?? 0) })),
          toolCounts: toolCounts.rows.map((r) => ({ toolName: r.tool_name, count: Number(r.count ?? 0) })),
        },
        effectiveness: mappedSubagentTypes.map((st) => ({
          subagentType: st.subagentType,
          total: st.count,
          completed: st.completed,
          errors: st.errors,
          sessions: 0,
          successRate: st.count > 0 ? st.completed / st.count * 100 : 0,
          avgDuration: null,
          trend: [],
        })),
        cooccurrence: cooccurrence.rows.map((r) => ({ source: r.source, target: r.target, weight: Number(r.weight ?? 0) })),
      };
    },
    async getCoreFeatures(): Promise<DashboardCoreFeatures> {
      const [packs, skills, tools, subagents, plans, pullRequests] =
        await Promise.all([
          this.getPacks(),
          this.getSkills(),
          this.getTools(),
          this.getSubAgents(),
          this.getPlans(),
          this.getPullRequests(),
        ]);
      return { packs, skills, tools, subagents, plans, pullRequests };
    },
    async getPacks(): Promise<DashboardPackSummary[]> {
      const skills = await this.getSkills();
      const packs = new Map<string, DashboardPackSummary>();
      for (const skill of skills) {
        if (!skill.packId) {
          continue;
        }
        const existing = packs.get(skill.packId);
        if (existing) {
          existing.skillCount++;
          existing.toolCallCount += skill.invocationCount;
          existing.lastUsedAt = maxIso(existing.lastUsedAt, skill.lastUsedAt);
          continue;
        }
        packs.set(skill.packId, {
          id: skill.packId,
          name: titleFromId(skill.packId),
          harness: skill.harness,
          installPath: null,
          sourceUrl: null,
          version: null,
          skillCount: 1,
          toolCallCount: skill.invocationCount,
          lastUsedAt: skill.lastUsedAt,
        });
      }
      return [...packs.values()].sort(compareLastUsedThenName);
    },
    async getSkills(): Promise<DashboardSkillSummary[]> {
      const result = await db.query<{
        harness: string | null;
        data: string | null;
        summary: string | null;
        created_at: string | null;
      }>(`
        SELECT s.harness, e.data, e.summary, e.created_at
        FROM events e
        LEFT JOIN sessions s ON s.id = e.session_id
        WHERE e.tool_name = 'Skill'
        ORDER BY e.created_at DESC
      `);
      const grouped = new Map<string, DashboardSkillSummary>();
      for (const row of result.rows) {
        const data = parseJsonObjectText(row.data);
        const name =
          nonEmptyString(data?.skillName) ??
          nonEmptyString(data?.skill) ??
          nonEmptyString(data?.name) ??
          nonEmptyString(row.summary);
        if (!name) {
          continue;
        }
        const harness = nonEmptyString(row.harness) ?? "unknown";
        const packId = packIdFromSkillName(name);
        const id = `${harness}:${packId ?? "standalone"}:${name}`;
        const existing = grouped.get(id);
        if (existing) {
          existing.invocationCount++;
          existing.lastUsedAt = maxIso(existing.lastUsedAt, row.created_at ?? null);
          continue;
        }
        grouped.set(id, {
          id,
          packId,
          name,
          harness,
          description: nonEmptyString(data?.description) ?? null,
          installPath: nonEmptyString(data?.installPath) ?? nonEmptyString(data?.path) ?? null,
          invocationCount: 1,
          lastUsedAt: row.created_at ?? null,
        });
      }
      return [...grouped.values()].sort(compareLastUsedThenName);
    },
    async getTools(): Promise<DashboardToolSummary[]> {
      const result = await db.query<{
        tool_name: string;
        invocation_count: number;
        session_count: number;
        last_used_at: string | null;
      }>(`
        SELECT tool_name,
          COUNT(*)::int as invocation_count,
          COUNT(DISTINCT session_id)::int as session_count,
          MAX(created_at) as last_used_at
        FROM events
        WHERE tool_name IS NOT NULL
        GROUP BY tool_name
        ORDER BY invocation_count DESC, tool_name ASC
      `);
      return result.rows.map((row) => ({
        toolName: row.tool_name,
        invocationCount: Number(row.invocation_count ?? 0),
        sessionCount: Number(row.session_count ?? 0),
        lastUsedAt: row.last_used_at ?? null,
      }));
    },
    async getSubAgents(): Promise<DashboardSubAgentSummary[]> {
      const result = await db.query<{
        subagent_type: string;
        total: number;
        completed: number;
        errors: number;
        sessions: number;
        last_used_at: string | null;
      }>(`
        SELECT COALESCE(agents.subagent_type, COALESCE(MAX(agents.name), 'unknown')) as subagent_type,
          COUNT(*)::int as total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::int as completed,
          SUM(CASE WHEN status IN ('failed', 'error') THEN 1 ELSE 0 END)::int as errors,
          COUNT(DISTINCT session_id)::int as sessions,
          MAX(updated_at) as last_used_at
        FROM agents
        WHERE parent_agent_id IS NOT NULL OR type = 'subagent'
        GROUP BY agents.subagent_type
        ORDER BY total DESC, subagent_type ASC
      `);
      return result.rows.map((row) => ({
        subagentType: row.subagent_type,
        total: Number(row.total ?? 0),
        completed: Number(row.completed ?? 0),
        errors: Number(row.errors ?? 0),
        sessions: Number(row.sessions ?? 0),
        lastUsedAt: row.last_used_at ?? null,
      }));
    },
    async getPlans(): Promise<DashboardPlanSummary[]> {
      const result = await db.query<{
        id: string;
        cwd: string | null;
        harness: string | null;
        metadata: string | null;
        updated_at: string | null;
      }>(`
        SELECT id, cwd, harness, metadata, updated_at
        FROM sessions
        WHERE metadata IS NOT NULL
        ORDER BY updated_at DESC
      `);
      const plans: DashboardPlanSummary[] = [];
      const seen = new Set<string>();
      for (const session of result.rows) {
        const metadata = parseJsonObjectText(session.metadata);
        const rawPlans = Array.isArray(metadata?.plans) ? metadata.plans : [];
        for (const [index, rawPlan] of rawPlans.entries()) {
          const plan = asRecord(rawPlan);
          const content = nonEmptyString(plan?.content);
          if (!content) {
            continue;
          }
          const timestamp = nonEmptyString(plan?.timestamp) ?? session.updated_at ?? null;
          const id = `${session.id}:plan:${index}`;
          if (seen.has(id)) {
            continue;
          }
          seen.add(id);
          plans.push({
            id,
            sessionId: session.id,
            title: titleFromPlan(content),
            source: nonEmptyString(plan?.source) ?? null,
            content,
            timestamp,
            harness: session.harness,
            cwd: session.cwd,
          });
        }
      }
      return plans.sort((a, b) => compareIsoDesc(a.timestamp, b.timestamp));
    },
    async getPullRequests(): Promise<DashboardPullRequestSummary[]> {
      const result = await db.query<{
        id: string;
        name: string | null;
        harness: string | null;
        metadata: string | null;
        updated_at: string | null;
      }>(`
        SELECT id, name, harness, metadata, updated_at
        FROM sessions
        WHERE metadata IS NOT NULL
        ORDER BY updated_at DESC
      `);
      const pullRequests: DashboardPullRequestSummary[] = [];
      const seen = new Set<string>();
      for (const session of result.rows) {
        const metadata = parseJsonObjectText(session.metadata);
        const artifacts = asRecord(metadata?.artifacts);
        const repoFallback = nonEmptyString(artifacts?.repo);
        const prs = Array.isArray(artifacts?.prs) ? artifacts.prs : [];
        for (const rawPr of prs) {
          const pr = asRecord(rawPr);
          const number = numberFromUnknown(pr?.number);
          const repoFullName = nonEmptyString(pr?.repo) ?? repoFallback;
          if (number == null || !repoFullName) {
            continue;
          }
          const id = `${session.id}:pr:${repoFullName}:${number}`;
          if (seen.has(id)) {
            continue;
          }
          seen.add(id);
          pullRequests.push({
            id,
            sessionId: session.id,
            sessionName: session.name,
            prUrl: `https://github.com/${repoFullName}/pull/${number}`,
            prNumber: number,
            repoFullName,
            branchName: nonEmptyString(pr?.branch) ?? nonEmptyString(pr?.branchName) ?? null,
            headSha: nonEmptyString(pr?.headSha) ?? nonEmptyString(pr?.sha) ?? null,
            title: nonEmptyString(pr?.title) ?? null,
            harness: session.harness,
            observedAt: session.updated_at,
          });
        }
      }
      return pullRequests.sort((a, b) => compareIsoDesc(a.observedAt, b.observedAt));
    },
  };
}

function createPgliteLifecycle(
  db: PgliteClient,
  queue: ReturnType<typeof createWriteQueue>,
  tokenUsage: ReturnType<typeof createPgliteTokenUsageStore>,
  deps: {
    detectBillingMode: (harness: string) => string;
    emit?: (sessionId: string) => void;
    extractTranscript?: (path: string) => TranscriptExtract | null;
    getUserIdentity?: () => { userId: string | null; organizationId: string | null } | null;
    log: (message: string) => void;
    now: () => string;
    staleMinutes?: number;
  },
) {
  const staleMinutes = deps.staleMinutes ?? 180;
  const extract = deps.extractTranscript ?? extractTranscriptTokens;

  return {
    async processEvent(hookType: string, data: HookData, harness: string): Promise<boolean> {
      const sessionId = data.session_id;
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        return false;
      }
      let transcript: TranscriptExtract | null = null;
      if (data.transcript_path) {
        try {
          transcript = extract(data.transcript_path);
        } catch {
          transcript = null;
        }
      }
      const now = deps.now();
      const processed = await queue.run(async () => {
        try {
          await db.transaction(async (tx) => {
            await handleHook(tx, {
              data,
              hookType,
              harness,
              now,
              sessionId,
              staleMinutes,
              tokenUsage,
              transcript,
              detectBillingMode: deps.detectBillingMode,
              getUserIdentity: deps.getUserIdentity,
            });
          });
          return true;
        } catch (error) {
          deps.log(
            `pglite lifecycle: failed to process ${hookType}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return false;
        }
      });
      if (processed) {
        try {
          deps.emit?.(sessionId);
        } catch {
          /* live-update push is best-effort */
        }
      }
      return processed;
    },
  };
}

async function handleHook(
  tx: PgliteExecutor,
  options: {
    data: HookData;
    hookType: string;
    harness: string;
    now: string;
    sessionId: string;
    staleMinutes: number;
    tokenUsage: ReturnType<typeof createPgliteTokenUsageStore>;
    transcript: TranscriptExtract | null;
    detectBillingMode: (harness: string) => string;
    getUserIdentity?: () => { userId: string | null; organizationId: string | null } | null;
  },
): Promise<void> {
  const { data, hookType, harness, now, sessionId } = options;
  const main = mainAgentId(sessionId);
  await ensureSession(tx, sessionId, data, harness, now, options.detectBillingMode, options.getUserIdentity);
  const session = await getSession(tx, sessionId);
  if (!session) {
    return;
  }
  await maybeReactivate(tx, session, hookType, now);
  await tx.query("UPDATE sessions SET updated_at = $1 WHERE id = $2", [now, sessionId]);

  switch (hookType) {
    case "SessionStart":
      await setMainWaiting(tx, sessionId, now);
      await sweepStaleSessions(tx, sessionId, now, options.staleMinutes);
      await insertEvent(tx, sessionId, main, "SessionStart", data, now, data.source === "resume" ? "Resumed session" : "Started session");
      break;
    case "UserPromptSubmit":
      await clearAwaitingInput(tx, sessionId, now);
      await promoteMain(tx, main, now);
      await insertEvent(tx, sessionId, main, "UserPromptSubmit", data, now);
      break;
    case "PreToolUse":
      await clearAwaitingInput(tx, sessionId, now);
      if (data.tool_name === "Agent" || data.tool_name === "Task") {
        const agentId = await spawnSubagent(tx, sessionId, data, now);
        await insertEvent(tx, sessionId, agentId, "PreToolUse", data, now, "Spawned subagent");
      } else {
        await setAgentTool(tx, main, data.tool_name ?? null, now);
        await insertEvent(tx, sessionId, main, "PreToolUse", data, now);
      }
      break;
    case "PostToolUse": {
      await clearAwaitingInput(tx, sessionId, now);
      const mainAgent = await getAgent(tx, main);
      if (mainAgent && mainAgent.status === "working") {
        await setAgentTool(tx, main, null, now);
      }
      await insertEvent(tx, sessionId, main, "PostToolUse", data, now);
      break;
    }
    case "Stop":
      if (data.stop_reason === "error") {
        await setAgentStatus(tx, main, "error", now);
        await setSessionStatus(tx, sessionId, "error", now);
        await clearAwaitingInput(tx, sessionId, now);
      } else {
        await setMainWaiting(tx, sessionId, now);
      }
      await insertEvent(tx, sessionId, main, "Stop", data, now);
      break;
    case "SubagentStop": {
      const agentId = await matchSubagent(tx, sessionId, data);
      if (agentId) {
        await setAgentStatus(tx, agentId, "completed", now);
      }
      await insertEvent(tx, sessionId, agentId, "SubagentStop", data, now);
      break;
    }
    case "Notification": {
      const message = strOf(data.message) ?? "";
      if (COMPACTION_RE.test(message)) {
        await insertEvent(tx, sessionId, main, "Compaction", data, now, "Context compaction");
      } else if (WAITING_INPUT_RE.test(message)) {
        await setMainWaiting(tx, sessionId, now);
        await insertEvent(tx, sessionId, main, "Notification", data, now, message.slice(0, 200));
      } else {
        await insertEvent(tx, sessionId, main, "Notification", data, now, message.slice(0, 200) || undefined);
      }
      break;
    }
    case "SessionEnd": {
      await clearAwaitingInput(tx, sessionId, now);
      const finalStatus = session.status === "error" ? "error" : "completed";
      await tx.query(
        "UPDATE agents SET status = $1, ended_at = $2, updated_at = $2 WHERE session_id = $3 AND status NOT IN ('completed', 'error')",
        [finalStatus === "error" ? "error" : "completed", now, sessionId],
      );
      await setSessionStatus(tx, sessionId, finalStatus, now);
      await insertEvent(tx, sessionId, main, "SessionEnd", data, now);
      break;
    }
    default:
      await insertEvent(tx, sessionId, main, hookType, data, now);
      break;
  }

  if (options.transcript) {
    if (options.transcript.latestModel) {
      await tx.query(
        "UPDATE sessions SET model = $1, updated_at = $2 WHERE id = $3 AND COALESCE(model, '') != $1",
        [options.transcript.latestModel, now, sessionId],
      );
    }
    for (const [model, counts] of options.transcript.tokensByModel) {
      await options.tokenUsage.replace(sessionId, model, counts, now, tx);
    }
  }
}

function createPgliteImporter(
  db: PgliteClient,
  queue: ReturnType<typeof createWriteQueue>,
  tokenUsage: ReturnType<typeof createPgliteTokenUsageStore>,
  deps: {
    detectBillingMode: (harness: string) => string;
    now: () => string;
    log: (message: string) => void;
  },
): Importer {
  return {
    async importSession(session: NormalizedSession, harness: Harness): Promise<ImportResult> {
      if (typeof session.sessionId !== "string" || session.sessionId.length === 0 || !session.startedAt) {
        return { skipped: true, reactivated: false };
      }
      return queue.run(async () => {
        const now = deps.now();
        try {
          return await db.transaction(async (tx) => importSessionWithTx(tx, tokenUsage, deps, session, harness, now));
        } catch (error) {
          deps.log(
            `pglite importSession failed for ${session.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return { skipped: true, reactivated: false };
        }
      });
    },
  };
}

async function importSessionWithTx(
  tx: PgliteExecutor,
  tokenUsage: ReturnType<typeof createPgliteTokenUsageStore>,
  deps: {
    detectBillingMode: (harness: string) => string;
  },
  session: NormalizedSession,
  harness: Harness,
  now: string,
): Promise<ImportResult> {
  const nowMs = Date.parse(now);
  const recentlyActive =
    session.fileModifiedAt != null &&
    Number.isFinite(session.fileModifiedAt) &&
    (Number.isNaN(nowMs) ? Date.now() : nowMs) - session.fileModifiedAt < RECENT_ACTIVITY_MS;
  const mainId = mainAgentId(session.sessionId);
  const existing = await getImportSession(tx, session.sessionId);
  let reactivated = false;

  if (!existing) {
    const status = recentlyActive ? "active" : "completed";
    const billingMode = safe(() => deps.detectBillingMode(harness)) ?? "unknown";
    await tx.query(
      `INSERT INTO sessions (id, name, status, cwd, model, started_at, updated_at, ended_at, harness, billing_mode, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        session.sessionId,
        session.name ?? null,
        status,
        session.cwd ?? null,
        session.model ?? null,
        session.startedAt,
        session.endedAt ?? session.startedAt,
        status === "completed" ? session.endedAt ?? null : null,
        harness,
        billingMode,
        buildImportMetadata(session, harness),
      ],
    );
    await tx.query(
      `INSERT INTO agents (id, session_id, name, type, subagent_type, status, task, current_tool, started_at, updated_at, ended_at, parent_agent_id, metadata)
       VALUES ($1, $2, 'main', 'main', NULL, $3, NULL, NULL, $4, $5, $6, NULL, NULL)`,
      [
        mainId,
        session.sessionId,
        status === "completed" ? "completed" : "waiting",
        session.startedAt,
        now,
        status === "completed" ? session.endedAt ?? now : null,
      ],
    );
  } else {
    const billingMode = safe(() => deps.detectBillingMode(harness)) ?? "unknown";
    await tx.query(
      `UPDATE sessions SET
        name = COALESCE(name, $1),
        model = COALESCE(model, $2),
        cwd = COALESCE(cwd, $3),
        harness = CASE WHEN COALESCE(harness, '') = '' THEN $4 ELSE harness END,
        billing_mode = CASE WHEN COALESCE(billing_mode, '') IN ('', 'unknown') THEN $5 ELSE billing_mode END,
        updated_at = $6
       WHERE id = $7`,
      [
        session.name ?? null,
        session.model ?? null,
        session.cwd ?? null,
        harness,
        billingMode,
        now,
        session.sessionId,
      ],
    );
    const isLive = existing.status === "active" && existing.ended_at == null;
    if (recentlyActive && !isLive) {
      await tx.query("UPDATE sessions SET status = 'active', ended_at = NULL, updated_at = $1 WHERE id = $2", [now, session.sessionId]);
      await tx.query(
        "UPDATE agents SET status = 'waiting', ended_at = NULL, current_tool = NULL, awaiting_input_since = NULL, updated_at = $1 WHERE id = $2",
        [now, mainId],
      );
      reactivated = true;
    }
  }

  const highWater = new Map<string, string>();
  const hwm = await tx.query<{ event_type: string; hwm: string | null }>(
    "SELECT event_type, MAX(created_at) AS hwm FROM events WHERE session_id = $1 GROUP BY event_type",
    [session.sessionId],
  );
  for (const row of hwm.rows) {
    if (row.hwm) highWater.set(row.event_type, row.hwm);
  }

  let inserted = 0;
  const addEvent = async (
    eventType: string,
    agentId: string,
    ts: string | null,
    toolName: string | null,
    summary: string | null,
    data: string | null,
  ): Promise<void> => {
    if (!ts) return;
    const prev = highWater.get(eventType);
    if (prev != null && ts <= prev) return;
    await tx.query(
      "INSERT INTO events (id, session_id, agent_id, event_type, tool_name, summary, data, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [randomUUID(), session.sessionId, agentId, eventType, toolName, summary, data, ts],
    );
    inserted++;
  };

  for (const ts of session.messageTimestamps ?? []) {
    await addEvent("Stop", mainId, ts, null, null, null);
  }
  for (const [idx, tu] of (session.toolUses ?? []).entries()) {
    if (tu.name === "Agent" || tu.name === "Task") {
      const subId = `${session.sessionId}-sub-${idx}`;
      const input = (tu.input ?? {}) as Record<string, unknown>;
      const prompt = strOf(input.prompt);
      await tx.query(
        `INSERT INTO agents (id, session_id, name, type, subagent_type, status, task, started_at, updated_at, ended_at, parent_agent_id)
         VALUES ($1, $2, $3, 'subagent', $4, 'completed', $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [
          subId,
          session.sessionId,
          subagentName(tu),
          strOf(input.subagent_type) ?? null,
          prompt ? prompt.slice(0, 500) : null,
          tu.timestamp ?? session.startedAt,
          now,
          tu.timestamp ?? session.endedAt ?? now,
          mainId,
        ],
      );
      await addEvent("PreToolUse", subId, tu.timestamp, tu.name, "Spawned subagent", importToolEventData(tu));
    } else {
      await addEvent("PostToolUse", mainId, tu.timestamp, tu.name, null, importToolEventData(tu));
    }
  }
  for (const td of session.turnDurations ?? []) {
    await addEvent("TurnDuration", mainId, td.timestamp, null, String(td.durationMs), null);
  }
  for (const err of session.apiErrors ?? []) {
    await addEvent("APIError", mainId, err.timestamp, null, err.message ?? err.type ?? null, null);
  }
  for (const err of session.toolResultErrors ?? []) {
    await addEvent("ToolError", mainId, err.timestamp, null, truncate(err.content, 200), null);
  }
  for (const [model, counts] of Object.entries(session.tokensByModel ?? {})) {
    await tokenUsage.replace(session.sessionId, model, counts, now, tx);
  }

  return { skipped: existing != null && inserted === 0 && !reactivated, reactivated };
}

function createPgliteSessionSyncSource(db: PgliteClient): AgentSessionSyncSource {
  return {
    async listAllSessionCursorRows(): Promise<SessionCursorRow[]> {
      const result = await db.query<SessionCursorRow>(`
        SELECT id, updated_at
        FROM sessions
        ORDER BY updated_at DESC, id DESC
      `);
      return result.rows;
    },
    async listUpdatedSessionCursorRows(
      sinceUpdatedAt: string,
    ): Promise<SessionCursorRow[]> {
      const result = await db.query<SessionCursorRow>(
        `
          SELECT id, updated_at
          FROM sessions
          WHERE updated_at >= $1
          ORDER BY updated_at DESC, id DESC
        `,
        [sinceUpdatedAt],
      );
      return result.rows;
    },
    async loadSyncedSessions(
      ids: string[],
      cache: SessionAttributionResolverCache,
    ): Promise<SyncedAgentSession[]> {
      return loadPgliteSyncedSessions(db, ids, cache);
    },
  };
}

async function loadPgliteSyncedSessions(
  db: PgliteClient,
  ids: string[],
  cache: SessionAttributionResolverCache,
): Promise<SyncedAgentSession[]> {
  if (ids.length === 0) {
    return [];
  }

  const sessionRows = await selectRowsByIds<{
    id: string;
    name: string | null;
    status: string;
    cwd: string | null;
    model: string | null;
    started_at: string;
    updated_at: string;
    ended_at: string | null;
    awaiting_input_since: string | null;
    metadata: string | null;
    harness: string | null;
    billing_mode: string | null;
    user_id: string | null;
    organization_id: string | null;
  }>(
    db,
    `
      SELECT
        id,
        name,
        status,
        cwd,
        model,
        started_at,
        updated_at,
        ended_at,
        awaiting_input_since,
        metadata,
        harness,
        billing_mode,
        user_id,
        organization_id
      FROM sessions
      WHERE id IN (__IDS__)
    `,
    ids,
  );
  const agentRows = await selectRowsByIds<{
    id: string;
    session_id: string;
    name: string;
    type: string;
    subagent_type: string | null;
    status: string;
    task: string | null;
    current_tool: string | null;
    started_at: string;
    updated_at: string;
    ended_at: string | null;
    awaiting_input_since: string | null;
    parent_agent_id: string | null;
    metadata: string | null;
  }>(
    db,
    `
      SELECT
        id,
        session_id,
        name,
        type,
        subagent_type,
        status,
        task,
        current_tool,
        started_at,
        updated_at,
        ended_at,
        awaiting_input_since,
        parent_agent_id,
        metadata
      FROM agents
      WHERE session_id IN (__IDS__)
      ORDER BY session_id ASC, started_at ASC, id ASC
    `,
    ids,
  );
  const eventRows = await selectRowsByIds<{
    id: string;
    session_id: string;
    agent_id: string | null;
    event_type: string;
    tool_name: string | null;
    summary: string | null;
    data: string | null;
    created_at: string;
  }>(
    db,
    `
      SELECT
        id,
        session_id,
        agent_id,
        event_type,
        tool_name,
        summary,
        data,
        created_at
      FROM events
      WHERE session_id IN (__IDS__)
      ORDER BY session_id ASC, created_at ASC, id ASC
    `,
    ids,
  );
  const tokenRows = await selectRowsByIds<{
    session_id: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
  }>(
    db,
    `
      SELECT
        session_id,
        model,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens
      FROM token_usage
      WHERE session_id IN (__IDS__)
      ORDER BY session_id ASC, model ASC
    `,
    ids,
  );

  const sessionsById = new Map(sessionRows.map((row) => [row.id, row]));
  const agentsBySessionId = groupRowsBySessionId(agentRows);
  const eventsBySessionId = groupRowsBySessionId(eventRows);
  const tokenUsageBySessionId = groupRowsBySessionId(tokenRows);

  return ids.flatMap((id) => {
    const row = sessionsById.get(id);
    if (!row) {
      return [];
    }
    const attribution = resolveSessionAttribution(row.cwd, cache);
    const tokenUsageByModel: SyncedAgentSessionTokenUsage[] = (
      tokenUsageBySessionId.get(id) ?? []
    ).map((tokenRow) => {
      const estimatedCostUsd = estimateTokenUsageCostUsd(tokenRow);
      return {
        model: tokenRow.model,
        inputTokens: Number(tokenRow.input_tokens ?? 0),
        outputTokens: Number(tokenRow.output_tokens ?? 0),
        cacheReadTokens: Number(tokenRow.cache_read_tokens ?? 0),
        cacheWriteTokens: Number(tokenRow.cache_write_tokens ?? 0),
        ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
      };
    });

    return [
      {
        externalSessionId: row.id,
        name: row.name,
        status: row.status,
        harness: row.harness,
        billingMode: resolveBillingModeForRow(row),
        cwd: row.cwd,
        model: row.model,
        startedAt: row.started_at,
        updatedAt: row.updated_at,
        endedAt: row.ended_at,
        awaitingInputSince: row.awaiting_input_since,
        metadata: parseJsonObjectText(row.metadata),
        ...(row.user_id ? { userId: row.user_id } : {}),
        ...(row.organization_id ? { organizationId: row.organization_id } : {}),
        ...(attribution ? { attribution } : {}),
        agents: (agentsBySessionId.get(id) ?? []).map((agentRow) => ({
          externalAgentId: agentRow.id,
          name: agentRow.name,
          type: agentRow.type,
          subagentType: agentRow.subagent_type,
          status: agentRow.status,
          task: agentRow.task,
          currentTool: agentRow.current_tool,
          startedAt: agentRow.started_at,
          updatedAt: agentRow.updated_at,
          endedAt: agentRow.ended_at,
          awaitingInputSince: agentRow.awaiting_input_since,
          parentExternalAgentId: agentRow.parent_agent_id,
          metadata: parseJsonObjectText(agentRow.metadata),
        })),
        events: (eventsBySessionId.get(id) ?? []).map((eventRow) => ({
          externalEventId: String(eventRow.id),
          agentExternalId: eventRow.agent_id,
          eventType: eventRow.event_type,
          toolName: eventRow.tool_name,
          summary: eventRow.summary,
          data: parseJsonValueText(eventRow.data),
          createdAt: eventRow.created_at,
        })),
        tokenUsageByModel,
      },
    ];
  });
}

async function selectRowsByIds<T extends Record<string, unknown>>(
  db: PgliteExecutor,
  sql: string,
  ids: string[],
): Promise<T[]> {
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
  const result = await db.query<T>(sql.replace("__IDS__", placeholders), ids);
  return result.rows;
}

function groupRowsBySessionId<
  T extends { session_id: string },
>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const existing = grouped.get(row.session_id);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(row.session_id, [row]);
    }
  }
  return grouped;
}

async function loadPgliteMeteredUsageRows(
  db: PgliteClient,
  cutoffIso: string,
): Promise<MeteredUsageRow[]> {
  const result = await db.query<{
    session_id: string;
    started_at: string;
    billing_mode: string | null;
    harness: string | null;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
  }>(
    `
      SELECT
        s.id AS session_id,
        s.started_at AS started_at,
        s.billing_mode AS billing_mode,
        s.harness AS harness,
        tu.model AS model,
        tu.input_tokens AS input_tokens,
        tu.output_tokens AS output_tokens,
        tu.cache_read_tokens AS cache_read_tokens,
        tu.cache_write_tokens AS cache_write_tokens
      FROM token_usage tu
      JOIN sessions s ON s.id = tu.session_id
      WHERE s.started_at >= $1
      ORDER BY s.started_at ASC, tu.model ASC
    `,
    [cutoffIso],
  );
  const out: MeteredUsageRow[] = [];
  for (const row of result.rows) {
    const billingMode = resolveBillingMode({
      billingMode: row.billing_mode,
      harness: row.harness,
    });
    if (!isMeteredApi(billingMode)) {
      continue;
    }
    out.push({
      sessionId: row.session_id,
      model: row.model,
      startedAt: row.started_at,
      billingMode,
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      cacheReadTokens: Number(row.cache_read_tokens ?? 0),
      cacheWriteTokens: Number(row.cache_write_tokens ?? 0),
    });
  }
  return out;
}

function sessionDetailsCtes(): string {
  return `
    WITH agent_counts AS (
      SELECT session_id, COUNT(*)::int as agent_count
      FROM agents
      GROUP BY session_id
    ),
    event_counts AS (
      SELECT session_id, COUNT(*)::int as event_count
      FROM events
      GROUP BY session_id
    ),
    token_totals AS (
      SELECT
        session_id,
        COALESCE(SUM(COALESCE(input_tokens, 0)::bigint + COALESCE(output_tokens, 0)::bigint), 0) as total_tokens
      FROM token_usage
      GROUP BY session_id
    )
  `;
}

function toSessionRow(raw: Record<string, unknown> | undefined): SessionRow | undefined {
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
    userId: (raw.user_id as string) ?? null,
    organizationId: (raw.organization_id as string) ?? null,
  };
}

function toAgentRow(raw: Record<string, unknown> | undefined): AgentRow | undefined {
  if (!raw) return undefined;
  return {
    id: raw.id as string,
    sessionId: raw.session_id as string,
    name: (raw.name as string) ?? null,
    type: (raw.type as string) ?? null,
    subagentType: (raw.subagent_type as string) ?? null,
    status: raw.status as string,
    task: (raw.task as string) ?? null,
    currentTool: (raw.current_tool as string) ?? null,
    startedAt: (raw.started_at as string) ?? null,
    updatedAt: (raw.updated_at as string) ?? null,
    endedAt: (raw.ended_at as string) ?? null,
    awaitingInputSince: (raw.awaiting_input_since as string) ?? null,
    parentAgentId: (raw.parent_agent_id as string) ?? null,
    metadata: (raw.metadata as string) ?? null,
  };
}

function toEventRow(raw: Record<string, unknown> | undefined): EventRow | undefined {
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
  const row = toEventRow(raw);
  if (!row) return undefined;
  return { ...row, sessionName: (raw?.session_name as string) ?? null };
}

function toTokenUsageRow(raw: Record<string, unknown>): TokenUsageRow {
  return {
    sessionId: raw.session_id as string,
    model: raw.model as string,
    inputTokens: Number(raw.input_tokens ?? 0),
    outputTokens: Number(raw.output_tokens ?? 0),
    cacheReadTokens: Number(raw.cache_read_tokens ?? 0),
    cacheWriteTokens: Number(raw.cache_write_tokens ?? 0),
  };
}

function detailRowsToList(raws: Record<string, unknown>[]): SessionWithAgents[] {
  return raws.map((raw) => {
    const base = toSessionRow(raw)!;
    return {
      ...base,
      agentCount: Number(raw.agent_count ?? 0),
      eventCount: Number(raw.event_count ?? 0),
      totalTokens: Number(raw.total_tokens ?? 0),
    };
  });
}

async function count(db: PgliteExecutor, sql: string, params?: unknown[]): Promise<number> {
  return scalarNumber(db, sql, "count", params);
}

async function scalarNumber(
  db: PgliteExecutor,
  sql: string,
  key: string,
  params?: unknown[],
): Promise<number> {
  const result = await db.query(sql, params);
  return Number(result.rows[0]?.[key] ?? 0);
}

function mainAgentId(sessionId: string): string {
  return `${sessionId}-main`;
}

async function getSession(tx: PgliteExecutor, sessionId: string): Promise<SessionRowRaw | undefined> {
  const result = await tx.query<SessionRowRaw>(
    "SELECT id, status, harness, billing_mode, model FROM sessions WHERE id = $1",
    [sessionId],
  );
  return result.rows[0];
}

async function getImportSession(tx: PgliteExecutor, sessionId: string): Promise<{ id: string; status: string; ended_at: string | null } | undefined> {
  const result = await tx.query<{ id: string; status: string; ended_at: string | null }>(
    "SELECT id, status, ended_at FROM sessions WHERE id = $1",
    [sessionId],
  );
  return result.rows[0];
}

async function getAgent(tx: PgliteExecutor, agentId: string): Promise<AgentRowRaw | undefined> {
  const result = await tx.query<AgentRowRaw>(
    "SELECT id, status, type, parent_agent_id FROM agents WHERE id = $1",
    [agentId],
  );
  return result.rows[0];
}

async function ensureSession(
  tx: PgliteExecutor,
  sessionId: string,
  data: HookData,
  harness: string,
  now: string,
  detectBillingMode: (harness: string) => string,
  getUserIdentity?: () => { userId: string | null; organizationId: string | null } | null,
): Promise<void> {
  if (await getSession(tx, sessionId)) {
    return;
  }
  const billingMode = safe(() => detectBillingMode(harness)) ?? "unknown";
  const identity = safe(() => getUserIdentity?.()) ?? null;
  await tx.query(
    `INSERT INTO sessions (
       id, name, status, cwd, model, started_at, updated_at, harness,
       billing_mode, user_id, organization_id
     )
     VALUES ($1, $2, 'active', $3, $4, $5, $5, $6, $7, $8, $9)`,
    [
      sessionId,
      data.session_name ?? null,
      data.cwd ?? null,
      data.model ?? null,
      now,
      harness,
      billingMode,
      identity?.userId ?? null,
      identity?.organizationId ?? null,
    ],
  );
  await tx.query(
    `INSERT INTO agents (id, session_id, name, type, subagent_type, status, task, current_tool, started_at, updated_at, parent_agent_id, metadata)
     VALUES ($1, $2, 'main', 'main', NULL, 'working', NULL, NULL, $3, $3, NULL, NULL)`,
    [mainAgentId(sessionId), sessionId, now],
  );
}

async function clearAwaitingInput(tx: PgliteExecutor, sessionId: string, now: string): Promise<void> {
  await tx.query("UPDATE sessions SET awaiting_input_since = NULL, updated_at = $1 WHERE id = $2", [now, sessionId]);
  await tx.query("UPDATE agents SET awaiting_input_since = NULL, updated_at = $1 WHERE session_id = $2 AND awaiting_input_since IS NOT NULL", [now, sessionId]);
}

async function setMainWaiting(tx: PgliteExecutor, sessionId: string, now: string): Promise<void> {
  await tx.query("UPDATE sessions SET awaiting_input_since = $1, updated_at = $1 WHERE id = $2", [now, sessionId]);
  await tx.query("UPDATE agents SET awaiting_input_since = $1, status = 'waiting', updated_at = $1 WHERE id = $2", [now, mainAgentId(sessionId)]);
}

async function promoteMain(tx: PgliteExecutor, main: string, now: string): Promise<void> {
  await tx.query("UPDATE agents SET status = 'working', awaiting_input_since = NULL, updated_at = $1 WHERE id = $2 AND status != 'working'", [now, main]);
}

async function setAgentTool(tx: PgliteExecutor, agentId: string, toolName: string | null, now: string): Promise<void> {
  await tx.query("UPDATE agents SET current_tool = $1, status = 'working', updated_at = $2 WHERE id = $3", [toolName, now, agentId]);
}

async function setAgentStatus(tx: PgliteExecutor, agentId: string, status: string, now: string): Promise<void> {
  await tx.query("UPDATE agents SET status = $1, updated_at = $2, ended_at = $2 WHERE id = $3", [status, now, agentId]);
}

async function setSessionStatus(tx: PgliteExecutor, sessionId: string, status: string, now: string): Promise<void> {
  await tx.query("UPDATE sessions SET status = $1, updated_at = $2, ended_at = $2 WHERE id = $3", [status, now, sessionId]);
}

async function insertEvent(
  tx: PgliteExecutor,
  sessionId: string,
  agentId: string | null,
  eventType: string,
  data: HookData,
  now: string,
  summary?: string,
): Promise<void> {
  await tx.query(
    "INSERT INTO events (id, session_id, agent_id, event_type, tool_name, summary, data, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [
      randomUUID(),
      sessionId,
      agentId,
      eventType,
      data.tool_name ?? null,
      summary ?? null,
      safe(() => JSON.stringify(data)) ?? null,
      now,
    ],
  );
}

async function maybeReactivate(
  tx: PgliteExecutor,
  session: SessionRowRaw,
  hookType: string,
  now: string,
): Promise<void> {
  if (session.status === "active" || hookType === "SessionEnd") {
    return;
  }
  const isUserActivity = hookType === "UserPromptSubmit" || hookType === "PreToolUse";
  const isStopLike = hookType === "Stop" || hookType === "SubagentStop";
  const reactivate =
    isUserActivity ||
    (!isStopLike && session.status !== "error") ||
    (isStopLike && (session.status === "completed" || session.status === "abandoned"));
  if (reactivate) {
    await tx.query("UPDATE sessions SET status = 'active', updated_at = $1, ended_at = NULL WHERE id = $2", [now, session.id]);
    await promoteMain(tx, mainAgentId(session.id), now);
    session.status = "active";
  }
}

async function spawnSubagent(
  tx: PgliteExecutor,
  sessionId: string,
  data: HookData,
  now: string,
): Promise<string> {
  const input = (data.tool_input as Record<string, unknown> | undefined) ?? {};
  const description = strOf(input.description) ?? strOf(data.description);
  const subagentType = strOf(input.subagent_type) ?? strOf(data.subagent_type);
  const prompt = strOf(input.prompt) ?? strOf(data.prompt);
  const name =
    description ??
    subagentType ??
    (prompt ? prompt.split("\n")[0].slice(0, 60) : undefined) ??
    "Subagent";
  let parentId = mainAgentId(sessionId);
  const main = await getAgent(tx, parentId);
  if (!main || main.status !== "working") {
    const deepest = await tx.query<{ id: string }>(`
      WITH RECURSIVE chain(id, depth) AS (
        SELECT id, 0 FROM agents WHERE session_id = $1 AND parent_agent_id IS NULL
        UNION ALL
        SELECT a.id, c.depth + 1 FROM agents a JOIN chain c ON a.parent_agent_id = c.id
      )
      SELECT a.id AS id FROM chain c JOIN agents a ON a.id = c.id
      WHERE a.status = 'working' AND a.type = 'subagent'
      ORDER BY c.depth DESC, a.started_at DESC LIMIT 1
    `, [sessionId]);
    if (deepest.rows[0]) {
      parentId = deepest.rows[0].id;
    }
  }
  const agentId = `${sessionId}-sub-${randomUUID().slice(0, 8)}`;
  await tx.query(
    `INSERT INTO agents (id, session_id, name, type, subagent_type, status, task, current_tool, started_at, updated_at, parent_agent_id, metadata)
     VALUES ($1, $2, $3, 'subagent', $4, 'working', $5, NULL, $6, $6, $7, NULL)`,
    [
      agentId,
      sessionId,
      name,
      subagentType ?? null,
      prompt ? prompt.slice(0, 500) : null,
      now,
      parentId,
    ],
  );
  return agentId;
}

async function matchSubagent(
  tx: PgliteExecutor,
  sessionId: string,
  data: HookData,
): Promise<string | null> {
  const result = await tx.query<{
    id: string;
    name: string | null;
    subagent_type: string | null;
    task: string | null;
  }>(
    "SELECT id, name, subagent_type, task FROM agents WHERE session_id = $1 AND type = 'subagent' AND status = 'working' ORDER BY started_at DESC",
    [sessionId],
  );
  const candidates = result.rows;
  if (candidates.length === 0) {
    return null;
  }
  const prefix = strOf(data.description) ?? strOf(data.agent_type) ?? strOf(data.subagent_type);
  if (prefix) {
    const byName = candidates.find((a) => a.name != null && a.name.startsWith(prefix));
    if (byName) return byName.id;
  }
  if (data.agent_type) {
    const byType = candidates.find((a) => a.subagent_type === data.agent_type);
    if (byType) return byType.id;
  }
  if (data.prompt) {
    const task = String(data.prompt).slice(0, 500);
    const byTask = candidates.find((a) => a.task === task);
    if (byTask) return byTask.id;
  }
  return candidates[0].id;
}

async function sweepStaleSessions(
  tx: PgliteExecutor,
  currentSessionId: string,
  now: string,
  staleMinutes: number,
): Promise<void> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();
  const stale = await tx.query<{ id: string }>(
    "SELECT id FROM sessions WHERE status = 'active' AND id != $1 AND updated_at < $2",
    [currentSessionId, cutoff],
  );
  for (const { id } of stale.rows) {
    await tx.query(
      "UPDATE agents SET status = 'completed', ended_at = $1, updated_at = $1 WHERE session_id = $2 AND status NOT IN ('completed', 'error')",
      [now, id],
    );
    await tx.query(
      "UPDATE sessions SET status = 'abandoned', ended_at = $1, updated_at = $1 WHERE id = $2",
      [now, id],
    );
  }
}

function buildImportMetadata(session: NormalizedSession, harness: Harness): string {
  return JSON.stringify({
    version: session.version ?? null,
    slug: session.slug ?? null,
    gitBranch: session.gitBranch ?? null,
    userMessages: session.userMessages ?? 0,
    assistantMessages: session.assistantMessages ?? 0,
    entrypoint: session.entrypoint ?? harness,
    permissionMode: session.permissionMode ?? null,
    thinkingBlockCount: session.thinkingBlockCount ?? 0,
    teams: session.teams ?? [],
    plans: session.plans ?? [],
    usageExtras: session.usageExtras ?? {
      service_tiers: [],
      speeds: [],
      inference_geos: [],
    },
    compactions: session.compactions ?? [],
    messages: session.messages ?? [],
    tokenSeries: session.tokenSeries ?? [],
    diffStats: session.diffStats ?? null,
    slashCommands: session.slashCommands ?? [],
    artifacts: session.artifacts ?? { prs: [], issues: [], repo: null },
  });
}

function importEventData(input: unknown): string | null {
  if (input == null) return null;
  let text: string;
  try {
    text = JSON.stringify(input);
  } catch {
    return null;
  }
  if (text.length > MAX_EVENT_DATA_BYTES) {
    return JSON.stringify({ truncated: true, bytes: text.length });
  }
  return text;
}

function importToolEventData(toolUse: NormalizedToolUse): string | null {
  const input = asRecord(toolUse.input);
  const payload: Record<string, unknown> = input ? { ...input } : {};
  if (toolUse.skillName && !payload.skillName) {
    payload.skillName = toolUse.skillName;
  }
  if (toolUse.mcpServer && !payload.mcpServer) {
    payload.mcpServer = toolUse.mcpServer;
  }
  if (toolUse.mcpMethod && !payload.mcpMethod) {
    payload.mcpMethod = toolUse.mcpMethod;
  }
  if (toolUse.diffDelta && !payload.diffDelta) {
    payload.diffDelta = toolUse.diffDelta;
  }
  return Object.keys(payload).length > 0 ? importEventData(payload) : null;
}

function subagentName(tu: NormalizedToolUse): string {
  const input = (tu.input ?? {}) as Record<string, unknown>;
  const description = strOf(input.description);
  const subagentType = strOf(input.subagent_type);
  const prompt = strOf(input.prompt);
  return (
    description ??
    subagentType ??
    (prompt ? prompt.split("\n")[0].slice(0, 60) : undefined) ??
    "Subagent"
  );
}

function strOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function packIdFromSkillName(name: string): string | null {
  const normalized = name.trim();
  const separatorIndex = normalized.search(/[/:]/);
  if (separatorIndex <= 0) {
    return null;
  }
  return normalized.slice(0, separatorIndex);
}

function titleFromId(id: string): string {
  return id
    .split(/[-_\s/]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || id;
}

function titleFromPlan(content: string): string {
  const firstLine =
    content
      .split(/\r?\n/)
      .map((line) => line.replace(/^#+\s*/, "").trim())
      .find((line) => line.length > 0) ?? "Untitled plan";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

function compareIsoDesc(a: string | null, b: string | null): number {
  const left = a ? Date.parse(a) : 0;
  const right = b ? Date.parse(b) : 0;
  return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
}

function maxIso(a: string | null, b: string | null): string | null {
  return compareIsoDesc(a, b) <= 0 ? a : b;
}

function compareLastUsedThenName<
  T extends { name: string; lastUsedAt: string | null },
>(a: T, b: T): number {
  const byDate = compareIsoDesc(a.lastUsedAt, b.lastUsedAt);
  return byDate !== 0 ? byDate : a.name.localeCompare(b.name);
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.length > max ? value.slice(0, max) : value;
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
