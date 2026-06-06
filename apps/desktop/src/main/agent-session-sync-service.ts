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
import { expandHomePath } from "../shared/path-utils.js";
import { computeTokenCost } from "../shared/token-cost.js";
import type { BillingMode } from "../shared/billing-mode.js";
import { resolveBillingMode } from "./billing-mode-detector.js";

const TAG = "agent-session-sync";
const SYNC_INTERVAL_MS = 5_000;
const MIN_INCREMENTAL_SYNC_INTERVAL_MS = 30_000;
// Maximum number of candidate session IDs to pull from the queue per sync cycle.
const INCREMENTAL_SESSION_BATCH_SIZE = 10;
export const BACKFILL_SESSION_BATCH_SIZE = 3;
// Maximum serialized JSON payload size per batch (256 KiB).
export const SESSION_PAYLOAD_BYTE_CAP = 262_144;
// After this many consecutive ack timeouts on the same session, dead-letter it
// so one oversized or slow session does not permanently block the queue.
export const MAX_CONSECUTIVE_TIMEOUTS = 3;
// FEA-1461: after this many consecutive `rate_limited` rejections on the same
// session, dead-letter it. Higher than the timeout threshold because
// rate-limits are more legitimately transient (the relay may genuinely just
// be throttling a burst), but still bounded so a persistently-rejected
// session cannot infinite-loop the sync queue + log spam.
export const MAX_CONSECUTIVE_RATE_LIMITED = 5;
// FEA-1461: after a `rate_limited` rejection, defer re-attempting the same
// session for this long. Prevents the 5-second sync tick from re-chunking and
// re-sending the same oversized session every cycle (the original symptom).
// Other queued sessions continue to flow through `pickReadyCandidates`.
export const RATE_LIMIT_BACKOFF_MS = 30_000;

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
  billing_mode: string | null;
  user_id: string | null;
  organization_id: string | null;
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
  isChunkedSyncEnabled?: () => boolean;
  getSandboxBaseDirectory?: () => string;
  sendBatch: (batch: AgentSessionSyncBatch) => Promise<DesktopAgentSessionsAck>;
  getUserDataPath?: () => string;
  /**
   * The optional design-system in-process DB connection. When provided, the
   * service reads through it (no per-cycle open/close, no path resolution, no
   * existsSync guard). When omitted or null, the service falls back to the
   * legacy sidecar dashboard.db path from getUserDataPath.
   */
  getConnection?: () => DatabaseSync | null;
  onBatchOutcome?: (event: AgentSessionSyncTelemetryEvent) => void;
}

