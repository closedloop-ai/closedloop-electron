/**
 * @file opencode-parser.ts
 * @description Parse OpenCode session data from `opencode.db` into the
 * normalized session shape consumed by `importSession`. OpenCode persists its
 * canonical session/message/part model in SQLite; `storage/` is auxiliary
 * cache/snapshot state and is not authoritative for session history.
 *
 * OpenCode is a BATCH harness: this reads the whole foreign `opencode.db` in
 * one load. Ported from `scripts/agent-monitor-opencode/opencode-parser.js`
 * (logic preserved exactly); the foreign DB is opened with `node:sqlite`'s
 * `DatabaseSync`.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { getOpenCodeDbPath } from "./opencode-home.js";
import {
  emptyUsageExtras,
  type NormalizedApiError,
  type NormalizedSession,
  type NormalizedTokenCounts,
  type NormalizedToolResultError,
  type NormalizedToolUse,
  type NormalizedTurnDuration,
} from "../types.js";
import {
  extractErrorMessage,
  pushTurnDuration,
  safeJson,
  toIso,
} from "../parser-utils.js";

type Row = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJsonCell(value: unknown): unknown {
  return typeof value === "string" ? safeJson(value) : value;
}

function modelIdFromValue(value: unknown): string | null {
  const parsed = parseJsonCell(value);
  if (isObject(parsed)) {
    const modelID = parsed.modelID;
    const id = parsed.id;
    const name = parsed.name;
    return (
      (typeof modelID === "string" ? modelID : null) ||
      (typeof id === "string" ? id : null) ||
      (typeof name === "string" ? name : null) ||
      null
    );
  }
  return typeof parsed === "string" && parsed.length > 0 ? parsed : null;
}

function partTimestamp(partRow: Row, part: Record<string, unknown>): unknown {
  const time = isObject(part.time) ? part.time : undefined;
  return (
    time?.created ??
    time?.start ??
    partRow.time_created ??
    partRow.time_updated ??
    null
  );
}

function collectToolUse(
  toolUses: NormalizedToolUse[],
  toolResultErrors: NormalizedToolResultError[],
  partRow: Row,
  part: Record<string, unknown>,
  firstTimestamp: string | null,
): void {
  const timestamp = toIso(partTimestamp(partRow, part)) || firstTimestamp;
  const state = isObject(part.state) ? part.state : undefined;
  const input = state?.input ?? part.input ?? part.parameters ?? null;
  toolUses.push({
    name:
      (typeof part.tool === "string" ? part.tool : null) ||
      (typeof part.name === "string" ? part.name : null) ||
      "opencode_tool",
    timestamp,
    input: safeJson(input),
  });

  const status = state?.status;
  const errorMessage = extractErrorMessage(state?.error ?? part.error);
  if (status === "failed" || status === "error" || errorMessage) {
    const stateOutput = state?.output;
    const output =
      typeof stateOutput === "string"
        ? stateOutput
        : JSON.stringify(stateOutput ?? part.state ?? part).slice(0, 500);
    toolResultErrors.push({
      content: (errorMessage || output || "OpenCode tool error").slice(0, 500),
      timestamp,
    });
  }
}

function parseSessionRow(
  sessionRow: Row,
  getMessages: StatementSync,
  getParts: StatementSync,
): NormalizedSession | null {
  const sessionId = sessionRow.id as string | number | bigint | null;
  const messageRows = getMessages.all(sessionId) as Row[];
  if (!Array.isArray(messageRows) || messageRows.length === 0) return null;

  let cwd: string | null =
    typeof sessionRow.directory === "string" ? sessionRow.directory : null;
  const model = modelIdFromValue(sessionRow.model);
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  const messageTimestamps: string[] = [];
  const toolUses: NormalizedToolUse[] = [];
  const turnDurations: NormalizedTurnDuration[] = [];
  const apiErrors: NormalizedApiError[] = [];
  let thinkingBlockCount = 0;
  const toolResultErrors: NormalizedToolResultError[] = [];
  let pendingTurnStartedAt: string | null = null;

  const noteTs = (raw: unknown): string | null => {
    const iso = toIso(raw);
    if (!iso) return null;
    if (!firstTimestamp || iso < firstTimestamp) firstTimestamp = iso;
    if (!lastTimestamp || iso > lastTimestamp) lastTimestamp = iso;
    return iso;
  };

  noteTs(sessionRow.time_created);
  noteTs(sessionRow.time_updated);

  for (const row of messageRows) {
    const data = parseJsonCell(row.data);
    if (!isObject(data)) continue;

    const dataTime = isObject(data.time) ? data.time : undefined;
    const iso = noteTs(
      dataTime?.created ?? row.time_created ?? row.time_updated,
    );
    const role =
      (typeof data.role === "string" ? data.role : null) ||
      (typeof data.type === "string" ? data.type : null) ||
      "";

    if (!cwd && isObject(data.path)) {
      const dataPath = data.path;
      const pathCwd =
        typeof dataPath.cwd === "string" ? dataPath.cwd : null;
      const pathRoot =
        typeof dataPath.root === "string" ? dataPath.root : null;
      cwd = pathCwd || pathRoot || cwd;
    }

    if (role === "user" || role === "human") {
      userMessageCount++;
      if (iso) pendingTurnStartedAt = iso;
    } else if (role === "assistant" || role === "ai" || role === "model") {
      assistantMessageCount++;
      if (iso) messageTimestamps.push(iso);
      pushTurnDuration(turnDurations, pendingTurnStartedAt, iso);
      pendingTurnStartedAt = null;
    }

    const errorMessage = extractErrorMessage(data.error);
    if (errorMessage) {
      apiErrors.push({
        type: "error",
        message: errorMessage,
        timestamp: iso,
      });
    }
  }

  const partRows = getParts.all(sessionId) as Row[];
  for (const partRow of partRows) {
    const part = parseJsonCell(partRow.data);
    if (!isObject(part)) continue;

    const iso = noteTs(partTimestamp(partRow, part));
    if (part.type === "reasoning") {
      thinkingBlockCount++;
    } else if (part.type === "tool") {
      collectToolUse(toolUses, toolResultErrors, partRow, part, firstTimestamp);
    } else if (part.type === "error") {
      const errorMessage = extractErrorMessage(part);
      if (errorMessage) {
        apiErrors.push({
          type: "error",
          message: errorMessage,
          timestamp: iso,
        });
      }
    }
  }

  if (!firstTimestamp) return null;

  const tokensByModel: Record<string, NormalizedTokenCounts> = {};
  const tokenInput = Number(sessionRow.tokens_input || 0);
  const tokenOutput = Number(sessionRow.tokens_output || 0);
  const tokenReasoning = Number(sessionRow.tokens_reasoning || 0);
  const tokenCacheRead = Number(sessionRow.tokens_cache_read || 0);
  const tokenCacheWrite = Number(sessionRow.tokens_cache_write || 0);
  if (
    tokenInput ||
    tokenOutput ||
    tokenReasoning ||
    tokenCacheRead ||
    tokenCacheWrite
  ) {
    const agent = typeof sessionRow.agent === "string" ? sessionRow.agent : null;
    const key = model || agent || "opencode-default";
    tokensByModel[key] = {
      input: tokenInput,
      output: tokenOutput + tokenReasoning,
      cacheRead: tokenCacheRead,
      cacheWrite: tokenCacheWrite,
    };
  }

  const sessionIdStr = String(sessionId);
  const title = typeof sessionRow.title === "string" ? sessionRow.title : null;
  const projectName = cwd
    ? path.basename(cwd)
    : title || `OpenCode Session ${sessionIdStr.slice(0, 8)}`;

  const version =
    typeof sessionRow.version === "string" ? sessionRow.version : null;
  const slug = typeof sessionRow.slug === "string" ? sessionRow.slug : null;
  const permissionMode =
    typeof sessionRow.permission === "string" ? sessionRow.permission : null;

  return {
    sessionId: `opencode-${sessionIdStr}`,
    name: projectName,
    cwd,
    model,
    version,
    slug,
    gitBranch: null,
    startedAt: firstTimestamp,
    endedAt: lastTimestamp || firstTimestamp,
    teams: [],
    userMessages: userMessageCount,
    assistantMessages: assistantMessageCount,
    tokensByModel,
    messageTimestamps,
    toolUses,
    compactions: [],
    apiErrors,
    fileModifiedAt: Number(sessionRow.time_updated || 0) || null,
    turnDurations,
    entrypoint: "opencode",
    permissionMode,
    thinkingBlockCount,
    toolResultErrors,
    usageExtras: emptyUsageExtras(),
  };
}

export function loadSessionsFromDb(
  dbPath: string = getOpenCodeDbPath(),
): NormalizedSession[] {
  if (!dbPath || !fs.existsSync(dbPath)) return [];

  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 1000");
    const sessionRows = db
      .prepare(
        `
        SELECT
          id,
          slug,
          directory,
          title,
          version,
          agent,
          model,
          permission,
          time_created,
          time_updated,
          tokens_input,
          tokens_output,
          tokens_reasoning,
          tokens_cache_read,
          tokens_cache_write
        FROM session
        ORDER BY time_updated DESC, id DESC
      `,
      )
      .all() as Row[];
    const getMessages = db.prepare(`
      SELECT id, time_created, time_updated, data
      FROM message
      WHERE session_id = ?
      ORDER BY time_created ASC, id ASC
    `);
    const getParts = db.prepare(`
      SELECT id, time_created, time_updated, data
      FROM part
      WHERE session_id = ?
      ORDER BY time_created ASC, id ASC
    `);

    const out: NormalizedSession[] = [];
    for (const row of sessionRows) {
      const session = parseSessionRow(row, getMessages, getParts);
      if (session) out.push(session);
    }
    return out;
  } finally {
    db.close();
  }
}
