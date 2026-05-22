import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import electron from "electron";
import type { DesktopAgentSessionsAck } from "./cloud-protocol.js";
import { DesktopAgentSessionsAckReason } from "./cloud-protocol.js";
import {
  AGENT_SESSION_SYNC_SCHEMA_VERSION,
  type AgentSessionSyncBatch,
  type AgentSessionSyncMode,
  type SyncedAgentSession,
  type SyncedAgentSessionAttribution,
  type SyncedAgentSessionTokenUsage,
  type SyncJsonObject,
  type SyncJsonValue,
} from "./agent-session-sync-contract.js";
import { gatewayLog } from "./gateway-logger.js";
import { resolveRepoFullName } from "../server/operations/git-helpers.js";
import {
  readLaunchMetadata,
  type LaunchMetadata,
} from "../server/operations/symphony-utils.js";

const TAG = "agent-session-sync";
const SYNC_INTERVAL_MS = 5_000;
const MIN_INCREMENTAL_SYNC_INTERVAL_MS = 30_000;
// Maximum number of candidate session IDs to pull from the queue per sync cycle.
const SESSION_BATCH_SIZE = 10;
// Maximum serialized JSON payload size per batch (256 KiB).
export const SESSION_PAYLOAD_BYTE_CAP = 262_144;

export function estimateSessionPayloadBytes(session: SyncedAgentSession): number {
  return Buffer.byteLength(JSON.stringify(session));
}

const { app } = electron;

type SessionCursorRow = {
  id: string;
  updated_at: string;
};

type SessionRow = {
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
};

type AgentRow = {
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
};

type EventRow = {
  id: number;
  session_id: string;
  agent_id: string | null;
  event_type: string;
  tool_name: string | null;
  summary: string | null;
  data: string | null;
  created_at: string;
};

