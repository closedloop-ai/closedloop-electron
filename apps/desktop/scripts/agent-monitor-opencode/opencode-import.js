/**
 * @file opencode-import.js
 * @description Bootstrap importer for OpenCode sessions. Parses the canonical
 * `opencode.db` session/message store into the shared normalized session shape
 * and reuses importSession().
 */
const { loadSessionsFromDb } = require("./opencode-parser");
const { importSession } = require("../../scripts/import-history");

function importOpenCodeSession(dbModule, session) {
  const result = importSession(dbModule, session);
  try {
    dbModule.stmts.setSessionHarness.run("opencode", session.sessionId, "opencode");
  } catch { /* non-fatal */ }
  return { sessionId: session.sessionId, result };
}

async function importAllOpenCodeSessions(dbModule) {
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  const importBatch = dbModule.db.transaction((sessions) => {
    for (const session of sessions) {
      const { result } = importOpenCodeSession(dbModule, session);
      if (result && result.skipped) skipped++;
      else imported++;
    }
  });

  try {
    const sessions = loadSessionsFromDb();
    if (sessions.length > 0) {
      importBatch(sessions);
    }
  } catch {
    errors++;
  }

  return { imported, skipped, errors };
}

module.exports = { importAllOpenCodeSessions, importOpenCodeSession };
