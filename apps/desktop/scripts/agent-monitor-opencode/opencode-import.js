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
const { ingestStateDir } = require("../agent-monitor-shared/ingest-paths");
const { stampSessionBillingMode } = require("../agent-monitor-shared/billing-stamp");

// See FEA-1316: skip the full DB load when neither opencode.db nor its
// WAL/SHM siblings have changed since the last catchup tick. FEA-1334
// persists that fingerprint to disk so a fresh process also skips the load
// on the cold-start boot import when the DB is untouched.
function fingerprintFilePath() {
  return path.join(ingestStateDir(), "ingest-opencode-fingerprint.txt");
}

function loadPersistedFingerprint() {
  try {
    return fs.readFileSync(fingerprintFilePath(), "utf8");
  } catch {
    return null;
  }
}

function persistFingerprint(fingerprint) {
  try {
    fs.mkdirSync(ingestStateDir(), { recursive: true });
    fs.writeFileSync(fingerprintFilePath(), fingerprint);
  } catch {
    /* best-effort — an unwritable state dir just costs one extra load */
  }
}

let lastDbFingerprint = loadPersistedFingerprint();

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
  // FEA-1434: stamp the billing mode (idempotent + best-effort internally).
  stampSessionBillingMode(dbModule.stmts, "opencode", session.sessionId);
  const reactivated = reactivateImportedSession(dbModule, session);
  return { sessionId: session.sessionId, result, reactivated };
}

/**
 * Parse + import every OpenCode session from opencode.db. Idempotent.
 *
 * @param {any} dbModule
 * @param {{ signal?: AbortSignal, onBegin?: (total: number) => void,
 *           onProgress?: () => void }} [opts] - ingest-orchestrator progress
 *   hooks (FEA-1334). The watcher catchup tick calls this with no opts.
 *   OpenCode is a single DB read, so it counts as one unit of progress.
 */
async function importAllOpenCodeSessions(dbModule, opts = {}) {
  const onBegin = typeof opts.onBegin === "function" ? opts.onBegin : null;
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  // OpenCode is a single batch DB load rather than a per-file walk.
  if (onBegin) onBegin(1);

  const importBatch = dbModule.db.transaction((sessions) => {
    for (const session of sessions) {
      const { result, reactivated } = importOpenCodeSession(dbModule, session);
      if (result && result.skipped && !reactivated) skipped++;
      else imported++;
    }
  });

  const fingerprint = fingerprintDbFiles();
  if (fingerprint === lastDbFingerprint) {
    if (onProgress) onProgress();
    return { imported, skipped, errors };
  }

  try {
    const sessions = loadSessionsFromDb();
    if (sessions.length > 0) {
      importBatch(sessions);
    }
    lastDbFingerprint = fingerprint;
    persistFingerprint(fingerprint);
  } catch {
    errors++;
  }

  if (onProgress) onProgress();
  return { imported, skipped, errors };
}

module.exports = { importAllOpenCodeSessions, importOpenCodeSession };
