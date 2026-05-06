import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Per-model token breakdown. */
export interface ModelTokenUsage {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

const CLAUDE_OUTPUT_FILE = "claude-output.jsonl";
const CLAUDE_OUTPUT_SIDECAR_FILE = "claude-output.name.txt";
const CLAUDE_OUTPUT_RENAMED_PREFIX = "claude-output-";
const CLAUDE_OUTPUT_RENAMED_SUFFIX = ".jsonl";

/**
 * Resolve the Claude JSONL output for a run.
 *
 * Resolution order:
 * 1. Sidecar-selected renamed output.
 * 2. Newest renamed output when the sidecar is absent/unreadable/stale.
 * 3. Legacy fixed-path `claude-output.jsonl`.
 *
 * An empty sidecar is a start-of-run sentinel, so it intentionally skips the
 * renamed-file scan and only falls through to the legacy fixed path.
 */
export function resolveClaudeOutputPath(claudeWorkDir: string): string | null {
  const legacyPath = path.join(claudeWorkDir, CLAUDE_OUTPUT_FILE);
  const sidecarPath = path.join(claudeWorkDir, CLAUDE_OUTPUT_SIDECAR_FILE);

  if (existsSync(sidecarPath)) {
    try {
      const sidecarValue = readFileSync(sidecarPath, "utf-8").trim();
      if (sidecarValue.length === 0) {
        return existsSync(legacyPath) ? legacyPath : null;
      }
      const resolvedSidecarPath = resolveSidecarOutputPath(
        claudeWorkDir,
        sidecarValue,
      );
      if (resolvedSidecarPath !== null) {
        return resolvedSidecarPath;
      }
    } catch {
      // Fall through to renamed-file scan when the sidecar cannot be read.
    }
  }

  const newestRenamedPath = resolveNewestRenamedOutputPath(claudeWorkDir);
  if (newestRenamedPath !== null) {
    return newestRenamedPath;
  }

  return existsSync(legacyPath) ? legacyPath : null;
}

function resolveSidecarOutputPath(
  claudeWorkDir: string,
  sidecarValue: string,
): string | null {
  if (path.basename(sidecarValue) !== sidecarValue) {
    return null;
  }
  if (
    !sidecarValue.startsWith(CLAUDE_OUTPUT_RENAMED_PREFIX) ||
    !sidecarValue.endsWith(CLAUDE_OUTPUT_RENAMED_SUFFIX)
  ) {
    return null;
  }
  const candidate = path.join(claudeWorkDir, sidecarValue);
  if (!existsSync(candidate)) {
    return null;
  }
  try {
    return statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function resolveNewestRenamedOutputPath(claudeWorkDir: string): string | null {
  let newest: { path: string; mtimeMs: number; name: string } | null = null;
  let entries: string[];
  try {
    entries = readdirSync(claudeWorkDir);
  } catch {
    return null;
  }

  for (const name of entries) {
    if (
      !name.startsWith(CLAUDE_OUTPUT_RENAMED_PREFIX) ||
      !name.endsWith(CLAUDE_OUTPUT_RENAMED_SUFFIX)
    ) {
      continue;
    }
    const candidate = path.join(claudeWorkDir, name);
    try {
      const stats = statSync(candidate);
      if (!stats.isFile()) {
        continue;
      }
      if (
        newest === null ||
        stats.mtimeMs > newest.mtimeMs ||
        (stats.mtimeMs === newest.mtimeMs && name > newest.name)
      ) {
        newest = { path: candidate, mtimeMs: stats.mtimeMs, name };
      }
    } catch {
      // Ignore entries that disappear or cannot be statted.
    }
  }
  return newest?.path ?? null;
}

/** Parse token usage from Claude JSONL stream output. */
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
  const outputFile = resolveClaudeOutputPath(claudeWorkDir);
  if (outputFile === null) {
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

/** Extract apiKeySource from the init record in Claude JSONL stream output. */
export function parseApiKeySource(claudeWorkDir: string): string | null {
  const outputFile = resolveClaudeOutputPath(claudeWorkDir);
  if (outputFile === null) {
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
