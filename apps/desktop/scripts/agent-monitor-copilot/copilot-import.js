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
const { ingestCachePath } = require("../agent-monitor-shared/ingest-paths");

// Skip chat/CLI files unchanged since the last tick (FEA-1316); the persisted
// backing files additionally let a fresh process skip unchanged files on the
// cold-start boot import (FEA-1334).
const chatCache = createCatchupCache({ persistPath: ingestCachePath("copilot-chat") });
const cliCache = createCatchupCache({ persistPath: ingestCachePath("copilot-cli") });

function importCopilotSession(dbModule, session) {
  const result = importSession(dbModule, session);
  try {
    dbModule.stmts.setSessionHarness.run("copilot", session.sessionId, "copilot");
  } catch { /* non-fatal */ }
  // FEA-1434: GitHub Copilot is always covered by a per-seat subscription —
  // no per-token API surface exists. Stamp the mode so the UI ledger split
  // counts these as subscription-covered.
  //
  // FEA-1434 (round-3 review follow-up): pass the protected-mode exclusion
  // list ('api', 'claude_max', 'claude_pro') so the importer can never
  // demote a row that the desktop main process has deliberately marked.
  // See the prepared-statement comment in `build-agent-monitor.mjs`.
  try {
    dbModule.stmts.setSessionBillingMode.run(
      "copilot_seat",
      session.sessionId,
      "copilot_seat",
      "api",
      "claude_max",
      "claude_pro",
    );
  } catch { /* non-fatal */ }
  const reactivated = reactivateImportedSession(dbModule, session);
  return { sessionId: session.sessionId, result, reactivated };
}

/**
 * Parse + import every discovered Copilot Chat + CLI session. Idempotent.
 *
 * @param {any} dbModule
 * @param {{ signal?: AbortSignal, onBegin?: (total: number) => void,
 *           onProgress?: () => void }} [opts] - ingest-orchestrator progress
 *   hooks (FEA-1334). The watcher catchup tick calls this with no opts.
 */
async function importAllCopilotSessions(dbModule, opts = {}) {
  const onBegin = typeof opts.onBegin === "function" ? opts.onBegin : null;
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  const signal = opts.signal || null;
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

  // Discover both source sets up front so the orchestrator gets one honest
  // total covering Chat (JSON) + CLI (JSONL) before parsing begins.
  const chatFiles = listChatSessionFiles();
  const cliFiles = listCliEventFiles();
  if (onBegin) onBegin(chatFiles.length + cliFiles.length);

  // Copilot Chat (VS Code extension) — JSON files
  for (const { filePath, workspacePath } of chatFiles) {
    if (signal && signal.aborted) break;
    if (onProgress) onProgress();
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
  for (const { filePath, sessionId } of cliFiles) {
    if (signal && signal.aborted) break;
    if (onProgress) onProgress();
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
  chatCache.flush();
  cliCache.flush();

  return { imported, skipped, errors };
}

module.exports = { importAllCopilotSessions, importCopilotSession };
