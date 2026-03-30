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

/** Sanitize an error message by redacting credentials and truncating to 500 chars. */
export function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/:\/\/[^@]+@/g, "://***@")
    .replace(/\b[0-9a-f]{20,}\b/gi, "[REDACTED]")
    .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, "[REDACTED]")
    .slice(0, 500);
}
