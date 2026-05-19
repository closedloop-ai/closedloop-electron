/**
 * @file codex-parser.js
 * @description Parse an OpenAI Codex CLI rollout JSONL file into the SAME
 * normalized session object that scripts/import-history.js `parseSessionFile`
 * produces for Claude Code. Emitting an identical shape lets the Codex import
 * path reuse the existing, battle-tested `importSession()` so Codex sessions
 * render through the unchanged dashboard UI exactly like Claude sessions.
 *
 * Codex's rollout format has drifted across releases, so parsing is
 * intentionally tolerant: it accepts the modern RolloutLine envelope
 * (`{type:"session_meta"|"event_msg"|"response_item", payload, timestamp}`),
 * older bare records (the item itself on the line), and auto-detects a typed
 * `payload` under an unknown wrapper. Token usage in Codex `token_count`
 * events is CUMULATIVE per session, so the final value is the session total
 * (no delta math needed). Model attribution follows CodexBar's documented
 * rule: `turn_context.model` is authoritative.
 *
 * Reference for the Codex format & token/model semantics: steipete/CodexBar
 * `docs/codex.md` (MIT) — see THIRD_PARTY_NOTICES.md.
 *
 * Part of CLOSEDLOOP VENDOR Addition #6 (see vendor/agent-monitor/VENDOR.md).
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { sessionIdFromRolloutPath } = require("./codex-home");
const { toIso, safeJson } = require("./parser-utils");

const RESPONSE_ITEM_TYPES = new Set([
  "message",
  "reasoning",
  "function_call",
  "function_call_output",
  "local_shell_call",
  "local_shell_call_output",
  "custom_tool_call",
  "custom_tool_call_output",
]);

/**
 * Classify a parsed JSONL record into a coarse kind plus its inner payload.
 */
function classify(rec) {
  if (!rec || typeof rec !== "object") return null;
  const ts = rec.timestamp || rec.ts || (rec.payload && rec.payload.timestamp) || null;
  const t = rec.type;

  if (t === "session_meta" || t === "session.created")
    return { kind: "session_meta", p: rec.payload || rec, ts };
  if (t === "turn_context" || t === "turn.context")
    return { kind: "turn_context", p: rec.payload || rec, ts };
  if (t === "event_msg" || t === "event")
    return { kind: "event", p: rec.payload || rec, ts };
  if (t === "response_item" || t === "response.item")
    return { kind: "response_item", p: rec.payload || rec, ts };

  // Unknown wrapper but a typed payload — auto-detect from payload.type.
  if (rec.payload && typeof rec.payload === "object" && rec.payload.type) {
    return { kind: "auto", p: rec.payload, ts };
  }
  // Bare Responses-API item on the line.
  if (t && RESPONSE_ITEM_TYPES.has(t)) return { kind: "response_item", p: rec, ts };
  // Bare session meta (no `type`, but session-ish fields).
  if (!t && (rec.cwd || rec.instructions || rec.git || rec.session_id || rec.id)) {
    return { kind: "session_meta", p: rec, ts };
  }
  // Bare event-like record.
  if (t) return { kind: "event", p: rec, ts };
  return { kind: "other", p: rec.payload || rec, ts };
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const b of content) {
    if (!b) continue;
    if (typeof b === "string") parts.push(b);
    else if (typeof b.text === "string") parts.push(b.text);
    else if (b.type === "input_text" || b.type === "output_text" || b.type === "text") {
      if (typeof b.text === "string") parts.push(b.text);
    }
  }
  return parts.join("");
}

/**
 * Parse a single Codex rollout JSONL file into the normalized session object.
 * Returns null when the file carries no usable timestamp (mirrors
 * parseSessionFile's contract so importSession can treat both identically).
 */
