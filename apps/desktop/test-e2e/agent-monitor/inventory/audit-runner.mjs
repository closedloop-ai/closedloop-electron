// Shared audit machinery used by the API-audit (node:test) and UI-audit
// (Playwright) specs, plus the standalone report generator.
//
// One implementation, three call sites — so a change to comparison logic
// can't silently diverge across test layers.

import { DatabaseSync } from "node:sqlite";

import { oracles } from "./oracles.mjs";
import { applyFormatter } from "./formatters.mjs";

/**
 * Resolve a dotted JSON path against an object. Supports array indexing.
 * Returns undefined if any segment is missing.
 *
 *   getField({ a: { b: [1, { c: 2 }] } }, "a.b.1.c") → 2
 */
export function getField(obj, path) {
  if (path == null || path === "") return obj;
  let cur = obj;
  for (const seg of String(path).split(".")) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * Compute the oracle expected value for a manifest row.
 * Returns { expected, expectedFormatted } where expectedFormatted is the
 * string the UI is supposed to render (formatter applied).
 *
 * @param {object} row
 * @param {DatabaseSync} db
 * @param {{ tzOffsetMinutes?: number, now?: Date }} [opts]
 */
export function computeOracle(row, db, opts = {}) {
  const fn = oracles[row.oracle];
  if (!fn) {
    throw new Error(
      `Oracle "${row.oracle}" referenced by manifest row "${row.id}" is not ` +
        `exported from inventory/oracles.mjs.`,
    );
  }
  const expected = fn(db, opts);
  const expectedFormatted = row.formatter
    ? applyFormatter(row.formatter, expected)
    : undefined;
  return { expected, expectedFormatted };
}

/**
 * Open the same fixture DB the sidecar is reading and return a handle.
 * Read-only mode is forbidden by DatabaseSync's surface, but we only call
 * COUNT/SUM here so concurrent writes from the sidecar don't matter — SQLite
 * file-locking handles it.
 */
export function openDb(dbPath) {
  return new DatabaseSync(dbPath);
}

/**
 * Compare a rendered (or API-returned) value against the oracle. Returns
 * { ok: true } if they agree, or { ok: false, ... } with diagnostic detail.
 *
 * Comparison strategy:
 *   - For numeric API audits: compare raw numeric value, with optional epsilon.
 *   - For UI audits: compare the formatted string from the oracle against the
 *     rendered text. The rendered text may include surrounding whitespace
 *     or sibling text; the caller is responsible for slicing first.
 */
export function compareNumeric(actual, expected, { eps = 0.005 } = {}) {
  if (typeof actual !== "number" || !Number.isFinite(actual)) {
    return {
      ok: false,
      reason: `actual is not a finite number: ${JSON.stringify(actual)}`,
      actual,
      expected,
    };
  }
  if (Math.abs(actual - expected) <= eps) return { ok: true, actual, expected };
  return {
    ok: false,
    reason: `numeric mismatch (|Δ| = ${Math.abs(actual - expected)})`,
    actual,
    expected,
  };
}

export function compareString(actual, expected) {
  const a = String(actual ?? "").trim();
  const e = String(expected ?? "").trim();
  if (a === e) return { ok: true, actual: a, expected: e };
  return {
    ok: false,
    reason: `string mismatch`,
    actual: a,
    expected: e,
  };
}

/**
 * Classify a disagreement by which layer is most likely wrong.
 * Used by the report generator to populate triage hints.
 *
 *   - If API value disagrees with oracle: API↔DB layer.
 *   - If API matches oracle but UI doesn't: UI↔API layer (rendering / formatter).
 *   - If both disagree the same way: parser↔DB or oracle (DB has wrong data).
 *
 * @param {{ apiOk: boolean, uiOk: boolean }} signals
 */
export function classifyDrift({ apiOk, uiOk }) {
  if (apiOk && uiOk) return "agree";
  if (!apiOk && !uiOk) return "parser-or-oracle";
  if (!apiOk && uiOk) return "api-vs-db";
  if (apiOk && !uiOk) return "ui-vs-api";
  return "unknown";
}
