// CLOSEDLOOP CONTRACT — consumed by the cloud relay, ships separately.
// Schema-version bumps follow the CLAUDE.md "Breaking Changes" rule: the
// previous shape must remain decodable at the boundary.
//
// v2 (FEA-1434): adds optional `billingMode` to SyncedAgentSession.
//   - Outbound: desktop sends `billingMode` when known; `undefined`/`null`
//     means "no signal" (the relay should treat it as `unknown`).
//   - Inbound: the cloud relay MUST accept payloads with the v1 schema
//     version that omit `billingMode` and treat them as `billingMode:
//     "unknown"`. See the legacy-migration note in cloud-protocol.ts.
//   - Removal: once the relay enforces v2 across all clients, the v1
//     decode path can be deleted. Tracking ticket TBD — see the report
//     attached to this commit (the user creates the tracking ticket in
//     ClosedLoop and pastes the ID into the comment below in a follow-up
//     PR before merge).
export const AGENT_SESSION_SYNC_SCHEMA_VERSION = 2 as const;

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
  /**
   * FEA-1434: billing mode used to distinguish API-metered cost from
   * subscription-covered usage. Encoded as a string at the wire boundary
   * (the canonical enum lives in `src/shared/billing-mode.ts`) so the cloud
   * relay can accept forward-compatible values without a contract bump.
   *
   * `undefined` or `null` means "no signal" and is equivalent to the
   * `unknown` billing mode in the typed enum. Older clients (v1 schema)
   * never set this field — the relay treats missing as `unknown`.
   */
  billingMode?: string | null;
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
