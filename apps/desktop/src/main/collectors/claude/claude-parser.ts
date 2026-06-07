/**
 * @file claude-parser.ts
 * @description First-party Claude Code transcript parser (FEA-1503; ported from
 * the vendor `scripts/import-history.js` `parseSessionFile`, logic preserved). It
 * streams a `~/.claude/projects/**​/<sessionId>.jsonl` transcript and produces the
 * shared NormalizedSession. Token accumulation mirrors `database/transcript.ts`
 * (cumulative per model, reasoning folded into output is NOT done here — Claude's
 * usage block already separates the fields).
 */
import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type {
  NormalizedApiError,
  NormalizedDiffStats,
  NormalizedMessage,
  NormalizedSession,
  NormalizedTokenCounts,
  NormalizedTokenRecord,
  NormalizedToolResultError,
  NormalizedToolUse,
  NormalizedTurnDuration,
} from "../types.js";
import { truncateText, computeLineDelta, collectArtifacts } from "../parser-utils.js";

/** Mirror the vendor's lenient timestamp handling: epoch number → ISO, string as-is. */
function isoTs(ts: unknown): string | null {
  if (ts == null) return null;
  if (typeof ts === "number") return new Date(ts).toISOString();
  if (typeof ts === "string") return ts;
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Parse a Claude transcript file into a NormalizedSession. Returns null when the
 * file has no usable timestamp (matching the vendor contract). Fail-silent on IO
 * or parse errors (malformed lines are skipped).
 */
export async function parseSessionFile(filePath: string): Promise<NormalizedSession | null> {
  const sessionId = path.basename(filePath, ".jsonl");

  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let cwd: string | null = null;
  let model: string | null = null;
  let version: string | null = null;
  let slug: string | null = null;
  let gitBranch: string | null = null;
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  const teams = new Set<string>();
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  const tokensByModel: Record<string, NormalizedTokenCounts> = {};
  const messageTimestamps: string[] = [];
  const toolUses: NormalizedToolUse[] = [];
  const compactions: Array<{ uuid: string | null; timestamp: string | null }> = [];
  const apiErrors: NormalizedApiError[] = [];
  const turnDurations: NormalizedTurnDuration[] = [];
  let entrypoint: string | null = null;
  let permissionMode: string | null = null;
  let thinkingBlockCount = 0;
  const toolResultErrors: NormalizedToolResultError[] = [];
  const serviceTiers = new Set<string>();
  const speeds = new Set<string>();
  const inferenceGeos = new Set<string>();

  // CR-1: ordered messages
  const messages: NormalizedMessage[] = [];
  // CR-2: per-turn token time-series
  const tokenSeries: NormalizedTokenRecord[] = [];
  // CR-4: aggregate diff stats
  let totalAdded = 0;
  let totalRemoved = 0;
  const diffFiles = new Set<string>();
  // CR-7: slash commands
  const slashCommands: Array<{ name: string; timestamp: string }> = [];
  // CR-3: map tool_use_id → index in toolUses for back-linking tool results
  const toolUseIdIndex = new Map<string, number>();

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (entry.isCompactSummary) {
        compactions.push({
          uuid: (entry.uuid as string) || null,
          timestamp: (entry.timestamp as string) || null,
        });
      }

      if (entry.type === "system" && entry.subtype === "turn_duration" && entry.durationMs) {
        turnDurations.push({
          durationMs: num(entry.durationMs),
          timestamp: isoTs(entry.timestamp),
        });
      }

      // isApiErrorMessage entries (quota/rate limits, invalid_request).
      if (entry.isApiErrorMessage) {
        const message = asRecord(entry.message);
        const errContent = Array.isArray(message.content) ? message.content : [];
        const first = asRecord(errContent[0]);
        const errText =
          typeof first.text === "string" ? first.text.slice(0, 500) : "Unknown error";
        apiErrors.push({
          type: (entry.error as string) || "unknown_error",
          message: errText,
          timestamp: isoTs(entry.timestamp),
        });
      }
      // Raw API error responses (type: "error" at message level).
      const rawMsg = asRecord(entry.message ?? entry);
      if (rawMsg.type === "error" && rawMsg.error) {
        const err = asRecord(rawMsg.error);
        apiErrors.push({
          type: (err.type as string) || "unknown_error",
          message: (err.message as string) || "Unknown API error",
          timestamp: isoTs(entry.timestamp),
        });
      }

      if (!cwd && typeof entry.cwd === "string") cwd = entry.cwd;
      if (!slug && typeof entry.slug === "string") slug = entry.slug;
      if (!gitBranch && typeof entry.gitBranch === "string") gitBranch = entry.gitBranch;
      if (!version && typeof entry.version === "string") version = entry.version;
      if (!entrypoint && typeof entry.entrypoint === "string") entrypoint = entry.entrypoint;
      if (!permissionMode && typeof entry.permissionMode === "string") {
        permissionMode = entry.permissionMode;
      }

      const ts = entry.timestamp;
      if (ts) {
        const iso = isoTs(ts);
        if (iso) {
          if (!firstTimestamp || iso < firstTimestamp) firstTimestamp = iso;
          if (!lastTimestamp || iso > lastTimestamp) lastTimestamp = iso;
        }
      }

      if (typeof entry.teamName === "string") teams.add(entry.teamName);

      if (entry.type === "user") {
        userMessageCount++;

        // CR-1: Build NormalizedMessage for user messages.
        const userMsg = asRecord(entry.message);
        const userContent = Array.isArray(userMsg.content) ? userMsg.content : [];
        const userTextParts: string[] = [];
        for (const raw of userContent) {
          const block = asRecord(raw);
          if (block.type === "text" && typeof block.text === "string") {
            userTextParts.push(block.text);
          }
          // CR-3: Capture tool_result content and back-link to the originating tool_use.
          if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
            const resultContent = Array.isArray(block.content) ? block.content : [];
            const resultTextParts: string[] = [];
            for (const rc of resultContent) {
              const rcBlock = asRecord(rc);
              if (typeof rcBlock.text === "string") resultTextParts.push(rcBlock.text);
            }
            // Also handle string content directly
            if (typeof block.content === "string") resultTextParts.push(block.content);
            const resultText = resultTextParts.join("\n");
            const tuIdx = toolUseIdIndex.get(block.tool_use_id as string);
            if (tuIdx !== undefined && toolUses[tuIdx]) {
              toolUses[tuIdx].output = truncateText(resultText);
              if (block.is_error) toolUses[tuIdx].isError = true;
            }
          }
        }
        const userTextJoined = userTextParts.join("\n");
        messages.push({
          role: "human",
          timestamp: isoTs(entry.timestamp),
          text: truncateText(userTextJoined) || null,
        });

        // CR-7: Scan user message text for <command-name> XML tags (slash commands).
        const cmdRe = /<command-name>([^<]+)<\/command-name>/g;
        let cmdMatch: RegExpExecArray | null;
        const entryIso = isoTs(entry.timestamp);
        while ((cmdMatch = cmdRe.exec(userTextJoined)) !== null) {
          if (entryIso) {
            slashCommands.push({ name: cmdMatch[1].trim(), timestamp: entryIso });
          }
        }

        // Existing: toolUseResult error tracking (top-level shorthand).
        const toolUseResult = entry.toolUseResult;
        if (toolUseResult && typeof toolUseResult === "object") {
          const tur = toolUseResult as Record<string, unknown>;
          if (tur.is_error) {
            const content =
              typeof tur.content === "string"
                ? tur.content.slice(0, 500)
                : JSON.stringify(tur.content ?? "").slice(0, 500);
            toolResultErrors.push({ content, timestamp: isoTs(entry.timestamp) });
          }
        }
      }

      if (entry.type === "assistant") {
        assistantMessageCount++;
        const iso = isoTs(ts);
        if (iso) messageTimestamps.push(iso);
        const msg = asRecord(entry.message);
        const msgModel = typeof msg.model === "string" ? msg.model : null;
        if (!model && msgModel && msgModel !== "<synthetic>") model = msgModel;
        const usage = asRecord(msg.usage);
        if (msgModel && msgModel !== "<synthetic>" && msg.usage) {
          if (tokensByModel[msgModel] === undefined) {
            tokensByModel[msgModel] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
          }
          tokensByModel[msgModel].input += num(usage.input_tokens);
          tokensByModel[msgModel].output += num(usage.output_tokens);
          tokensByModel[msgModel].cacheRead += num(usage.cache_read_input_tokens);
          tokensByModel[msgModel].cacheWrite += num(usage.cache_creation_input_tokens);

          // CR-2: Push per-turn token record for time-series.
          if (iso) {
            tokenSeries.push({
              timestamp: iso,
              model: msgModel,
              input: num(usage.input_tokens),
              output: num(usage.output_tokens),
              cacheRead: num(usage.cache_read_input_tokens),
              cacheWrite: num(usage.cache_creation_input_tokens),
            });
          }
        }
        if (msg.usage) {
          if (typeof usage.service_tier === "string") serviceTiers.add(usage.service_tier);
          if (typeof usage.speed === "string") speeds.add(usage.speed);
          if (
            typeof usage.inference_geo === "string" &&
            usage.inference_geo !== "not_available"
          ) {
            inferenceGeos.add(usage.inference_geo);
          }
        }
        const content = msg.content;
        // CR-1: Collect text blocks for the assistant NormalizedMessage.
        const assistantTextParts: string[] = [];
        if (Array.isArray(content)) {
          for (const raw of content) {
            const block = asRecord(raw);
            if (block.type === "text" && typeof block.text === "string") {
              assistantTextParts.push(block.text);
            }
            if (block.type === "tool_use" && typeof block.name === "string") {
              const toolName = block.name as string;
              const toolInput = block.input ?? null;
              const tu: NormalizedToolUse = {
                name: toolName,
                timestamp: iso || firstTimestamp,
                input: toolInput,
              };

              // CR-8: Extract skill name from Skill tool.
              if (toolName === "Skill") {
                const inp = asRecord(toolInput);
                if (typeof inp.skill === "string") tu.skillName = inp.skill;
              }

              // CR-4: Compute diffDelta for Edit and Write tool uses.
              if (toolName === "Edit") {
                const inp = asRecord(toolInput);
                const oldStr = typeof inp.old_string === "string" ? inp.old_string : null;
                const newStr = typeof inp.new_string === "string" ? inp.new_string : null;
                tu.diffDelta = computeLineDelta(oldStr, newStr);
                totalAdded += tu.diffDelta.add;
                totalRemoved += tu.diffDelta.del;
                if (typeof inp.file_path === "string") diffFiles.add(inp.file_path);
              }
              if (toolName === "Write") {
                const inp = asRecord(toolInput);
                const fileContent = typeof inp.content === "string" ? inp.content : "";
                const addLines = fileContent.split("\n").length;
                tu.diffDelta = { add: addLines, del: 0 };
                totalAdded += addLines;
                if (typeof inp.file_path === "string") diffFiles.add(inp.file_path);
              }

              // CR-3: Track tool_use_id for back-linking tool results.
              if (typeof block.id === "string") {
                toolUseIdIndex.set(block.id as string, toolUses.length);
              }
              toolUses.push(tu);
            }
            if (block.type === "thinking") {
              thinkingBlockCount++;
              // CR-1: Emit a NormalizedMessage for thinking blocks (text redacted).
              messages.push({
                role: "assistant",
                timestamp: iso,
                text: null,
                model: msgModel,
                isThinking: true,
              });
            }
          }
        }
        // CR-1: Build main assistant NormalizedMessage.
        const assistantText = assistantTextParts.join("\n");
        messages.push({
          role: "assistant",
          timestamp: iso,
          text: truncateText(assistantText) || null,
          model: msgModel,
          tokens: msg.usage
            ? {
                input: num(usage.input_tokens),
                output: num(usage.output_tokens),
                cacheRead: num(usage.cache_read_input_tokens),
                cacheWrite: num(usage.cache_creation_input_tokens),
              }
            : undefined,
        });

        // CR-7: Scan assistant text for <command-name> tags too.
        const cmdRe = /<command-name>([^<]+)<\/command-name>/g;
        let cmdMatch: RegExpExecArray | null;
        while ((cmdMatch = cmdRe.exec(assistantText)) !== null) {
          if (iso) {
            slashCommands.push({ name: cmdMatch[1].trim(), timestamp: iso });
          }
        }
      }
    }
  } catch {
    return null;
  }

  if (!firstTimestamp) return null;

  const projectName = cwd
    ? path.basename(cwd)
    : slug || `Session ${sessionId.slice(0, 8)}`;
  const sessionName = slug
    ? `${projectName} (${slug})`
    : `${projectName} - ${sessionId.slice(0, 8)}`;

  let fileModifiedAt: number | null = null;
  try {
    fileModifiedAt = statSync(filePath).mtimeMs;
  } catch {
    /* non-fatal */
  }

  // CR-4: Build aggregate diffStats (null when no edits were made).
  const diffStats: NormalizedDiffStats | null =
    diffFiles.size > 0
      ? { filesChanged: diffFiles.size, linesAdded: totalAdded, linesRemoved: totalRemoved }
      : null;

  // CR-13: Collect artifact references from tool uses.
  const artifacts = collectArtifacts(toolUses, cwd);

  return {
    sessionId,
    name: sessionName,
    cwd,
    model,
    version,
    slug,
    gitBranch,
    startedAt: firstTimestamp,
    endedAt: lastTimestamp,
    teams: [...teams],
    userMessages: userMessageCount,
    assistantMessages: assistantMessageCount,
    tokensByModel,
    messageTimestamps,
    toolUses,
    compactions,
    apiErrors,
    fileModifiedAt,
    turnDurations,
    entrypoint: entrypoint ?? "claude",
    permissionMode,
    thinkingBlockCount,
    toolResultErrors,
    usageExtras: {
      service_tiers: [...serviceTiers],
      speeds: [...speeds],
      inference_geos: [...inferenceGeos],
    },
    // CR-1: Ordered messages with text content.
    messages,
    // CR-2: Per-turn token time-series.
    tokenSeries,
    // CR-4: Aggregate diff stats.
    diffStats,
    // CR-7: Extracted slash commands.
    slashCommands,
    // CR-13: Structured artifact references.
    artifacts,
  };
}
