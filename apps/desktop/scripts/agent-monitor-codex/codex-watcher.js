/**
 * @file codex-watcher.js
 * @description Live file watcher for OpenAI Codex CLI sessions. Codex has NO
 * hook system (unlike Claude Code, whose live data arrives via hooks), so the
 * ONLY way to keep the dashboard current for Codex is to watch the rollout
 * JSONL files Codex appends to under `~/.codex/sessions/YYYY/MM/DD/`.
 *
 * On a debounced change it re-parses the affected rollout file and runs the
 * shared idempotent importer (importSession backfills only genuinely-new
 * events via its per-event-type high-water-mark), then broadcasts the updated
 * session/agent rows over the existing dashboard WebSocket so the unchanged
 * client live-updates exactly like it does for Claude hook events.
 *
 * Best-effort and non-fatal, mirroring cc-watcher.js: `fs.watch` is
 * platform-quirky; a failure here must never crash the sidecar. A full
 * startup catch-up still happens via codex-import.js.
 *
 * Part of CLOSEDLOOP VENDOR Addition #6 (see vendor/agent-monitor/VENDOR.md).
 */
const fs = require("fs");
const path = require("path");
const { getCodexSessionsDir } = require("./codex-home");
const { parseRolloutFile } = require("./codex-parser");

const DEBOUNCE_MS = 600;
const RETRY_MS = 4000;

let started = false;
let timer = null;
let retryTimer = null;
let pending = new Set();
const watchers = [];

function processPending(broadcast) {
  const files = Array.from(pending);
  pending = new Set();
  if (files.length === 0) return;

  // Lazy-require to avoid load-order coupling with db/import-history.
  let dbModule;
  let importCodexSession;
  try {
    dbModule = require("../db");
    ({ importCodexSession } = require("./codex-import"));
  } catch {
    return;
  }

  (async () => {
    for (const filePath of files) {
      let session;
      try {
        session = await parseRolloutFile(filePath);
      } catch {
        continue;
      }
      if (!session) continue;
      try {
        const before = dbModule.stmts.getSession.get(session.sessionId);
        const apply = dbModule.db.transaction(() => {
          importCodexSession(dbModule, session);
        });
        apply();
        const row = dbModule.stmts.getSession.get(session.sessionId);
        if (row) broadcast(before ? "session_updated" : "session_created", row);
        const agent = dbModule.stmts.getAgent.get(`${session.sessionId}-main`);
        if (agent) broadcast("agent_updated", agent);
      } catch {
        /* non-fatal — a partially-written rollout line is normal mid-turn */
      }
    }
  })();
}

function scheduleProcess(broadcast, filePath) {
  if (filePath) pending.add(filePath);
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      processPending(broadcast);
    } catch {
      /* ignore */
    }
  }, DEBOUNCE_MS);
}

function safeWatchSessions({ root, broadcast }) {
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
  } catch {
    /* platform limitation — startup import still covers historical sessions */
    return false;
  }
}

// One-time catch-up after the sessions dir appears for the first time AFTER
// the sidecar booted (e.g. the user ran their first-ever Codex session while
// the dashboard was already open). server/index.js's startup import ran when
// the dir didn't exist yet and fs.watch only fires for events AFTER it
// attaches, so without this the session stays invisible until an app
// restart. Re-imports are idempotent; broadcasts make an open UI refresh.
function runCatchupImport(broadcast) {
  let dbModule;
  let importAllCodexSessions;
  try {
    dbModule = require("../db");
    ({ importAllCodexSessions } = require("./codex-import"));
  } catch {
    return;
  }
  Promise.resolve()
    .then(() => importAllCodexSessions(dbModule))
    .then(() => {
      try {
        const rows = dbModule.db
          .prepare("SELECT * FROM sessions WHERE harness = 'codex'")
          .all();
        for (const row of rows) broadcast("session_updated", row);
      } catch {
        /* non-fatal */
      }
    })
    .catch(() => {});
}

/**
 * Start watching Codex rollout files. Idempotent: subsequent calls are no-ops.
 * Resilient to a not-yet-existent ~/.codex/sessions: if the dir is missing at
 * boot we poll (cheap fs.existsSync) until it appears, then run a one-time
 * catch-up import and attach the recursive watcher.
 */
function startCodexWatcher({ broadcast }) {
  if (started) return;
  started = true;
  const root = getCodexSessionsDir();
  if (safeWatchSessions({ root, broadcast })) return; // dir existed → attached
  retryTimer = setInterval(() => {
    if (!fs.existsSync(root)) return;
    if (safeWatchSessions({ root, broadcast })) {
      clearInterval(retryTimer);
      retryTimer = null;
      runCatchupImport(broadcast);
    }
  }, RETRY_MS);
  retryTimer.unref?.();
}

function stopCodexWatcher() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
  for (const w of watchers) {
    try {
      w.close();
    } catch {
      /* ignore */
    }
  }
  watchers.length = 0;
  pending = new Set();
  started = false;
}

module.exports = { startCodexWatcher, stopCodexWatcher };
