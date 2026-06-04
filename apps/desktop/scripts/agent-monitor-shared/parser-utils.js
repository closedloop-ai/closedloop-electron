/**
 * @file parser-utils.js
 * @description Shared utility functions for all agent monitor parsers.
 * Extracted to avoid duplication across codex-parser, cursor-parser,
 * copilot-parser, and opencode-parser.
 */

/**
 * Normalize a timestamp value to ISO 8601 string.
 * Handles numbers (seconds or milliseconds), strings, and nulls.
 */
function toIso(ts) {
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

/**
 * Safely parse a value as JSON if it's a string, or return it as-is
 * if it's already an object.
 */
function safeJson(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

/**
 * Best-effort extraction of a human-readable error message from a nested value.
 */
function extractErrorMessage(value, depth = 0) {
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
    for (const key of ["message", "error", "details", "text", "content"]) {
      const message = extractErrorMessage(value[key], depth + 1);
      if (message) return message;
    }
  }
  return null;
}

/**
 * Push a turn-duration entry if both timestamps are valid and the duration is non-negative.
 */
function pushTurnDuration(turnDurations, startedAtIso, endedAtIso) {
  if (!startedAtIso || !endedAtIso) return;
  const durationMs = new Date(endedAtIso).getTime() - new Date(startedAtIso).getTime();
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  turnDurations.push({ durationMs, timestamp: endedAtIso });
}

module.exports = { toIso, safeJson, extractErrorMessage, pushTurnDuration };
