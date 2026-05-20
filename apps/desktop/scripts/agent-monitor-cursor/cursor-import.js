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

/**
 * Import a single Cursor agent transcript file.
 */
function importCursorSession(dbModule, session) {
  const result = importSession(dbModule, session);
  try {
    dbModule.stmts.setSessionHarness.run("cursor", session.sessionId, "cursor");
  } catch { /* non-fatal */ }
  const reactivated = reactivateImportedSession(dbModule, session);
  return { sessionId: session.sessionId, result, reactivated };
}

/**
 * Parse + import every discovered Cursor transcript file. Idempotent on repeat runs.
 */
async function importAllCursorSessions(dbModule) {
  const files = listAllTranscriptFiles();
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
  for (const filePath of files) {
    try {
      const session = await parseTranscriptFile(filePath);
      if (!session) { skipped++; continue; }
      batch.push(session);
    } catch { errors++; }
  }
  if (batch.length > 0) importBatch(batch);

  return { imported, skipped, errors };
}

module.exports = { importAllCursorSessions, importCursorSession };
