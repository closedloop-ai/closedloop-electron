/**
 * @file codex-parser.ts
 * @description Parse an OpenAI Codex CLI rollout JSONL file into the shared
 * `NormalizedSession` shape so the Codex import path renders through the
 * unchanged dashboard UI exactly like Claude sessions.
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
 * Ported from `scripts/agent-monitor-codex/codex-parser.js` (logic preserved).
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import {
  pushTurnDuration,
  toIso,
  safeJson,
  truncateText,
  computeUnifiedDiffDelta,
  countDiffFiles,
  collectArtifacts,
} from "../parser-utils.js";
import type {
  NormalizedApiError,
  NormalizedArtifacts,
  NormalizedDiffStats,
  NormalizedMessage,
  NormalizedPlan,
  NormalizedSession,
  NormalizedTokenRecord,
  NormalizedToolResultError,
  NormalizedToolUse,
  NormalizedTokenCounts,
  NormalizedTurnDuration,
} from "../types.js";
import { sessionIdFromRolloutPath } from "./codex-home.js";

const RESPONSE_ITEM_TYPES = new Set<string>([
  "message",
  "reasoning",
  "function_call",
  "function_call_output",
  "local_shell_call",
  "local_shell_call_output",
  "custom_tool_call",
  "custom_tool_call_output",
]);

// CLOSEDLOOP plan-extraction (FEA-1189): Codex emits implementation plans as a
// structured `item_completed` event whose item.type === "Plan", and (fallback)
// as a <proposed_plan> block inside an assistant message. We surface both into
// session.plans[]; plan-extractor/plan-store handle normalization + versioning.
const PROPOSED_PLAN_RE = /<proposed_plan>([\s\S]*?)<\/proposed_plan>/i;

type Rec = Record<string, unknown>;

type ClassifyKind =
  | "session_meta"
  | "turn_context"
  | "event"
  | "response_item"
  | "auto"
  | "other";

interface Classified {
  kind: ClassifyKind;
  p: Rec;
  ts: unknown;
}

/** Narrow an unknown value to a plain object record (excludes arrays/null). */
function asRec(v: unknown): Rec | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;
}

/** Read a string field from a record, returning null when not a string. */
function asStr(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Classify a parsed JSONL record into a coarse kind plus its inner payload.
 */
export function classify(rec: unknown): Classified | null {
  const r = asRec(rec);
  if (!r) return null;
  const payload = asRec(r.payload);
  const ts =
    r.timestamp ?? r.ts ?? (payload ? payload.timestamp : undefined) ?? null;
  const t = r.type;

  if (t === "session_meta" || t === "session.created")
    return { kind: "session_meta", p: payload ?? r, ts };
  if (t === "turn_context" || t === "turn.context")
    return { kind: "turn_context", p: payload ?? r, ts };
  if (t === "event_msg" || t === "event")
    return { kind: "event", p: payload ?? r, ts };
  if (t === "response_item" || t === "response.item")
    return { kind: "response_item", p: payload ?? r, ts };

  // Unknown wrapper but a typed payload — auto-detect from payload.type.
  if (payload && payload.type) {
    return { kind: "auto", p: payload, ts };
  }
  // Bare Responses-API item on the line.
  if (typeof t === "string" && RESPONSE_ITEM_TYPES.has(t))
    return { kind: "response_item", p: r, ts };
  // Bare session meta (no `type`, but session-ish fields).
  if (!t && (r.cwd || r.instructions || r.git || r.session_id || r.id)) {
    return { kind: "session_meta", p: r, ts };
  }
  // Bare event-like record.
  if (t) return { kind: "event", p: r, ts };
  return { kind: "other", p: payload ?? r, ts };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const b of content) {
    if (!b) continue;
    if (typeof b === "string") {
      parts.push(b);
      continue;
    }
    const block = asRec(b);
    if (!block) continue;
    if (typeof block.text === "string") parts.push(block.text);
    else if (
      block.type === "input_text" ||
      block.type === "output_text" ||
      block.type === "text"
    ) {
      if (typeof block.text === "string") parts.push(block.text);
    }
  }
  return parts.join("");
}

/** Read a numeric field from a record, returning 0 when absent/non-number. */
function num(rec: Rec, key: string): number {
  const v = rec[key];
  return typeof v === "number" ? v : 0;
}

