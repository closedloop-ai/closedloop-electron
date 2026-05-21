/**
 * @file copilot-import.js
 * @description Bootstrap importer for GitHub Copilot sessions. Parses both
 * Copilot Chat (VS Code extension JSON) and Copilot CLI (JSONL event logs)
 * into the shared normalized session shape, reusing importSession().
 */
const { parseChatSessionFile, parseCliEventFile } = require("./copilot-parser");
const { listChatSessionFiles, listCliEventFiles } = require("./copilot-home");
const { importSession } = require("../../scripts/import-history");
const { reactivateImportedSession } = require("../agent-monitor-shared/import-session-utils");
const { createCatchupCache } = require("../agent-monitor-shared/catchup-cache");

// See FEA-1316: skip chat/CLI files unchanged since last tick.
const chatCache = createCatchupCache();
const cliCache = createCatchupCache();

function importCopilotSession(dbModule, session) {
  const result = importSession(dbModule, session);
  try {
    dbModule.stmts.setSessionHarness.run("copilot", session.sessionId, "copilot");
  } catch { /* non-fatal */ }
  const reactivated = reactivateImportedSession(dbModule, session);
  return { sessionId: session.sessionId, result, reactivated };
}

async function importAllCopilotSessions(dbModule) {
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  const importBatch = dbModule.db.transaction((sessions) => {
    for (const session of sessions) {
      const { result, reactivated } = importCopilotSession(dbModule, session);
      if (result && result.skipped && !reactivated) skipped++;
      else imported++;
    }
  });

  const batch = [];
  const chatParsed = [];
  const cliParsed = [];

  // Copilot Chat (VS Code extension) — JSON files
  const chatFiles = listChatSessionFiles();
  for (const { filePath, workspacePath } of chatFiles) {
    if (chatCache.isUnchanged(filePath)) {
      skipped++;
      continue;
    }
    try {
      const session = parseChatSessionFile(filePath, workspacePath);
      if (!session) { chatCache.markSeen(filePath); skipped++; continue; }
      batch.push(session);
      chatParsed.push(filePath);
    } catch { errors++; }
  }

  // Copilot CLI — JSONL event files
  const cliFiles = listCliEventFiles();
  for (const { filePath, sessionId } of cliFiles) {
    if (cliCache.isUnchanged(filePath)) {
      skipped++;
      continue;
    }
    try {
      const session = await parseCliEventFile(filePath, sessionId);
      if (!session) { cliCache.markSeen(filePath); skipped++; continue; }
      batch.push(session);
      cliParsed.push(filePath);
    } catch { errors++; }
  }

  if (batch.length > 0) importBatch(batch);
  for (const p of chatParsed) chatCache.markSeen(p);
  for (const p of cliParsed) cliCache.markSeen(p);
  chatCache.pruneTo(chatFiles.map((f) => f.filePath));
  cliCache.pruneTo(cliFiles.map((f) => f.filePath));

  return { imported, skipped, errors };
}

module.exports = { importAllCopilotSessions, importCopilotSession };
