/**
 * Shared diagnostics helpers for loop finalization and failure handling.
 *
 * Exported from main/ so both main/loop-finalizer.ts and
 * server/operations/symphony-loop.ts can import without cross-layer violations.
 */

import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import {
    TELEMETRY_LOG_TAIL_LINES,
    TELEMETRY_LOG_TAIL_MAX_BYTES,
} from "./telemetry-protocol.js";

/** Read a text file; returns null if missing or unreadable. */
export function readTextFile(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Read up to TELEMETRY_LOG_TAIL_MAX_BYTES from the tail of a log file synchronously.
 * Exported so that edge-case tests can import it directly.
 */
export function readLogTail(logPath: string): string | null {
  if (!existsSync(logPath)) {
    return null;
  }
  try {
    const stat = statSync(logPath);
    const fileSize = stat.size;
    if (fileSize === 0) {
      return null;
    }
    const readBytes = Math.min(fileSize, TELEMETRY_LOG_TAIL_MAX_BYTES);
    const offset = fileSize - readBytes;
    const buf = Buffer.alloc(readBytes);
    const fd = openSync(logPath, "r");
    try {
      readSync(fd, buf, 0, readBytes, offset);
    } finally {
      closeSync(fd);
    }
    const raw = buf.toString("utf-8");
    // If we started mid-file, drop any partial first line to avoid garbled output
    let tail: string;
    if (offset > 0) {
      const newlineIdx = raw.indexOf("\n");
      tail = newlineIdx === -1 ? raw : raw.slice(newlineIdx + 1);
    } else {
      tail = raw;
    }
    // Cap to the last TELEMETRY_LOG_TAIL_LINES lines (AC-002: "last 50 lines / 32KB")
    const lines = tail.split("\n");
    if (lines.length > TELEMETRY_LOG_TAIL_LINES) {
      return lines.slice(-TELEMETRY_LOG_TAIL_LINES).join("\n");
    }
    return tail;
  } catch {
    return null;
  }
}

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

/** Sanitize an error message by redacting credentials and truncating to 500 chars. */
export function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/:\/\/[^@]+@/g, "://***@")
    .replace(/\b[0-9a-f]{20,}\b/gi, "[REDACTED]")
    .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, "[REDACTED]")
    .slice(0, 500);
}
