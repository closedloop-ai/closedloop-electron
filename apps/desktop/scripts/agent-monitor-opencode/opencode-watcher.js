/**
 * @file opencode-watcher.js
 * @description Live file watcher for OpenCode sessions. Watches the
 * `opencode.db` / WAL files for changes and re-imports the DB-backed session
 * model on change. Best-effort and non-fatal.
 */
const fs = require("fs");
const path = require("path");
const { getOpenCodeDbWatchDir, getOpenCodeDbWatchFiles } = require("./opencode-home");
const { broadcastHarnessRows } = require("../agent-monitor-shared/harness-watcher-utils");

const DEBOUNCE_MS = 600;
const RETRY_MS = 4000;
const CATCHUP_POLL_MS = 5000;

let started = false;
let timer = null;
let retryTimer = null;
let catchupTimer = null;
const watchers = [];

function processPending(broadcast) {
  runCatchupImport(broadcast);
}

function scheduleProcess(broadcast) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try { processPending(broadcast); } catch { /* ignore */ }
  }, DEBOUNCE_MS);
}

function safeWatch({ root, broadcast }) {
  try {
    if (!fs.existsSync(root)) return false;
    const watchedNames = new Set(getOpenCodeDbWatchFiles());
    const w = fs.watch(root, (_event, filename) => {
      if (!filename) return;
      const relative = String(filename);
      const base = path.basename(relative);
      if (!watchedNames.has(base)) return;
      scheduleProcess(broadcast);
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
    .then(({ imported }) => {
      if (imported > 0) {
        broadcastHarnessRows(dbModule, broadcast, "opencode");
      }
    })
    .catch(() => {});
}

function startOpenCodeWatcher({ broadcast }) {
  if (started) return;
  started = true;
  catchupTimer = setInterval(() => runCatchupImport(broadcast), CATCHUP_POLL_MS);
  catchupTimer.unref?.();
  runCatchupImport(broadcast);
  const root = getOpenCodeDbWatchDir();
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
  if (catchupTimer) { clearInterval(catchupTimer); catchupTimer = null; }
  for (const w of watchers) { try { w.close(); } catch { /* ignore */ } }
  watchers.length = 0;
  started = false;
}

module.exports = { startOpenCodeWatcher, stopOpenCodeWatcher };
