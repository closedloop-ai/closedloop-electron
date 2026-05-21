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
    const { unchanged, stat } = chatCache.isUnchanged(filePath);
    if (unchanged) {
      skipped++;
      continue;
    }
    try {
      const session = parseChatSessionFile(filePath, workspacePath);
      if (!session) { chatCache.markSeenWith(filePath, stat); skipped++; continue; }
      batch.push(session);
      chatParsed.push({ path: filePath, stat });
    } catch { errors++; }
  }

  // Copilot CLI — JSONL event files
  const cliFiles = listCliEventFiles();
  for (const { filePath, sessionId } of cliFiles) {
    const { unchanged, stat } = cliCache.isUnchanged(filePath);
    if (unchanged) {
      skipped++;
      continue;
    }
    try {
      const session = await parseCliEventFile(filePath, sessionId);
      if (!session) { cliCache.markSeenWith(filePath, stat); skipped++; continue; }
      batch.push(session);
      cliParsed.push({ path: filePath, stat });
    } catch { errors++; }
  }

  if (batch.length > 0) importBatch(batch);
  for (const { path, stat } of chatParsed) chatCache.markSeenWith(path, stat);
  for (const { path, stat } of cliParsed) cliCache.markSeenWith(path, stat);
  chatCache.pruneTo(chatFiles.map((f) => f.filePath));
  cliCache.pruneTo(cliFiles.map((f) => f.filePath));

  return { imported, skipped, errors };
}

module.exports = { importAllCopilotSessions, importCopilotSession };
