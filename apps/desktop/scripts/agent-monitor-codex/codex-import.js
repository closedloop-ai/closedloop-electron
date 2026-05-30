/**
 * @file codex-import.js
 * @description Bootstrap importer for OpenAI Codex CLI sessions — the Codex
 * analogue of scripts/import-history.js `importAllSessions`. It parses each
 * Codex rollout JSONL into the shared normalized session shape and then reuses
 * the existing, battle-tested `importSession()` so Codex sessions land in the
 * same sessions/agents/events/token_usage rows and render through the
 * unchanged dashboard UI. The only Codex-specific step is stamping
 * `harness='codex'` on the row afterwards (the shared insert defaults to
 * 'claude'); `setSessionHarness` is idempotent.
 *
 * Part of CLOSEDLOOP VENDOR Addition #6 (see vendor/agent-monitor/VENDOR.md).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseRolloutFile } = require("./codex-parser");
const { listAllRolloutFiles } = require("./codex-home");
const { importSession } = require("../../scripts/import-history");
const { reactivateImportedSession } = require("../agent-monitor-shared/import-session-utils");
const { createCatchupCache } = require("../agent-monitor-shared/catchup-cache");
const { ingestCachePath } = require("../agent-monitor-shared/ingest-paths");

// Cache of (path, mtime, size) for rollout files already parsed and imported.
// The catchup poll runs every 5 s and would otherwise re-parse every file on
// every tick (FEA-1316); the persisted backing file additionally lets a fresh
// process skip unchanged files on the cold-start boot import (FEA-1334).
const catchupCache = createCatchupCache({ persistPath: ingestCachePath("codex") });

/**
 * Import (or idempotently backfill) a single Codex rollout file.
 * Returns { sessionId, result } where result is importSession's return value,
 * or { skipped: true } when the file has no usable content.
 */
function importCodexSession(dbModule, session) {
  // FEA-1444 dedup: if the user opted into Codex hooks, the same logical
  // event will already be in `events` (inserted ~5s earlier by the hook
  // handler). Without this filter the rollout-tail importer would create a
  // duplicate row for every Codex event after the user opts in. Match on
  // (session_id, event_type, tool_name, created_at-truncated-to-second) —
  // hooks and rollout-tail timestamps usually agree within sub-second
  // granularity for the same logical event. False negatives are tolerable
  // (cosmetic duplicates); false positives would silently drop events, so
  // the match is intentionally narrow.
  filterEventsAlreadyCapturedByHooks(dbModule, session);
  const result = importSession(dbModule, session);
  // Stamp the harness regardless of skipped/backfilled — cheap, idempotent,
  // and self-heals rows imported before the `harness` column existed.
  try {
    dbModule.stmts.setSessionHarness.run("codex", session.sessionId, "codex");
  } catch {
    /* non-fatal — column/stmt guaranteed by db.js Patch #4 */
  }
  const reactivated = reactivateImportedSession(dbModule, session);
  return { sessionId: session.sessionId, result, reactivated };
}

/**
 * FEA-1444: filter session.events in place, removing any whose
 * (session_id, event_type, COALESCE(tool_name, ''), created_at-rounded-to-second)
 * already exists in the `events` table. The hook handler inserts in real time;
 * rollout-tail catches up ~5s later — so the dedup query consistently sees
 * hook-sourced rows first when both paths are active.
 *
 * No-op when session.events is empty or the events query fails (best-effort;
 * never block the import on a dedup-time error).
 */
// FEA-1444 review (PR #259, Codex P2): the filter has no hook-source
// discriminator, so without an upstream gate it can incorrectly drop
// rollout-tail events that look like duplicates but aren't (e.g., two
// same-second tool calls in rapid succession). Gate the filter on
// "does the user actually have our Codex hook handler installed?" —
// when it isn't installed there are no possible hook-sourced rows to
// dedup against, so the filter must be a no-op. Cases where hooks ARE
// installed but miss an event (b/c in the reviewer's framing) remain a
// known v1 limitation; tracked for a follow-up FEA that adds a real
// `source` column to the events table.
const HOOK_HANDLER_FILENAME = "codex-hook-handler.js";

let cachedCodexHooksInstalled = null;

function codexHooksInstalled() {
  if (cachedCodexHooksInstalled !== null) {
    return cachedCodexHooksInstalled;
  }
  cachedCodexHooksInstalled = detectCodexHooksInstalled();
  return cachedCodexHooksInstalled;
}

function detectCodexHooksInstalled() {
  try {
    const codexHomeRaw = process.env.CODEX_HOME;
    const codexHome = codexHomeRaw && codexHomeRaw.trim()
      ? codexHomeRaw.split(",")[0].trim().replace(/^~(?=\/)/, os.homedir())
      : path.join(os.homedir(), ".codex");
    const hooksPath = path.join(codexHome, "hooks.json");
    if (!fs.existsSync(hooksPath)) {
      return false;
    }
    const raw = fs.readFileSync(hooksPath, "utf8");
    return raw.includes(HOOK_HANDLER_FILENAME);
  } catch {
    return false;
  }
}