export class AgentSessionSyncService {
  private readonly options: AgentSessionSyncServiceOptions;
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private syncing = false;
  private activeSyncToken: symbol | null = null;
  private sourceStateGeneration = 0;
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
  /** Consecutive timeout count per session ID for dead-letter detection. */
  private readonly timeoutCountById = new Map<string, number>();
  /**
   * FEA-1461: consecutive `rate_limited` count per session ID. Parallel to
   * `timeoutCountById` — kept separate so the existing timeout dead-letter
   * threshold and the new rate-limit threshold do not contaminate each other.
   */
  private readonly rateLimitedCountById = new Map<string, number>();
  /**
   * FEA-1461: per-session deferred-retry deadline (ms since epoch). While the
   * deadline is in the future, `pickReadyCandidates` skips the session.
   */
  private readonly nextRetryAfterMs = new Map<string, number>();
  /** Session IDs removed from the queue after exceeding MAX_CONSECUTIVE_TIMEOUTS or MAX_CONSECUTIVE_RATE_LIMITED. */
  private readonly deadLetteredIds = new Set<string>();
  /** Remaining chunks for an oversized session being sent in parts. */
  private pendingChunks: {
    sessionId: string;
    syncMode: AgentSessionSyncMode;
    chunks: SyncedAgentSession[];
  } | null = null;

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
    this.clearTimer();
    this.resetSourceState();
  }

  /**
   * Clear every cursor, queue, retry, dead-letter, pending chunk, and
   * attribution cache that is derived from the currently selected dashboard
   * source. Availability disable and source transitions must restart from the
   * next selected source instead of replaying stale work from the prior one.
   */
  resetSourceState(): void {
    this.sourceStateGeneration += 1;
    this.activeSyncToken = null;
    this.syncing = false;
    this.observedTopUpdatedAt = null;
    this.observedIdsAtTopUpdatedAt = new Set<string>();
    this.lastIncrementalBatchAttemptedAtMs = 0;
    this.featureDisabledForRelaySession = false;
    this.firstAckReceived = false;
    this.incrementalQueue = [];
    this.incrementalQueuedIds.clear();
    this.backfillQueue = [];
    this.backfillQueuedIds.clear();
    this.attributionCache.attributionByCwd.clear();
    this.attributionCache.launchMetadataRootByCwd.clear();
    this.attributionCache.repoFullNameByPath.clear();
    this.timeoutCountById.clear();
    this.rateLimitedCountById.clear();
    this.nextRetryAfterMs.clear();
    this.deadLetteredIds.clear();
    this.pendingChunks = null;
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
    const syncToken = Symbol("agent-session-sync");
    const sourceStateGeneration = this.sourceStateGeneration;
    this.activeSyncToken = syncToken;
    this.syncing = true;

    try {
      // The caller owns the dashboard source by mode: design-system injects an
      // in-process connection, legacy falls back to dashboard.db on disk, and
      // disabled mode stops this service before it reaches the source lookup.
      const sharedDb = this.options.getConnection?.() ?? null;
      const dbPath = sharedDb
        ? null
        : resolveAgentMonitorDatabasePath(this.options.getUserDataPath?.());
      if (dbPath && !existsSync(dbPath)) {
        return;
      }

      let syncMode: AgentSessionSyncMode | null = null;
      let syncIds: string[] = [];
      let batch: AgentSessionSyncBatch | null = null;
      let accumulatedBytes = 0;

      // If there are pending chunks from a previous oversized session split,
      // send the next chunk without touching the DB or queues.
      if (this.pendingChunks && this.pendingChunks.chunks.length > 0) {
        const { sessionId, syncMode: chunkMode, chunks } = this.pendingChunks;
        const chunk = chunks.shift()!;
        accumulatedBytes = estimateSessionPayloadBytes(chunk);
        const isLast = chunks.length === 0;
        if (isLast) {
          this.pendingChunks = null;
        }
        gatewayLog.info(
          TAG,
          `sending chunked session ${sessionId} (~${formatBytes(accumulatedBytes)}); ` +
            `${chunks.length} chunk(s) remaining`,
        );
        batch = {
          schemaVersion: AGENT_SESSION_SYNC_SCHEMA_VERSION,
          batchId: randomUUID(),
          syncMode: chunkMode,
          sessionCount: 1,
          sessions: [chunk],
        };
        syncMode = chunkMode;
        syncIds = [sessionId];
        // Skip DB access — go straight to send.
      } else {
        const db = sharedDb ?? new DatabaseSync(dbPath!);
        try {
          if (!sharedDb) {
            db.exec("PRAGMA busy_timeout = 5000");
          }
          this.initializeBackfillQueueIfNeeded(db);
          this.enqueueIncrementalUpdates(db);

          const nowMs = Date.now();
          let candidateIds: string[] = [];
          // FEA-1461: try incremental first. `pickReadyCandidates` may filter
          // out every queued session (all in rate-limit backoff). When that
          // happens, fall through to backfill so it does not get starved
          // for the whole backoff window — previously the early-return
          // below would skip backfill entirely on every tick.
          if (
            this.incrementalQueue.length > 0 &&
            nowMs - this.lastIncrementalBatchAttemptedAtMs >=
              MIN_INCREMENTAL_SYNC_INTERVAL_MS
          ) {
            candidateIds = this.pickReadyCandidates(
              this.incrementalQueue,
              INCREMENTAL_SESSION_BATCH_SIZE,
              nowMs,
            );
            if (candidateIds.length > 0) {
              syncMode = "incremental";
              // Only stamp the throttle timestamp if we actually selected
              // at least one ready candidate. Stamping when every candidate
              // was filtered by backoff would unnecessarily delay a session
              // added to the queue moments later by the full
              // MIN_INCREMENTAL_SYNC_INTERVAL_MS window.
              this.lastIncrementalBatchAttemptedAtMs = nowMs;
            }
          }
          if (candidateIds.length === 0 && this.backfillQueue.length > 0) {
            const backfillCandidates = this.pickReadyCandidates(
              this.backfillQueue,
              BACKFILL_SESSION_BATCH_SIZE,
              nowMs,
            );
            if (backfillCandidates.length > 0) {
              syncMode = "backfill";
              candidateIds = backfillCandidates;
            }
          }

          if (!syncMode || candidateIds.length === 0) {
            return;
          }

          const chunkedSyncEnabled = this.options.isChunkedSyncEnabled?.() ?? false;

          // Load all candidate sessions from SQLite, then accumulate into the
          // batch until adding the next session would exceed the 256 KiB cap.
          // Sessions that individually exceed the cap are either chunked (if
          // the feature flag is on) or skipped/dead-lettered.
          const rawSessions = loadSyncedSessions(
            db,
            candidateIds,
            this.attributionCache,
          );

          const sandboxBase = this.options.getSandboxBaseDirectory?.() ?? "";
          const sandboxSkipped: string[] = [];
          const candidateSessions = rawSessions.filter((s) => {
            if (isSessionInSandbox(s.cwd, sandboxBase)) {
              return true;
            }
            sandboxSkipped.push(s.externalSessionId);
            return false;
          });
          if (sandboxSkipped.length > 0) {
            this.dequeue(syncMode, sandboxSkipped);
            gatewayLog.debug(
              TAG,
              `filtered ${sandboxSkipped.length} session(s) outside sandbox`,
            );
          }

          if (candidateSessions.length === 0) {
            this.dequeue(syncMode, candidateIds);
            return;
          }

          const sessions: SyncedAgentSession[] = [];
          const skippedOversized: string[] = [];
          syncIds = [];
          for (const session of candidateSessions) {
            const sanitized = sanitizeSessionForSync(session);
            const sessionBytes = estimateSessionPayloadBytes(sanitized);
            if (sessionBytes > SESSION_PAYLOAD_BYTE_CAP && sessions.length === 0) {
              if (chunkedSyncEnabled) {
                const chunks = chunkOversizedSession(sanitized, SESSION_PAYLOAD_BYTE_CAP);
                const first = chunks.shift()!;
                if (chunks.length > 0) {
                  this.pendingChunks = {
                    sessionId: sanitized.externalSessionId,
                    syncMode,
                    chunks,
                  };
                }
                sessions.push(first);
                syncIds.push(sanitized.externalSessionId);
                accumulatedBytes += estimateSessionPayloadBytes(first);
                gatewayLog.info(
                  TAG,
                  `chunking oversized session ${sanitized.externalSessionId} (~${formatBytes(sessionBytes)}) into ` +
                    `${chunks.length + 1} chunks of ≤${formatBytes(SESSION_PAYLOAD_BYTE_CAP)}`,
                );
              } else {
                skippedOversized.push(sanitized.externalSessionId);
                this.deadLetteredIds.add(sanitized.externalSessionId);
                gatewayLog.warn(
                  TAG,
                  `skipping oversized session ${sanitized.externalSessionId} (~${formatBytes(sessionBytes)}) — ` +
                    `exceeds ${formatBytes(SESSION_PAYLOAD_BYTE_CAP)} payload cap; ` +
                    `enable chunked session sync or wait for server-side support`,
                );
              }
              continue;
            }
            if (
              sessions.length > 0 &&
              accumulatedBytes + sessionBytes > SESSION_PAYLOAD_BYTE_CAP
            ) {
              break;
            }
            sessions.push(sanitized);
            syncIds.push(sanitized.externalSessionId);
            accumulatedBytes += sessionBytes;
          }
          if (skippedOversized.length > 0) {
            this.dequeue(syncMode, skippedOversized);
          }

          batch = {
            schemaVersion: AGENT_SESSION_SYNC_SCHEMA_VERSION,
            batchId: randomUUID(),
            syncMode,
            sessionCount: sessions.length,
            sessions,
          };
        } finally {
          if (!sharedDb) {
            db.close();
          }
        }
      }

      if (!batch || !syncMode || syncIds.length === 0) {
        return;
      }

      const ack = await this.options.sendBatch(batch);
      if (
        this.activeSyncToken !== syncToken ||
        this.sourceStateGeneration !== sourceStateGeneration ||
        !this.started
      ) {
        gatewayLog.debug(
          TAG,
          "ignoring agent-session batch ack from a stale dashboard source",
        );
        return;
      }
      this.handleBatchAck(syncMode, syncIds, batch.sessionCount, accumulatedBytes, ack);
    } catch (error) {
      gatewayLog.warn(
        TAG,
        `sync failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (this.activeSyncToken === syncToken) {
        this.activeSyncToken = null;
        this.syncing = false;
      }
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

  /**
   * FEA-1461: pick up to `limit` session IDs from `queue`, skipping any whose
   * deferred-retry deadline (set by a prior `rate_limited` failure) is still
   * in the future. Order is preserved for selected IDs so the queue remains
   * stable; only the backed-off entries are skipped, not reordered.
   */
  private pickReadyCandidates(
    queue: readonly string[],
    limit: number,
    nowMs: number,
  ): string[] {
    const result: string[] = [];
    for (const id of queue) {
      const deadline = this.nextRetryAfterMs.get(id);
      if (deadline !== undefined && deadline > nowMs) {
        continue;
      }
      result.push(id);
      if (result.length >= limit) {
        break;
      }
    }
    return result;
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
      // Only dequeue the session after all chunks have been sent.
      const hasMoreChunks = this.pendingChunks !== null &&
        ids.length === 1 &&
        this.pendingChunks.sessionId === ids[0];
      if (!hasMoreChunks) {
        for (const id of ids) {
          this.timeoutCountById.delete(id);
          // FEA-1461: a successful ack resets the rate-limit counter and
          // clears any deferred-retry deadline for this session, so a future
          // rate-limited rejection starts the count over at 1.
          this.rateLimitedCountById.delete(id);
          this.nextRetryAfterMs.delete(id);
        }
        this.dequeue(syncMode, ids);
      }
      const deadLetterSuffix = this.deadLetteredIds.size > 0
        ? ` deadLettered=${this.deadLetteredIds.size}`
        : "";
      const chunkSuffix = hasMoreChunks
        ? ` (chunk; ${this.pendingChunks!.chunks.length} remaining)`
        : "";
      gatewayLog.info(
        TAG,
        `synced ${sessionCount} agent sessions (${syncMode})${chunkSuffix}; remaining incremental=${this.incrementalQueue.length} backfill=${this.backfillQueue.length}${deadLetterSuffix}`,
      );
      return;
    }

    // On any failure, discard remaining chunks for this session — partial
    // chunk sequences are not useful without server-side reassembly.
    //
    // FEA-1461: the next retry will re-fetch + re-chunk the source session
    // from SQLite. That re-chunk work is bounded for transient failures
    // (rate_limited) by the per-session backoff added below — the same
    // session is not re-attempted within RATE_LIMIT_BACKOFF_MS — and by the
    // MAX_CONSECUTIVE_RATE_LIMITED dead-letter trip. True resume-from-chunk-N
    // would eliminate the re-chunk work entirely but requires server-side
    // partial-payload reassembly that does not exist today; tracked as out
    // of scope on FEA-1461.
    if (this.pendingChunks && ids.includes(this.pendingChunks.sessionId)) {
      gatewayLog.warn(
        TAG,
        `discarding ${this.pendingChunks.chunks.length} remaining chunk(s) for session ${this.pendingChunks.sessionId} after batch failure (${ack.reason})`,
      );
      this.pendingChunks = null;
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
      const deadLettered: string[] = [];
      for (const id of ids) {
        const count = (this.timeoutCountById.get(id) ?? 0) + 1;
        if (count >= MAX_CONSECUTIVE_TIMEOUTS) {
          deadLettered.push(id);
          this.timeoutCountById.delete(id);
          // FEA-1461: also clear any orphaned rate-limit state for this
          // session so a dead-lettered id leaves no Map entries behind.
          this.rateLimitedCountById.delete(id);
          this.nextRetryAfterMs.delete(id);
          this.deadLetteredIds.add(id);
        } else {
          this.timeoutCountById.set(id, count);
        }
      }
      if (deadLettered.length > 0) {
        this.dequeue(syncMode, deadLettered);
        gatewayLog.warn(
          TAG,
          `dead-lettered ${deadLettered.length} oversized/slow agent session(s) after ${MAX_CONSECUTIVE_TIMEOUTS} consecutive ack timeouts ` +
            `(payload ~${formatBytes(payloadBytes)}); ids: ${deadLettered.join(", ")}; ` +
            `remaining incremental=${this.incrementalQueue.length} backfill=${this.backfillQueue.length} deadLettered=${this.deadLetteredIds.size}`,
        );
      }
      if (deadLettered.length < ids.length) {
        const attempt = this.timeoutCountById.get(ids.find((id) => !this.deadLetteredIds.has(id))!) ?? 0;
        gatewayLog.info(
          TAG,
          `agent-session batch (${syncMode}, ~${formatBytes(payloadBytes)}) timed out waiting for server ack ` +
            `(attempt ${attempt}/${MAX_CONSECUTIVE_TIMEOUTS}); batch left queued for retry`,
        );
      }
    } else if (ack.reason === DesktopAgentSessionsAckReason.RateLimited) {
      // FEA-1461: previously fell through to the bare `else` below — debug
      // log only, no counter, no dead-letter, no dequeue, no backoff. For an
      // oversized session that's permanently throttled, that produced an
      // infinite retry loop (re-chunking + log spam every 5s).
      //
      // FEA-1461 review fix (PR #258, Codex P1): `cloud-socket.sendAgentSessions`
      // returns `RateLimited` for BOTH server-side payload throttling AND
      // local transport unavailability (`!isRelayReady()` or socket
      // disconnected after the batch was prepared). Treating a relay flap
      // as a session-payload problem would dead-letter perfectly good
      // sessions after 5 disconnects. Re-check relay readiness here: if the
      // relay is down right now, the ack came from the transport layer —
      // defer with backoff but do NOT increment the dead-letter counter.
      const relayHealthy = this.options.isRelayReady();
      const deadLettered: string[] = [];
      const deferred: string[] = [];
      const retryDeadline = Date.now() + RATE_LIMIT_BACKOFF_MS;
      for (const id of ids) {
        const previousCount = this.rateLimitedCountById.get(id) ?? 0;
        const count = relayHealthy ? previousCount + 1 : previousCount;
        if (relayHealthy && count >= MAX_CONSECUTIVE_RATE_LIMITED) {
          deadLettered.push(id);
          this.rateLimitedCountById.delete(id);
          this.nextRetryAfterMs.delete(id);
          // FEA-1461: also clear any orphaned timeout state for this
          // session so a dead-lettered id leaves no Map entries behind.
          this.timeoutCountById.delete(id);
          this.deadLetteredIds.add(id);
        } else {
          if (relayHealthy) {
            this.rateLimitedCountById.set(id, count);
          }
          this.nextRetryAfterMs.set(id, retryDeadline);
          deferred.push(id);
        }
      }
      if (deadLettered.length > 0) {
        this.dequeue(syncMode, deadLettered);
        gatewayLog.warn(
          TAG,
          `dead-lettered ${deadLettered.length} agent session(s) after ${MAX_CONSECUTIVE_RATE_LIMITED} consecutive rate_limited rejections ` +
            `(payload ~${formatBytes(payloadBytes)}); ids: ${deadLettered.join(", ")}; ` +
            `remaining incremental=${this.incrementalQueue.length} backfill=${this.backfillQueue.length} deadLettered=${this.deadLetteredIds.size}`,
        );
      }
      if (deferred.length > 0) {
        const sampleId = deferred[0];
        const attempt = this.rateLimitedCountById.get(sampleId) ?? 0;
        gatewayLog.info(
          TAG,
          `agent-session batch (${syncMode}, ~${formatBytes(payloadBytes)}) rate_limited ` +
            `(${relayHealthy ? "server payload throttle" : "transport unavailable"}); ` +
            `deferring ${deferred.length} session(s) for ${Math.round(RATE_LIMIT_BACKOFF_MS / 1000)}s ` +
            `(attempt ${attempt}/${MAX_CONSECUTIVE_RATE_LIMITED}); batch left queued for retry`,
        );
      }
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

export function isSessionInSandbox(
  cwd: string | null | undefined,
  sandboxBaseDirectory: string | null | undefined,
): boolean {
  if (!sandboxBaseDirectory) {
    return false;
  }
  if (!cwd) {
    return false;
  }
  const normalizedCwd = path.resolve(expandHomePath(cwd));
  const normalizedSandbox = path.resolve(expandHomePath(sandboxBaseDirectory));
  if (normalizedCwd === normalizedSandbox) {
    return true;
  }
  const prefix = normalizedSandbox.endsWith(path.sep)
    ? normalizedSandbox
    : normalizedSandbox + path.sep;
  return normalizedCwd.startsWith(prefix);
}

export function sanitizeSessionForSync(
  session: SyncedAgentSession,
): SyncedAgentSession {
  return {
    ...session,
    agents: session.agents.map((agent) => ({
      ...agent,
      task: null,
    })),
    events: session.events.map((event) => ({
      ...event,
      data: stripDataContent(event.data),
    })),
  };
}

const STRIPPED_LEAF_KEYS = new Set(["prompt", "content", "stdout", "stderr"]);

function stripDataContent(data: SyncJsonValue | undefined): SyncJsonValue | undefined {
  if (data === undefined || data === null) {
    return data;
  }
  if (typeof data !== "object") {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map((item) => stripDataContent(item) ?? null);
  }
  const obj = data as Record<string, SyncJsonValue>;
  const rest: Record<string, SyncJsonValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (STRIPPED_LEAF_KEYS.has(k)) {
      continue;
    }
    rest[k] = (typeof v === "object" && v !== null ? stripDataContent(v) : v) ?? null;
  }
  return Object.keys(rest).length > 0 ? rest : null;
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
        harness,
        billing_mode,
        user_id,
        organization_id
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
        input_tokens AS input_tokens,
        output_tokens AS output_tokens,
        cache_read_tokens AS cache_read_tokens,
        cache_write_tokens AS cache_write_tokens
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
        inputTokens: tokenRow.input_tokens,
        outputTokens: tokenRow.output_tokens,
        cacheReadTokens: tokenRow.cache_read_tokens,
        cacheWriteTokens: tokenRow.cache_write_tokens,
        // Omit entirely when the model is not priced — the contract field is
        // optional, so an absent value renders as "—" rather than a silent $0.
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
        ...(attribution ? { attribution } : {}),
        userId: row.user_id,
        organizationId: row.organization_id,
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

/**
 * Estimate the USD cost for one token-usage row using the canonical
 * genai-prices engine (`src/shared/token-cost.ts`). Returns `undefined` when
 * the model is not priced so the caller can omit the optional contract field
 * (no silent $0). Library prices are returned UNCHANGED — no local rounding,
 * clamping, or override (the override pipeline was the source of the v1
 * overcharge bugs; see token-cost.ts).
 */
export function estimateTokenUsageCostUsd(
  tokenUsage: TokenUsageRow,
): number | undefined {
  const result = computeTokenCost({
    model: tokenUsage.model,
    inputTokens: tokenUsage.input_tokens,
    outputTokens: tokenUsage.output_tokens,
    cacheReadTokens: tokenUsage.cache_read_tokens,
    cacheWriteTokens: tokenUsage.cache_write_tokens,
  });
  return result.priced && result.costUsd != null ? result.costUsd : undefined;
}

/**
 * Resolve a session's billing mode for the sync payload (CLOSEDLOOP FEA-1434).
 * The sidecar importers and the Claude session route stamp the real mode at
 * ingest; this fills the gap for legacy rows (migrated to the default
 * 'unknown') by best-effort detecting from the live desktop environment. A
 * stored, definite mode always wins over re-detection.
 */
export function resolveBillingModeForRow(row: SessionRow): BillingMode {
  return resolveBillingMode({
    billingMode: row.billing_mode,
    harness: row.harness,
  });
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * Split an oversized session into multiple chunks, each within the byte cap.
 * Every chunk contains the full session metadata, agents, and token usage;
 * only the events array is paginated across chunks.
 */
export function chunkOversizedSession(
  session: SyncedAgentSession,
  maxBytes: number,
): SyncedAgentSession[] {
  const baseSession: SyncedAgentSession = { ...session, events: [] };
  const baseBytes = estimateSessionPayloadBytes(baseSession);
  const eventBudget = maxBytes - baseBytes;

  // If session metadata alone exceeds the cap, send it without events.
  if (eventBudget <= 0 || session.events.length === 0) {
    return [baseSession];
  }

  const chunks: SyncedAgentSession[] = [];
  let currentEvents: typeof session.events = [];
  let currentBytes = 0;

  for (const event of session.events) {
    const eventBytes = Buffer.byteLength(JSON.stringify(event));
    if (currentBytes > 0 && currentBytes + eventBytes > eventBudget) {
      chunks.push({ ...session, events: currentEvents });
      currentEvents = [];
      currentBytes = 0;
    }
    currentEvents.push(event);
    currentBytes += eventBytes;
  }
  if (currentEvents.length > 0) {
    chunks.push({ ...session, events: currentEvents });
  }

  return chunks.length > 0 ? chunks : [baseSession];
}
