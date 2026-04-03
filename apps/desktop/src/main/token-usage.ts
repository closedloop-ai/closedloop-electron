import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Parse token usage from claude-output.jsonl (JSONL stream output). */
export function parseTokenUsage(claudeWorkDir: string): {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  turns: number;
  models: string[];
} {
  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    turns: 0,
    models: [] as string[],
  };
  const modelSet = new Set<string>();
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
          totals.turns += 1;
          const message = entry.message as Record<string, unknown> | undefined;
          if (typeof message?.model === "string" && message.model.length > 0) {
            modelSet.add(message.model);
          }
          const usage = message?.usage as Record<string, number> | undefined;
          if (usage) {
            totals.inputTokens += usage.input_tokens ?? 0;
            totals.outputTokens += usage.output_tokens ?? 0;
            totals.cacheCreationInputTokens += usage.cache_creation_input_tokens ?? 0;
            totals.cacheReadInputTokens += usage.cache_read_input_tokens ?? 0;
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Ignore read errors
  }
  totals.models = [...modelSet];
  return totals;
}

/** Extract apiKeySource from the init record in claude-output.jsonl. */
export function parseApiKeySource(claudeWorkDir: string): string | null {
  const outputFile = path.join(claudeWorkDir, "claude-output.jsonl");
  if (!existsSync(outputFile)) {
    return null;
  }
  try {
    const content = readFileSync(outputFile, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (
          entry.type === "system" &&
          entry.subtype === "init" &&
          typeof entry.apiKeySource === "string"
        ) {
          return entry.apiKeySource;
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Ignore read errors
  }
  return null;
}
