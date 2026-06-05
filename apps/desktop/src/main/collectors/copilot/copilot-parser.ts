/**
 * @file copilot-parser.ts
 * @description Parse GitHub Copilot session data into the normalized session
 * object consumed by the collection layer. Handles two formats:
 *
 * 1. Copilot Chat (VS Code extension): JSON files with conversation turns
 * 2. Copilot CLI (`gh copilot`): JSONL event log files
 *
 * Both produce the same normalized shape so Copilot sessions render through
 * the unchanged dashboard UI.
 *
 * Ported from `scripts/agent-monitor-copilot/copilot-parser.js` (logic
 * preserved).
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
  extractErrorMessage,
  toIso,
  safeJson,
  pushTurnDuration,
} from "../parser-utils.js";
import type {
  NormalizedSession,
  NormalizedToolUse,
  NormalizedApiError,
  NormalizedTurnDuration,
} from "../types.js";

/** True when `value` is a non-null object (and not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a property off an unknown value without throwing. */
function get(value: unknown, key: string): unknown {
  if (isRecord(value)) return value[key];
  return undefined;
}

function hasRenderableContent(value: unknown, depth = 0): boolean {
  if (value == null || depth > 4) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some((entry) => hasRenderableContent(entry, depth + 1));
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) =>
      hasRenderableContent(entry, depth + 1),
    );
  }
  return false;
}

function collectToolCalls(value: unknown, depth = 0, out: unknown[] = []): unknown[] {
  if (value == null || depth > 4) return out;
  if (Array.isArray(value)) {
    for (const entry of value) collectToolCalls(entry, depth + 1, out);
    return out;
  }
  if (typeof value !== "object") return out;

  const obj = value as Record<string, unknown>;
  for (const key of ["toolCalls", "tool_calls", "functionCalls"]) {
    const calls = obj[key];
    if (Array.isArray(calls)) {
      for (const call of calls) out.push(call);
    }
  }

  for (const key of ["message", "request", "prompt", "input", "response", "result", "reply", "output"]) {
    collectToolCalls(obj[key], depth + 1, out);
  }
  return out;
}

interface ChatEntry {
  role: "user" | "assistant";
  timestamp: unknown;
  toolCalls?: unknown[];
  thinking?: boolean;
  error?: string | null;
}

function normalizeChatRequest(request: unknown, sessionData: Record<string, unknown>): ChatEntry[] {
  if (!request || typeof request !== "object") return [];
  const req = request as Record<string, unknown>;

  const requestTimestamp =
    req.timestamp ||
    req.created_at ||
    req.createdAt ||
    req.requestDate ||
    get(req.message, "timestamp") ||
    get(req.message, "createdAt") ||
    sessionData.creationDate ||
    null;
  const responseTimestamp =
    req.responseTimestamp ||
    req.responseDate ||
    req.updatedAt ||
    get(req.response, "timestamp") ||
    get(req.result, "timestamp") ||
    sessionData.lastMessageDate ||
    requestTimestamp;
  const userPayload =
    req.message ??
    req.request ??
    req.prompt ??
    req.input;
  const assistantPayload =
    req.response ??
    req.result ??
    req.reply ??
    req.output;
  const toolCalls = collectToolCalls(req);
  const assistantError = extractErrorMessage(
    req.responseError ??
      req.error ??
      get(req.result, "error") ??
      get(req.response, "error"),
  );

  const entries: ChatEntry[] = [];
  if (
    hasRenderableContent(userPayload) ||
    req.id != null ||
    req.requestId != null
  ) {
    entries.push({
      role: "user",
      timestamp: requestTimestamp,
    });
  }

  if (
    hasRenderableContent(assistantPayload) ||
    assistantError != null ||
    toolCalls.length > 0 ||
    req.response != null ||
    req.result != null ||
    req.reply != null ||
    req.output != null
  ) {
    entries.push({
      role: "assistant",
      timestamp: responseTimestamp,
      toolCalls,
      thinking: Boolean(
        req.thinking ||
          req.reasoning ||
          get(req.response, "thinking") ||
          get(req.response, "reasoning") ||
          get(req.result, "thinking") ||
          get(req.result, "reasoning"),
      ),
      error: assistantError,
    });
  }

  return entries;
}