type TokenUsageRow = {
  session_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

type PricingRow = {
  model_pattern: string;
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok: number;
  cache_write_per_mtok: number;
};

export type SessionAttributionResolverCache = {
  attributionByCwd: Map<string, SyncedAgentSessionAttribution | null>;
  launchMetadataRootByCwd: Map<string, string | null>;
  repoFullNameByPath: Map<string, string | null>;
};

export type AgentSessionSyncTelemetryEvent = {
  outcome: "failure";
  reason: DesktopAgentSessionsAckReason;
  syncMode: AgentSessionSyncMode;
  sessionCount: number;
  payloadBytes: number;
};

export interface AgentSessionSyncServiceOptions {
  isAgentMonitorEnabled: () => boolean;
  isRelayReady: () => boolean;
  sendBatch: (batch: AgentSessionSyncBatch) => Promise<DesktopAgentSessionsAck>;
  getUserDataPath?: () => string;
  onBatchOutcome?: (event: AgentSessionSyncTelemetryEvent) => void;
}

export class AgentSessionSyncService {
  private readonly options: AgentSessionSyncServiceOptions;
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private syncing = false;
  private observedTopUpdatedAt: string | null = null;
  private observedIdsAtTopUpdatedAt = new Set<string>();
  private lastIncrementalBatchAttemptedAtMs = 0;
  private featureDisabledForRelaySession = false;
  private firstAckReceived = false;
  private incrementalQueue: string[] = [];
  private readonly incrementalQueuedIds = new Set<string>();
  private backfillQueue: string[] = [];
  private readonly backfillQueuedIds = new Set<string>();
  private readonly attributionCache: SessionAttributionResolverCache = {
    attributionByCwd: new Map(),
    launchMetadataRootByCwd: new Map(),
    repoFullNameByPath: new Map(),
  };

  constructor(options: AgentSessionSyncServiceOptions) {
    this.options = options;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.refresh();
  }

  stop(): void {
    this.started = false;
    this.syncing = false;
    this.clearTimer();
  }

  refresh(): void {
    if (!this.started) {
      return;
    }
    if (!this.options.isRelayReady()) {
      this.featureDisabledForRelaySession = false;
      this.firstAckReceived = false;
      this.lastIncrementalBatchAttemptedAtMs = 0;
    }
    if (!this.shouldRun()) {
      this.clearTimer();
      return;
    }
    this.ensureTimer();
    void this.syncOnce();
  }

  private shouldRun(): boolean {
    // Allow syncing when the relay reports ready via serverCapabilities, or
    // when we have already received a confirmed ack in this relay session
    // (so the service does not rely solely on serverCapabilities.agentSessionSync).
    // The firstAckReceived flag starts false, so initial syncs still proceed
    // via isRelayReady() before any ack is received.
    const relayAccepting = this.options.isRelayReady() || this.firstAckReceived;
    return this.options.isAgentMonitorEnabled() && relayAccepting && !this.featureDisabledForRelaySession;
  }

  private ensureTimer(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.syncOnce();
    }, SYNC_INTERVAL_MS);
  }

  private clearTimer(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  private async syncOnce(): Promise<void> {
    if (this.syncing || !this.shouldRun()) {
      return;
    }
    this.syncing = true;

    try {
      const dbPath = resolveAgentMonitorDatabasePath(
        this.options.getUserDataPath?.(),
      );
      if (!existsSync(dbPath)) {
        return;
      }

      let syncMode: AgentSessionSyncMode | null = null;
      let syncIds: string[] = [];
      let batch: AgentSessionSyncBatch | null = null;
      let accumulatedBytes = 0;

      const db = new DatabaseSync(dbPath);
      try {
        db.exec("PRAGMA busy_timeout = 1000");
        this.initializeBackfillQueueIfNeeded(db);
        this.enqueueIncrementalUpdates(db);

        const nowMs = Date.now();
        let candidateIds: string[] = [];
        if (
          this.incrementalQueue.length > 0 &&
          nowMs - this.lastIncrementalBatchAttemptedAtMs >=
            MIN_INCREMENTAL_SYNC_INTERVAL_MS
        ) {
          syncMode = "incremental";
          candidateIds = this.incrementalQueue.slice(0, SESSION_BATCH_SIZE);
          this.lastIncrementalBatchAttemptedAtMs = nowMs;
        } else if (this.backfillQueue.length > 0) {
          syncMode = "backfill";
          candidateIds = this.backfillQueue.slice(0, SESSION_BATCH_SIZE);
        }

        if (!syncMode || candidateIds.length === 0) {
          return;
        }

        // Load all candidate sessions from SQLite, then accumulate into the
        // batch until adding the next session would exceed the 256 KiB cap.
        // Always include at least one session even if it alone exceeds the cap.
        const candidateSessions = loadSyncedSessions(
          db,
          candidateIds,
          this.attributionCache,
        );
        if (candidateSessions.length === 0) {
          this.dequeue(syncMode, candidateIds);
          return;
        }

        const sessions: SyncedAgentSession[] = [];
        syncIds = [];
        for (const session of candidateSessions) {
          const sessionBytes = estimateSessionPayloadBytes(session);
          if (
            sessions.length > 0 &&
            accumulatedBytes + sessionBytes > SESSION_PAYLOAD_BYTE_CAP
          ) {
            break;
          }
          sessions.push(session);
          syncIds.push(session.externalSessionId);
          accumulatedBytes += sessionBytes;
        }

        batch = {
          schemaVersion: AGENT_SESSION_SYNC_SCHEMA_VERSION,
          batchId: randomUUID(),
          syncMode,
          sessionCount: sessions.length,
          sessions,
        };
      } finally {
        db.close();
      }

      if (!batch || !syncMode || syncIds.length === 0) {
        return;
      }

      const ack = await this.options.sendBatch(batch);
      this.handleBatchAck(syncMode, syncIds, batch.sessionCount, accumulatedBytes, ack);
    } catch (error) {
      gatewayLog.warn(
        TAG,
        `sync failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.syncing = false;
    }
  }

  private initializeBackfillQueueIfNeeded(db: DatabaseSync): void {
    if (this.observedTopUpdatedAt !== null) {
      return;
    }

    const rows = listAllSessionCursorRows(db);
    if (rows.length === 0) {
      return;
    }

    this.observedTopUpdatedAt = rows[0].updated_at;
    this.observedIdsAtTopUpdatedAt = collectIdsAtTimestamp(
      rows,
      this.observedTopUpdatedAt,
    );
    for (const row of rows) {
      if (this.backfillQueuedIds.has(row.id)) {
        continue;
      }
      this.backfillQueuedIds.add(row.id);
      this.backfillQueue.push(row.id);
    }

    gatewayLog.info(
      TAG,
      `queued historical backfill for ${rows.length} agent sessions`,
    );
  }

  private enqueueIncrementalUpdates(db: DatabaseSync): void {
    if (!this.observedTopUpdatedAt) {
      return;
    }

    const previousTopUpdatedAt = this.observedTopUpdatedAt;
    const previousTopIds = new Set(this.observedIdsAtTopUpdatedAt);
    const rows = listUpdatedSessionCursorRows(db, previousTopUpdatedAt);
    if (rows.length === 0) {
      return;
    }

    let nextTopUpdatedAt = previousTopUpdatedAt;
    let nextTopIds = new Set(previousTopIds);
    for (const row of rows) {
      if (row.updated_at > nextTopUpdatedAt) {
        nextTopUpdatedAt = row.updated_at;
        nextTopIds = new Set<string>();
      }
      if (row.updated_at === nextTopUpdatedAt) {
        nextTopIds.add(row.id);
      }
      if (
        row.updated_at === previousTopUpdatedAt &&
        previousTopIds.has(row.id)
      ) {
        continue;
      }
      if (this.incrementalQueuedIds.has(row.id)) {
        continue;
      }
      this.incrementalQueuedIds.add(row.id);
      this.incrementalQueue.push(row.id);
    }

    this.observedTopUpdatedAt = nextTopUpdatedAt;
    this.observedIdsAtTopUpdatedAt = nextTopIds;
  }

  private handleBatchAck(
    syncMode: AgentSessionSyncMode,
    ids: string[],
    sessionCount: number,
    payloadBytes: number,
    ack: DesktopAgentSessionsAck,
  ): void {
    if (ack.accepted) {
      this.firstAckReceived = true;
      this.dequeue(syncMode, ids);
      gatewayLog.info(
        TAG,
        `synced ${sessionCount} agent sessions (${syncMode}); remaining incremental=${this.incrementalQueue.length} backfill=${this.backfillQueue.length}`,
      );
      return;
    }

    if (ack.reason === DesktopAgentSessionsAckReason.ValidationFailed) {
      gatewayLog.warn(
        TAG,
        `dropping ${ids.length} ${syncMode} agent-session payload(s) after validation_failed to avoid a permanent sync stall`,
      );
      this.dequeue(syncMode, ids);
    } else if (ack.reason === DesktopAgentSessionsAckReason.FeatureDisabled) {
      this.featureDisabledForRelaySession = true;
      this.clearTimer();
      gatewayLog.info(
        TAG,
        "pausing agent-session sync until the relay reconnects because the current relay session rejected agent-session batches with feature_disabled",
      );
    } else if (ack.reason === DesktopAgentSessionsAckReason.AckTimeout) {
      gatewayLog.debug(
        TAG,
        `agent-session batch (${syncMode}) timed out waiting for a server ack (client-side timeout, not a server rejection); batch left queued for retry`,
      );
    } else {
      gatewayLog.debug(
        TAG,
        `agent-session batch rejected by server (${syncMode}): ${ack.reason}`,
      );
    }

    this.options.onBatchOutcome?.({
      outcome: "failure",
      reason: ack.reason,
      syncMode,
      sessionCount,
      payloadBytes,
    });
  }

  private dequeue(syncMode: AgentSessionSyncMode, ids: string[]): void {
    const removeIds = new Set(ids);
    if (syncMode === "incremental") {
      this.incrementalQueue = this.incrementalQueue.filter(
        (id) => !removeIds.has(id),
      );
      for (const id of removeIds) {
        this.incrementalQueuedIds.delete(id);
      }
      return;
    }

    this.backfillQueue = this.backfillQueue.filter((id) => !removeIds.has(id));
    for (const id of removeIds) {
      this.backfillQueuedIds.delete(id);
    }
  }
}

export function resolveAgentMonitorDatabasePath(
  userDataPath = app.getPath("userData"),
): string {
  return path.join(userDataPath, "agent-monitor", "dashboard.db");
}

export function listAllSessionCursorRows(db: DatabaseSync): SessionCursorRow[] {
  return db
    .prepare(
      `
        SELECT id, updated_at
        FROM sessions
        ORDER BY updated_at DESC, id DESC
      `,
    )
    .all() as SessionCursorRow[];
}

export function listUpdatedSessionCursorRows(
  db: DatabaseSync,
  sinceUpdatedAt: string,
): SessionCursorRow[] {
  return db
    .prepare(
      `
        SELECT id, updated_at
        FROM sessions
        WHERE updated_at >= ?
        ORDER BY updated_at DESC, id DESC
      `,
    )
    .all(sinceUpdatedAt) as SessionCursorRow[];
}

function collectIdsAtTimestamp(
  rows: SessionCursorRow[],
  updatedAt: string,
): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.updated_at !== updatedAt) {
      break;
    }
    ids.add(row.id);
  }
  return ids;
}

export function loadSyncedSessions(
  db: DatabaseSync,
  ids: string[],
  cache: SessionAttributionResolverCache = {
    attributionByCwd: new Map(),
    launchMetadataRootByCwd: new Map(),
    repoFullNameByPath: new Map(),
  },
): SyncedAgentSession[] {
  if (ids.length === 0) {
    return [];
  }

  const sessionRows = selectRowsByIds<SessionRow>(
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
        harness
      FROM sessions
      WHERE id IN (__IDS__)
    `,
    ids,
  );
  const agentRows = selectRowsByIds<AgentRow>(
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
  const eventRows = selectRowsByIds<EventRow>(
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
  const tokenRows = selectRowsByIds<TokenUsageRow>(
    db,
    `
      SELECT
        session_id,
        model,
        input_tokens + baseline_input AS input_tokens,
        output_tokens + baseline_output AS output_tokens,
        cache_read_tokens + baseline_cache_read AS cache_read_tokens,
        cache_write_tokens + baseline_cache_write AS cache_write_tokens
      FROM token_usage
      WHERE session_id IN (__IDS__)
      ORDER BY session_id ASC, model ASC
    `,
    ids,
  );
  const pricingRows = db
    .prepare(
      `
        SELECT
          model_pattern,
          input_per_mtok,
          output_per_mtok,
          cache_read_per_mtok,
          cache_write_per_mtok
        FROM model_pricing
        ORDER BY LENGTH(model_pattern) DESC, model_pattern ASC
      `,
    )
    .all() as PricingRow[];

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
    ).map((tokenRow) => ({
      model: tokenRow.model,
      inputTokens: tokenRow.input_tokens,
      outputTokens: tokenRow.output_tokens,
      cacheReadTokens: tokenRow.cache_read_tokens,
      cacheWriteTokens: tokenRow.cache_write_tokens,
      estimatedCostUsd: estimateTokenUsageCostUsd(tokenRow, pricingRows),
    }));

    return [
      {
        externalSessionId: row.id,
        name: row.name,
        status: row.status,
        harness: row.harness,
        cwd: row.cwd,
        model: row.model,
        startedAt: row.started_at,
        updatedAt: row.updated_at,
        endedAt: row.ended_at,
        awaitingInputSince: row.awaiting_input_since,
        metadata: parseJsonObjectText(row.metadata),
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

export function estimateTokenUsageCostUsd(
  tokenUsage: TokenUsageRow,
  pricingRows: PricingRow[],
): number {
  const pricing = pricingRows.find((row) =>
    sqliteLikeMatch(tokenUsage.model, row.model_pattern),
  );
  if (!pricing) {
    return 0;
  }

  return roundUsd(
    (tokenUsage.input_tokens * pricing.input_per_mtok +
      tokenUsage.output_tokens * pricing.output_per_mtok +
      tokenUsage.cache_read_tokens * pricing.cache_read_per_mtok +
      tokenUsage.cache_write_tokens * pricing.cache_write_per_mtok) /
      1_000_000,
  );
}

function selectRowsByIds<T>(
  db: DatabaseSync,
  sql: string,
  ids: string[],
): T[] {
  const placeholders = ids.map(() => "?").join(", ");
  return db
    .prepare(sql.replace("__IDS__", placeholders))
    .all(...ids) as T[];
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

function resolveSessionAttribution(
  cwd: string | null,
  cache: SessionAttributionResolverCache,
): SyncedAgentSessionAttribution | undefined {
  if (!cwd) {
    return undefined;
  }

  const cached = cache.attributionByCwd.get(cwd);
  if (cached !== undefined) {
    return cached ?? undefined;
  }

  const worktreePath =
    findLaunchMetadataRoot(cwd, cache.launchMetadataRootByCwd) ?? cwd;
  const launchMetadata = readLaunchMetadata(worktreePath);
  const repoLookupPath = worktreePath;
  let repositoryFullName = cache.repoFullNameByPath.get(repoLookupPath);
  if (repositoryFullName === undefined) {
    repositoryFullName = resolveRepoFullName(repoLookupPath);
    cache.repoFullNameByPath.set(repoLookupPath, repositoryFullName);
  }

  const attribution = buildAttribution(
    worktreePath,
    repositoryFullName ?? null,
    launchMetadata,
  );
  cache.attributionByCwd.set(cwd, attribution ?? null);
  return attribution ?? undefined;
}

function buildAttribution(
  worktreePath: string,
  repositoryFullName: string | null,
  launchMetadata: LaunchMetadata | null,
): SyncedAgentSessionAttribution | null {
  const attribution: SyncedAgentSessionAttribution = {
    repositoryFullName,
    worktreePath,
    sourceArtifactId: launchMetadata?.artifactId ?? null,
    sourceLoopId: launchMetadata?.loopId ?? null,
    issueId: launchMetadata?.issueId ?? null,
    baseBranch: launchMetadata?.baseBranch ?? null,
  };

  return Object.values(attribution).some((value) => value)
    ? attribution
    : null;
}

function findLaunchMetadataRoot(
  startDir: string,
  cache: Map<string, string | null>,
): string | null {
  const cached = cache.get(startDir);
  if (cached !== undefined) {
    return cached;
  }

  let currentDir = startDir;
  while (true) {
    const metadataPath = path.join(
      currentDir,
      ".closedloop-ai",
      "work",
      "launch-metadata.json",
    );
    if (existsSync(metadataPath)) {
      cache.set(startDir, currentDir);
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      cache.set(startDir, null);
      return null;
    }
    currentDir = parentDir;
  }
}

function parseJsonValueText(value: string | null): SyncJsonValue | null {
  if (!value || value.trim().length === 0) {
    return null;
  }

  try {
    return toSyncJsonValue(JSON.parse(value));
  } catch {
    return toSyncJsonValue(value);
  }
}

function parseJsonObjectText(value: string | null): SyncJsonObject | null {
  const parsed = parseJsonValueText(value);
  return isSyncJsonObject(parsed) ? parsed : null;
}

function toSyncJsonValue(value: unknown): SyncJsonValue | null {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toSyncJsonValue(entry));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const normalized: SyncJsonObject = {};
    for (const [key, entry] of Object.entries(record)) {
      const parsed = toSyncJsonValue(entry);
      if (parsed !== null) {
        normalized[key] = parsed;
      }
    }
    return normalized;
  }
  return null;
}

function isSyncJsonObject(value: SyncJsonValue | null): value is SyncJsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sqliteLikeMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replaceAll(/([.+^${}()|[\]\\])/g, "\\$1");
  const regex = new RegExp(
    `^${escaped.replaceAll("%", ".*").replaceAll("_", ".")}$`,
    "i",
  );
  return regex.test(value);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
