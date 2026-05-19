/**
 * @file opencode-watcher.js
 * @description Live file watcher for OpenCode sessions. Watches
 * ~/.local/share/opencode/storage/ for new/changed message JSON files and
 * re-imports the containing session on change. Best-effort and non-fatal.
 */
const fs = require("fs");
const path = require("path");
const { getOpenCodeStorageDir } = require("./opencode-home");
const { parseSessionDir } = require("./opencode-parser");

const DEBOUNCE_MS = 600;
const RETRY_MS = 4000;

let started = false;
let timer = null;
let retryTimer = null;
let pending = new Map(); // sessionDir → sessionId
const watchers = [];

function processPending(broadcast) {
  const entries = Array.from(pending.entries());
  pending = new Map();
  if (entries.length === 0) return;

  let dbModule;
  let importOpenCodeSession;
  try {
    dbModule = require("../db");
    ({ importOpenCodeSession } = require("./opencode-import"));
  } catch { return; }

  for (const [sessionDir, sessionId] of entries) {
    let session;
    try { session = parseSessionDir(sessionDir, sessionId); } catch { continue; }
    if (!session) continue;
    try {
      const before = dbModule.stmts.getSession.get(session.sessionId);
      const apply = dbModule.db.transaction(() => {
        importOpenCodeSession(dbModule, session);
      });
      apply();
      const row = dbModule.stmts.getSession.get(session.sessionId);
      if (row) broadcast(before ? "session_updated" : "session_created", row);
      const agent = dbModule.stmts.getAgent.get(`${session.sessionId}-main`);
      if (agent) broadcast("agent_updated", agent);
    } catch { /* non-fatal */ }
  }
}

function scheduleProcess(broadcast, sessionDir, sessionId) {
  if (sessionDir) pending.set(sessionDir, sessionId);
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
      if (!String(filename).endsWith(".json")) return;
      // filename is relative to root, e.g. "session-id/message_3.json"
      const parts = String(filename).split(path.sep);
      if (parts.length < 2) return;
      const sessionId = parts[0];
      const sessionDir = path.join(root, sessionId);
      scheduleProcess(broadcast, sessionDir, sessionId);
    });
    w.on("error", () => {});
    watchers.push(w);
    return true;
  } catch { return false; }
}

function runCatchupImport(broadcast) {
  let dbModule;
  let importAllOpenCodeSessions;
  try {
    dbModule = require("../db");
    ({ importAllOpenCodeSessions } = require("./opencode-import"));
  } catch { return; }
  Promise.resolve()
    .then(() => importAllOpenCodeSessions(dbModule))
    .then(() => {
      try {
        const rows = dbModule.db
          .prepare("SELECT * FROM sessions WHERE harness = 'opencode'")
          .all();
        for (const row of rows) broadcast("session_updated", row);
      } catch { /* non-fatal */ }
    })
    .catch(() => {});
}

function startOpenCodeWatcher({ broadcast }) {
  if (started) return;
  started = true;
  const root = getOpenCodeStorageDir();
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

function stopOpenCodeWatcher() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
  for (const w of watchers) { try { w.close(); } catch { /* ignore */ } }
  watchers.length = 0;
  pending = new Map();
  started = false;
}

module.exports = { startOpenCodeWatcher, stopOpenCodeWatcher };
