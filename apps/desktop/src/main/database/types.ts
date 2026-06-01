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

export interface TokenUsageRow {
  sessionId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface HookEventPayload {
  sessionId?: string;
  agentId?: string;
  eventType?: string;
  toolName?: string;
  summary?: string;
  data?: string;
  status?: string;
  name?: string;
  model?: string;
  cwd?: string;
  task?: string;
  type?: string;
  subagentType?: string;
  parentAgentId?: string;
  metadata?: Record<string, unknown>;
}

export interface DashboardSummary {
  totalSessions: number;
  activeSessions: number;
  totalAgents: number;
  totalEvents: number;
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
