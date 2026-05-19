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

module.exports = { toIso, safeJson };
