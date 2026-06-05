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
  type NormalizedDiffStats,
  type NormalizedMessage,
  type NormalizedSession,
  type NormalizedTokenCounts,
  type NormalizedTokenRecord,
  type NormalizedToolResultError,
  type NormalizedToolUse,
  type NormalizedTurnDuration,
} from "../types.js";
import {
  collectArtifacts,
  computeUnifiedDiffDelta,
  countDiffFiles,
  extractErrorMessage,
  pushTurnDuration,
  safeJson,
  toIso,
  truncateText,
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

/** CR-2: Extract per-message token counts from the message data JSON. */
function extractMessageTokens(
  data: Record<string, unknown>,
): { input: number; output: number; cacheRead: number; cacheWrite: number } | null {
  // OpenCode stores tokens in data.tokens as an object or JSON string.
  const raw = parseJsonCell(data.tokens);
  if (!isObject(raw)) return null;
  const input = Number(raw.input || raw.inputTokens || 0);
  const output = Number(raw.output || raw.outputTokens || 0) +
    Number(raw.reasoning || raw.reasoningTokens || 0);
  const cacheRead = Number(raw.cacheRead || raw.cache_read || raw.cacheReadTokens || 0);
  const cacheWrite = Number(raw.cacheWrite || raw.cache_write || raw.cacheWriteTokens || 0);
  if (input || output || cacheRead || cacheWrite) {
    return { input, output, cacheRead, cacheWrite };
  }
  return null;
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
  const status = state?.status;
  const stateOutput = state?.output;

  // CR-3: Capture output for all completions (success and error).
  let output: unknown = undefined;
  let isError = false;
  const errorMessage = extractErrorMessage(state?.error ?? part.error);

  if (status === "failed" || status === "error" || errorMessage) {
    isError = true;
    const outputStr =
      typeof stateOutput === "string"
        ? stateOutput
        : JSON.stringify(stateOutput ?? part.state ?? part).slice(0, 500);
    output = truncateText(
      errorMessage || outputStr || "OpenCode tool error",
      4096,
    );
    toolResultErrors.push({
      content: (errorMessage || outputStr || "OpenCode tool error").slice(0, 500),
      timestamp,
    });
  } else if (stateOutput != null) {
    // CR-3: Successful tool output — truncate at 4KB.
    const outputStr =
      typeof stateOutput === "string"
        ? stateOutput
        : JSON.stringify(stateOutput);
    output = truncateText(outputStr, 4096);
  }

  toolUses.push({
    name:
      (typeof part.tool === "string" ? part.tool : null) ||
      (typeof part.name === "string" ? part.name : null) ||
      "opencode_tool",
    timestamp,
    input: safeJson(input),
    output,
    isError: isError || undefined,
  });
}

function parseSessionRow(
  sessionRow: Row,
  getMessages: StatementSync,
  getParts: StatementSync,
  hasSummaryCols: boolean,
): NormalizedSession | null {
  const sessionId = sessionRow.id as string | number | bigint | null;
  const messageRows = getMessages.all(sessionId) as Row[];
  if (!Array.isArray(messageRows) || messageRows.length === 0) return null;

  let cwd: string | null =
    typeof sessionRow.directory === "string" ? sessionRow.directory : null;
  const sessionModel = modelIdFromValue(sessionRow.model);
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

  // CR-1: ordered messages
  const messages: NormalizedMessage[] = [];
  // CR-2: per-turn token time-series
  const tokenSeries: NormalizedTokenRecord[] = [];
  // CR-4: aggregate diff stats from patch parts
  let totalAdded = 0;
  let totalRemoved = 0;
  let totalFilesChanged = 0;
  // CR-7: slash commands (OpenCode does not have these; keep empty)
  const slashCommands: Array<{ name: string; timestamp: string }> = [];

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

    // CR-5: Per-message modelID from data JSON.
    const msgModel = modelIdFromValue(data.model ?? data.modelID) || sessionModel;

    // CR-2: Per-message token counts.
    const msgTokens = extractMessageTokens(data);

    if (role === "user" || role === "human") {
      userMessageCount++;
      if (iso) pendingTurnStartedAt = iso;

      // CR-1: Build NormalizedMessage for user messages.
      // User message text is in data.content (string or array of parts).
      const userText = extractMessageText(data);
      messages.push({
        role: "human",
        timestamp: iso,
        text: truncateText(userText),
        model: msgModel,
        tokens: msgTokens ?? undefined,
      });

      // CR-2: Token series for user messages (if tokens present).
      if (msgTokens && iso && msgModel) {
        tokenSeries.push({
          timestamp: iso,
          model: msgModel,
          input: msgTokens.input,
          output: msgTokens.output,
          cacheRead: msgTokens.cacheRead,
          cacheWrite: msgTokens.cacheWrite,
        });
      }
    } else if (role === "assistant" || role === "ai" || role === "model") {
      assistantMessageCount++;
      if (iso) messageTimestamps.push(iso);
      pushTurnDuration(turnDurations, pendingTurnStartedAt, iso);
      pendingTurnStartedAt = null;

      // CR-1: Build NormalizedMessage for assistant messages.
      const assistantText = extractMessageText(data);
      messages.push({
        role: "assistant",
        timestamp: iso,
        text: truncateText(assistantText),
        model: msgModel,
        tokens: msgTokens ?? undefined,
      });

      // CR-2: Token series for assistant messages.
      if (msgTokens && iso && msgModel) {
        tokenSeries.push({
          timestamp: iso,
          model: msgModel,
          input: msgTokens.input,
          output: msgTokens.output,
          cacheRead: msgTokens.cacheRead,
          cacheWrite: msgTokens.cacheWrite,
        });
      }
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
      // CR-1: Thinking block as a message entry.
      messages.push({
        role: "assistant",
        timestamp: iso,
        text: null,
        model: sessionModel,
        isThinking: true,
      });
    } else if (part.type === "text") {
      // CR-1: Text parts contribute to messages. These are typically
      // content sub-parts within assistant turns.
      const textContent =
        typeof part.text === "string" ? part.text :
        typeof part.content === "string" ? part.content : null;
      if (textContent) {
        messages.push({
          role: "assistant",
          timestamp: iso,
          text: truncateText(textContent),
          model: sessionModel,
        });
      }
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
    } else if (part.type === "patch") {
      // CR-4: Patch parts contain unified diff data.
      const patchContent =
        typeof part.content === "string" ? part.content :
        typeof part.patch === "string" ? part.patch :
        typeof part.diff === "string" ? part.diff : null;
      if (patchContent) {
        const delta = computeUnifiedDiffDelta(patchContent);
        totalAdded += delta.add;
        totalRemoved += delta.del;
        totalFilesChanged += countDiffFiles(patchContent);
        // Attach diff delta to the most recent tool use if applicable.
        if (toolUses.length > 0) {
          const lastTool = toolUses[toolUses.length - 1];
          if (!lastTool.diffDelta) {
            lastTool.diffDelta = delta;
          }
        }
      }
    } else if (part.type === "step-finish" || part.type === "step_finish") {
      // CR-2: Step-finish parts may contain per-step token data.
      const stepData = isObject(part.usage) ? part.usage :
        isObject(part.tokens) ? part.tokens : null;
      if (stepData && iso) {
        const stepModel =
          modelIdFromValue(part.model ?? part.modelID) || sessionModel || "opencode-default";
        const input = Number(stepData.input || stepData.inputTokens || 0);
        const output = Number(stepData.output || stepData.outputTokens || 0) +
          Number(stepData.reasoning || stepData.reasoningTokens || 0);
        const cacheRead = Number(stepData.cacheRead || stepData.cache_read || 0);
        const cacheWrite = Number(stepData.cacheWrite || stepData.cache_write || 0);
        if (input || output || cacheRead || cacheWrite) {
          tokenSeries.push({
            timestamp: iso,
            model: stepModel,
            input,
            output,
            cacheRead,
            cacheWrite,
          });
        }
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
    const key = sessionModel || agent || "opencode-default";
    tokensByModel[key] = {
      input: tokenInput,
      output: tokenOutput + tokenReasoning,
      cacheRead: tokenCacheRead,
      cacheWrite: tokenCacheWrite,
    };
  }

  // CR-4: Build aggregate diffStats. Prefer summary columns from the session
  // row when available (CR-9), fall back to patch-part accumulation.
  let diffStats: NormalizedDiffStats | null = null;
  if (hasSummaryCols) {
    const summaryAdds = Number(sessionRow.summary_additions || 0);
    const summaryDels = Number(sessionRow.summary_deletions || 0);
    const summaryFiles = Number(sessionRow.summary_files || 0);
    if (summaryAdds || summaryDels || summaryFiles) {
      diffStats = {
        filesChanged: summaryFiles,
        linesAdded: summaryAdds,
        linesRemoved: summaryDels,
      };
    }
  }
  if (!diffStats && (totalAdded || totalRemoved || totalFilesChanged)) {
    diffStats = {
      filesChanged: totalFilesChanged,
      linesAdded: totalAdded,
      linesRemoved: totalRemoved,
    };
  }

  // CR-13: Collect artifact references from tool uses.
  const artifacts = collectArtifacts(toolUses, cwd);

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
    model: sessionModel,
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
    messages,
    tokenSeries,
    diffStats,
    slashCommands,
    artifacts,
  };
}

/** Extract text content from a message data object. Handles both string and
 *  array-of-parts content shapes. */
function extractMessageText(data: Record<string, unknown>): string | null {
  const content = data.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textParts: string[] = [];
    for (const item of content) {
      if (typeof item === "string") {
        textParts.push(item);
      } else if (isObject(item)) {
        if (item.type === "text" && typeof item.text === "string") {
          textParts.push(item.text);
        }
      }
    }
    return textParts.length > 0 ? textParts.join("\n") : null;
  }
  // Fallback: try data.text directly.
  if (typeof data.text === "string") return data.text;
  return null;
}

/** CR-9: Detect whether the session table has summary_* columns. */
function hasSummaryColumns(db: DatabaseSync): boolean {
  try {
    const cols = db.prepare("PRAGMA table_info(session)").all() as Row[];
    const names = new Set(cols.map((c) => c.name));
    return (
      names.has("summary_additions") &&
      names.has("summary_deletions") &&
      names.has("summary_files")
    );
  } catch {
    return false;
  }
}

export function loadSessionsFromDb(
  dbPath: string = getOpenCodeDbPath(),
): NormalizedSession[] {
  if (!dbPath || !fs.existsSync(dbPath)) return [];

  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 1000");

    // CR-9: Detect optional summary columns before building the SELECT.
    const hasSummaryCols = hasSummaryColumns(db);

    const sessionSelect = hasSummaryCols
      ? `
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
          tokens_cache_write,
          summary_additions,
          summary_deletions,
          summary_files
        FROM session
        ORDER BY time_updated DESC, id DESC
      `
      : `
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
      `;

    const sessionRows = db.prepare(sessionSelect).all() as Row[];
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
      const session = parseSessionRow(row, getMessages, getParts, hasSummaryCols);
      if (session) out.push(session);
    }
    return out;
  } finally {
    db.close();
  }
}
