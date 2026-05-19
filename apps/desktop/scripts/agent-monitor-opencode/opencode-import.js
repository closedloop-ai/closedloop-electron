/**
 * @file opencode-import.js
 * @description Bootstrap importer for OpenCode sessions. Parses each session's
 * message JSON files into the shared normalized session shape and reuses
 * importSession().
 */
const { parseSessionDir } = require("./opencode-parser");
const { listSessionDirs } = require("./opencode-home");
const { importSession } = require("../../scripts/import-history");

function importOpenCodeSession(dbModule, session) {
  const result = importSession(dbModule, session);
  try {
    dbModule.stmts.setSessionHarness.run("opencode", session.sessionId, "opencode");
  } catch { /* non-fatal */ }
  return { sessionId: session.sessionId, result };
}

async function importAllOpenCodeSessions(dbModule) {
  const dirs = listSessionDirs();
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

  const batch = [];
  for (const { sessionDir, sessionId } of dirs) {
    try {
      const session = parseSessionDir(sessionDir, sessionId);
      if (!session) { skipped++; continue; }
      batch.push(session);
    } catch { errors++; }
  }
  if (batch.length > 0) importBatch(batch);

  return { imported, skipped, errors };
}

module.exports = { importAllOpenCodeSessions, importOpenCodeSession };
