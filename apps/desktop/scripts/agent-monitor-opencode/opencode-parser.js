/**
 * @file opencode-parser.js
 * @description Parse OpenCode session data from `opencode.db` into the
 * normalized session object consumed by importSession(). OpenCode persists its
 * canonical session/message/part model in SQLite; `storage/` is auxiliary
 * cache/snapshot state and is not authoritative for session history.
 */
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { getOpenCodeDbPath } = require("./opencode-home");
const {
  extractErrorMessage,
  safeJson,
  toIso,
} = require("../agent-monitor-shared/parser-utils");

function parseJsonCell(value) {
  return typeof value === "string" ? safeJson(value) : value;
}

function modelIdFromValue(value) {
  const parsed = parseJsonCell(value);
  if (parsed && typeof parsed === "object") {
    return parsed.modelID || parsed.id || parsed.name || null;
  }
  return typeof parsed === "string" && parsed.length > 0 ? parsed : null;
}

function partTimestamp(partRow, part) {
  return (
    part?.time?.created ??
    part?.time?.start ??
    partRow.time_created ??
    partRow.time_updated ??
    null
  );
}

function collectToolUse(toolUses, toolResultErrors, partRow, part, firstTimestamp) {
  const timestamp = toIso(partTimestamp(partRow, part)) || firstTimestamp;
  const input = part?.state?.input ?? part?.input ?? part?.parameters ?? null;
  toolUses.push({
    name: part.tool || part.name || "opencode_tool",
    timestamp,
    input: safeJson(input),
  });

  const status = part?.state?.status;
  const errorMessage = extractErrorMessage(part?.state?.error ?? part?.error);
  if (status === "failed" || status === "error" || errorMessage) {
    const output =
      typeof part?.state?.output === "string"
        ? part.state.output
        : JSON.stringify(part?.state?.output ?? part?.state ?? part).slice(0, 500);
    toolResultErrors.push({
      content: (errorMessage || output || "OpenCode tool error").slice(0, 500),
      timestamp,
    });
  }
}

function parseSessionRow(sessionRow, getMessages, getParts) {
  const messageRows = getMessages.all(sessionRow.id);
  if (!Array.isArray(messageRows) || messageRows.length === 0) return null;

  let cwd = sessionRow.directory || null;
  const model = modelIdFromValue(sessionRow.model);
  let firstTimestamp = null;
  let lastTimestamp = null;
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  const messageTimestamps = [];
  const toolUses = [];
  const apiErrors = [];
  let thinkingBlockCount = 0;
  const toolResultErrors = [];

  const noteTs = (raw) => {
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
    if (!data || typeof data !== "object") continue;

    const iso = noteTs(data.time?.created ?? row.time_created ?? row.time_updated);
    const role = data.role || data.type || "";

    if (!cwd && data.path && typeof data.path === "object") {
      cwd = data.path.cwd || data.path.root || cwd;
    }

    if (role === "user" || role === "human") {
      userMessageCount++;
    } else if (role === "assistant" || role === "ai" || role === "model") {
      assistantMessageCount++;
      if (iso) messageTimestamps.push(iso);
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

  const partRows = getParts.all(sessionRow.id);
  for (const partRow of partRows) {
    const part = parseJsonCell(partRow.data);
    if (!part || typeof part !== "object") continue;

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

  const tokensByModel = {};
  const tokenInput = Number(sessionRow.tokens_input || 0);
  const tokenOutput = Number(sessionRow.tokens_output || 0);
  const tokenReasoning = Number(sessionRow.tokens_reasoning || 0);
  const tokenCacheRead = Number(sessionRow.tokens_cache_read || 0);
  const tokenCacheWrite = Number(sessionRow.tokens_cache_write || 0);
  if (tokenInput || tokenOutput || tokenReasoning || tokenCacheRead || tokenCacheWrite) {
    const key = model || sessionRow.agent || "opencode-default";
    tokensByModel[key] = {
      input: tokenInput,
      output: tokenOutput + tokenReasoning,
      cacheRead: tokenCacheRead,
      cacheWrite: tokenCacheWrite,
    };
  }

  const projectName = cwd ? path.basename(cwd) : sessionRow.title || `OpenCode Session ${sessionRow.id.slice(0, 8)}`;

  return {
    sessionId: `opencode-${sessionRow.id}`,
    name: `${projectName} (opencode)`,
    cwd,
    model,
    version: sessionRow.version || null,
    slug: sessionRow.slug || null,
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
    turnDurations: [],
    entrypoint: "opencode",
    permissionMode: sessionRow.permission || null,
    thinkingBlockCount,
    toolResultErrors,
    usageExtras: { service_tiers: [], speeds: [], inference_geos: [] },
  };
}

function loadSessionsFromDb(dbPath = getOpenCodeDbPath()) {
  if (!dbPath || !fs.existsSync(dbPath)) return [];

  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 1000");
    const sessionRows = db
      .prepare(`
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
      `)
      .all();
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

    return sessionRows
      .map((row) => parseSessionRow(row, getMessages, getParts))
      .filter(Boolean);
  } finally {
    db.close();
  }
}

module.exports = { loadSessionsFromDb };