function normalizeChatMessages(data: Record<string, unknown>): unknown[] {
  for (const key of ["messages", "turns", "history"]) {
    const value = data[key];
    if (Array.isArray(value) && value.length > 0) return value;
  }

  const requests = Array.isArray(data.requests) ? data.requests : [];
  return requests.flatMap((request) => normalizeChatRequest(request, data));
}

interface TokenFields {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Parse a Copilot Chat JSON session file (VS Code extension).
 * Recent VS Code builds persist these as top-level metadata plus `requests[]`,
 * while older shapes may store direct `messages[]` / `turns[]` arrays.
 */
export function parseChatSessionFile(
  filePath: string,
  workspacePath: string | null,
): NormalizedSession | null {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { return null; }

  if (!data || typeof data !== "object") return null;
  const dataObj = data as Record<string, unknown>;

  const sessionId = String(
    dataObj.sessionId || dataObj.id || path.basename(filePath, ".json"),
  );

  // P1 Fix: extract token usage from raw requests BEFORE normalization,
  // since normalizeChatMessages reduces each request to {role, timestamp}
  // and drops the original usage/response payloads.
  const rawRequests = Array.isArray(dataObj.requests) ? dataObj.requests : [];
  const requestTokenFields: TokenFields = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const req of rawRequests) {
    if (!req || typeof req !== "object") continue;
    const reqObj = req as Record<string, unknown>;
    const usageInfo =
      reqObj.usage || reqObj.tokenUsage || reqObj.token_count ||
      get(reqObj.response, "usage") || get(reqObj.result, "usage") || null;
    if (usageInfo && typeof usageInfo === "object") {
      const u = usageInfo as Record<string, unknown>;
      if (u.input_tokens != null) requestTokenFields.input += Number(u.input_tokens);
      if (u.output_tokens != null) requestTokenFields.output += Number(u.output_tokens);
      if (u.prompt_tokens != null) requestTokenFields.input += Number(u.prompt_tokens);
      if (u.completion_tokens != null) requestTokenFields.output += Number(u.completion_tokens);
      if (u.cache_read_tokens != null) requestTokenFields.cacheRead += Number(u.cache_read_tokens);
      if (u.cached_input_tokens != null) requestTokenFields.cacheRead += Number(u.cached_input_tokens);
      if (u.cache_write_tokens != null) requestTokenFields.cacheWrite += Number(u.cache_write_tokens);
      if (u.cache_creation_input_tokens != null) requestTokenFields.cacheWrite += Number(u.cache_creation_input_tokens);
    }
  }

  const messages = normalizeChatMessages(dataObj);
  if (!Array.isArray(messages) || messages.length === 0) return null;

  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  const messageTimestamps: string[] = [];
  const toolUses: NormalizedToolUse[] = [];
  const turnDurations: NormalizedTurnDuration[] = [];
  const apiErrors: NormalizedApiError[] = [];
  let thinkingBlockCount = 0;
  const toolResultErrors: NormalizedSession["toolResultErrors"] = [];
  const tokenFields: TokenFields = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let pendingTurnStartedAt: string | null = null;

  const noteTs = (raw: unknown): string | null => {
    const iso = toIso(raw);
    if (!iso) return null;
    if (!firstTimestamp || iso < firstTimestamp) firstTimestamp = iso;
    if (!lastTimestamp || iso > lastTimestamp) lastTimestamp = iso;
    return iso;
  };

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const msgObj = msg as Record<string, unknown>;
    const ts = msgObj.timestamp || msgObj.created_at || msgObj.createdAt || msgObj.date || null;
    const iso = noteTs(ts);
    const role = msgObj.role || msgObj.author || msgObj.type || "";

