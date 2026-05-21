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

// Per-process cache of (path, mtime, size) for rollout files already parsed
// and imported. The catchup poll runs every 5 s and would otherwise re-parse
// every file on every tick — see FEA-1316.
const catchupCache = createCatchupCache();

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
 * Returns { imported, skipped, errors }.
 */
async function importAllCodexSessions(dbModule) {
  const files = listAllRolloutFiles();
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
  const parsedPaths = [];
  for (const filePath of files) {
    if (catchupCache.isUnchanged(filePath)) {
      skipped++;
      continue;
    }
    try {
      const session = await parseRolloutFile(filePath);
      if (!session) {
        // Cache even null-parsed files so we don't re-read them every tick.
        catchupCache.markSeen(filePath);
        skipped++;
        continue;
      }
      batch.push(session);
      parsedPaths.push(filePath);
    } catch {
      errors++;
    }
  }
  if (batch.length > 0) importBatch(batch);
  for (const p of parsedPaths) catchupCache.markSeen(p);
  catchupCache.pruneTo(files);

  return { imported, skipped, errors };
}

module.exports = { importAllCodexSessions, importCodexSession };
