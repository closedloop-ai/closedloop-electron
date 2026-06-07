import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { createTokenUsageStore } from "../database/token-usage.js";
import type { Harness, NormalizedSession, NormalizedToolUse } from "./types.js";

/**
 * First-party session importer (FEA-1503). Replaces the vendor `import-history.js`
 * `importSession` + the vendor `dbModule`: it writes a parsed `NormalizedSession`
 * into the in-process node:sqlite repository (`sessions`/`agents`/`events`/
 * `token_usage`) — the SAME tables and schema the hook lifecycle writes.
 *
 * Idempotency (FEA-1503 AC): re-import adds nothing new.
 *  - session row: COALESCE-fill on conflict, never clobbers a live row.
 *    `updated_at` stays an ingest-time mutation cursor for cloud sync; source
 *    dates live on `started_at`, `ended_at`, events, and token usage analytics.
 *  - events: per-(session, event_type) high-water-mark on `created_at` — only
 *    events with a source timestamp strictly greater than the stored max are
 *    inserted. Backfill never stamps events with importer runtime `now`; when an
 *    individual source event has no timestamp, it falls back to the session's
 *    source timestamp so date windows remain tied to when work occurred.
 *  - tokens: `tokenUsage.replace` nets zero when re-applying equal cumulatives.
 *
 * Each session is applied in one `BEGIN IMMEDIATE` transaction (mirrors
 * lifecycle.ts); a malformed session rolls back without affecting others and
 * never throws. Callers MUST NOT wrap this in their own transaction (node:sqlite
 * has no nested transactions).
 */

/** A session whose source file changed within this window is treated as live. */
const RECENT_ACTIVITY_MS = 10 * 60 * 1000;
/** Cap an individual event's stored `data` blob so bulk import can't bloat the DB. */
const MAX_EVENT_DATA_BYTES = 64 * 1024;

export interface ImporterDeps {
  tokenUsage: ReturnType<typeof createTokenUsageStore>;
  /** Resolve a billing mode for a harness at session creation (FEA-1434). */
  detectBillingMode: (harness: string) => string;
  /** Injectable clock (tests pin it). Returns an ISO timestamp. */
  now?: () => string;
  /** Key-free diagnostic sink. */
  log?: (message: string) => void;
  /**
   * FEA-1548: resolve the current authenticated user's identity for stamping
   * on new sessions. Returns null when no user is signed in.
   */
  getUserIdentity?: () => { userId: string; organizationId: string | null } | null;
}

export interface ImportResult {
  /** True when the session already existed and nothing new was written. */
  skipped: boolean;
  /** True when a terminal session was revived because its file is recently active. */
  reactivated: boolean;
}

interface SessionRowRaw {
  id: string;
  status: string;
  ended_at: string | null;
}

export interface Importer {
  importSession(session: NormalizedSession, harness: Harness): ImportResult;
}

