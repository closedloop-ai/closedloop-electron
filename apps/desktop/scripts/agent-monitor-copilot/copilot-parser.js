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
const { toIso, safeJson } = require("../agent-monitor-shared/parser-utils");

/**
 * Parse a Copilot Chat JSON session file (VS Code extension).
 * These files contain conversation history with user/assistant message arrays.
 */
function parseChatSessionFile(filePath, workspacePath) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { return null; }

  if (!data || typeof data !== "object") return null;

  const sessionId = data.sessionId || data.id || path.basename(filePath, ".json");
  const messages = data.messages || data.turns || data.history || [];
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
    const ts = msg.timestamp || msg.created_at || msg.date || null;
    const iso = noteTs(ts);
    const role = msg.role || msg.author || msg.type || "";

    if (role === "user" || role === "human") {
      userMessageCount++;
    } else if (role === "assistant" || role === "copilot" || role === "bot") {
      assistantMessageCount++;
      if (iso) messageTimestamps.push(iso);
    }

    // Tool uses embedded in messages
    const calls = msg.toolCalls || msg.tool_calls || msg.functionCalls || [];
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

module.exports = { parseChatSessionFile, parseCliEventFile, toIso };