/**
 * FEA-1444: test-only hook to reset the install-state cache. Exposed via
 * module.exports for the regression tests so a single process can exercise
 * both the "hooks installed" and "hooks not installed" paths.
 */
function resetCodexHooksInstalledCache() {
  cachedCodexHooksInstalled = null;
}

// FEA-1444 dedup-stmt cache: the filter runs per-session inside
// importCodexSession, which itself runs inside the importBatch transaction
// loop. Caching the prepared statement on the dbModule keeps us at O(1)
// compilations per process instead of O(sessions) per batch. The cache is
// keyed by dbModule so a fresh DatabaseSync in tests gets a fresh stmt.
const dedupStmtCache = new WeakMap();
function getDedupCheckStmt(dbModule) {
  let stmt = dedupStmtCache.get(dbModule);
  if (stmt) return stmt;
  // Truncate created_at to seconds via `substr(?, 1, 19)` so sub-second
  // timestamp drift between the hook payload and the rollout file doesn't
  // produce a false negative.
  stmt = dbModule.db.prepare(
    "SELECT 1 FROM events " +
      "WHERE session_id = ? AND event_type = ? " +
      "AND COALESCE(tool_name, '') = COALESCE(?, '') " +
      "AND substr(COALESCE(created_at, ''), 1, 19) = substr(COALESCE(?, ''), 1, 19) " +
      "LIMIT 1",
  );
  dedupStmtCache.set(dbModule, stmt);
  return stmt;
}

function filterEventsAlreadyCapturedByHooks(dbModule, session) {
  if (!session || !Array.isArray(session.events) || session.events.length === 0) {
    return;
  }
  // FEA-1444 review fix: only run the dedup query when Codex hooks are
  // actually installed. Without this gate, every existing rollout-tail-
  // sourced row matching the tuple looks like a hook duplicate and gets
  // dropped — which silently loses legitimate rapid same-second tool
  // calls on rollout-tail re-imports. The gate eliminates the most common
  // false-positive vector (~99% of users who never opt into Codex hooks).
  if (!codexHooksInstalled()) {
    return;
  }
  let checkStmt;
  try {
    checkStmt = getDedupCheckStmt(dbModule);
  } catch {
    return; // schema mismatch or db locked — fall through, accept duplicates
  }
  const filtered = [];
  for (const ev of session.events) {
    if (!ev || typeof ev !== "object") {
      filtered.push(ev);
      continue;
    }
    try {
      const hit = checkStmt.get(
        session.sessionId,
        ev.event_type ?? null,
        ev.tool_name ?? null,
        ev.created_at ?? null,
      );
      if (hit) {
        continue; // already captured by the hook handler — drop the duplicate
      }
    } catch {
      // best-effort — on any per-row failure, keep the event
    }
    filtered.push(ev);
  }
  session.events = filtered;
}

/**
 * Parse + import every discovered Codex rollout file. Designed to be cheap on
 * repeat runs: importSession skips already-imported sessions (or backfills
 * only genuinely-new events via its per-event-type high-water-mark).
 *
 * @param {any} dbModule
 * @param {{ signal?: AbortSignal, onBegin?: (total: number) => void,
 *           onProgress?: () => void }} [opts] - ingest-orchestrator progress
 *   hooks (FEA-1334). The watcher catchup tick calls this with no opts.
 * Returns { imported, skipped, errors }.
 */
async function importAllCodexSessions(dbModule, opts = {}) {
  const onBegin = typeof opts.onBegin === "function" ? opts.onBegin : null;
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  const signal = opts.signal || null;
  const files = listAllRolloutFiles();
  if (onBegin) onBegin(files.length);
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  const importBatch = dbModule.db.transaction((sessions) => {
    for (const session of sessions) {
      const { result, reactivated } = importCodexSession(dbModule, session);
      if (result && result.skipped && !reactivated) skipped++;
      else imported++;
    }
  });

  // Parse outside the transaction (async IO); apply inside one (sync, fast).
  // Skip files whose (mtime, size) is unchanged since the last successful
  // parse — that is the common case for the 5 s catchup poll. Without this
  // gate every tick re-parses every historical rollout file (FEA-1316).
  const batch = [];
  const parsedEntries = [];
  for (const filePath of files) {
    if (signal && signal.aborted) break;
    if (onProgress) onProgress();
    const { unchanged, stat } = catchupCache.isUnchanged(filePath);
    if (unchanged) {
      skipped++;
      continue;
    }
    try {
      const session = await parseRolloutFile(filePath);
      if (!session) {
        // Cache even null-parsed files so we don't re-read them every tick.
        catchupCache.markSeenWith(filePath, stat);
        skipped++;
        continue;
      }
      batch.push(session);
      parsedEntries.push({ path: filePath, stat });
    } catch {
      errors++;
    }
  }
  if (batch.length > 0) importBatch(batch);
  for (const { path, stat } of parsedEntries) catchupCache.markSeenWith(path, stat);
  catchupCache.pruneTo(files);
  catchupCache.flush();

  return { imported, skipped, errors };
}

module.exports = {
  importAllCodexSessions,
  importCodexSession,
  // Exposed for regression coverage of FEA-1444 dedup.
  filterEventsAlreadyCapturedByHooks,
  resetCodexHooksInstalledCache,
};
