import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { readLogTail } from "../../main/diagnostics-helpers.js";
import {
  parseTokenUsage,
  type ModelTokenUsage,
} from "../../main/token-usage.js";

// ---------------------------------------------------------------------------
// JSONL error pattern scanning (DRY helper)
// ---------------------------------------------------------------------------

/**
 * Scan a claude-output.jsonl file for a result record with `is_error: true`
 * whose message matches the given pattern.
 * Returns the error text or null if not found.
 */
function detectPatternInJsonl(
  pattern: RegExp,
  claudeWorkDir: string,
): string | null {
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
          entry.type === "result" &&
          entry.is_error === true &&
          typeof entry.result === "string" &&
          pattern.test(entry.result)
        ) {
          return entry.result;
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file read error
  }
  return null;
}

// ---------------------------------------------------------------------------
// Session/context limit detection
// ---------------------------------------------------------------------------

/** Pattern that matches known session/context limit error messages. */
export const SESSION_LIMIT_PATTERN =
  /prompt is too long|exceed context limit|context limit reached|conversation too long/i;

/**
 * Scan claude-output.jsonl for a result record with `is_error: true` whose
 * message matches a known session/context limit pattern.
 * Returns the error text (e.g. "Prompt is too long") or null if not found
 * or if the error is unrelated to context limits.
 */
export function detectSessionLimitFromJsonl(
  claudeWorkDir: string,
): string | null {
  return detectPatternInJsonl(SESSION_LIMIT_PATTERN, claudeWorkDir);
}

/**
 * Check whether a log tail string contains Claude Code session/context limit
 * error patterns. The log file contains both stdout and stderr.
 */
export function isSessionLimitError(logTail: string): boolean {
  return SESSION_LIMIT_PATTERN.test(logTail);
}

// ---------------------------------------------------------------------------
// Auth challenge detection
// ---------------------------------------------------------------------------

/** Pattern that matches known auth/rate-limit/billing error messages from Claude CLI. */
export const AUTH_CHALLENGE_PATTERN =
  /authentication_error|invalid bearer token|rate_limit_error|rate limit reached|usage limit|billing_error|permission_error|overloaded_error|api overloaded|\bunauthorized\b|token.*expired/i;

/**
 * Scan claude-output.jsonl for a result record with `is_error: true` whose
 * message matches a known auth/rate-limit/billing pattern.
 * Returns the error text or null if not found.
 */
export function detectAuthChallengeFromJsonl(
  claudeWorkDir: string,
): string | null {
  return detectPatternInJsonl(AUTH_CHALLENGE_PATTERN, claudeWorkDir);
}

/**
 * Check whether a log tail string contains Claude CLI auth/rate-limit/billing
 * error patterns.
 */
export function isAuthChallengeError(logTail: string): boolean {
  return AUTH_CHALLENGE_PATTERN.test(logTail);
}

// ---------------------------------------------------------------------------
// Credential redaction
// ---------------------------------------------------------------------------

/**
 * Patterns matching common credential / secret formats.
 * Applied to log tail before including in telemetry events.
 * Each entry is a [pattern, replacement] tuple with a string replacement.
 */
export const CREDENTIAL_PATTERNS: Array<[RegExp, string]> = [
  // AWS keys: AKIA... style (20 uppercase alphanum after AKIA/ASIA/AROA prefix)
  [/\b(AKIA|ASIA|AROA)[A-Z0-9]{16}\b/g, "[REDACTED_AWS_KEY]"],
  // Generic bearer / API tokens: "Bearer <token>"
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/g, "Bearer [REDACTED]"],
  // sk- prefixed API keys (OpenAI, Anthropic, etc.)
  [/\bsk-[A-Za-z0-9\-_]{10,}/g, "[REDACTED_SK_KEY]"],
  // GitHub personal access tokens: ghp_, gho_, ghs_, ghr_
  [/\b(ghp|gho|ghs|ghr)_[A-Za-z0-9]{36,}/g, "[REDACTED_GH_TOKEN]"],
  // Generic "password=..." or "secret=..." in query strings / env
  [
    /\b(password|secret|passwd|api_key|apikey|auth_token)=[^\s&"']+/gi,
    "$1=[REDACTED]",
  ],
];

/**
 * Apply credential-pattern filters to redact common secret formats from a string.
 */
export function redactCredentials(text: string): string {
  let result = text;
  for (const [pattern, replacement] of CREDENTIAL_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Failure diagnostics
// ---------------------------------------------------------------------------

/**
 * Collect failure diagnostics for a failed loop process.
 * Returns an object suitable for inclusion in the error telemetry event.
 */
export function collectFailureDiagnostics(claudeWorkDir: string): {
  logTail: string | undefined;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
  tokensByModel: Record<string, ModelTokenUsage>;
  diagnosticsVersion: number;
} {
  const logPath = path.join(claudeWorkDir, "symphony-loop.log");
  const rawTail = readLogTail(logPath);
  const logTail = rawTail ? redactCredentials(rawTail) : undefined;
  const {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    tokensByModel,
  } = parseTokenUsage(claudeWorkDir);
  return {
    logTail,
    tokenUsage: {
      inputTokens,
      outputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
    },
    tokensByModel,
    diagnosticsVersion: 1,
  };
}