    if (role === "user" || role === "human") {
      userMessageCount++;
      if (iso) pendingTurnStartedAt = iso;
    } else if (role === "assistant" || role === "copilot" || role === "bot") {
      assistantMessageCount++;
      if (iso) messageTimestamps.push(iso);
      pushTurnDuration(turnDurations, pendingTurnStartedAt, iso);
      pendingTurnStartedAt = null;
    }

    // Tool uses embedded in messages
    const calls =
      msgObj.toolCalls ||
      msgObj.tool_calls ||
      msgObj.functionCalls ||
      collectToolCalls(msgObj);
    if (Array.isArray(calls)) {
      for (const call of calls) {
        if (!call) continue;
        const callObj = call as Record<string, unknown>;
        toolUses.push({
          name: String(callObj.name || get(callObj.function, "name") || "copilot_tool"),
          timestamp: iso || firstTimestamp,
          input: safeJson(callObj.arguments || callObj.input || callObj.parameters),
        });
      }
    }

    // Thinking blocks
    if (msgObj.thinking || msgObj.reasoning) thinkingBlockCount++;

    const errorMessage = extractErrorMessage(msgObj.error);
    if (errorMessage) {
      apiErrors.push({
        type: "error",
        message: errorMessage,
        timestamp: iso,
      });
    }

    // Token usage embedded in messages/requests
    const usageInfo =
      msgObj.usage || msgObj.tokenUsage || msgObj.token_count ||
      get(msgObj.response, "usage") || get(msgObj.result, "usage") || null;
    if (usageInfo && typeof usageInfo === "object") {
      const u = usageInfo as Record<string, unknown>;
      if (u.input_tokens != null) tokenFields.input += Number(u.input_tokens);
      if (u.output_tokens != null) tokenFields.output += Number(u.output_tokens);
      if (u.prompt_tokens != null) tokenFields.input += Number(u.prompt_tokens);
      if (u.completion_tokens != null) tokenFields.output += Number(u.completion_tokens);
      if (u.cache_read_tokens != null) tokenFields.cacheRead += Number(u.cache_read_tokens);
      if (u.cached_input_tokens != null) tokenFields.cacheRead += Number(u.cached_input_tokens);
      if (u.cache_write_tokens != null) tokenFields.cacheWrite += Number(u.cache_write_tokens);
      if (u.cache_creation_input_tokens != null) tokenFields.cacheWrite += Number(u.cache_creation_input_tokens);
    }
  }

  // Merge request-level tokens (from raw requests before normalization)
  // with message-level tokens. Use summation since each request is unique.
  tokenFields.input += requestTokenFields.input;
  tokenFields.output += requestTokenFields.output;
  tokenFields.cacheRead += requestTokenFields.cacheRead;
  tokenFields.cacheWrite += requestTokenFields.cacheWrite;

  // Token usage from top-level session data
  const topUsage = dataObj.usage || dataObj.tokenUsage || dataObj.token_count || null;
  if (topUsage && typeof topUsage === "object") {
    const u = topUsage as Record<string, unknown>;
    if (u.input_tokens != null) tokenFields.input = Math.max(tokenFields.input, Number(u.input_tokens));
    if (u.output_tokens != null) tokenFields.output = Math.max(tokenFields.output, Number(u.output_tokens));
    if (u.prompt_tokens != null) tokenFields.input = Math.max(tokenFields.input, Number(u.prompt_tokens));
    if (u.completion_tokens != null) tokenFields.output = Math.max(tokenFields.output, Number(u.completion_tokens));
    if (u.cache_read_tokens != null) tokenFields.cacheRead = Math.max(tokenFields.cacheRead, Number(u.cache_read_tokens));
    if (u.cached_input_tokens != null) tokenFields.cacheRead = Math.max(tokenFields.cacheRead, Number(u.cached_input_tokens));
    if (u.cache_write_tokens != null) tokenFields.cacheWrite = Math.max(tokenFields.cacheWrite, Number(u.cache_write_tokens));
    // P2 Fix: also map cache_creation_input_tokens to cacheWrite (alias)
    if (u.cache_creation_input_tokens != null) tokenFields.cacheWrite = Math.max(tokenFields.cacheWrite, Number(u.cache_creation_input_tokens));
  }

  if (!firstTimestamp) {
    // Fall back to file mtime
    try {
      const stat = fs.statSync(filePath);
      firstTimestamp = stat.birthtime?.toISOString() || stat.mtime.toISOString();
      lastTimestamp = stat.mtime.toISOString();
    } catch { return null; }
  }

  const model = (dataObj.model || dataObj.modelId || null) as string | null;
  const cwd = (workspacePath || dataObj.cwd || dataObj.workspaceFolder || null) as string | null;

  let fileModifiedAt: number | null = null;
  try { fileModifiedAt = fs.statSync(filePath).mtimeMs; } catch { /* non-fatal */ }

  const projectName = cwd ? path.basename(cwd) : `Copilot Chat ${sessionId.slice(0, 8)}`;

  const tokensByModel: NormalizedSession["tokensByModel"] = {};
  if (tokenFields.input || tokenFields.output || tokenFields.cacheRead || tokenFields.cacheWrite) {
    const key = model || "copilot-default";
    tokensByModel[key] = {
      input: tokenFields.input,
      output: tokenFields.output,
      cacheRead: tokenFields.cacheRead,
      cacheWrite: tokenFields.cacheWrite,
    };
  }

  return {
    sessionId: `copilot-chat-${sessionId}`,
    name: projectName,
    cwd,
    model,
    version: null,
    slug: null,
    gitBranch: null,
    startedAt: firstTimestamp,
    endedAt: lastTimestamp,
    teams: [],
    userMessages: userMessageCount,
    assistantMessages: assistantMessageCount,
    tokensByModel,
    messageTimestamps,
    toolUses,
    compactions: [],
    apiErrors,
    fileModifiedAt,
    turnDurations,
    entrypoint: "copilot",
    permissionMode: null,
    thinkingBlockCount,
    toolResultErrors,
    usageExtras: { service_tiers: [], speeds: [], inference_geos: [] },
  };
}

