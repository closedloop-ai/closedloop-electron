/**
 * @file copilot-parser.js
 * @description Parse GitHub Copilot session data into the normalized session
 * object consumed by importSession(). Handles two formats:
 *
 * 1. Copilot Chat (VS Code extension): JSON files with conversation turns
 * 2. Copilot CLI (`gh copilot`): JSONL event log files
 *
 * Both produce the same normalized shape so Copilot sessions render through
 * the unchanged dashboard UI.
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const {
  extractErrorMessage,
  toIso,
  safeJson,
} = require("../agent-monitor-shared/parser-utils");

function hasRenderableContent(value, depth = 0) {
  if (value == null || depth > 4) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some((entry) => hasRenderableContent(entry, depth + 1));
  if (typeof value === "object") {
    return Object.values(value).some((entry) => hasRenderableContent(entry, depth + 1));
  }
  return false;
}

function collectToolCalls(value, depth = 0, out = []) {
  if (value == null || depth > 4) return out;
  if (Array.isArray(value)) {
    for (const entry of value) collectToolCalls(entry, depth + 1, out);
    return out;
  }
  if (typeof value !== "object") return out;

  for (const key of ["toolCalls", "tool_calls", "functionCalls"]) {
    const calls = value[key];
    if (Array.isArray(calls)) {
      for (const call of calls) out.push(call);
    }
  }

  for (const key of ["message", "request", "prompt", "input", "response", "result", "reply", "output"]) {
    collectToolCalls(value[key], depth + 1, out);
  }
  return out;
}

function normalizeChatRequest(request, sessionData) {
  if (!request || typeof request !== "object") return [];

  const requestTimestamp =
    request.timestamp ||
    request.created_at ||
    request.createdAt ||
    request.requestDate ||
    request.message?.timestamp ||
    request.message?.createdAt ||
    sessionData.creationDate ||
    null;
  const responseTimestamp =
    request.responseTimestamp ||
    request.responseDate ||
    request.updatedAt ||
    request.response?.timestamp ||
    request.result?.timestamp ||
    sessionData.lastMessageDate ||
    requestTimestamp;
  const userPayload =
    request.message ??
    request.request ??
    request.prompt ??
    request.input;
  const assistantPayload =
    request.response ??
    request.result ??
    request.reply ??
    request.output;
  const toolCalls = collectToolCalls(request);
  const assistantError = extractErrorMessage(
    request.responseError ??
      request.error ??
      request.result?.error ??
      request.response?.error,
  );

  const entries = [];
  if (
    hasRenderableContent(userPayload) ||
    request.id != null ||
    request.requestId != null
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
    request.response != null ||
    request.result != null ||
    request.reply != null ||
    request.output != null
  ) {
    entries.push({
      role: "assistant",
      timestamp: responseTimestamp,
      toolCalls,
      thinking: Boolean(
        request.thinking ||
          request.reasoning ||
          request.response?.thinking ||
          request.response?.reasoning ||
          request.result?.thinking ||
          request.result?.reasoning,
      ),
      error: assistantError,
    });
  }

  return entries;
}

function normalizeChatMessages(data) {
  for (const key of ["messages", "turns", "history"]) {
    const value = data[key];
    if (Array.isArray(value) && value.length > 0) return value;
  }

  const requests = Array.isArray(data.requests) ? data.requests : [];
  return requests.flatMap((request) => normalizeChatRequest(request, data));
}

/**
 * Parse a Copilot Chat JSON session file (VS Code extension).
 * Recent VS Code builds persist these as top-level metadata plus `requests[]`,
 * while older shapes may store direct `messages[]` / `turns[]` arrays.
 */
