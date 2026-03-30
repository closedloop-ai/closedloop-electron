/**
 * Token usage parsing from claude-output.jsonl.
 *
 * Exported from main/ so both main/loop-finalizer.ts and
 * server/operations/symphony-loop.ts can import without cross-layer violations.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Parse token usage from claude-output.jsonl (JSONL stream output). */
export function parseTokenUsage(claudeWorkDir: string): {
  inputTokens: number;
  outputTokens: number;
} {
  const totals = { inputTokens: 0, outputTokens: 0 };
  const outputFile = path.join(claudeWorkDir, "claude-output.jsonl");
  if (!existsSync(outputFile)) {
    return totals;
  }
  try {
    const content = readFileSync(outputFile, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.type === "assistant") {
          const message = entry.message as Record<string, unknown> | undefined;
          const usage = message?.usage as Record<string, number> | undefined;
          if (usage) {
            totals.inputTokens +=
              (usage.input_tokens ?? 0) +
              (usage.cache_creation_input_tokens ?? 0) +
              (usage.cache_read_input_tokens ?? 0);
            totals.outputTokens += usage.output_tokens ?? 0;
          }
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file read error
  }
  return totals;
}