/**
 * Parse a Copilot CLI events.jsonl file.
 */
export async function parseCliEventFile(
  filePath: string,
  sessionId: string,
): Promise<NormalizedSession | null> {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let cwd: string | null = null;
  let model: string | null = null;
  let version: string | null = null;
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  const messageTimestamps: string[] = [];
  const toolUses: NormalizedToolUse[] = [];
  const turnDurations: NormalizedTurnDuration[] = [];
  const apiErrors: NormalizedApiError[] = [];
  let thinkingBlockCount = 0;
  const toolResultErrors: NormalizedSession["toolResultErrors"] = [];
  let tokenInput = 0;
  let tokenOutput = 0;
  let tokenCacheRead = 0;
  let tokenCacheWrite = 0;
  let tokenReasoning = 0;
  let pendingTurnStartedAt: string | null = null;

  const noteTs = (raw: unknown): string | null => {
    const iso = toIso(raw);
    if (!iso) return null;
    if (!firstTimestamp || iso < firstTimestamp) firstTimestamp = iso;
    if (!lastTimestamp || iso > lastTimestamp) lastTimestamp = iso;
    return iso;
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec: unknown;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;

    const ts = recObj.timestamp || recObj.ts || recObj.created_at || null;
    const iso = noteTs(ts);
    const type = recObj.type || recObj.event || "";
    const payload = (recObj.payload || recObj.data || recObj) as Record<string, unknown>;

    // Session metadata
    if (type === "session_start" || type === "session_created" || type === "init") {
      if (!cwd) cwd = (payload.cwd || payload.workdir || null) as string | null;
      if (!version) version = (payload.version || payload.cli_version || null) as string | null;
      if (!model) model = (payload.model || null) as string | null;
    }

    // Messages
    if (type === "user_message" || type === "user_input" || type === "prompt") {
      userMessageCount++;
      if (iso) pendingTurnStartedAt = iso;
    }
    if (type === "assistant_message" || type === "response" || type === "completion") {
      assistantMessageCount++;
      if (iso) messageTimestamps.push(iso);
      pushTurnDuration(turnDurations, pendingTurnStartedAt, iso);
      pendingTurnStartedAt = null;
    }

    // Tool calls
    if (type === "tool_call" || type === "function_call" || type === "command") {
      toolUses.push({
        name: String(payload.name || payload.tool || payload.command || "copilot_tool"),
        timestamp: iso || firstTimestamp,
        input: safeJson(payload.arguments || payload.input),
      });
    }

    // Token usage
    if (type === "usage" || type === "token_count" || type === "metrics") {
      const info = (payload.usage || payload) as Record<string, unknown>;
      if (info.input_tokens != null) tokenInput = Number(info.input_tokens);
      if (info.output_tokens != null) tokenOutput = Number(info.output_tokens);
      if (info.prompt_tokens != null) tokenInput = Number(info.prompt_tokens);
      if (info.completion_tokens != null) tokenOutput = Number(info.completion_tokens);
      if (info.cache_read_tokens != null) tokenCacheRead = Number(info.cache_read_tokens);
      if (info.cached_input_tokens != null) tokenCacheRead = Number(info.cached_input_tokens);
      if (info.cache_write_tokens != null) tokenCacheWrite = Number(info.cache_write_tokens);
      if (info.cache_creation_input_tokens != null) tokenCacheWrite = Number(info.cache_creation_input_tokens);
      if (info.reasoning_tokens != null) tokenReasoning = Number(info.reasoning_tokens);
      if (info.reasoning_output_tokens != null) tokenReasoning = Number(info.reasoning_output_tokens);
      if (payload.model) model = payload.model as string;
    }

    // Errors
    if (type === "error" || type === "api_error") {
      apiErrors.push({
        type: String(type),
        message: String(payload.message || payload.error || "Copilot CLI error"),
        timestamp: iso,
      });
    }

    // Thinking
    if (type === "reasoning" || type === "thinking") {
      thinkingBlockCount++;
    }
  }

  if (!firstTimestamp) return null;

  const tokensByModel: NormalizedSession["tokensByModel"] = {};
  if (tokenInput || tokenOutput || tokenCacheRead || tokenCacheWrite || tokenReasoning) {
    const key = model || "copilot-default";
    tokensByModel[key] = {
      input: tokenInput,
      output: tokenOutput + tokenReasoning,
      cacheRead: tokenCacheRead,
      cacheWrite: tokenCacheWrite,
    };
  }

  let fileModifiedAt: number | null = null;
  try { fileModifiedAt = fs.statSync(filePath).mtimeMs; } catch { /* non-fatal */ }

  const projectName = cwd ? path.basename(cwd) : `Copilot CLI ${sessionId.slice(0, 8)}`;

  return {
    sessionId: `copilot-cli-${sessionId}`,
    name: projectName,
    cwd,
    model,
    version,
    slug: null,
    gitBranch: null,
    startedAt: firstTimestamp,
    endedAt: lastTimestamp,
    teams: [],
    userMessages: userMessageCount,
    assistantMessages: assistantMessageCount,
    tokensByModel,
    messageTimestamps,
    toolUses,
    compactions: [],
    apiErrors,
    fileModifiedAt,
    turnDurations,
    entrypoint: "copilot",
    permissionMode: null,
    thinkingBlockCount,
    toolResultErrors,
    usageExtras: { service_tiers: [], speeds: [], inference_geos: [] },
  };
}
