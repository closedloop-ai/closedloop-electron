/**
 * @file pr-backfill.js — startup backfill of Claude pull-request URLs (FEA-1226).
 *
 * The upstream Claude legacy-session import is gated on a zero-row DB
 * (server/index.js: `if (existingCount === 0)`), so on a populated DB the
 * import — and the PR extraction wired into `importSession` — never runs for
 * pre-existing history. New sessions still get captured via the hook → POST →
 * `importSession` path, but historical sessions that ran before this feature
 * shipped sit uncaptured. This module closes that gap: it scans
 * `~/.claude/projects/<projDir>/<sessionId>.jsonl` directly on EVERY startup,
 * runs the command-gated extractor, and upserts. Idempotent — the store's
 * deterministic (harness, session, url) id makes re-runs no-ops.
 *
 * Mirrors `agent-monitor-plans/plan-backfill.js` exactly in shape so the two
 * remain readable as the same pattern. Materialized into the generated
 * server/lib by build-agent-monitor.mjs; relative requires (./claude-home,
 * ./pr-extractor, ./pull-request-store) resolve there.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { extractPullRequestsFromSession } = require("./pr-extractor");
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
 * Walk Claude session log files and upsert any captured PRs. Synchronous +
 * best-effort: extractor reads each JSONL once; upsert is idempotent so
 * re-running on every boot is safe (deterministic id dedups).
 *
 * Only walks top-level `<projDir>/<sessionId>.jsonl` — subagent JSONLs under
 * `<projDir>/<sessionId>/subagents/` are intentionally skipped, matching the
 * existing `importSession` PR-extract behavior (which reads exactly one
 * `sourceLogPath` per call).
 *
 * @param {object} db - node:sqlite Database or better-sqlite3 handle
 * @param {object} [options]
 * @param {string} [options.projectsDir] - override the Claude projects dir
 *   (tests use this to point at a fixture tree)
 * @returns {{captured:number, deduped:number, scanned:number, errors:number}}
 */
function runClaudePrBackfill(db, options = {}) {
  const projectsDir = options.projectsDir || resolveClaudeProjectsDir();
  let captured = 0;
  let deduped = 0;
  let scanned = 0;
  let errors = 0;
  let lastError = null;

  let projectDirs;
  try {
    projectDirs = fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    // Projects dir absent on a fresh machine — that's fine, nothing to backfill.
    return { captured, deduped, scanned, errors };
  }

  for (const projDir of projectDirs) {
    const projPath = path.join(projectsDir, projDir);
    let files;
    try {
      files = fs.readdirSync(projPath).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files) {
      scanned += 1;
      const filePath = path.join(projPath, file);
      const sessionId = path.basename(file, ".jsonl");
      try {
        for (const draft of extractPullRequestsFromSession({
          sessionId,
          sourceLogPath: filePath,
        })) {
          try {
            const r = upsertPullRequest(db, draft);
            if (r && r.created) captured += 1;
            else deduped += 1;
          } catch (e) {
            errors += 1;
            lastError = e;
          }
        }
      } catch (e) {
        errors += 1;
        lastError = e;
      }
    }
  }

  if (captured > 0) {
    console.log(
      `[pull-requests] backfilled ${captured} PR(s) from ${scanned} Claude session log(s) in ${projectsDir}`,
    );
  }
  if (errors > 0) {
    console.warn(
      `[pull-requests] ${errors} PR backfill error(s)${lastError && lastError.message ? `: ${lastError.message}` : ""}`,
    );
  }
  return { captured, deduped, scanned, errors };
}

module.exports = { runClaudePrBackfill, resolveClaudeProjectsDir };
