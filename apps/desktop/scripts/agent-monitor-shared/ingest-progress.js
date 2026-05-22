/**
 * @file ingest-progress.js
 * @description Process-wide singleton that tracks cold-start ingest progress
 * across all non-Claude harnesses (FEA-1334). The ingest orchestrator writes
 * into it as it discovers and parses files; `GET /api/import/progress` reads
 * a snapshot from it so the desktop renderer can show a floating progress
 * card while the backlog is processed.
 *
 * It is deliberately a plain in-memory singleton: progress is ephemeral
 * per-process state, there is exactly one orchestrator run per sidecar boot,
 * and a fresh process should start from a clean slate.
 */

const STALL_TIMEOUT_MS = 15_000;

function emptyState() {
  return {
    running: false,
    startedAt: null,
    updatedAt: null,
    finishedAt: null,
    total: 0,
    parsed: 0,
    imported: 0,
    /** @type {Record<string, { total: number, parsed: number, imported: number, complete: boolean }>} */
    byHarness: {},
  };
}

let state = emptyState();

function recomputeTotals() {
  let total = 0;
  let parsed = 0;
  let imported = 0;
  for (const h of Object.values(state.byHarness)) {
    total += h.total;
    parsed += h.parsed;
    imported += h.imported;
  }
  state.total = total;
  state.parsed = parsed;
  state.imported = imported;
}

/** Reset all progress and mark a fresh run as running. */
function beginRun() {
  state = emptyState();
  state.running = true;
  state.startedAt = Date.now();
  state.updatedAt = state.startedAt;
}

/**
 * Register a harness with the number of sources (files) discovered for it.
 * Called once per harness, before its parse loop starts.
 */
function beginHarness(harness, total) {
  state.byHarness[harness] = {
    total: Number.isFinite(total) && total > 0 ? total : 0,
    parsed: 0,
    imported: 0,
    complete: false,
  };
  recomputeTotals();
  state.updatedAt = Date.now();
}

/**
 * Advance a harness's counters. `parsed` is the number of sources handled
 * since the last tick (typically 1); `imported` is how many of those were
 * newly written to the DB.
 */
function tick(harness, { parsed = 0, imported = 0 } = {}) {
  const h = state.byHarness[harness];
  if (!h) return;
  h.parsed += parsed;
  h.imported += imported;
  recomputeTotals();
  state.updatedAt = Date.now();
}

/** Mark a harness done; clamp parsed up to total so the bar reads 100%. */
function completeHarness(harness) {
  const h = state.byHarness[harness];
  if (!h) return;
  h.complete = true;
  if (h.parsed < h.total) h.parsed = h.total;
  recomputeTotals();
  state.updatedAt = Date.now();
}

/** Mark the whole run finished. */
function endRun() {
  state.running = false;
  state.finishedAt = Date.now();
  state.updatedAt = state.finishedAt;
}

/**
 * Return a defensive copy of the current progress. `running` is additionally
 * forced false if the orchestrator appears to have stalled (no update within
 * STALL_TIMEOUT_MS) so a crashed run never leaves the UI spinning forever.
 */
function snapshot() {
  const stalled =
    state.running &&
    state.updatedAt != null &&
    Date.now() - state.updatedAt > STALL_TIMEOUT_MS;
  const byHarness = {};
  for (const [key, h] of Object.entries(state.byHarness)) {
    byHarness[key] = { ...h };
  }
  return {
    running: state.running && !stalled,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    finishedAt: state.finishedAt,
    total: state.total,
    parsed: state.parsed,
    imported: state.imported,
    byHarness,
  };
}

/** Test-only: drop all state back to the initial empty snapshot. */
function reset() {
  state = emptyState();
}

module.exports = {
  beginRun,
  beginHarness,
  tick,
  completeHarness,
  endRun,
  snapshot,
  reset,
  STALL_TIMEOUT_MS,
};
