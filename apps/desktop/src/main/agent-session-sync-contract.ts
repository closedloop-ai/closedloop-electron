export const AGENT_SESSION_SYNC_SCHEMA_VERSION = 1 as const;

export type AgentSessionSyncMode = "backfill" | "incremental";

export type SyncJsonPrimitive = string | number | boolean | null;
export type SyncJsonValue =
  | SyncJsonPrimitive
  | SyncJsonObject
  | SyncJsonValue[];
export type SyncJsonObject = {
  [key: string]: SyncJsonValue;
};

export type SyncedAgentSessionAttribution = {
  repositoryFullName?: string | null;
  worktreePath?: string | null;
  sourceArtifactId?: string | null;
  sourceLoopId?: string | null;
  issueId?: string | null;
  baseBranch?: string | null;
};

export type SyncedAgentSessionAgent = {
  externalAgentId: string;
  name: string;
  type: string;
  subagentType?: string | null;
  status: string;
  task?: string | null;
  currentTool?: string | null;
  startedAt?: string | null;
  updatedAt?: string | null;
  endedAt?: string | null;
  awaitingInputSince?: string | null;
  parentExternalAgentId?: string | null;
  metadata?: SyncJsonObject | null;
};

export type SyncedAgentSessionEvent = {
  externalEventId: string;
  agentExternalId?: string | null;
  eventType: string;
  toolName?: string | null;
  summary?: string | null;
  data?: SyncJsonValue;
  createdAt: string;
};

export type SyncedAgentSessionTokenUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd?: number;
};

export type SyncedAgentSession = {
  externalSessionId: string;
  name?: string | null;
  status: string;
  harness?: string | null;
  cwd?: string | null;
  model?: string | null;
  startedAt: string;
  updatedAt: string;
  endedAt?: string | null;
  awaitingInputSince?: string | null;
  metadata?: SyncJsonObject | null;
  attribution?: SyncedAgentSessionAttribution;
  agents: SyncedAgentSessionAgent[];
  events: SyncedAgentSessionEvent[];
  tokenUsageByModel: SyncedAgentSessionTokenUsage[];
};

export type AgentSessionSyncBatch = {
  schemaVersion: typeof AGENT_SESSION_SYNC_SCHEMA_VERSION;
  batchId: string;
  syncMode: AgentSessionSyncMode;
  sessionCount: number;
  sessions: SyncedAgentSession[];
};
