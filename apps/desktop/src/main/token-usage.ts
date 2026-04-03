import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Per-model token breakdown. */
export interface ModelTokenUsage {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

/** Parse token usage from claude-output.jsonl (JSONL stream output). */
export function parseTokenUsage(claudeWorkDir: string): {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  turns: number;
  models: string[];
  tokensByModel: Record<string, ModelTokenUsage>;
} {
  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    turns: 0,
    models: [] as string[],
    tokensByModel: {} as Record<string, ModelTokenUsage>,
  };
  const modelSet = new Set<string>();
  const perModel = new Map<string, ModelTokenUsage>();
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
          const model =
            typeof message?.model === "string" && message.model.length > 0
              ? message.model
              : undefined;
          if (model) {
            modelSet.add(model);
          }
          const usage = message?.usage as Record<string, number> | undefined;
          if (usage) {
            const inputTk = usage.input_tokens ?? 0;
            const outputTk = usage.output_tokens ?? 0;
            const cacheCreationTk = usage.cache_creation_input_tokens ?? 0;
            const cacheReadTk = usage.cache_read_input_tokens ?? 0;
            totals.inputTokens += inputTk;
            totals.outputTokens += outputTk;
            totals.cacheCreationInputTokens += cacheCreationTk;
            totals.cacheReadInputTokens += cacheReadTk;
            if (model) {
              const existing = perModel.get(model);
              if (existing) {
                existing.input += inputTk;
                existing.output += outputTk;
                existing.cacheCreation += cacheCreationTk;
                existing.cacheRead += cacheReadTk;
              } else {
                perModel.set(model, {
                  input: inputTk,
                  output: outputTk,
                  cacheCreation: cacheCreationTk,
                  cacheRead: cacheReadTk,
                });
              }
            }
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
  totals.tokensByModel = Object.fromEntries(perModel);
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
