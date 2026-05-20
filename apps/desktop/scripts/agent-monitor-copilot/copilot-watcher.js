/**
 * @file copilot-watcher.js
 * @description Live file watcher for GitHub Copilot sessions. Watches both:
 * 1. VS Code workspace storage chatSessions/ directories for new/changed JSON
 * 2. ~/.copilot/session-state/ for new/changed JSONL event logs
 *
 * Best-effort and non-fatal.
 */
const fs = require("fs");
const path = require("path");
const {
  getCopilotCliSessionStateDir,
  getVscodeWorkspaceStorageDir,
  readWorkspacePathFromHashDir,
} = require("./copilot-home");
const { parseChatSessionFile, parseCliEventFile } = require("./copilot-parser");
const { broadcastHarnessRows } = require("../agent-monitor-shared/harness-watcher-utils");

const DEBOUNCE_MS = 600;
const RETRY_MS = 4000;
const CATCHUP_POLL_MS = 5000;
const CHAT_SESSION_FILE_RE = /(^|[/\\])chatSessions[/\\][^/\\]+\.json$/i;

let started = false;
let timer = null;
let retryTimers = [];
let catchupTimer = null;
let pending = new Map(); // filePath → { type: "chat"|"cli", meta }
const watchers = [];

function processPending(broadcast) {
  const entries = Array.from(pending.entries());
  pending = new Map();
  if (entries.length === 0) return;

  let dbModule;
  let importCopilotSession;
  try {
    dbModule = require("../db");
    ({ importCopilotSession } = require("./copilot-import"));
  } catch { return; }

  (async () => {
    for (const [filePath, info] of entries) {
      let session;
      try {
        if (info.type === "chat") {
          session = parseChatSessionFile(filePath, info.workspacePath);
        } else {
          session = await parseCliEventFile(filePath, info.sessionId);
        }
      } catch { continue; }
      if (!session) continue;
      try {
        const before = dbModule.stmts.getSession.get(session.sessionId);
        const apply = dbModule.db.transaction(() => {
          importCopilotSession(dbModule, session);
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

function scheduleProcess(broadcast, filePath, info) {
  if (filePath) pending.set(filePath, info);
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try { processPending(broadcast); } catch { /* ignore */ }
  }, DEBOUNCE_MS);
}

function watchDir(root, broadcast, matchFn, infoFn) {
  try {
    if (!fs.existsSync(root)) return false;
    const w = fs.watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      if (!matchFn(filename)) return;
      const full = path.join(root, filename);
      scheduleProcess(broadcast, full, infoFn(full, filename));
    });
    w.on("error", () => {});
    watchers.push(w);
    return true;
  } catch { return false; }
}

function retryWatch(root, broadcast, matchFn, infoFn) {
  if (watchDir(root, broadcast, matchFn, infoFn)) return;
  const t = setInterval(() => {
    if (!fs.existsSync(root)) return;
    if (watchDir(root, broadcast, matchFn, infoFn)) {
      clearInterval(t);
      retryTimers = retryTimers.filter((r) => r !== t);
      runCatchupImport(broadcast);
    }
  }, RETRY_MS);
  t.unref?.();
  retryTimers.push(t);
}

function runCatchupImport(broadcast) {
  let dbModule;
  let importAllCopilotSessions;
  try {
    dbModule = require("../db");
    ({ importAllCopilotSessions } = require("./copilot-import"));
  } catch { return; }
  Promise.resolve()
    .then(() => importAllCopilotSessions(dbModule))
    .then(({ imported }) => {
      if (imported > 0) {
        broadcastHarnessRows(dbModule, broadcast, "copilot");
      }
    })
    .catch(() => {});
}

function startCopilotWatcher({ broadcast }) {
  if (started) return;
  started = true;
  catchupTimer = setInterval(() => runCatchupImport(broadcast), CATCHUP_POLL_MS);
  catchupTimer.unref?.();
  runCatchupImport(broadcast);

  // Watch VS Code workspace storage for chat session JSON files
  const wsRoot = getVscodeWorkspaceStorageDir();
  retryWatch(
    wsRoot,
    broadcast,
    (filename) => CHAT_SESSION_FILE_RE.test(String(filename)),
    (full) => {
      const hashDir = path.dirname(path.dirname(full));
      return { type: "chat", workspacePath: readWorkspacePathFromHashDir(hashDir) };
    },
  );

  // Watch Copilot CLI session-state for JSONL event files
  const cliRoot = getCopilotCliSessionStateDir();
  retryWatch(
    cliRoot,
    broadcast,
    (filename) => String(filename).endsWith(".jsonl"),
    (full, filename) => ({
      type: "cli",
      sessionId: path.basename(path.dirname(full)),
    }),
  );
}

function stopCopilotWatcher() {
  if (timer) { clearTimeout(timer); timer = null; }
  for (const t of retryTimers) { clearInterval(t); }
  retryTimers = [];
  if (catchupTimer) { clearInterval(catchupTimer); catchupTimer = null; }
  for (const w of watchers) { try { w.close(); } catch { /* ignore */ } }
  watchers.length = 0;
  pending = new Map();
  started = false;
}

module.exports = { startCopilotWatcher, stopCopilotWatcher };
