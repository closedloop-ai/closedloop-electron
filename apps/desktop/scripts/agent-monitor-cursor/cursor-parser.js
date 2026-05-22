/**
 * @file cursor-parser.js
 * @description Parse a Cursor agent transcript JSONL file into the normalized
 * session object consumed by importSession(). Cursor's background agent
 * transcripts use a format similar to Codex rollouts — each line is a JSON
 * record with a type, payload, and timestamp. The parser is intentionally
 * tolerant of format drift across Cursor versions.
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { sessionIdFromTranscriptPath } = require("./cursor-home");
const { pushTurnDuration, toIso, safeJson } = require("../agent-monitor-shared/parser-utils");

/**
 * Parse a single Cursor agent transcript JSONL file.
 * Returns null when the file carries no usable timestamp.
 */
async function parseTranscriptFile(filePath) {
  const sessionId = sessionIdFromTranscriptPath(filePath);

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let cwd = null;
  let model = null;
  let version = null;
  let gitBranch = null;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  const messageTimestamps = [];
  const toolUses = [];
  const turnDurations = [];
  const apiErrors = [];
  let thinkingBlockCount = 0;
  const toolResultErrors = [];
  let tokenInput = 0;
  let tokenOutput = 0;
  let tokenCacheRead = 0;
  let pendingTurnStartedAt = null;

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
    const type = rec.type || "";
    const payload = rec.payload || rec.data || rec;

    // Session metadata
    if (type === "session_meta" || type === "session.created" || type === "session_start" ||
        (!type && (payload.cwd || payload.workdir || payload.workspace))) {
      if (!cwd) cwd = payload.cwd || payload.workdir || payload.workspace || null;
      if (!version) version = payload.version || payload.cli_version || payload.cursor_version || null;
      if (!model) model = payload.model || null;
      if (!gitBranch) {
        if (typeof payload.git === "object" && payload.git) {
          gitBranch = payload.git.branch || payload.git.ref || null;
        } else if (payload.git_branch) {
          gitBranch = payload.git_branch;
        }
      }
    }

    // Model override (turn-level is authoritative)
    if (type === "turn_context" || type === "turn.context" || type === "model_context") {
      if (payload.model) model = payload.model;
      if (!cwd && payload.cwd) cwd = payload.cwd;
    }

    // User messages
    if (type === "user_message" || type === "human_message" ||
        (type === "message" && (payload.role === "user" || payload.author === "user"))) {
      userMessageCount++;
      if (iso) pendingTurnStartedAt = iso;
    }

    // Assistant messages
    if (type === "assistant_message" || type === "agent_message" ||
        (type === "message" && (payload.role === "assistant" || payload.author === "assistant"))) {
      assistantMessageCount++;
      if (iso) messageTimestamps.push(iso);
      pushTurnDuration(turnDurations, pendingTurnStartedAt, iso);
      pendingTurnStartedAt = null;
    }

    // Thinking/reasoning
    if (type === "reasoning" || type === "thinking" || type === "agent_reasoning") {
      thinkingBlockCount++;
    }

    // Tool calls
    if (type === "tool_call" || type === "function_call" || type === "tool_use" ||
        type === "command_execution" || type === "terminal_command") {
      toolUses.push({
        name: payload.name || payload.tool_name || payload.command_name || "tool",
        timestamp: iso || firstTimestamp,
        input: safeJson(payload.arguments != null ? payload.arguments : payload.input),
      });
    }

    // File edits (Cursor-specific)
    if (type === "file_edit" || type === "apply_edit" || type === "code_edit") {
      toolUses.push({
        name: "file_edit",
        timestamp: iso || firstTimestamp,
        input: payload.file || payload.path || null,
      });
    }

    // Tool results with errors
    if (type === "tool_result" || type === "tool_output" || type === "command_output") {
      const isErr = payload.is_error === true || payload.success === false ||
        payload.exit_code > 0 || !!payload.error;
      if (isErr) {
        const content = typeof payload.output === "string"
          ? payload.output.slice(0, 500)
          : JSON.stringify(payload.error || payload.output || payload).slice(0, 500);
        toolResultErrors.push({ content, timestamp: iso });
      }
    }

    // Token usage
    if (type === "token_count" || type === "usage" || type === "token_usage") {
      const info = payload.usage || payload.token_count || payload;
      if (info.input_tokens != null) tokenInput = info.input_tokens;
      if (info.output_tokens != null) tokenOutput = info.output_tokens;
      if (info.cache_read_tokens != null) tokenCacheRead = info.cache_read_tokens;
      if (info.cached_input_tokens != null) tokenCacheRead = info.cached_input_tokens;
      if (payload.model) model = payload.model;
    }

    // Errors
    if (type === "error" || type === "api_error" || type === "stream_error") {
      apiErrors.push({
        type,
        message: (typeof payload.message === "string" && payload.message) ||
          payload.error || "Cursor error",
        timestamp: iso,
      });
    }
  }

  if (!firstTimestamp) return null;

  const tokensByModel = {};
  if (tokenInput || tokenOutput || tokenCacheRead) {
    const key = model || "cursor-default";
    tokensByModel[key] = {
      input: tokenInput,
      output: tokenOutput,
      cacheRead: tokenCacheRead,
      cacheWrite: 0,
    };
  }

  let fileModifiedAt = null;
  try { fileModifiedAt = fs.statSync(filePath).mtimeMs; } catch { /* non-fatal */ }

  const projectName = cwd ? path.basename(cwd) : `Cursor Session ${sessionId.slice(0, 8)}`;

  return {
    sessionId,
    name: `${projectName} (cursor)`,
    cwd,
    model,
    version,
    slug: null,
    gitBranch,
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
    entrypoint: "cursor",
    permissionMode: null,
    thinkingBlockCount,
    toolResultErrors,
    usageExtras: { service_tiers: [], speeds: [], inference_geos: [] },
  };
}

module.exports = { parseTranscriptFile };
