/**
 * @file pr-backfill.js — startup backfill of Claude pull-request URLs (FEA-1226).
 *
 * The upstream Claude legacy-session import is gated on a zero-row DB
 * (server/index.js: `if (existingCount === 0)`), so on a populated DB the
 * import — and the PR extraction wired into `importSession` — never runs for
 * pre-existing history. New sessions still get captured via the hook → POST →
 * `importSession` path, but historical sessions that ran before this feature
 * shipped sit uncaptured. This module closes that gap: it scans
 * `~/.claude/projects/<projDir>/<sessionId>.jsonl` and runs the command-gated
 * extractor against any file whose mtime has changed since the last scan.
 *
 * Why per-file mtime skip (FEA-1226 PR #238 review feedback): on machines
 * with thousands of session logs (e.g. 3,000+ JSONLs / ~700 MB), reading
 * every file on every boot is unacceptable. By recording (session_id,
 * file_mtime_ms) in `pr_backfill_seen` after each successful scan, repeat
 * boots only fs.statSync each file and skip those whose mtime is unchanged
 * — no readFile, no parse, no upsert calls. First boot after the feature
 * ships pays the full scan cost once; every subsequent boot is ~stat-time.
 *
 * Two correctness invariants the cache MUST preserve, both flagged by the
 * Codex review on PR #238:
 *
 *   1. A read failure must NOT cache the mtime. If fs.readFileSync throws
 *      (EACCES, iCloud placeholder eviction, TOCTOU ENOENT after statSync),
 *      we leave the file uncached so the next boot retries it. That's why
 *      this module reads the file itself instead of using the session-shaped
 *      extractPullRequestsFromSession entry — that entry swallows read
 *      failures and returns [], which the cache cannot distinguish from
 *      "file read fine, just no PRs in it."
 *
 *   2. A per-draft upsert failure must NOT cache the mtime. If a single
 *      upsertPullRequest call throws mid-loop (transient DB error,
 *      constraint bug), we'd drop that PR; if we ALSO cache the mtime,
 *      the file is permanently skipped on every later boot and the PR is
 *      lost forever. The fileSucceeded flag below tracks per-file success
 *      and gates the upsertSeen call accordingly.
 *
 * Called from server/index.js via setImmediate so the first-run scan
 * happens after the current event-loop tick — boot is not blocked by it.
 *
 * Materialized into the generated server/lib by build-agent-monitor.mjs;
 * relative requires (./claude-home, ./pr-extractor, ./pull-request-store)
 * resolve there.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { extractPullRequestsFromText } = require("./pr-extractor");
const { upsertPullRequest } = require("./pull-request-store");

/**
 * Resolve `~/.claude/projects/` — uses the shared `claude-home` helper when
 * available (same path resolution as the legacy importer + plan-backfill),
 * falls back to env / homedir for tests and exotic setups.
 */
function resolveClaudeProjectsDir() {
  try {
    const h = require("./claude-home").getClaudeHome();
    if (h) return path.join(h, "projects");
  } catch {
    /* fall through */
  }
  return (
    process.env.CLAUDE_PROJECTS_DIR ||
    path.join(
      process.env.CLAUDE_HOME || path.join(require("os").homedir(), ".claude"),
      "projects",
    )
  );
}

/**
 * Walk Claude session log files and upsert any captured PRs. Best-effort and
 * never blocks the caller — every fs / SQL op is try/catch-isolated.
 *
 * Per-file mtime skip: each successfully-scanned file's mtime is persisted
 * to `pr_backfill_seen`; on the next boot a file whose mtime matches the
 * stored value is skipped (just one `fs.statSync` call, no read).
 *
 * Only walks top-level `<projDir>/<sessionId>.jsonl` — subagent JSONLs under
 * `<projDir>/<sessionId>/subagents/` are intentionally skipped, matching the
 * existing `importSession` PR-extract behavior (which reads exactly one
 * `sourceLogPath` per call).
 *
 * Error handling: ENOENT on the projects dir is normal (fresh machine) and
 * returns zeros silently. Any other filesystem error is counted, logged, and
 * does not abort the backfill — partial progress is preferable to none. Any
 * per-file read OR upsert failure leaves the file's mtime uncached so the
 * next boot retries it (no silent permanent-skip on transient errors).
 *
 * @param {object} db - node:sqlite Database or better-sqlite3 handle
 * @param {object} [options]
 * @param {string} [options.projectsDir] - override the Claude projects dir
 *   (tests use this to point at a fixture tree)
 * @param {object} [options.fs] - inject a custom fs implementation (tests
 *   use this to simulate EACCES on readdirSync without chmod-ing real dirs)
 * @returns {{captured:number, deduped:number, scanned:number, skipped:number, errors:number}}
 */
