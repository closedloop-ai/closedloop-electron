/**
 * @file parser-utils.ts
 * @description Shared utilities for the harness parsers (ported from the vendor
 * `scripts/agent-monitor-shared/parser-utils.js`, logic preserved). Kept
 * dependency-free so every parser can normalize timestamps and extract error
 * text identically.
 */
import type { NormalizedTurnDuration } from "./types.js";

/**
 * Normalize a timestamp to an ISO 8601 string. Handles numeric epoch (seconds or
 * milliseconds), strings, and nulls.
 */
export function toIso(ts: unknown): string | null {
  if (ts == null) return null;
  if (typeof ts === "number") {
    const ms = ts < 1e12 ? ts * 1000 : ts;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof ts === "string") {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : d.toISOString();
  }
  return null;
}

/** Parse a value as JSON if it's a string, return objects as-is. */
export function safeJson(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

/** Best-effort extraction of a human-readable error message from a nested value. */
export function extractErrorMessage(value: unknown, depth = 0): string | null {
  if (value == null || depth > 4) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const message = extractErrorMessage(entry, depth + 1);
      if (message) return message;
    }
    return null;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["message", "error", "details", "text", "content"]) {
      const message = extractErrorMessage(obj[key], depth + 1);
      if (message) return message;
    }
  }
  return null;
}

/** Push a turn-duration entry when both timestamps are valid and duration ≥ 0. */
export function pushTurnDuration(
  turnDurations: NormalizedTurnDuration[],
  startedAtIso: string | null,
  endedAtIso: string | null,
): void {
  if (!startedAtIso || !endedAtIso) return;
  const durationMs = new Date(endedAtIso).getTime() - new Date(startedAtIso).getTime();
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  turnDurations.push({ durationMs, timestamp: endedAtIso });
}
