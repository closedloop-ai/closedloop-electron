/**
 * @file codex-import.js
 * @description Bootstrap importer for OpenAI Codex CLI sessions — the Codex
 * analogue of scripts/import-history.js `importAllSessions`. It parses each
 * Codex rollout JSONL into the shared normalized session shape and then reuses
 * the existing, battle-tested `importSession()` so Codex sessions land in the
 * same sessions/agents/events/token_usage rows and render through the
 * unchanged dashboard UI. The only Codex-specific step is stamping
 * `harness='codex'` on the row afterwards (the shared insert defaults to
 * 'claude'); `setSessionHarness` is idempotent.
 *
 * Part of CLOSEDLOOP VENDOR Addition #6 (see vendor/agent-monitor/VENDOR.md).
 */
const { parseRolloutFile } = require("./codex-parser");
const { listAllRolloutFiles } = require("./codex-home");
const { importSession } = require("../../scripts/import-history");
const { reactivateImportedSession } = require("../agent-monitor-shared/import-session-utils");
const { createCatchupCache } = require("../agent-monitor-shared/catchup-cache");
const { ingestCachePath } = require("../agent-monitor-shared/ingest-paths");

// Cache of (path, mtime, size) for rollout files already parsed and imported.
// The catchup poll runs every 5 s and would otherwise re-parse every file on
// every tick (FEA-1316); the persisted backing file additionally lets a fresh
// process skip unchanged files on the cold-start boot import (FEA-1334).
const catchupCache = createCatchupCache({ persistPath: ingestCachePath("codex") });

/**
 * Import (or idempotently backfill) a single Codex rollout file.
 * Returns { sessionId, result } where result is importSession's return value,
 * or { skipped: true } when the file has no usable content.
 */
function importCodexSession(dbModule, session) {
  const result = importSession(dbModule, session);
  // Stamp the harness regardless of skipped/backfilled — cheap, idempotent,
  // and self-heals rows imported before the `harness` column existed.
  try {
    dbModule.stmts.setSessionHarness.run("codex", session.sessionId, "codex");
  } catch {
    /* non-fatal — column/stmt guaranteed by db.js Patch #4 */
  }
  const reactivated = reactivateImportedSession(dbModule, session);
  return { sessionId: session.sessionId, result, reactivated };
}

/**
 * Parse + import every discovered Codex rollout file. Designed to be cheap on
 * repeat runs: importSession skips already-imported sessions (or backfills
 * only genuinely-new events via its per-event-type high-water-mark).
 *
 * @param {any} dbModule
 * @param {{ signal?: AbortSignal, onBegin?: (total: number) => void,
 *           onProgress?: () => void }} [opts] - ingest-orchestrator progress
 *   hooks (FEA-1334). The watcher catchup tick calls this with no opts.
 * Returns { imported, skipped, errors }.
 */
async function importAllCodexSessions(dbModule, opts = {}) {
  const onBegin = typeof opts.onBegin === "function" ? opts.onBegin : null;
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  const signal = opts.signal || null;
  const files = listAllRolloutFiles();
  if (onBegin) onBegin(files.length);
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  const importBatch = dbModule.db.transaction((sessions) => {
    for (const session of sessions) {
      const { result, reactivated } = importCodexSession(dbModule, session);
      if (result && result.skipped && !reactivated) skipped++;
      else imported++;
    }
  });

  // Parse outside the transaction (async IO); apply inside one (sync, fast).
  // Skip files whose (mtime, size) is unchanged since the last successful
  // parse — that is the common case for the 5 s catchup poll. Without this
  // gate every tick re-parses every historical rollout file (FEA-1316).
  const batch = [];
  const parsedEntries = [];
  for (const filePath of files) {
    if (signal && signal.aborted) break;
    if (onProgress) onProgress();
    const { unchanged, stat } = catchupCache.isUnchanged(filePath);
    if (unchanged) {
      skipped++;
      continue;
    }
    try {
      const session = await parseRolloutFile(filePath);
      if (!session) {
        // Cache even null-parsed files so we don't re-read them every tick.
        catchupCache.markSeenWith(filePath, stat);
        skipped++;
        continue;
      }
      batch.push(session);
      parsedEntries.push({ path: filePath, stat });
    } catch {
      errors++;
    }
  }
  if (batch.length > 0) importBatch(batch);
  for (const { path, stat } of parsedEntries) catchupCache.markSeenWith(path, stat);
  catchupCache.pruneTo(files);
  catchupCache.flush();

  return { imported, skipped, errors };
}

module.exports = { importAllCodexSessions, importCodexSession };
