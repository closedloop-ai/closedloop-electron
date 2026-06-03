/**
 * @file cursor-parser.ts
 * @description Parse a Cursor agent transcript JSONL file into the normalized
 * session object consumed by importSession(). Cursor's background agent
 * transcripts use a format similar to Codex rollouts — each line is a JSON
 * record with a type, payload, and timestamp. The parser is intentionally
 * tolerant of format drift across Cursor versions.
 *
 * Ported from the vendor `scripts/agent-monitor-cursor/cursor-parser.js`; all
 * parsing/path logic, field names, token math (non-cumulative, last value
 * wins), and timestamp handling preserved exactly.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { toIso, safeJson, pushTurnDuration } from "../parser-utils.js";
import type {
  NormalizedApiError,
  NormalizedSession,
  NormalizedToolResultError,
  NormalizedToolUse,
  NormalizedTurnDuration,
} from "../types.js";
import { sessionIdFromTranscriptPath } from "./cursor-home.js";

/** Coerce an unknown JSON value to a plain object bag for tolerant field access. */
function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/** Read a string-or-null field tolerantly (Cursor records are untyped JSON). */
function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Read a numeric field tolerantly. */
function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/**
 * Parse a single Cursor agent transcript JSONL file.
 * Returns null when the file carries no usable timestamp.
 */
export async function parseTranscriptFile(filePath: string): Promise<NormalizedSession | null> {
  const sessionId = sessionIdFromTranscriptPath(filePath);

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
  const turnDurations: NormalizedTurnDuration[] = [];
  const apiErrors: NormalizedApiError[] = [];
  let thinkingBlockCount = 0;
  const toolResultErrors: NormalizedToolResultError[] = [];
  let tokenInput = 0;
  let tokenOutput = 0;
  let tokenCacheRead = 0;
  let tokenCacheWrite = 0;
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
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!rec || typeof rec !== "object") continue;

    const record = rec as Record<string, unknown>;
    const ts = record.timestamp || record.ts || record.created_at || null;
    const iso = noteTs(ts);
    const type = typeof record.type === "string" ? record.type : "";
    const payload = asRecord(record.payload ?? record.data ?? record);

    // Session metadata
    if (
      type === "session_meta" ||
      type === "session.created" ||
      type === "session_start" ||
      (!type && (payload.cwd || payload.workdir || payload.workspace))
    ) {
      if (!cwd) {
        cwd =
          asStringOrNull(payload.cwd) ??
          asStringOrNull(payload.workdir) ??
          asStringOrNull(payload.workspace);
      }
      if (!version) {
        version =
          asStringOrNull(payload.version) ??
          asStringOrNull(payload.cli_version) ??
          asStringOrNull(payload.cursor_version);
      }
      if (!model) model = asStringOrNull(payload.model);
      if (!gitBranch) {
        if (typeof payload.git === "object" && payload.git) {
          const git = payload.git as Record<string, unknown>;
          gitBranch = asStringOrNull(git.branch) ?? asStringOrNull(git.ref);
        } else if (payload.git_branch) {
          gitBranch = asStringOrNull(payload.git_branch);
        }
      }
    }

    // Model override (turn-level is authoritative)
    if (type === "turn_context" || type === "turn.context" || type === "model_context") {
      if (payload.model) model = asStringOrNull(payload.model);
      if (!cwd && payload.cwd) cwd = asStringOrNull(payload.cwd);
    }

    // User messages
    if (
      type === "user_message" ||
      type === "human_message" ||
      (type === "message" && (payload.role === "user" || payload.author === "user"))
    ) {
      userMessageCount++;
      if (iso) pendingTurnStartedAt = iso;
    }

    // Assistant messages
    if (
      type === "assistant_message" ||
      type === "agent_message" ||
      (type === "message" && (payload.role === "assistant" || payload.author === "assistant"))
    ) {
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
    if (
      type === "tool_call" ||
      type === "function_call" ||
      type === "tool_use" ||
      type === "command_execution" ||
      type === "terminal_command"
    ) {
      toolUses.push({
        name:
          asStringOrNull(payload.name) ??
          asStringOrNull(payload.tool_name) ??
          asStringOrNull(payload.command_name) ??
          "tool",
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
      const exitCode = asNumberOrNull(payload.exit_code);
      const isErr =
        payload.is_error === true ||
        payload.success === false ||
        (exitCode != null && exitCode > 0) ||
        !!payload.error;
      if (isErr) {
        const content =
          typeof payload.output === "string"
            ? payload.output.slice(0, 500)
            : JSON.stringify(payload.error || payload.output || payload).slice(0, 500);
        toolResultErrors.push({ content, timestamp: iso });
      }
    }

    // Token usage
    if (type === "token_count" || type === "usage" || type === "token_usage") {
      const info = asRecord(payload.usage ?? payload.token_count ?? payload);
      if (info.input_tokens != null) tokenInput = info.input_tokens as number;
      if (info.output_tokens != null) tokenOutput = info.output_tokens as number;
      if (info.cache_read_tokens != null) tokenCacheRead = info.cache_read_tokens as number;
      if (info.cached_input_tokens != null) tokenCacheRead = info.cached_input_tokens as number;
      if (info.cache_write_tokens != null) tokenCacheWrite = info.cache_write_tokens as number;
      if (info.cache_creation_input_tokens != null) {
        tokenCacheWrite = info.cache_creation_input_tokens as number;
      }
      if (payload.model) model = asStringOrNull(payload.model);
    }

    // Errors
    if (type === "error" || type === "api_error" || type === "stream_error") {
      apiErrors.push({
        type,
        message:
          (typeof payload.message === "string" && payload.message) ||
          asStringOrNull(payload.error) ||
          "Cursor error",
        timestamp: iso,
      });
    }
  }

  if (!firstTimestamp) return null;

  const tokensByModel: NormalizedSession["tokensByModel"] = {};
  if (tokenInput || tokenOutput || tokenCacheRead || tokenCacheWrite) {
    const key = model || "cursor-default";
    tokensByModel[key] = {
      input: tokenInput,
      output: tokenOutput,
      cacheRead: tokenCacheRead,
      cacheWrite: tokenCacheWrite,
    };
  }

  let fileModifiedAt: number | null = null;
  try {
    fileModifiedAt = fs.statSync(filePath).mtimeMs;
  } catch {
    /* non-fatal */
  }

  const projectName = cwd ? path.basename(cwd) : `Cursor Session ${sessionId.slice(0, 8)}`;

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
