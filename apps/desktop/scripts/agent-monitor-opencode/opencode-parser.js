/**
 * @file opencode-parser.js
 * @description Parse OpenCode session data into the normalized session object
 * consumed by importSession(). OpenCode stores each message turn as an
 * individual JSON file (message_1.json, message_2.json, etc.) in a
 * per-session subdirectory under ~/.local/share/opencode/storage/.
 *
 * Each message JSON typically contains: role, content, model, timestamp,
 * token usage, and optional tool call information.
 */
const fs = require("fs");
const path = require("path");
const { collectMessageFiles } = require("./opencode-home");

function toIso(ts) {
  if (ts == null) return null;
  if (typeof ts === "number") {
    const ms = ts < 1e12 ? ts * 1000 : ts;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof ts === "string") {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : d.toISOString();
  }
  return null;
}

function safeJson(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

/**
 * Parse a single OpenCode session directory into the normalized session object.
 * Returns null when the directory has no usable messages.
 */
function parseSessionDir(sessionDir, sessionId) {
  const messageFiles = collectMessageFiles(sessionDir);
  if (messageFiles.length === 0) return null;

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

  for (const filePath of messageFiles) {
    let msg;
    try {
      msg = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch { continue; }
    if (!msg || typeof msg !== "object") continue;

    const ts = msg.timestamp || msg.created_at || msg.date || null;
    const iso = noteTs(ts);
    const role = msg.role || msg.type || "";

    // Extract metadata from any message
    if (!cwd && (msg.cwd || msg.workdir || msg.project_dir)) {
      cwd = msg.cwd || msg.workdir || msg.project_dir;
    }
    if (!version && (msg.version || msg.opencode_version)) {
      version = msg.version || msg.opencode_version;
    }
    if (msg.model) model = msg.model;

    // Count messages
    if (role === "user" || role === "human") {
      userMessageCount++;
    } else if (role === "assistant" || role === "ai" || role === "model") {
      assistantMessageCount++;
      if (iso) messageTimestamps.push(iso);
    } else if (role === "system" && msg.content) {
      // System messages may contain project metadata
      if (!cwd && typeof msg.content === "string") {
        const cwdMatch = msg.content.match(/(?:cwd|directory|project):\s*(.+)/i);
        if (cwdMatch) cwd = cwdMatch[1].trim();
      }
    }

    // Thinking/reasoning
    if (msg.thinking || msg.reasoning) thinkingBlockCount++;

    // Tool calls
    const calls = msg.tool_calls || msg.toolCalls || msg.function_calls || [];
    if (Array.isArray(calls)) {
      for (const call of calls) {
        if (!call) continue;
        toolUses.push({
          name: call.name || call.function?.name || call.type || "opencode_tool",
          timestamp: iso || firstTimestamp,
          input: safeJson(call.arguments || call.input || call.parameters),
        });
      }
    }

    // Single tool call (some formats embed directly)
    if (msg.tool_call || msg.function_call) {
      const call = msg.tool_call || msg.function_call;
      toolUses.push({
        name: call.name || "opencode_tool",
        timestamp: iso || firstTimestamp,
        input: safeJson(call.arguments || call.input),
      });
    }

    // Tool results with errors
    if (msg.tool_result || msg.function_result) {
      const result = msg.tool_result || msg.function_result;
      const isErr = result.is_error === true || result.success === false || !!result.error;
      if (isErr) {
        const content = typeof result.output === "string"
          ? result.output.slice(0, 500)
          : JSON.stringify(result.error || result).slice(0, 500);
        toolResultErrors.push({ content, timestamp: iso });
      }
    }

    // Token usage
    const usage = msg.usage || msg.token_usage || msg.tokens || null;
    if (usage && typeof usage === "object") {
      if (usage.input_tokens != null) tokenInput += usage.input_tokens;
      else if (usage.prompt_tokens != null) tokenInput += usage.prompt_tokens;
      if (usage.output_tokens != null) tokenOutput += usage.output_tokens;
      else if (usage.completion_tokens != null) tokenOutput += usage.completion_tokens;
    }

    // Errors
    if (msg.error || (role === "error")) {
      apiErrors.push({
        type: "error",
        message: typeof msg.error === "string" ? msg.error :
          (msg.error?.message || msg.content || "OpenCode error"),
        timestamp: iso,
      });
    }
  }

  if (!firstTimestamp) {
    // Fall back to directory mtime
    try {
      const stat = fs.statSync(sessionDir);
      firstTimestamp = stat.birthtime?.toISOString() || stat.mtime.toISOString();
      lastTimestamp = stat.mtime.toISOString();
    } catch { return null; }
  }

  const tokensByModel = {};
  if (tokenInput || tokenOutput) {
    const key = model || "opencode-default";
    tokensByModel[key] = {
      input: tokenInput,
      output: tokenOutput,
      cacheRead: 0,
      cacheWrite: 0,
    };
  }

  let fileModifiedAt = null;
  try { fileModifiedAt = fs.statSync(sessionDir).mtimeMs; } catch { /* non-fatal */ }

  const projectName = cwd ? path.basename(cwd) : `OpenCode Session ${sessionId.slice(0, 8)}`;

  return {
    sessionId: `opencode-${sessionId}`,
    name: `${projectName} (opencode)`,
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
    entrypoint: "opencode",
    permissionMode: null,
    thinkingBlockCount,
    toolResultErrors,
    usageExtras: { service_tiers: [], speeds: [], inference_geos: [] },
  };
}

module.exports = { parseSessionDir, toIso };