function parseChatSessionFile(filePath, workspacePath) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { return null; }

  if (!data || typeof data !== "object") return null;

  const sessionId = data.sessionId || data.id || path.basename(filePath, ".json");
  const messages = normalizeChatMessages(data);
  if (!Array.isArray(messages) || messages.length === 0) return null;

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

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const ts = msg.timestamp || msg.created_at || msg.createdAt || msg.date || null;
    const iso = noteTs(ts);
    const role = msg.role || msg.author || msg.type || "";

    if (role === "user" || role === "human") {
      userMessageCount++;
    } else if (role === "assistant" || role === "copilot" || role === "bot") {
      assistantMessageCount++;
      if (iso) messageTimestamps.push(iso);
    }

    // Tool uses embedded in messages
    const calls =
      msg.toolCalls ||
      msg.tool_calls ||
      msg.functionCalls ||
      collectToolCalls(msg);
    if (Array.isArray(calls)) {
      for (const call of calls) {
        if (!call) continue;
        toolUses.push({
          name: call.name || call.function?.name || "copilot_tool",
          timestamp: iso || firstTimestamp,
          input: safeJson(call.arguments || call.input || call.parameters),
        });
      }
    }

    // Thinking blocks
    if (msg.thinking || msg.reasoning) thinkingBlockCount++;

    const errorMessage = extractErrorMessage(msg.error);
    if (errorMessage) {
      apiErrors.push({
        type: "error",
        message: errorMessage,
        timestamp: iso,
      });
    }
  }

  if (!firstTimestamp) {
    // Fall back to file mtime
    try {
      const stat = fs.statSync(filePath);
      firstTimestamp = stat.birthtime?.toISOString() || stat.mtime.toISOString();
      lastTimestamp = stat.mtime.toISOString();
    } catch { return null; }
  }

  const model = data.model || data.modelId || null;
  const cwd = workspacePath || data.cwd || data.workspaceFolder || null;

  let fileModifiedAt = null;
  try { fileModifiedAt = fs.statSync(filePath).mtimeMs; } catch { /* non-fatal */ }

  const projectName = cwd ? path.basename(cwd) : `Copilot Chat ${sessionId.slice(0, 8)}`;

  return {
    sessionId: `copilot-chat-${sessionId}`,
    name: `${projectName} (copilot)`,
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
    tokensByModel: {},
    messageTimestamps,
    toolUses,
    compactions: [],
    apiErrors,
    fileModifiedAt,
    turnDurations: [],
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
async function parseCliEventFile(filePath, sessionId) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let cwd = null;
  let model = null;
  let version = null;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  const messageTimestamps = [];
  const toolUses = [];
  const apiErrors = [];
  let thinkingBlockCount = 0;
  const toolResultErrors = [];
  let tokenInput = 0;
  let tokenOutput = 0;

  const noteTs = (raw) => {
    const iso = toIso(raw);
    if (!iso) return null;
    if (!firstTimestamp || iso < firstTimestamp) firstTimestamp = iso;
    if (!lastTimestamp || iso > lastTimestamp) lastTimestamp = iso;
    return iso;
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec || typeof rec !== "object") continue;

    const ts = rec.timestamp || rec.ts || rec.created_at || null;
    const iso = noteTs(ts);
    const type = rec.type || rec.event || "";
    const payload = rec.payload || rec.data || rec;

    // Session metadata
    if (type === "session_start" || type === "session_created" || type === "init") {
      if (!cwd) cwd = payload.cwd || payload.workdir || null;
      if (!version) version = payload.version || payload.cli_version || null;
      if (!model) model = payload.model || null;
    }

    // Messages
    if (type === "user_message" || type === "user_input" || type === "prompt") {
      userMessageCount++;
    }
    if (type === "assistant_message" || type === "response" || type === "completion") {
      assistantMessageCount++;
      if (iso) messageTimestamps.push(iso);
    }

    // Tool calls
    if (type === "tool_call" || type === "function_call" || type === "command") {
      toolUses.push({
        name: payload.name || payload.tool || payload.command || "copilot_tool",
        timestamp: iso || firstTimestamp,
        input: safeJson(payload.arguments || payload.input),
      });
    }

    // Token usage
    if (type === "usage" || type === "token_count" || type === "metrics") {
      const info = payload.usage || payload;
      if (info.input_tokens != null) tokenInput = info.input_tokens;
      if (info.output_tokens != null) tokenOutput = info.output_tokens;
      if (info.prompt_tokens != null) tokenInput = info.prompt_tokens;
      if (info.completion_tokens != null) tokenOutput = info.completion_tokens;
      if (payload.model) model = payload.model;
    }

    // Errors
    if (type === "error" || type === "api_error") {
      apiErrors.push({
        type,
        message: payload.message || payload.error || "Copilot CLI error",
        timestamp: iso,
      });
    }

    // Thinking
    if (type === "reasoning" || type === "thinking") {
      thinkingBlockCount++;
    }
  }

  if (!firstTimestamp) return null;

  const tokensByModel = {};
  if (tokenInput || tokenOutput) {
    const key = model || "copilot-default";
    tokensByModel[key] = {
      input: tokenInput,
      output: tokenOutput,
      cacheRead: 0,
      cacheWrite: 0,
    };
  }

  let fileModifiedAt = null;
  try { fileModifiedAt = fs.statSync(filePath).mtimeMs; } catch { /* non-fatal */ }

  const projectName = cwd ? path.basename(cwd) : `Copilot CLI ${sessionId.slice(0, 8)}`;

  return {
    sessionId: `copilot-cli-${sessionId}`,
    name: `${projectName} (copilot)`,
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
    turnDurations: [],
    entrypoint: "copilot",
    permissionMode: null,
    thinkingBlockCount,
    toolResultErrors,
    usageExtras: { service_tiers: [], speeds: [], inference_geos: [] },
  };
}

module.exports = { parseChatSessionFile, parseCliEventFile };