async function parseRolloutFile(filePath) {
  const sessionId = sessionIdFromRolloutPath(filePath);

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
  const apiErrors = [];
  let thinkingBlockCount = 0;
  const toolResultErrors = [];
  let latestTotals = null; // cumulative token_count totals (last wins)
  let sawResponseItems = false;
  let lastTs = null;

  const noteTs = (raw) => {
    const iso = toIso(raw);
    if (!iso) return null;
    if (!firstTimestamp || iso < firstTimestamp) firstTimestamp = iso;
    if (!lastTimestamp || iso > lastTimestamp) lastTimestamp = iso;
    lastTs = iso;
    return iso;
  };

  const handleResponseItem = (p, iso) => {
    sawResponseItems = true;
    const itype = p.type;
    if (itype === "message") {
      const role = p.role || p.author || "assistant";
      const text = extractText(p.content);
      if (role === "user") {
        userMessageCount++;
      } else {
        assistantMessageCount++;
        if (iso) messageTimestamps.push(iso);
      }
      void text;
    } else if (itype === "reasoning") {
      thinkingBlockCount++;
    } else if (itype === "function_call" || itype === "custom_tool_call") {
      toolUses.push({
        name: p.name || p.tool_name || "function",
        timestamp: iso || firstTimestamp,
        input: safeJson(p.arguments != null ? p.arguments : p.input),
      });
    } else if (itype === "local_shell_call") {
      const action = p.action || {};
      toolUses.push({
        name: "shell",
        timestamp: iso || firstTimestamp,
        input: action.command || action || p.input || null,
      });
    } else if (
      itype === "function_call_output" ||
      itype === "custom_tool_call_output" ||
      itype === "local_shell_call_output"
    ) {
      const out = p.output || p.result || {};
      const isErr =
        out && typeof out === "object"
          ? out.success === false || out.is_error === true || !!out.error
          : false;
      if (isErr) {
        const content =
          typeof out === "string"
            ? out.slice(0, 500)
            : JSON.stringify(out).slice(0, 500);
        toolResultErrors.push({ content, timestamp: iso });
      }
    }
  };

  const handleEvent = (p, iso) => {
    const et = p.type;
    if (!et) return;
    if (et === "user_message") {
      userMessageCount++;
    } else if (et === "agent_message" || et === "agent_message_delta") {
      if (et === "agent_message") {
        assistantMessageCount++;
        if (iso) messageTimestamps.push(iso);
      }
    } else if (et === "agent_reasoning" || et === "agent_reasoning_section_break") {
      if (et === "agent_reasoning") thinkingBlockCount++;
    } else if (et === "token_count") {
      const info = p.info || p.token_count_info || p;
      const totals =
        info.total_token_usage || info.totalTokenUsage || info.total || null;
      if (totals && typeof totals === "object") latestTotals = totals;
      const m =
        (p.turn_context && p.turn_context.model) || info.model || p.model;
      if (m) model = m;
    } else if (et === "error" || et === "stream_error") {
      apiErrors.push({
        type: et,
        message:
          (typeof p.message === "string" && p.message) ||
          p.error ||
          "Codex error",
        timestamp: iso,
      });
    } else if (
      !sawResponseItems &&
      (et === "exec_command_begin" ||
        et === "patch_apply_begin" ||
        et === "mcp_tool_call_begin")
    ) {
      // Fallback only for older event-only logs with no response_item items.
      const name =
        et === "exec_command_begin"
          ? "shell"
          : et === "patch_apply_begin"
            ? "apply_patch"
            : p.tool || p.server || "mcp_tool";
      toolUses.push({
        name,
        timestamp: iso || firstTimestamp,
        input: p.command || p.changes || p.arguments || null,
      });
    }
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const c = classify(rec);
    if (!c) continue;
    const iso = noteTs(c.ts) || lastTs;

    if (c.kind === "session_meta") {
      const p = c.p || {};
      if (!cwd && (p.cwd || p.workdir)) cwd = p.cwd || p.workdir;
      if (!version && (p.cli_version || p.version)) version = p.cli_version || p.version;
      if (!gitBranch) {
        if (typeof p.git === "object" && p.git) gitBranch = p.git.branch || p.git.ref || null;
        else if (typeof p.git_branch === "string") gitBranch = p.git_branch;
      }
      if (!model && p.model) model = p.model;
    } else if (c.kind === "turn_context") {
      const p = c.p || {};
      if (p.model) model = p.model; // authoritative
      if (!cwd && p.cwd) cwd = p.cwd;
    } else if (c.kind === "response_item") {
      handleResponseItem(c.p || {}, iso);
    } else if (c.kind === "event") {
      handleEvent(c.p || {}, iso);
    } else if (c.kind === "auto") {
      const p = c.p || {};
      if (RESPONSE_ITEM_TYPES.has(p.type)) handleResponseItem(p, iso);
      else handleEvent(p, iso);
    }
  }

  if (!firstTimestamp) return null;

  const tokensByModel = {};
  if (latestTotals) {
    const key = model || "gpt-codex";
    const input = latestTotals.input_tokens || latestTotals.inputTokens || 0;
    const cached =
      latestTotals.cached_input_tokens || latestTotals.cachedInputTokens || 0;
    const output = latestTotals.output_tokens || latestTotals.outputTokens || 0;
    const reasoning =
      latestTotals.reasoning_output_tokens ||
      latestTotals.reasoningOutputTokens ||
      0;
    if (input || output || cached || reasoning) {
      tokensByModel[key] = {
        input,
        output: output + reasoning,
        cacheRead: cached,
        cacheWrite: 0,
      };
    }
  }

  let fileModifiedAt = null;
  try {
    fileModifiedAt = fs.statSync(filePath).mtimeMs;
  } catch {
    /* non-fatal */
  }

  const projectName = cwd ? path.basename(cwd) : `Codex Session ${sessionId.slice(0, 8)}`;

  return {
    sessionId,
    name: `${projectName} (codex)`,
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
    turnDurations: [],
    entrypoint: "codex",
    permissionMode: null,
    thinkingBlockCount,
    toolResultErrors,
    usageExtras: { service_tiers: [], speeds: [], inference_geos: [] },
  };
}

module.exports = { parseRolloutFile, classify, toIso };
