// Renderer-facing agent-database IPC contract.
//
// These are the response DTOs returned by the `desktop:db:*` IPC handlers and
// consumed by the first-party renderer (`src/renderer/`). They are the stable
// shared contract between main and renderer — the renderer MUST import its DB
// response shapes from here, NOT from `src/main/database/types.ts`.
//
// Raw persistence rows (the untyped `Record<string, unknown>` produced by
// `node:sqlite`) are private to `src/main/database/`. Each repository store maps
// those raw rows into the DTOs below via its `toRow()` helper, so a SQLite
// schema/column change is absorbed at that boundary and does not break the
// renderer's compile-time contract. Purely-internal row types that never cross
// IPC (e.g. `TokenUsageRow`) stay in `src/main/database/types.ts`.

export interface SessionRow {
  id: string;
  name: string | null;
  status: string;
  cwd: string | null;
  model: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  endedAt: string | null;
  awaitingInputSince: string | null;
  metadata: string | null;
  harness: string | null;
  billingMode: string | null;
  userId: string | null;
  organizationId: string | null;
}

export interface AgentRow {
  id: string;
  sessionId: string;
  name: string | null;
  type: string | null;
  subagentType: string | null;
  status: string;
  task: string | null;
  currentTool: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  endedAt: string | null;
  awaitingInputSince: string | null;
  parentAgentId: string | null;
  metadata: string | null;
}

export interface EventRow {
  id: string;
  sessionId: string;
  agentId: string | null;
  eventType: string;
  toolName: string | null;
  summary: string | null;
  data: string | null;
  createdAt: string | null;
}

export interface DashboardSummary {
  totalSessions: number;
  activeSessions: number;
  totalAgents: number;
  totalEvents: number;
  eventTypeCount: number;
  totalTokens: number;
  recentSessions: Array<{
    id: string;
    name: string | null;
    status: string;
    model: string | null;
    cwd: string | null;
    startedAt: string | null;
  }>;
}

export interface SessionWithAgents extends SessionRow {
  agentCount: number;
  eventCount: number;
  totalTokens: number;
  estimatedCostUsd?: number;
}

export interface EventWithSession extends EventRow {
  sessionName: string | null;
}

export interface TokenAnalytics {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  byModel: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    sessions: number;
    estimatedCostUsd?: number;
  }>;
  byDay: Array<{
    day: string;
    inputTokens: number;
    outputTokens: number;
  }>;
}

export interface EventCountByType {
  eventType: string;
  count: number;
}

export interface ToolUsageItem {
  toolName: string;
  count: number;
}

export interface DailyEventCount {
  date: string;
  count: number;
}

export interface StatusCount {
  status: string;
  count: number;
}

export interface AgentTypeCount {
  type: string;
  count: number;
}

export interface AnalyticsData {
  tokens: TokenAnalytics;
  eventsByType: EventCountByType[];
  toolUsage: ToolUsageItem[];
  dailyEvents: DailyEventCount[];
  sessionsByStatus: StatusCount[];
  agentsByStatus: StatusCount[];
  agentsByType: AgentTypeCount[];
  totalSessions: number;
  totalAgents: number;
  totalEvents: number;
}

export interface WorkflowQueryData {
  stats: {
    totalSessions: number;
    totalAgents: number;
    totalSubagents: number;
    avgSubagents: number;
    successRate: number;
    avgDepth: number;
    avgDurationSec: number;
    totalCompactions: number;
    avgCompactions: number;
    topFlow: { source: string; target: string; count: number } | null;
  };
  orchestration: {
    sessionCount: number;
    mainCount: number;
    subagentTypes: Array<{ subagentType: string; count: number; completed: number; errors: number }>;
    edges: Array<{ source: string; target: string; weight: number }>;
    outcomes: Array<{ status: string; count: number }>;
    compactions: { total: number; sessions: number };
  };
  toolFlow: {
    transitions: Array<{ source: string; target: string; value: number }>;
    toolCounts: Array<{ toolName: string; count: number }>;
  };
  effectiveness: Array<{
    subagentType: string;
    total: number;
    completed: number;
    errors: number;
    sessions: number;
    successRate: number;
    avgDuration: number | null;
    trend: number[];
  }>;
  cooccurrence: Array<{ source: string; target: string; weight: number }>;
}

export interface AgentHierarchyNode {
  agentId: string;
  name: string | null;
  type: string | null;
  subagentType: string | null;
  status: string;
  task: string | null;
  currentTool: string | null;
  children: AgentHierarchyNode[];
  events: Array<{
    eventType: string;
    toolName: string | null;
    summary: string | null;
    createdAt: string | null;
  }>;
}
