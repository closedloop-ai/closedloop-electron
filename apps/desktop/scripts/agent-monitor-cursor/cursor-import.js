/**
 * @file cursor-import.js
 * @description Bootstrap importer for Cursor agent sessions. Parses each
 * Cursor agent transcript JSONL into the shared normalized session shape and
 * reuses the existing importSession() so Cursor sessions land in the same
 * sessions/agents/events/token_usage rows. The only Cursor-specific step is
 * stamping `harness='cursor'` on the row afterwards.
 */
const { parseTranscriptFile } = require("./cursor-parser");
const { listAllTranscriptFiles } = require("./cursor-home");
const { importSession } = require("../../scripts/import-history");
const { reactivateImportedSession } = require("../agent-monitor-shared/import-session-utils");
const { createCatchupCache } = require("../agent-monitor-shared/catchup-cache");
const { ingestCachePath } = require("../agent-monitor-shared/ingest-paths");
const { stampSessionBillingMode } = require("../agent-monitor-shared/billing-stamp");

// Skip transcript files unchanged since the last tick to keep the 5 s catchup
// poll cheap (FEA-1316); the persisted backing file additionally lets a fresh
// process skip unchanged files on the cold-start boot import (FEA-1334).
const catchupCache = createCatchupCache({ persistPath: ingestCachePath("cursor") });

/**
 * Import a single Cursor agent transcript file.
 */
function importCursorSession(dbModule, session) {
  const result = importSession(dbModule, session);
  try {
    dbModule.stmts.setSessionHarness.run("cursor", session.sessionId, "cursor");
  } catch { /* non-fatal */ }
  // FEA-1434: stamp the billing mode (idempotent + best-effort internally).
  stampSessionBillingMode(dbModule.stmts, "cursor", session.sessionId);
  const reactivated = reactivateImportedSession(dbModule, session);
  return { sessionId: session.sessionId, result, reactivated };
}

/**
 * Parse + import every discovered Cursor transcript file. Idempotent on repeat runs.
 *
 * @param {any} dbModule
 * @param {{ signal?: AbortSignal, onBegin?: (total: number) => void,
 *           onProgress?: () => void }} [opts] - ingest-orchestrator progress
 *   hooks (FEA-1334). The watcher catchup tick calls this with no opts.
 */
async function importAllCursorSessions(dbModule, opts = {}) {
  const onBegin = typeof opts.onBegin === "function" ? opts.onBegin : null;
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  const signal = opts.signal || null;
  const files = listAllTranscriptFiles();
  if (onBegin) onBegin(files.length);
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  const importBatch = dbModule.db.transaction((sessions) => {
    for (const session of sessions) {
      const { result, reactivated } = importCursorSession(dbModule, session);
      if (result && result.skipped && !reactivated) skipped++;
      else imported++;
    }
  });

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
      const session = await parseTranscriptFile(filePath);
      if (!session) {
        catchupCache.markSeenWith(filePath, stat);
        skipped++;
        continue;
      }
      batch.push(session);
      parsedEntries.push({ path: filePath, stat });
    } catch { errors++; }
  }
  if (batch.length > 0) importBatch(batch);
  for (const { path, stat } of parsedEntries) catchupCache.markSeenWith(path, stat);
  catchupCache.pruneTo(files);
  catchupCache.flush();

  return { imported, skipped, errors };
}

module.exports = { importAllCursorSessions, importCursorSession };
