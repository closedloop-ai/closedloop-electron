import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { extractTranscriptTokens, type TranscriptExtract } from "./transcript.js";
import type { createTokenUsageStore } from "./token-usage.js";

/**
 * In-process hook lifecycle state machine (FEA-1497 Phase 1).
 *
 * Ports the vendor `server/routes/hooks.js` `processEvent` transaction onto the
 * in-process node:sqlite repository: it owns ALL session/agent/event/token
 * writes. Each hook event is applied in a single `BEGIN IMMEDIATE` transaction
 * so a malformed event cannot leave half-written state, and node:sqlite being
 * synchronous + single-threaded means concurrent hook POSTs serialize without
 * SQLITE_BUSY.
 *
 * Status vocabulary (matches the vendor + canonical AgentSession*):
 *   session: 'active' | 'completed' | 'abandoned' | 'error'
 *   agent:   'working' | 'waiting'  | 'completed' | 'error'
 * "Waiting for input" is also surfaced via the `awaiting_input_since` timestamp.
 */

/** Snake_case hook payload `data` block as delivered by the hook handlers. */
export interface HookData {
  session_id?: string;
  cwd?: string;
  model?: string;
  transcript_path?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown> | null;
  source?: string;
  stop_reason?: string;
  message?: string;
  agent_type?: string;
  subagent_type?: string;
  prompt?: string;
  description?: string;
  session_name?: string;
  [key: string]: unknown;
}

export interface LifecycleDeps {
  tokenUsage: ReturnType<typeof createTokenUsageStore>;
  /** Resolve a billing mode for a harness at session creation (FEA-1434). */
  detectBillingMode: (harness: string) => string;
  /** Injectable transcript extractor (tests pass a stub; default reads the file). */
  extractTranscript?: (path: string) => TranscriptExtract | null;
  /** Notify the renderer a session changed (live updates). */
  emit?: (sessionId: string) => void;
  /** Injectable clock (tests pin it). Returns an ISO timestamp. */
  now?: () => string;
  /** Key-free diagnostic sink. */
  log?: (message: string) => void;
  /** Minutes of inactivity after which a still-active session is abandoned. */
  staleMinutes?: number;
  /**
   * FEA-1548: resolve the current authenticated user's identity for stamping
   * on new sessions. Returns null when no user is signed in.
   */
  getUserIdentity?: () => { userId: string; organizationId: string | null } | null;
}

const COMPACTION_RE = /compact|compress|context.*(reduc|truncat|summar)/i;
// Permission / waiting-for-input notifications (not idle "finished responding").
const WAITING_INPUT_RE =
  /needs your permission|waiting for your input|is waiting|requires approval|permission to use/i;

interface SessionRowRaw {
  id: string;
  status: string;
  harness: string | null;
  billing_mode: string | null;
  model: string | null;
}

interface AgentRowRaw {
  id: string;
  status: string;
  type: string | null;
  parent_agent_id: string | null;
}

