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
  truncateText,
  collectArtifacts,
} from "../parser-utils.js";
import type {
  NormalizedSession,
  NormalizedToolUse,
  NormalizedApiError,
  NormalizedTurnDuration,
  NormalizedMessage,
  NormalizedTokenRecord,
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
  /** CR-1: User prompt or assistant response text. */
  text?: string | null;
  thinking?: boolean;
  error?: string | null;
  /** CR-5: Per-request model identifier. */
  model?: string | null;
  /** CR-2: Raw usage object for building tokenSeries. */
  usage?: Record<string, unknown> | null;
  /** CR-3: Tool result content keyed by tool call index/name. */
  toolResults?: Array<{ name: string; content: unknown; isError?: boolean }>;
}

/** CR-1: Best-effort extraction of displayable text from a Copilot message payload. */
function extractText(payload: unknown): string | null {
  if (payload == null) return null;
  if (typeof payload === "string") return payload;
  if (typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  // Direct text/content fields
  for (const key of ["text", "content", "body", "value", "message"]) {
    const v = obj[key];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  // Array of content parts (OpenAI-style)
  if (Array.isArray(obj.content)) {
    const parts = obj.content
      .map((p: unknown) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object") {
          const po = p as Record<string, unknown>;
          if (typeof po.text === "string") return po.text;
          if (typeof po.content === "string") return po.content;
        }
        return null;
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join("\n");
  }
  return null;
}

/** CR-3: Collect tool result entries from a request's response flow. */
function collectToolResults(
  req: Record<string, unknown>,
): Array<{ name: string; content: unknown; isError?: boolean }> {
  const results: Array<{ name: string; content: unknown; isError?: boolean }> = [];
  // Look in response.toolResults, result.toolResults, etc.
  for (const outer of ["response", "result", "reply", "output"]) {
    const container = req[outer];
    if (!container || typeof container !== "object") continue;
    const containerObj = container as Record<string, unknown>;
    for (const key of ["toolResults", "tool_results", "functionResults"]) {
      const arr = containerObj[key];
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) {
        if (!entry || typeof entry !== "object") continue;
        const e = entry as Record<string, unknown>;
        results.push({
          name: String(e.name || e.toolName || e.tool || "copilot_tool"),
          content: e.content ?? e.result ?? e.output ?? null,
          isError: Boolean(e.isError || e.is_error || e.error),
        });
      }
    }
  }
  return results;
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

  // CR-1: Extract user and assistant text
  const userText = extractText(userPayload);
  const assistantText = extractText(assistantPayload);

  // CR-5: Per-request model
  const reqModel = (req.model || req.modelId ||
    get(req.response, "model") || get(req.result, "model") || null) as string | null;

  // CR-2: Per-request usage for tokenSeries
  const usageInfo =
    req.usage || req.tokenUsage || req.token_count ||
    get(req.response, "usage") || get(req.result, "usage") || null;
  const usageObj = (usageInfo && typeof usageInfo === "object") ? usageInfo as Record<string, unknown> : null;

  // CR-3: Tool results from the response flow
  const toolResults = collectToolResults(req);

  const entries: ChatEntry[] = [];
  if (
    hasRenderableContent(userPayload) ||
    req.id != null ||
    req.requestId != null
  ) {
    entries.push({
      role: "user",
      timestamp: requestTimestamp,
      text: truncateText(userText),
      model: reqModel,
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
    const isThinking = Boolean(
      req.thinking ||
        req.reasoning ||
        get(req.response, "thinking") ||
        get(req.response, "reasoning") ||
        get(req.result, "thinking") ||
        get(req.result, "reasoning"),
    );
    entries.push({
      role: "assistant",
      timestamp: responseTimestamp,
      toolCalls,
      text: isThinking ? null : truncateText(assistantText),
      thinking: isThinking,
      error: assistantError,
      model: reqModel,
      usage: usageObj,
      toolResults,
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
  // CR-1: Ordered messages with text content
  const normalizedMessages: NormalizedMessage[] = [];
  // CR-2: Per-turn token records for time-series
  const tokenSeries: NormalizedTokenRecord[] = [];
  // Session-level model — extracted early so tokenSeries fallback can reference it
  const model = (dataObj.model || dataObj.modelId || null) as string | null;

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

    // CR-5: Per-message model
    const msgModel = (msgObj.model as string | null) || null;

    if (role === "user" || role === "human") {
      userMessageCount++;
      if (iso) pendingTurnStartedAt = iso;
      // CR-1: User message
      normalizedMessages.push({
        role: "human",
        timestamp: iso,
        text: truncateText(msgObj.text as string | null ?? extractText(msgObj)),
        model: msgModel,
      });
    } else if (role === "assistant" || role === "copilot" || role === "bot") {
      assistantMessageCount++;
      if (iso) messageTimestamps.push(iso);
      pushTurnDuration(turnDurations, pendingTurnStartedAt, iso);
      pendingTurnStartedAt = null;

      const isThinking = Boolean(msgObj.thinking || msgObj.reasoning);

      // CR-1: Assistant message (thinking indicator uses null text)
      if (isThinking) {
        normalizedMessages.push({
          role: "assistant",
          timestamp: iso,
          text: null,
          model: msgModel,
          isThinking: true,
        });
      } else {
        normalizedMessages.push({
          role: "assistant",
          timestamp: iso,
          text: truncateText(msgObj.text as string | null ?? extractText(msgObj)),
          model: msgModel,
        });
      }

      // CR-2: Build tokenSeries from per-message usage
      const msgUsage = msgObj.usage as Record<string, unknown> | null | undefined;
      if (msgUsage && typeof msgUsage === "object" && iso) {
        const inp = Number(msgUsage.input_tokens ?? msgUsage.prompt_tokens ?? 0);
        const out = Number(msgUsage.output_tokens ?? msgUsage.completion_tokens ?? 0);
        const cr = Number(msgUsage.cache_read_tokens ?? msgUsage.cached_input_tokens ?? 0);
        const cw = Number(msgUsage.cache_write_tokens ?? msgUsage.cache_creation_input_tokens ?? 0);
        if (inp || out || cr || cw) {
          tokenSeries.push({
            timestamp: iso,
            model: msgModel || model || "copilot-default",
            input: inp,
            output: out,
            cacheRead: cr,
            cacheWrite: cw,
          });
        }
      }
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
        // CR-3: Capture tool result content from call-level result
        const rawOutput = callObj.result ?? callObj.output ?? callObj.response ?? null;
        const outputText = typeof rawOutput === "string" ? truncateText(rawOutput) : rawOutput;
        const callIsError = Boolean(callObj.isError || callObj.is_error);
        toolUses.push({
          name: String(callObj.name || get(callObj.function, "name") || "copilot_tool"),
          timestamp: iso || firstTimestamp,
          input: safeJson(callObj.arguments || callObj.input || callObj.parameters),
          ...(outputText != null ? { output: outputText } : {}),
          ...(callIsError ? { isError: true } : {}),
        });
      }
    }

    // CR-3: Tool results from the ChatEntry enrichment path
    const toolResults = msgObj.toolResults;
    if (Array.isArray(toolResults)) {
      for (const tr of toolResults) {
        if (!tr || typeof tr !== "object") continue;
        const trObj = tr as Record<string, unknown>;
        const rawContent = trObj.content ?? trObj.result ?? trObj.output ?? null;
        const contentText = typeof rawContent === "string" ? truncateText(rawContent) : rawContent;
        // Try to match to the last tool use with the same name
        const trName = String(trObj.name || "copilot_tool");
        const matchIdx = toolUses.findLastIndex((tu) => tu.name === trName && tu.output == null);
        if (matchIdx >= 0) {
          if (contentText != null) toolUses[matchIdx].output = contentText;
          if (trObj.isError || trObj.is_error) toolUses[matchIdx].isError = true;
        }
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

  // CR-2: Also build tokenSeries from raw requests (for requests that go through
  // the normalizeChatRequest path which enriches ChatEntry with usage).
  // The normalizeChatMessages path already feeds into the message loop above,
  // but raw requests have richer usage data. Build additional series entries
  // from raw requests that weren't already captured.
  for (const req of rawRequests) {
    if (!req || typeof req !== "object") continue;
    const reqObj = req as Record<string, unknown>;
    const usageInfo =
      reqObj.usage || reqObj.tokenUsage || reqObj.token_count ||
      get(reqObj.response, "usage") || get(reqObj.result, "usage") || null;
    if (!usageInfo || typeof usageInfo !== "object") continue;
    const u = usageInfo as Record<string, unknown>;
    const reqTs = toIso(
      reqObj.responseTimestamp || reqObj.responseDate || reqObj.updatedAt ||
      get(reqObj.response, "timestamp") || get(reqObj.result, "timestamp") ||
      reqObj.timestamp || reqObj.created_at || reqObj.createdAt ||
      dataObj.lastMessageDate || null,
    );
    if (!reqTs) continue;
    // Skip if we already have a tokenSeries entry at this exact timestamp
    if (tokenSeries.some((ts) => ts.timestamp === reqTs)) continue;
    const reqModel = (reqObj.model || reqObj.modelId ||
      get(reqObj.response, "model") || get(reqObj.result, "model") || null) as string | null;
    const inp = Number(u.input_tokens ?? u.prompt_tokens ?? 0);
    const out = Number(u.output_tokens ?? u.completion_tokens ?? 0);
    const cr = Number(u.cache_read_tokens ?? u.cached_input_tokens ?? 0);
    const cw = Number(u.cache_write_tokens ?? u.cache_creation_input_tokens ?? 0);
    if (inp || out || cr || cw) {
      tokenSeries.push({
        timestamp: reqTs,
        model: reqModel || model || "copilot-default",
        input: inp,
        output: out,
        cacheRead: cr,
        cacheWrite: cw,
      });
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
    // CR-1: Ordered messages with text content
    messages: normalizedMessages,
    // CR-2: Per-turn token records
    tokenSeries,
    // CR-4: Diff stats absent at source for Copilot
    diffStats: null,
    // CR-7: Slash commands not applicable to Copilot
    slashCommands: [],
    // CR-13: Artifact references extracted from tool calls
    artifacts: collectArtifacts(toolUses, cwd),
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
  // CR-1: Ordered messages with text content
  const normalizedMessages: NormalizedMessage[] = [];
  // CR-2: Per-turn token records for time-series
  const tokenSeries: NormalizedTokenRecord[] = [];

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

    // CR-5: Per-event model
    const eventModel = (payload.model || recObj.model || null) as string | null;

    // Messages
    if (type === "user_message" || type === "user_input" || type === "prompt") {
      userMessageCount++;
      if (iso) pendingTurnStartedAt = iso;
      // CR-1: User message with text content
      const userText = extractText(payload.content ?? payload.message ?? payload.text ?? payload.prompt ?? payload);
      normalizedMessages.push({
        role: "human",
        timestamp: iso,
        text: truncateText(userText),
        model: eventModel,
      });
    }
    if (type === "assistant_message" || type === "response" || type === "completion") {
      assistantMessageCount++;
      if (iso) messageTimestamps.push(iso);
      pushTurnDuration(turnDurations, pendingTurnStartedAt, iso);
      pendingTurnStartedAt = null;
      // CR-1: Assistant message with text content
      const assistantText = extractText(payload.content ?? payload.message ?? payload.text ?? payload.response ?? payload);
      normalizedMessages.push({
        role: "assistant",
        timestamp: iso,
        text: truncateText(assistantText),
        model: eventModel,
      });
    }

    // Tool calls
    if (type === "tool_call" || type === "function_call" || type === "command") {
      toolUses.push({
        name: String(payload.name || payload.tool || payload.command || "copilot_tool"),
        timestamp: iso || firstTimestamp,
        input: safeJson(payload.arguments || payload.input),
      });
    }

    // CR-3: Tool results — match back to the most recent unresolved tool use
    if (type === "tool_result" || type === "function_result" || type === "command_result") {
      const resultName = String(payload.name || payload.tool || "copilot_tool");
      const rawContent = payload.content ?? payload.result ?? payload.output ?? null;
      const contentText = typeof rawContent === "string" ? truncateText(rawContent) : rawContent;
      const resultIsError = Boolean(payload.isError || payload.is_error || payload.error);
      const matchIdx = toolUses.findLastIndex((tu) => tu.name === resultName && tu.output == null);
      if (matchIdx >= 0) {
        if (contentText != null) toolUses[matchIdx].output = contentText;
        if (resultIsError) toolUses[matchIdx].isError = true;
      }
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

      // CR-2: Push per-event token record for time-series
      if (iso) {
        const usageModel = (eventModel || model || "copilot-default");
        const inp = Number(info.input_tokens ?? info.prompt_tokens ?? 0);
        const out = Number(info.output_tokens ?? info.completion_tokens ?? 0);
        const cr = Number(info.cache_read_tokens ?? info.cached_input_tokens ?? 0);
        const cw = Number(info.cache_write_tokens ?? info.cache_creation_input_tokens ?? 0);
        if (inp || out || cr || cw) {
          tokenSeries.push({
            timestamp: iso,
            model: usageModel,
            input: inp,
            output: out,
            cacheRead: cr,
            cacheWrite: cw,
          });
        }
      }
    }

    // Errors
    if (type === "error" || type === "api_error") {
      apiErrors.push({
        type: String(type),
        message: String(payload.message || payload.error || "Copilot CLI error"),
        timestamp: iso,
      });
    }

    // Thinking — Copilot provides boolean-only thinking flag
    if (type === "reasoning" || type === "thinking") {
      thinkingBlockCount++;
      // CR-1: Thinking indicator as message with null text
      normalizedMessages.push({
        role: "assistant",
        timestamp: iso,
        text: null,
        model: eventModel,
        isThinking: true,
      });
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
    // CR-1: Ordered messages with text content
    messages: normalizedMessages,
    // CR-2: Per-turn token records
    tokenSeries,
    // CR-4: Diff stats absent at source for Copilot
    diffStats: null,
    // CR-7: Slash commands not applicable to Copilot
    slashCommands: [],
    // CR-13: Artifact references extracted from tool calls
    artifacts: collectArtifacts(toolUses, cwd),
  };
}
