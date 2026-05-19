/**
 * @file copilot-import.js
 * @description Bootstrap importer for GitHub Copilot sessions. Parses both
 * Copilot Chat (VS Code extension JSON) and Copilot CLI (JSONL event logs)
 * into the shared normalized session shape, reusing importSession().
 */
const { parseChatSessionFile, parseCliEventFile } = require("./copilot-parser");
const { listChatSessionFiles, listCliEventFiles } = require("./copilot-home");
const { importSession } = require("../../scripts/import-history");

function importCopilotSession(dbModule, session) {
  const result = importSession(dbModule, session);
  try {
    dbModule.stmts.setSessionHarness.run("copilot", session.sessionId, "copilot");
  } catch { /* non-fatal */ }
  return { sessionId: session.sessionId, result };
}

async function importAllCopilotSessions(dbModule) {
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  const importBatch = dbModule.db.transaction((sessions) => {
    for (const session of sessions) {
      const { result } = importCopilotSession(dbModule, session);
      if (result && result.skipped) skipped++;
      else imported++;
    }
  });

  const batch = [];

  // Copilot Chat (VS Code extension) — JSON files
  for (const { filePath, workspacePath } of listChatSessionFiles()) {
    try {
      const session = parseChatSessionFile(filePath, workspacePath);
      if (!session) { skipped++; continue; }
      batch.push(session);
    } catch { errors++; }
  }

  // Copilot CLI — JSONL event files
  for (const { filePath, sessionId } of listCliEventFiles()) {
    try {
      const session = await parseCliEventFile(filePath, sessionId);
      if (!session) { skipped++; continue; }
      batch.push(session);
    } catch { errors++; }
  }

  if (batch.length > 0) importBatch(batch);

  return { imported, skipped, errors };
}

module.exports = { importAllCopilotSessions, importCopilotSession };