export function createLifecycle(db: DatabaseSync, deps: LifecycleDeps) {
  const nowFn = deps.now ?? (() => new Date().toISOString());
  const log = deps.log ?? (() => {});
  const staleMinutes = deps.staleMinutes ?? 180;
  const extract = deps.extractTranscript ?? extractTranscriptTokens;

  // ── Prepared statements ────────────────────────────────────────────────────
  const getSessionStmt = db.prepare(
    "SELECT id, status, harness, billing_mode, model FROM sessions WHERE id = ?",
  );
  const insertSessionStmt = db.prepare(`
    INSERT INTO sessions (id, name, status, cwd, model, started_at, updated_at, harness, billing_mode, user_id, organization_id)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const setSessionStatusStmt = db.prepare(
    "UPDATE sessions SET status = ?, updated_at = ?, ended_at = ? WHERE id = ?",
  );
  const touchSessionStmt = db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?");
  const setSessionModelStmt = db.prepare(
    "UPDATE sessions SET model = ?, updated_at = ? WHERE id = ? AND COALESCE(model, '') != ?",
  );
  const setSessionAwaitingStmt = db.prepare(
    "UPDATE sessions SET awaiting_input_since = ?, updated_at = ? WHERE id = ?",
  );
  const clearSessionAwaitingStmt = db.prepare(
    "UPDATE sessions SET awaiting_input_since = NULL, updated_at = ? WHERE id = ?",
  );

  const getAgentStmt = db.prepare(
    "SELECT id, status, type, parent_agent_id FROM agents WHERE id = ?",
  );
  const insertAgentStmt = db.prepare(`
    INSERT INTO agents (id, session_id, name, type, subagent_type, status, task, current_tool, started_at, updated_at, parent_agent_id, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const setAgentStatusStmt = db.prepare(
    "UPDATE agents SET status = ?, updated_at = ?, ended_at = ? WHERE id = ?",
  );
  const setAgentToolStmt = db.prepare(
    "UPDATE agents SET current_tool = ?, status = 'working', updated_at = ? WHERE id = ?",
  );
  const setAgentAwaitingStmt = db.prepare(
    "UPDATE agents SET awaiting_input_since = ?, status = ?, updated_at = ? WHERE id = ?",
  );
  const clearSessionAgentsAwaitingStmt = db.prepare(
    "UPDATE agents SET awaiting_input_since = NULL, updated_at = ? WHERE session_id = ? AND awaiting_input_since IS NOT NULL",
  );
  const promoteMainStmt = db.prepare(
    "UPDATE agents SET status = 'working', awaiting_input_since = NULL, updated_at = ? WHERE id = ? AND status != 'working'",
  );
  const completeNonTerminalAgentsStmt = db.prepare(
    "UPDATE agents SET status = ?, ended_at = ?, updated_at = ? WHERE session_id = ? AND status NOT IN ('completed', 'error')",
  );
  // Deepest working subagent for parent inference (recursive depth over the tree).
  const deepestWorkingStmt = db.prepare(`
    WITH RECURSIVE chain(id, depth) AS (
      SELECT id, 0 FROM agents WHERE session_id = ? AND parent_agent_id IS NULL
      UNION ALL
      SELECT a.id, c.depth + 1 FROM agents a JOIN chain c ON a.parent_agent_id = c.id
    )
    SELECT a.id AS id FROM chain c JOIN agents a ON a.id = c.id
    WHERE a.status = 'working' AND a.type = 'subagent'
    ORDER BY c.depth DESC, a.started_at DESC LIMIT 1
  `);
  const workingSubagentsStmt = db.prepare(
    "SELECT id, name, subagent_type, task FROM agents WHERE session_id = ? AND type = 'subagent' AND status = 'working' ORDER BY started_at DESC",
  );
  const findStaleSessionsStmt = db.prepare(
    "SELECT id FROM sessions WHERE status = 'active' AND id != ? AND updated_at < ?",
  );

  const insertEventStmt = db.prepare(`
    INSERT INTO events (id, session_id, agent_id, event_type, tool_name, summary, data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function mainAgentId(sessionId: string): string {
    return `${sessionId}-main`;
  }

  function getSession(sessionId: string): SessionRowRaw | undefined {
    return getSessionStmt.get(sessionId) as SessionRowRaw | undefined;
  }

  function getAgent(agentId: string): AgentRowRaw | undefined {
    return getAgentStmt.get(agentId) as AgentRowRaw | undefined;
  }

  function ensureSession(sessionId: string, data: HookData, harness: string, now: string): SessionRowRaw {
    const existing = getSession(sessionId);
    if (existing) {
      return existing;
    }
    const billingMode = safe(() => deps.detectBillingMode(harness)) ?? "unknown";
    const identity = safe(() => deps.getUserIdentity?.()) ?? null;
    insertSessionStmt.run(
      sessionId,
      data.session_name ?? null,
      data.cwd ?? null,
      data.model ?? null,
      now,
      now,
      harness,
      billingMode,
      identity?.userId ?? null,
      identity?.organizationId ?? null,
    );
    // Every session has a synthetic main agent.
    insertAgentStmt.run(
      mainAgentId(sessionId),
      sessionId,
      "main",
      "main",
      null,
      "working",
      null,
      null,
      now,
      now,
      null,
      null,
    );
    return getSession(sessionId)!;
  }

  function clearAwaitingInput(sessionId: string, now: string): void {
    clearSessionAwaitingStmt.run(now, sessionId);
    clearSessionAgentsAwaitingStmt.run(now, sessionId);
  }

  function setMainWaiting(sessionId: string, now: string): void {
    setSessionAwaitingStmt.run(now, now, sessionId);
    setAgentAwaitingStmt.run(now, "waiting", now, mainAgentId(sessionId));
  }

  function insertEvent(
    sessionId: string,
    agentId: string | null,
    eventType: string,
    data: HookData,
    now: string,
    summary?: string,
  ): void {
    insertEventStmt.run(
      randomUUID(),
      sessionId,
      agentId,
      eventType,
      data.tool_name ?? null,
      summary ?? null,
      safe(() => JSON.stringify(data)) ?? null,
      now,
    );
  }

  /** Reactivate a non-active session per the vendor's gate. */
  function maybeReactivate(session: SessionRowRaw, hookType: string, now: string): void {
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
      setSessionStatusStmt.run("active", now, null, session.id);
      promoteMainStmt.run(now, mainAgentId(session.id));
      session.status = "active";
    }
  }

  function spawnSubagent(sessionId: string, data: HookData, now: string): string {
    const input = (data.tool_input as Record<string, unknown> | undefined) ?? {};
    const description = strOf(input.description) ?? strOf(data.description);
    const subagentType = strOf(input.subagent_type) ?? strOf(data.subagent_type);
    const prompt = strOf(input.prompt) ?? strOf(data.prompt);
    const name =
      description ??
      subagentType ??
      (prompt ? prompt.split("\n")[0].slice(0, 60) : undefined) ??
      "Subagent";

    // Parent inference: a working main agent is the parent; otherwise the
    // deepest currently-working subagent; otherwise fall back to main.
    const main = getAgent(mainAgentId(sessionId));
    let parentId = mainAgentId(sessionId);
    if (!main || main.status !== "working") {
      const deepest = deepestWorkingStmt.get(sessionId) as { id: string } | undefined;
      if (deepest) {
        parentId = deepest.id;
      }
    }

    const agentId = `${sessionId}-sub-${randomUUID().slice(0, 8)}`;
    insertAgentStmt.run(
      agentId,
      sessionId,
      name,
      "subagent",
      subagentType ?? null,
      "working",
      prompt ? prompt.slice(0, 500) : null,
      null,
      now,
      now,
      parentId,
      null,
    );
    return agentId;
  }

  function matchSubagent(sessionId: string, data: HookData): string | null {
    const candidates = workingSubagentsStmt.all(sessionId) as Array<{
      id: string;
      name: string | null;
      subagent_type: string | null;
      task: string | null;
    }>;
    if (candidates.length === 0) {
      return null;
    }
    const prefix = strOf(data.description) ?? strOf(data.agent_type) ?? strOf(data.subagent_type);
    if (prefix) {
      const byName = candidates.find((a) => a.name != null && a.name.startsWith(prefix));
      if (byName) {
        return byName.id;
      }
    }
    if (data.agent_type) {
      const byType = candidates.find((a) => a.subagent_type === data.agent_type);
      if (byType) {
        return byType.id;
      }
    }
    if (data.prompt) {
      const task = String(data.prompt).slice(0, 500);
      const byTask = candidates.find((a) => a.task === task);
      if (byTask) {
        return byTask.id;
      }
    }
    return candidates[0].id; // fallback: oldest-started working subagent
  }

  function sweepStaleSessions(currentSessionId: string, now: string): void {
    const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();
    const stale = findStaleSessionsStmt.all(currentSessionId, cutoff) as Array<{ id: string }>;
    for (const { id } of stale) {
      completeNonTerminalAgentsStmt.run("completed", now, now, id);
      setSessionStatusStmt.run("abandoned", now, now, id);
    }
  }

  function applyTranscript(sessionId: string, extract: TranscriptExtract, now: string): void {
    if (extract.latestModel) {
      setSessionModelStmt.run(extract.latestModel, now, sessionId, extract.latestModel);
    }
    for (const [model, counts] of extract.tokensByModel) {
      deps.tokenUsage.replace(sessionId, model, counts, now);
    }
  }

  // ── Per-event handlers ───────────────────────────────────────────────────────
  function handle(hookType: string, data: HookData, sessionId: string, harness: string, now: string): void {
    ensureSession(sessionId, data, harness, now);
    const session = getSession(sessionId)!;
    maybeReactivate(session, hookType, now);
    touchSessionStmt.run(now, sessionId);
    const main = mainAgentId(sessionId);

    switch (hookType) {
      case "SessionStart": {
        // A freshly started/resumed session sits at a prompt awaiting input.
        setMainWaiting(sessionId, now);
        sweepStaleSessions(sessionId, now);
        insertEvent(sessionId, main, "SessionStart", data, now, data.source === "resume" ? "Resumed session" : "Started session");
        break;
      }
      case "UserPromptSubmit": {
        clearAwaitingInput(sessionId, now);
        promoteMainStmt.run(now, main);
        insertEvent(sessionId, main, "UserPromptSubmit", data, now);
        break;
      }
      case "PreToolUse": {
        clearAwaitingInput(sessionId, now);
        if (data.tool_name === "Agent" || data.tool_name === "Task") {
          const agentId = spawnSubagent(sessionId, data, now);
          insertEvent(sessionId, agentId, "PreToolUse", data, now, "Spawned subagent");
        } else {
          setAgentToolStmt.run(data.tool_name ?? null, now, main);
          insertEvent(sessionId, main, "PreToolUse", data, now);
        }
        break;
      }
      case "PostToolUse": {
        clearAwaitingInput(sessionId, now);
        const mainAgent = getAgent(main);
        if (mainAgent && mainAgent.status === "working") {
          setAgentToolStmt.run(null, now, main);
        }
        insertEvent(sessionId, main, "PostToolUse", data, now);
        break;
      }
      case "Stop": {
        if (data.stop_reason === "error") {
          setAgentStatusStmt.run("error", now, now, main);
          setSessionStatusStmt.run("error", now, now, sessionId);
          clearAwaitingInput(sessionId, now);
        } else {
          // Turn ended; session stays active, main waits for the next prompt.
          setMainWaiting(sessionId, now);
        }
        insertEvent(sessionId, main, "Stop", data, now);
        break;
      }
      case "SubagentStop": {
        const agentId = matchSubagent(sessionId, data);
        if (agentId) {
          setAgentStatusStmt.run("completed", now, now, agentId);
        }
        insertEvent(sessionId, agentId, "SubagentStop", data, now);
        break;
      }
      case "Notification": {
        const message = strOf(data.message) ?? "";
        if (COMPACTION_RE.test(message)) {
          insertEvent(sessionId, main, "Compaction", data, now, "Context compaction");
        } else if (WAITING_INPUT_RE.test(message)) {
          setMainWaiting(sessionId, now);
          insertEvent(sessionId, main, "Notification", data, now, message.slice(0, 200));
        } else {
          insertEvent(sessionId, main, "Notification", data, now, message.slice(0, 200) || undefined);
        }
        break;
      }
      case "SessionEnd": {
        clearAwaitingInput(sessionId, now);
        const finalStatus = session.status === "error" ? "error" : "completed";
        completeNonTerminalAgentsStmt.run(
          finalStatus === "error" ? "error" : "completed",
          now,
          now,
          sessionId,
        );
        setSessionStatusStmt.run(finalStatus, now, now, sessionId);
        insertEvent(sessionId, main, "SessionEnd", data, now);
        break;
      }
      default: {
        insertEvent(sessionId, main, hookType, data, now);
        break;
      }
    }
  }

  return {
    /**
     * Apply one hook event. `harness` is stamped at the listener boundary
     * ("claude" | "codex"). Returns true if a write occurred, false if ignored.
     * Never throws — a bad event is logged and rolled back, never propagated to
     * the fail-silent hook handler.
     */
    processEvent(hookType: string, data: HookData, harness: string): boolean {
      // `session_id` arrives as `unknown` through the listener's zod envelope
      // (`data` is validated only as a string-keyed record), so its declared
      // `string` type is not enforced at runtime. Guard the actual type before
      // it becomes a SQLite primary-key binding: a non-string (e.g. an object)
      // would otherwise be stringified to "[object Object]" and stored as a
      // junk primary key. (CLAUDE.md: runtime-validate persisted payloads.)
      const sessionId = data.session_id;
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        return false;
      }
      // Read the transcript (file IO) BEFORE opening the write transaction.
      let transcript: TranscriptExtract | null = null;
      if (data.transcript_path) {
        try {
          transcript = extract(data.transcript_path);
        } catch {
          transcript = null;
        }
      }
      const now = nowFn();
      try {
        // BEGIN is inside the try so that a stale open transaction (e.g. a prior
        // ROLLBACK that itself failed) surfaces here and is rolled back below,
        // letting the next event recover, rather than escaping processEvent.
        db.exec("BEGIN IMMEDIATE");
        handle(hookType, data, sessionId, harness, now);
        if (transcript) {
          applyTranscript(sessionId, transcript, now);
        }
        db.exec("COMMIT");
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ignore rollback failure */
        }
        log(`lifecycle: failed to process ${hookType}: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
      try {
        deps.emit?.(sessionId);
      } catch {
        /* live-update push is best-effort */
      }
      return true;
    },
  };
}

function strOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