/**
 * Parse a single Codex rollout JSONL file into the normalized session object.
 * Returns null when the file carries no usable timestamp (mirrors
 * parseSessionFile's contract so importSession can treat both identically).
 */
export async function parseRolloutFile(
  filePath: string,
): Promise<NormalizedSession | null> {
  const sessionId = sessionIdFromRolloutPath(filePath);

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let cwd: string | null = null;
  let model: string | null = null;
  let version: string | null = null;
  let gitBranch: string | null = null;
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  const messageTimestamps: string[] = [];
  const toolUses: NormalizedToolUse[] = [];
  const toolCallIndex = new Map<string, number>();
  const turnDurations: NormalizedTurnDuration[] = [];
  const plans: NormalizedPlan[] = []; // CLOSEDLOOP plan-extraction (FEA-1189)
  const apiErrors: NormalizedApiError[] = [];
  let thinkingBlockCount = 0;
  const toolResultErrors: NormalizedToolResultError[] = [];
  let latestTotals: Rec | null = null; // cumulative token_count totals (last wins)
  let previousTotals: Rec | null = null; // CR-2: previous cumulative totals for delta computation
  let sawResponseItems = false;
  let lastTs: string | null = null;
  let pendingTurnStartedAt: string | null = null;
  const messages: NormalizedMessage[] = []; // CR-1
  const tokenSeries: NormalizedTokenRecord[] = []; // CR-2
  let diffStats: NormalizedDiffStats | null = null; // CR-4
  /** CR-5: per-event model from turn_context; reset on each turn_context line. */
  let currentTurnModel: string | null = null;

  const noteTs = (raw: unknown): string | null => {
    const iso = toIso(raw);
    if (!iso) return null;
    if (!firstTimestamp || iso < firstTimestamp) firstTimestamp = iso;
    if (!lastTimestamp || iso > lastTimestamp) lastTimestamp = iso;
    lastTs = iso;
    return iso;
  };

  const handleResponseItem = (
    p: Rec,
    iso: string | null,
    explicitIso: string | null,
  ): void => {
    sawResponseItems = true;
    const itype = p.type;
    if (itype === "message") {
      const role = asStr(p.role) ?? asStr(p.author) ?? "assistant";
      const text = extractText(p.content);
      if (role === "user") {
        userMessageCount++;
        if (explicitIso) pendingTurnStartedAt = explicitIso;
        // CR-1: capture user message
        messages.push({
          role: "human",
          timestamp: iso || firstTimestamp,
          text: truncateText(text),
          model: currentTurnModel ?? model,
        });
      } else {
        assistantMessageCount++;
        if (iso) messageTimestamps.push(iso);
        pushTurnDuration(turnDurations, pendingTurnStartedAt, iso);
        pendingTurnStartedAt = null;
        // Fallback plan signal: <proposed_plan> block in an assistant message
        // (medium confidence — flagged for user confirmation downstream).
        const pm = PROPOSED_PLAN_RE.exec(text);
        if (pm && pm[1] && pm[1].trim()) {
          plans.push({
            source: "codex-proposed-plan",
            content: pm[1].trim(),
            timestamp: iso || firstTimestamp,
          });
        }
        // CR-1: capture assistant message
        messages.push({
          role: "assistant",
          timestamp: iso || firstTimestamp,
          text: truncateText(text),
          model: currentTurnModel ?? model,
        });
      }
    } else if (itype === "reasoning") {
      thinkingBlockCount++;
      // CR-1: capture reasoning as a thinking message
      const reasoningText = extractText(p.content) || asStr(p.text) || asStr(p.summary) || null;
      messages.push({
        role: "assistant",
        timestamp: iso || firstTimestamp,
        text: truncateText(reasoningText),
        model: currentTurnModel ?? model,
        isThinking: true,
      });
    } else if (itype === "function_call" || itype === "custom_tool_call") {
      const toolName = asStr(p.name) ?? asStr(p.tool_name) ?? "function";
      const toolInput = safeJson(p.arguments != null ? p.arguments : p.input);
      const callId = asStr(p.call_id) ?? asStr(p.id) ?? null;
      const tu: NormalizedToolUse = {
        name: toolName,
        timestamp: iso || firstTimestamp,
        input: toolInput,
      };
      // CR-4: parse apply_patch input as unified diff
      if (toolName === "apply_patch") {
        const rawInput = typeof p.arguments === "string" ? p.arguments
          : typeof p.input === "string" ? p.input
          : typeof toolInput === "string" ? toolInput
          : null;
        if (rawInput) {
          const delta = computeUnifiedDiffDelta(rawInput);
          tu.diffDelta = delta;
          const files = countDiffFiles(rawInput);
          if (!diffStats) {
            diffStats = { filesChanged: files, linesAdded: delta.add, linesRemoved: delta.del };
          } else {
            diffStats.filesChanged += files;
            diffStats.linesAdded += delta.add;
            diffStats.linesRemoved += delta.del;
          }
        }
      }
      if (callId) toolCallIndex.set(callId, toolUses.length);
      toolUses.push(tu);
    } else if (itype === "local_shell_call") {
      const shellCallId = asStr(p.call_id) ?? asStr(p.id) ?? null;
      const action = asRec(p.action) ?? {};
      const shellTu: NormalizedToolUse = {
        name: "shell",
        timestamp: iso || firstTimestamp,
        input: action.command || p.action || p.input || null,
      };
      if (shellCallId) toolCallIndex.set(shellCallId, toolUses.length);
      toolUses.push(shellTu);
    } else if (
      itype === "function_call_output" ||
      itype === "custom_tool_call_output" ||
      itype === "local_shell_call_output"
    ) {
      const out = p.output ?? p.result ?? {};
      const outRec = asRec(out);
      const isErr = outRec
        ? outRec.success === false || outRec.is_error === true || !!outRec.error
        : false;
      // CR-3: match tool output by call ID when available, fall back to most recent
      const outputStr =
        typeof out === "string" ? out : JSON.stringify(out);
      const truncatedOutput = truncateText(outputStr);
      const outputCallId = asStr(p.call_id) ?? asStr(p.id) ?? null;
      const matchIdx = outputCallId != null ? toolCallIndex.get(outputCallId) : undefined;
      const matchedTool = matchIdx != null ? toolUses[matchIdx] : toolUses[toolUses.length - 1];
      if (matchedTool) {
        matchedTool.output = truncatedOutput;
        matchedTool.isError = isErr;
      }
      if (isErr) {
        const content =
          typeof out === "string"
            ? out.slice(0, 500)
            : JSON.stringify(out).slice(0, 500);
        toolResultErrors.push({ content, timestamp: iso });
      }
    }
  };

  const handleEvent = (
    p: Rec,
    iso: string | null,
    explicitIso: string | null,
  ): void => {
    const et = p.type;
    if (!et) return;
    // CLOSEDLOOP plan-extraction (FEA-1189): the strongest Codex plan signal —
    // a structured item_completed event carrying item.type === "Plan".
    const item = asRec(p.item);
    if (
      et === "item_completed" &&
      item &&
      item.type === "Plan" &&
      typeof item.text === "string" &&
      item.text.trim()
    ) {
      plans.push({
        source: "codex-plan-item",
        content: item.text,
        timestamp: iso || firstTimestamp,
      });
      return;
    }
    if (et === "user_message") {
      userMessageCount++;
      if (explicitIso) pendingTurnStartedAt = explicitIso;
    } else if (et === "agent_message" || et === "agent_message_delta") {
      if (et === "agent_message") {
        assistantMessageCount++;
        if (iso) messageTimestamps.push(iso);
        pushTurnDuration(turnDurations, pendingTurnStartedAt, iso);
        pendingTurnStartedAt = null;
      }
    } else if (
      et === "agent_reasoning" ||
      et === "agent_reasoning_section_break"
    ) {
      if (et === "agent_reasoning") thinkingBlockCount++;
    } else if (et === "token_count") {
      const info = asRec(p.info) ?? asRec(p.token_count_info) ?? p;
      const totals =
        asRec(info.total_token_usage) ??
        asRec(info.totalTokenUsage) ??
        asRec(info.total);
      if (totals) {
        // CR-2: compute per-turn delta from cumulative totals
        const curInput = num(totals, "input_tokens") || num(totals, "inputTokens");
        const curCached =
          num(totals, "cached_input_tokens") || num(totals, "cachedInputTokens");
        const curOutput =
          num(totals, "output_tokens") || num(totals, "outputTokens");
        const curReasoning =
          num(totals, "reasoning_output_tokens") || num(totals, "reasoningOutputTokens");
        const curCacheWrite =
          num(totals, "cache_write_tokens") ||
          num(totals, "cacheWriteTokens") ||
          num(totals, "cache_creation_input_tokens") ||
          num(totals, "cacheCreationInputTokens");

        let deltaInput = curInput;
        let deltaOutput = curOutput + curReasoning;
        let deltaCacheRead = curCached;
        let deltaCacheWrite = curCacheWrite;

        if (previousTotals) {
          const prevInput = num(previousTotals, "input_tokens") || num(previousTotals, "inputTokens");
          const prevCached =
            num(previousTotals, "cached_input_tokens") || num(previousTotals, "cachedInputTokens");
          const prevOutput =
            num(previousTotals, "output_tokens") || num(previousTotals, "outputTokens");
          const prevReasoning =
            num(previousTotals, "reasoning_output_tokens") || num(previousTotals, "reasoningOutputTokens");
          const prevCacheWrite =
            num(previousTotals, "cache_write_tokens") ||
            num(previousTotals, "cacheWriteTokens") ||
            num(previousTotals, "cache_creation_input_tokens") ||
            num(previousTotals, "cacheCreationInputTokens");

          deltaInput = Math.max(0, curInput - prevInput);
          deltaOutput = Math.max(0, (curOutput + curReasoning) - (prevOutput + prevReasoning));
          deltaCacheRead = Math.max(0, curCached - prevCached);
          deltaCacheWrite = Math.max(0, curCacheWrite - prevCacheWrite);
        }
        previousTotals = totals;
        latestTotals = totals;

        // CR-5: read per-event model from turn_context
        const turnCtx = asRec(p.turn_context);
        const m =
          (turnCtx && asStr(turnCtx.model)) || asStr(info.model) || asStr(p.model);
        if (m) model = m;
        const eventModel = m ?? model ?? "gpt-codex";

        if (iso && (deltaInput || deltaOutput || deltaCacheRead || deltaCacheWrite)) {
          tokenSeries.push({
            timestamp: iso,
            model: eventModel,
            input: deltaInput,
            output: deltaOutput,
            cacheRead: deltaCacheRead,
            cacheWrite: deltaCacheWrite,
          });
        }
      } else {
        // No totals object — still extract model if present
        const turnCtx = asRec(p.turn_context);
        const m =
          (turnCtx && asStr(turnCtx.model)) || asStr(info.model) || asStr(p.model);
        if (m) model = m;
      }
    } else if (et === "error" || et === "stream_error") {
      apiErrors.push({
        type: et,
        message:
          (typeof p.message === "string" && p.message) ||
          asStr(p.error) ||
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
      if (et === "mcp_tool_call_begin") {
        // CR-6: preserve MCP server and method from the event payload
        const server = asStr(p.server) ?? asStr(p.mcp_server) ?? undefined;
        const method = asStr(p.method) ?? asStr(p.tool) ?? asStr(p.tool_name) ?? undefined;
        const displayName = server && method ? `${server}__${method}` : (method ?? server ?? "mcp_tool");
        toolUses.push({
          name: displayName,
          timestamp: iso || firstTimestamp,
          input: p.arguments ?? p.input ?? null,
          mcpServer: server,
          mcpMethod: method,
        });
      } else if (et === "patch_apply_begin") {
        // CR-4: parse the patch input for diff stats
        const patchInput = typeof p.changes === "string"
          ? p.changes
          : typeof p.patch === "string"
            ? p.patch
            : typeof p.arguments === "string"
              ? p.arguments
              : null;
        const tu: NormalizedToolUse = {
          name: "apply_patch",
          timestamp: iso || firstTimestamp,
          input: p.changes ?? p.patch ?? p.arguments ?? null,
        };
        if (patchInput) {
          const delta = computeUnifiedDiffDelta(patchInput);
          tu.diffDelta = delta;
          const files = countDiffFiles(patchInput);
          // Aggregate into session-level diffStats
          if (!diffStats) {
            diffStats = { filesChanged: files, linesAdded: delta.add, linesRemoved: delta.del };
          } else {
            diffStats.filesChanged += files;
            diffStats.linesAdded += delta.add;
            diffStats.linesRemoved += delta.del;
          }
        }
        toolUses.push(tu);
      } else {
        toolUses.push({
          name: "shell",
          timestamp: iso || firstTimestamp,
          input: p.command ?? p.arguments ?? null,
        });
      }
    } else if (et === "mcp_tool_call_end") {
      // CR-6: match MCP end event to the most recent MCP tool use and capture output
      const out = p.output ?? p.result ?? undefined;
      const outRec = asRec(out);
      const isErr = outRec
        ? outRec.success === false || outRec.is_error === true || !!outRec.error
        : false;
      // Find the last MCP tool use to attach output
      for (let i = toolUses.length - 1; i >= 0; i--) {
        if (toolUses[i].mcpServer != null || toolUses[i].mcpMethod != null) {
          if (out !== undefined) {
            const outputStr = typeof out === "string" ? out : JSON.stringify(out);
            toolUses[i].output = truncateText(outputStr);
            toolUses[i].isError = isErr;
          }
          break;
        }
      }
      if (isErr) {
        const content =
          typeof out === "string"
            ? out.slice(0, 500)
            : JSON.stringify(out ?? {}).slice(0, 500);
        toolResultErrors.push({ content, timestamp: iso });
      }
    }
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const c = classify(rec);
    if (!c) continue;
    const explicitIso = noteTs(c.ts);
    const iso = explicitIso || lastTs;

    if (c.kind === "session_meta") {
      const p = c.p;
      if (!cwd && (p.cwd || p.workdir))
        cwd = asStr(p.cwd) ?? asStr(p.workdir);
      if (!version && (p.cli_version || p.version))
        version = asStr(p.cli_version) ?? asStr(p.version);
      if (!gitBranch) {
        const git = asRec(p.git);
        if (git) gitBranch = asStr(git.branch) ?? asStr(git.ref) ?? null;
        else if (typeof p.git_branch === "string") gitBranch = p.git_branch;
      }
      if (!model && p.model) model = asStr(p.model);
    } else if (c.kind === "turn_context") {
      const p = c.p;
      // CR-5: turn_context.model is authoritative per CodexBar docs
      if (p.model) {
        model = asStr(p.model);
        currentTurnModel = asStr(p.model);
      }
      if (!cwd && p.cwd) cwd = asStr(p.cwd);
    } else if (c.kind === "response_item") {
      handleResponseItem(c.p, iso, explicitIso);
    } else if (c.kind === "event") {
      handleEvent(c.p, iso, explicitIso);
    } else if (c.kind === "auto") {
      const p = c.p;
      if (typeof p.type === "string" && RESPONSE_ITEM_TYPES.has(p.type))
        handleResponseItem(p, iso, explicitIso);
      else handleEvent(p, iso, explicitIso);
    }
  }

  if (!firstTimestamp) return null;

  const tokensByModel: Record<string, NormalizedTokenCounts> = {};
  if (latestTotals) {
    const key = model || "gpt-codex";
    const input = num(latestTotals, "input_tokens") || num(latestTotals, "inputTokens");
    const cached =
      num(latestTotals, "cached_input_tokens") ||
      num(latestTotals, "cachedInputTokens");
    const output =
      num(latestTotals, "output_tokens") || num(latestTotals, "outputTokens");
    const reasoning =
      num(latestTotals, "reasoning_output_tokens") ||
      num(latestTotals, "reasoningOutputTokens");
    const cacheWrite =
      num(latestTotals, "cache_write_tokens") ||
      num(latestTotals, "cacheWriteTokens") ||
      num(latestTotals, "cache_creation_input_tokens") ||
      num(latestTotals, "cacheCreationInputTokens");
    if (input || output || cached || reasoning || cacheWrite) {
      tokensByModel[key] = {
        input,
        output: output + reasoning,
        cacheRead: cached,
        cacheWrite,
      };
    }
  }

  // CR-13: collect artifact references from all tool uses
  const artifacts: NormalizedArtifacts = collectArtifacts(toolUses, cwd);

  let fileModifiedAt: number | null = null;
  try {
    fileModifiedAt = fs.statSync(filePath).mtimeMs;
  } catch {
    /* non-fatal */
  }

  const projectName = cwd
    ? path.basename(cwd)
    : `Codex Session ${sessionId.slice(0, 8)}`;

  return {
    sessionId,
    name: projectName,
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
    plans,
    compactions: [],
    apiErrors,
    fileModifiedAt,
    turnDurations,
    entrypoint: "codex",
    permissionMode: null,
    thinkingBlockCount,
    toolResultErrors,
    usageExtras: { service_tiers: [], speeds: [], inference_geos: [] },
    messages, // CR-1
    tokenSeries, // CR-2
    diffStats, // CR-4
    slashCommands: [], // CR-7: Codex has no slash commands
    artifacts, // CR-13
  };
}
