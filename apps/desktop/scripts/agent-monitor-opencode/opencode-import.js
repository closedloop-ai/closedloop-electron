/**
 * @file opencode-import.js
 * @description Bootstrap importer for OpenCode sessions. Parses the canonical
 * `opencode.db` session/message store into the shared normalized session shape
 * and reuses importSession().
 */
const fs = require("fs");
const path = require("path");
const { loadSessionsFromDb } = require("./opencode-parser");
const { getOpenCodeHome, getOpenCodeDbWatchFiles } = require("./opencode-home");
const { importSession } = require("../../scripts/import-history");
const { reactivateImportedSession } = require("../agent-monitor-shared/import-session-utils");

// See FEA-1316: skip the full DB load when neither opencode.db nor its
// WAL/SHM siblings have changed since the last catchup tick.
let lastDbFingerprint = null;

function fingerprintDbFiles() {
  const home = getOpenCodeHome();
  const parts = [];
  for (const name of getOpenCodeDbWatchFiles()) {
    try {
      const stat = fs.statSync(path.join(home, name));
      parts.push(`${name}:${stat.mtimeMs}:${stat.size}`);
    } catch {
      parts.push(`${name}:missing`);
    }
  }
  return parts.join("|");
}

function importOpenCodeSession(dbModule, session) {
  const result = importSession(dbModule, session);
  try {
    dbModule.stmts.setSessionHarness.run("opencode", session.sessionId, "opencode");
  } catch { /* non-fatal */ }
  const reactivated = reactivateImportedSession(dbModule, session);
  return { sessionId: session.sessionId, result, reactivated };
}

async function importAllOpenCodeSessions(dbModule) {
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  const importBatch = dbModule.db.transaction((sessions) => {
    for (const session of sessions) {
      const { result, reactivated } = importOpenCodeSession(dbModule, session);
      if (result && result.skipped && !reactivated) skipped++;
      else imported++;
    }
  });

  const fingerprint = fingerprintDbFiles();
  if (fingerprint === lastDbFingerprint) {
    return { imported, skipped, errors };
  }

  try {
    const sessions = loadSessionsFromDb();
    if (sessions.length > 0) {
      importBatch(sessions);
    }
    lastDbFingerprint = fingerprint;
  } catch {
    errors++;
  }

  return { imported, skipped, errors };
}

module.exports = { importAllOpenCodeSessions, importOpenCodeSession };