function runClaudePrBackfill(db, options = {}) {
  const projectsDir = options.projectsDir || resolveClaudeProjectsDir();
  const fsImpl = options.fs || fs;
  let captured = 0;
  let deduped = 0;
  let scanned = 0;
  let skipped = 0;
  let errors = 0;
  let lastError = null;

  let projectDirs;
  try {
    projectDirs = fsImpl
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch (e) {
    // ENOENT is the fresh-machine case — silent, nothing to backfill.
    // Any other error (EACCES, EIO, …) is real and must surface, not vanish.
    if (e && e.code !== "ENOENT") {
      console.warn(
        `[pull-requests] failed to read projects dir ${projectsDir}: ${e.message}`,
      );
      return { captured, deduped, scanned, skipped, errors: 1 };
    }
    return { captured, deduped, scanned, skipped, errors };
  }

  // Prepare the mtime-cache statements once. If the schema hasn't been
  // bootstrapped (older DB, partial init), bail loudly so the user can repair
  // rather than silently re-reading hundreds of MB on every boot.
  let getSeen, upsertSeen;
  try {
    getSeen = db.prepare(
      "SELECT file_mtime_ms FROM pr_backfill_seen WHERE session_id = ?",
    );
    upsertSeen = db.prepare(
      "INSERT INTO pr_backfill_seen (session_id, file_path, file_mtime_ms, scanned_at) " +
        "VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(session_id) DO UPDATE SET " +
        "file_path = excluded.file_path, " +
        "file_mtime_ms = excluded.file_mtime_ms, " +
        "scanned_at = excluded.scanned_at",
    );
  } catch (e) {
    console.warn(
      `[pull-requests] pr_backfill_seen schema missing — repeat-boot perf will degrade: ${e && e.message}`,
    );
    return { captured, deduped, scanned, skipped, errors: 1 };
  }

  for (const projDir of projectDirs) {
    const projPath = path.join(projectsDir, projDir);
    let files;
    try {
      files = fsImpl.readdirSync(projPath).filter((f) => f.endsWith(".jsonl"));
    } catch (e) {
      // A single unreadable project dir is logged and skipped — must not
      // abort the whole backfill. ENOENT here only happens on a TOCTOU race
      // between the parent readdir and this one; treat it as benign.
      if (e && e.code !== "ENOENT") {
        errors += 1;
        lastError = e;
      }
      continue;
    }
    for (const file of files) {
      const filePath = path.join(projPath, file);
      const sessionId = path.basename(file, ".jsonl");

      let stat;
      try {
        stat = fsImpl.statSync(filePath);
      } catch (e) {
        if (e && e.code !== "ENOENT") {
          errors += 1;
          lastError = e;
        }
        continue;
      }
      const mtimeMs = stat.mtimeMs;

      // Has this exact file (by session_id) been scanned at this same mtime?
      // If so, no need to re-read / re-parse — the upsert would dedup anyway.
      let seen;
      try {
        seen = getSeen.get(sessionId);
      } catch (e) {
        errors += 1;
        lastError = e;
        continue;
      }
      if (seen && seen.file_mtime_ms === mtimeMs) {
        skipped += 1;
        continue;
      }

      scanned += 1;

      // Read the file OURSELVES so a read failure surfaces here instead of
      // being swallowed by extractPullRequestsFromSession's []-on-throw
      // behavior. Caching the mtime of an unreadable file would skip it
      // forever on the same mtime.
      let text;
      try {
        text = fsImpl.readFileSync(filePath, "utf8");
      } catch (e) {
        errors += 1;
        lastError = e;
        continue; // do NOT upsertSeen — let the next boot retry
      }

      let fileSucceeded = true;
      try {
        for (const draft of extractPullRequestsFromText(text, sessionId)) {
          try {
            const r = upsertPullRequest(db, draft);
            if (r && r.created) captured += 1;
            else deduped += 1;
          } catch (e) {
            // A single failed upsert MUST mark this file as not-yet-fully-
            // succeeded. Otherwise we'd cache the mtime and permanently
            // skip the file on every subsequent boot — and the dropped
            // PR would be lost forever.
            fileSucceeded = false;
            errors += 1;
            lastError = e;
          }
        }
      } catch (e) {
        // Parser-level failure — same logic: don't cache.
        fileSucceeded = false;
        errors += 1;
        lastError = e;
      }

      if (fileSucceeded) {
        try {
          upsertSeen.run(sessionId, filePath, mtimeMs, new Date().toISOString());
        } catch (e) {
          errors += 1;
          lastError = e;
        }
      }
    }
  }

  if (captured > 0 || scanned > 0 || skipped > 0) {
    console.log(
      `[pull-requests] backfill: scanned=${scanned} skipped=${skipped} captured=${captured} deduped=${deduped} errors=${errors}`,
    );
  }
  if (errors > 0) {
    console.warn(
      `[pull-requests] ${errors} PR backfill error(s)${lastError && lastError.message ? `: ${lastError.message}` : ""}`,
    );
  }
  return { captured, deduped, scanned, skipped, errors };
}

module.exports = { runClaudePrBackfill, resolveClaudeProjectsDir };