export function createImporter(db: DatabaseSync, deps: ImporterDeps): Importer {
  const nowFn = deps.now ?? (() => new Date().toISOString());
  const log = deps.log ?? (() => {});

  const getSessionStmt = db.prepare(
    "SELECT id, status, ended_at FROM sessions WHERE id = ?",
  );
  const insertSessionStmt = db.prepare(`
    INSERT INTO sessions (id, name, status, cwd, model, started_at, updated_at, ended_at, harness, billing_mode, metadata, user_id, organization_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // Fill only missing fields on an existing row; never clobber a live status.
  // Always refresh metadata so new fields (diffStats, artifacts, etc.) are populated.
  const coalesceSessionStmt = db.prepare(`
    UPDATE sessions SET
      name = COALESCE(name, ?),
      model = COALESCE(model, ?),
      cwd = COALESCE(cwd, ?),
      harness = CASE WHEN COALESCE(harness, '') = '' THEN ? ELSE harness END,
      billing_mode = CASE WHEN COALESCE(billing_mode, '') IN ('', 'unknown') THEN ? ELSE billing_mode END,
      metadata = ?
    WHERE id = ?
  `);
  const touchSessionStmt = db.prepare(
    "UPDATE sessions SET updated_at = CASE WHEN updated_at IS NULL OR updated_at < ? THEN ? ELSE updated_at END WHERE id = ?",
  );
  const reactivateSessionStmt = db.prepare(
    "UPDATE sessions SET status = 'active', ended_at = NULL, updated_at = ? WHERE id = ?",
  );

  const getAgentStmt = db.prepare("SELECT id FROM agents WHERE id = ?");
  const insertAgentStmt = db.prepare(`
    INSERT INTO agents (id, session_id, name, type, subagent_type, status, task, current_tool, started_at, updated_at, ended_at, parent_agent_id, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSubagentStmt = db.prepare(`
    INSERT OR IGNORE INTO agents (id, session_id, name, type, subagent_type, status, task, started_at, updated_at, ended_at, parent_agent_id)
    VALUES (?, ?, ?, 'subagent', ?, 'completed', ?, ?, ?, ?, ?)
  `);
  const reactivateMainAgentStmt = db.prepare(
    "UPDATE agents SET status = 'waiting', ended_at = NULL, current_tool = NULL, awaiting_input_since = NULL, updated_at = ? WHERE id = ?",
  );

  const highWaterStmt = db.prepare(
    "SELECT event_type, MAX(created_at) AS hwm FROM events WHERE session_id = ? GROUP BY event_type",
  );
  const insertEventStmt = db.prepare(`
    INSERT INTO events (id, session_id, agent_id, event_type, tool_name, summary, data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  function mainAgentId(sessionId: string): string {
    return `${sessionId}-main`;
  }

  function isRecentlyActive(
    session: NormalizedSession,
    nowMs: number,
    sourceUpdatedAt: string,
  ): boolean {
    const sourceUpdatedAtMs = Date.parse(sourceUpdatedAt);
    return (
      session.fileModifiedAt != null &&
      Number.isFinite(session.fileModifiedAt) &&
      nowMs - session.fileModifiedAt < RECENT_ACTIVITY_MS &&
      Number.isFinite(sourceUpdatedAtMs) &&
      sourceUpdatedAtMs <= nowMs &&
      nowMs - sourceUpdatedAtMs < RECENT_ACTIVITY_MS
    );
  }

  function buildMetadata(session: NormalizedSession, harness: Harness): string {
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
      diffStats: session.diffStats ?? null,
      slashCommands: session.slashCommands ?? [],
      artifacts: session.artifacts ?? { prs: [], issues: [], repo: null },
      tokenSeries: session.tokenSeries ?? [],
    });
  }

  function eventData(input: unknown): string | null {
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

  function sessionSourceUpdatedAt(session: NormalizedSession, startedAt: string): string {
    let latest = startedAt;
    let latestMs = Date.parse(startedAt);
    const consider = (value: string | null | undefined): void => {
      if (!value) return;
      const ms = Date.parse(value);
      if (!Number.isFinite(ms)) return;
      if (!Number.isFinite(latestMs) || ms > latestMs) {
        latest = value;
        latestMs = ms;
      }
    };

    consider(session.endedAt);
    for (const ts of session.messageTimestamps ?? []) consider(ts);
    for (const toolUse of session.toolUses ?? []) consider(toolUse.timestamp);
    for (const duration of session.turnDurations ?? []) consider(duration.timestamp);
    for (const error of session.apiErrors ?? []) consider(error.timestamp);
    for (const error of session.toolResultErrors ?? []) consider(error.timestamp);

    return latest;
  }

  function importSession(session: NormalizedSession, harness: Harness): ImportResult {
    if (typeof session.sessionId !== "string" || session.sessionId.length === 0) {
      return { skipped: true, reactivated: false };
    }
    if (!session.startedAt) {
      return { skipped: true, reactivated: false };
    }

    const startedAt = session.startedAt;
    const now = nowFn();
    const sourceUpdatedAt = sessionSourceUpdatedAt(session, startedAt);
    const nowMs = Date.parse(now);
    const recentlyActive = isRecentlyActive(
      session,
      Number.isNaN(nowMs) ? Date.now() : nowMs,
      sourceUpdatedAt,
    );
    const mainId = mainAgentId(session.sessionId);

    try {
      db.exec("BEGIN IMMEDIATE");

      const existing = getSessionStmt.get(session.sessionId) as SessionRowRaw | undefined;
      let reactivated = false;

      if (!existing) {
        const status = recentlyActive ? "active" : "completed";
        const billingMode = safe(() => deps.detectBillingMode(harness)) ?? "unknown";
        const identity = safe(() => deps.getUserIdentity?.()) ?? null;
        insertSessionStmt.run(
          session.sessionId,
          session.name ?? null,
          status,
          session.cwd ?? null,
          session.model ?? null,
          startedAt,
          now,
          status === "completed" ? sourceUpdatedAt : null,
          harness,
          billingMode,
          buildMetadata(session, harness),
          identity?.userId ?? null,
          identity?.organizationId ?? null,
        );
        insertAgentStmt.run(
          mainId,
          session.sessionId,
          "main",
          "main",
          null,
          status === "completed" ? "completed" : "waiting",
          null,
          null,
          startedAt,
          now,
          status === "completed" ? sourceUpdatedAt : null,
          null,
          null,
        );
      } else {
        const billingMode = safe(() => deps.detectBillingMode(harness)) ?? "unknown";
        coalesceSessionStmt.run(
          session.name ?? null,
          session.model ?? null,
          session.cwd ?? null,
          harness,
          billingMode,
          buildMetadata(session, harness),
          session.sessionId,
        );
        const isLive = existing.status === "active" && existing.ended_at == null;
        if (recentlyActive && !isLive) {
          reactivateSessionStmt.run(now, session.sessionId);
          if (getAgentStmt.get(mainId)) {
            reactivateMainAgentStmt.run(now, mainId);
          }
          reactivated = true;
        }
      }

      // ── Idempotent event backfill via per-event-type high-water-mark ──────────
      const highWater = new Map<string, string>();
      for (const row of highWaterStmt.all(session.sessionId) as Array<{
        event_type: string;
        hwm: string | null;
      }>) {
        if (row.hwm) highWater.set(row.event_type, row.hwm);
      }

      let inserted = 0;
      let namelessEventCounter = 0;
      const addEvent = (
        eventType: string,
        agentId: string,
        ts: string | null,
        toolName: string | null,
        summary: string | null,
        data: string | null,
      ): void => {
        const eventTimestamp = ts ?? (() => {
          // Synthetic increment to distinguish no-timestamp events in the same
          // batch so they don't all collide on the high-water-mark dedup.
          const base = Date.parse(sourceUpdatedAt);
          return new Date(base + namelessEventCounter++).toISOString();
        })();
        const prev = highWater.get(eventType);
        if (prev != null && eventTimestamp <= prev) return;
        insertEventStmt.run(
          randomUUID(),
          session.sessionId,
          agentId,
          eventType,
          toolName,
          summary,
          data,
          eventTimestamp,
        );
        inserted++;
      };

      for (const ts of session.messageTimestamps ?? []) {
        addEvent("Stop", mainId, ts, null, null, null);
      }

      for (const msg of session.messages ?? []) {
        const eventType = msg.role === "human" ? "UserMessage" : "AssistantMessage";
        addEvent(eventType, mainId, msg.timestamp, null, null, eventData({
          text: msg.text,
          role: msg.role,
          ...(msg.model ? { model: msg.model } : {}),
          ...(msg.tokens ? { tokens: msg.tokens } : {}),
          ...(msg.isThinking ? { isThinking: true } : {}),
        }));
      }

      (session.toolUses ?? []).forEach((tu, idx) => {
        const enrichedData = buildToolEventData(tu);
        if (tu.name === "Agent" || tu.name === "Task") {
          const subId = `${session.sessionId}-sub-${idx}`;
          const input = (tu.input ?? {}) as Record<string, unknown>;
          const prompt = strOf(input.prompt);
          insertSubagentStmt.run(
            subId,
            session.sessionId,
            subagentName(tu),
            strOf(input.subagent_type) ?? null,
            prompt ? prompt.slice(0, 500) : null,
            tu.timestamp ?? startedAt,
            tu.timestamp ?? now,
            tu.timestamp ?? sourceUpdatedAt,
            mainId,
          );
          addEvent("PreToolUse", subId, tu.timestamp, tu.name, "Spawned subagent", eventData(enrichedData));
        } else {
          addEvent("PostToolUse", mainId, tu.timestamp, tu.name, null, eventData(enrichedData));
        }
      });

      for (const td of session.turnDurations ?? []) {
        addEvent("TurnDuration", mainId, td.timestamp, null, String(td.durationMs), null);
      }
      for (const err of session.apiErrors ?? []) {
        addEvent("APIError", mainId, err.timestamp, null, err.message ?? err.type ?? null, null);
      }
      for (const err of session.toolResultErrors ?? []) {
        addEvent("ToolError", mainId, err.timestamp, null, truncate(err.content, 200), null);
      }

      // ── Tokens (store reconciles raw/effective; idempotent on equal counts) ───
      for (const [model, counts] of Object.entries(session.tokensByModel ?? {})) {
        deps.tokenUsage.replace(session.sessionId, model, counts, sourceUpdatedAt);
      }

      if (existing != null && inserted > 0 && !reactivated) {
        touchSessionStmt.run(now, now, session.sessionId);
      }

      db.exec("COMMIT");

      const skipped = existing != null && inserted === 0 && !reactivated;
      return { skipped, reactivated };
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore rollback failure */
      }
      log(
        `importSession failed for ${session.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { skipped: true, reactivated: false };
    }
  }

  return { importSession };
}

function buildToolEventData(tu: NormalizedToolUse): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (tu.input != null) data.input = tu.input;
  if (tu.output != null) data.output = tu.output;
  if (tu.isError != null) data.isError = tu.isError;
  if (tu.mcpServer != null) data.mcpServer = tu.mcpServer;
  if (tu.mcpMethod != null) data.mcpMethod = tu.mcpMethod;
  if (tu.skillName != null) data.skillName = tu.skillName;
  if (tu.diffDelta != null) data.diffDelta = tu.diffDelta;
  return data;
}

function strOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
