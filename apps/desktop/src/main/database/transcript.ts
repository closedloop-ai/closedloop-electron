import { readFileSync } from "node:fs";

/**
 * Per-model token totals extracted from a single Claude/Codex hook transcript
 * file. Values are the CUMULATIVE sum across every usage-bearing line in the
 * file as it exists right now — when a transcript is compaction-rewritten the
 * file shrinks and these totals drop, which the token-usage store reconciles
 * via its `raw_*` accumulators.
 *
 * This parses the absolute `transcript_path` supplied on a hook payload. It is
 * intentionally separate from `src/main/token-usage.ts` `parseTokenUsage`,
 * which resolves a symphony-loop run output directory (`claude-output*.jsonl`)
 * rather than an arbitrary hook transcript path.
 */
export interface TranscriptTokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface TranscriptExtract {
  /** model id -> summed token counts across the transcript. */
  tokensByModel: Map<string, TranscriptTokenCounts>;
  /** Most recent non-synthetic model id seen, for session model sync. */
  latestModel: string | null;
  /** Count of compaction-summary lines seen (drives compaction analytics later). */
  compactionCount: number;
}

interface UsageRecord {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

function asUsage(value: unknown): UsageRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as UsageRecord;
}

/**
 * Read and parse a transcript JSONL file, accumulating per-model token usage.
 * Returns `null` when the file is missing/unreadable so callers can no-op.
 * Malformed lines are skipped. A model id of `<synthetic>` (Claude's
 * placeholder for non-API turns) is ignored.
 */
export function extractTranscriptTokens(
  transcriptPath: string,
): TranscriptExtract | null {
  let content: string;
  try {
    content = readFileSync(transcriptPath, "utf-8");
  } catch {
    return null;
  }

  const tokensByModel = new Map<string, TranscriptTokenCounts>();
  let latestModel: string | null = null;
  let compactionCount = 0;

  for (const line of content.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (entry.isCompactSummary === true) {
      compactionCount += 1;
    }

    // The usage block lives on `message` for assistant turns; some shapes carry
    // it on the entry directly. Mirror the vendor extractor's `message || entry`.
    const message = (entry.message as Record<string, unknown> | undefined) ?? entry;
    const model =
      typeof message.model === "string" && message.model.length > 0
        ? message.model
        : undefined;
    const usage = asUsage(message.usage);
    if (!model || model === "<synthetic>" || !usage) {
      continue;
    }

    latestModel = model;
    const existing = tokensByModel.get(model);
    const input = usage.input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    if (existing) {
      existing.input += input;
      existing.output += output;
      existing.cacheRead += cacheRead;
      existing.cacheWrite += cacheWrite;
    } else {
      tokensByModel.set(model, { input, output, cacheRead, cacheWrite });
    }
  }

  return { tokensByModel, latestModel, compactionCount };
}
