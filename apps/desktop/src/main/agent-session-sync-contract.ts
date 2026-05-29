// Schema version history:
//   1: initial shape (sessions + agents + events + tokenUsageByModel)
//   2: FEA-1432 — `tokenUsageByModel[].cacheWrite1hTokens` (1-hour Anthropic
//      ephemeral cache tier, split out from cacheWriteTokens which now means
//      the 5-minute tier specifically).
//
// Additive (no schema bump):
//   FEA-1433 — `tokenUsageByModel[].priced` (whether the model matched a
//   `model_pricing` row at compute time). Missing means "assume priced" so
//   legacy v1/v2 payloads decode unchanged. `estimatedCostUsd` becomes
//   nullable: producers MAY emit `null` when `priced === false` to surface
//   the diagnostic signal without conflating it with a zero cost.
//
// Boundary translation: a relay receiver MAY accept v1 payloads (no
// `cacheWrite1hTokens` field) and treat the missing field as 0. The cloud
// removal ticket for the legacy-shape translation lives at FEA-1439.
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
  /**
   * Anthropic 5-minute ephemeral cache write tokens. For OpenAI / non-Anthropic
   * models this is always 0 (the vendor has no cache-write surcharge).
   *
   * Pre-FEA-1432 (schema v1) this field carried all cache writes regardless of
   * tier. v1 payloads on the wire should be treated as
   * `cacheWriteTokens = <existing> + 0 (cacheWrite1hTokens missing)`.
   */
  cacheWriteTokens: number;
  /**
   * Anthropic 1-hour ephemeral cache write tokens. Added in FEA-1432 (schema
   * v2). Always 0 for non-Anthropic models. v1 payloads omit this field;
   * downstream consumers should default it to 0 when reading a v1 batch.
   */
  cacheWrite1hTokens?: number | null;
  /**
   * Estimated USD cost for this row. Nullable as of FEA-1433: a `null` value
   * signals "model not in `model_pricing` table" — distinct from a genuine
   * zero cost (where the model is priced but had zero tokens). Legacy v1/v2
   * payloads omitting `priced` should treat a missing field as priced=true
   * and a missing/zero estimatedCostUsd as the legacy "0 fallback" meaning.
   */
  estimatedCostUsd?: number | null;
  /**
   * FEA-1433: whether `model` matched a `model_pricing` row at compute time.
   * Optional + additive (no schema bump): missing field is treated as
   * `priced=true` so legacy receivers keep working unchanged.
   */
  priced?: boolean;
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
