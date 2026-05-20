/**
 * @file cursor-watcher.js
 * @description Live file watcher for Cursor agent transcripts. Watches
 * `~/.cursor/projects/` for new/changed JSONL transcript files and
 * re-imports them into the dashboard on change. Best-effort and non-fatal.
 */
const fs = require("fs");
const path = require("path");
const { getCursorProjectsDir } = require("./cursor-home");
const { parseTranscriptFile } = require("./cursor-parser");
const { broadcastHarnessRows } = require("../agent-monitor-shared/harness-watcher-utils");

const DEBOUNCE_MS = 600;
const RETRY_MS = 4000;
const CATCHUP_POLL_MS = 5000;

let started = false;
let timer = null;
let retryTimer = null;
let catchupTimer = null;
let pending = new Set();
const watchers = [];

function processPending(broadcast) {
  const files = Array.from(pending);
  pending = new Set();
  if (files.length === 0) return;

  let dbModule;
  let importCursorSession;
  try {
    dbModule = require("../db");
    ({ importCursorSession } = require("./cursor-import"));
  } catch { return; }

  (async () => {
    for (const filePath of files) {
      let session;
      try { session = await parseTranscriptFile(filePath); } catch { continue; }
      if (!session) continue;
      try {
        const before = dbModule.stmts.getSession.get(session.sessionId);
        const apply = dbModule.db.transaction(() => {
          importCursorSession(dbModule, session);
        });
        apply();
        const row = dbModule.stmts.getSession.get(session.sessionId);
        if (row) broadcast(before ? "session_updated" : "session_created", row);
        const agent = dbModule.stmts.getAgent.get(`${session.sessionId}-main`);
        if (agent) broadcast("agent_updated", agent);
      } catch { /* non-fatal */ }
    }
  })();
}

function scheduleProcess(broadcast, filePath) {
  if (filePath) pending.add(filePath);
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try { processPending(broadcast); } catch { /* ignore */ }
  }, DEBOUNCE_MS);
}

function safeWatch({ root, broadcast }) {
  try {
    if (!fs.existsSync(root)) return false;
    const w = fs.watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      if (!String(filename).endsWith(".jsonl")) return;
      const full = path.join(root, filename);
      scheduleProcess(broadcast, full);
    });
    w.on("error", () => {});
    watchers.push(w);
    return true;
  } catch { return false; }
}

function runCatchupImport(broadcast) {
  let dbModule;
  let importAllCursorSessions;
  try {
    dbModule = require("../db");
    ({ importAllCursorSessions } = require("./cursor-import"));
  } catch { return; }
  Promise.resolve()
    .then(() => importAllCursorSessions(dbModule))
    .then(({ imported }) => {
      if (imported > 0) {
        broadcastHarnessRows(dbModule, broadcast, "cursor");
      }
    })
    .catch(() => {});
}

function startCursorWatcher({ broadcast }) {
  if (started) return;
  started = true;
  catchupTimer = setInterval(() => runCatchupImport(broadcast), CATCHUP_POLL_MS);
  catchupTimer.unref?.();
  runCatchupImport(broadcast);
  const root = getCursorProjectsDir();
  if (safeWatch({ root, broadcast })) return;
  retryTimer = setInterval(() => {
    if (!fs.existsSync(root)) return;
    if (safeWatch({ root, broadcast })) {
      clearInterval(retryTimer);
      retryTimer = null;
      runCatchupImport(broadcast);
    }
  }, RETRY_MS);
  retryTimer.unref?.();
}

function stopCursorWatcher() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
  if (catchupTimer) { clearInterval(catchupTimer); catchupTimer = null; }
  for (const w of watchers) { try { w.close(); } catch { /* ignore */ } }
  watchers.length = 0;
  pending = new Set();
  started = false;
}

module.exports = { startCursorWatcher, stopCursorWatcher };
