/**
 * @file Express router for captured pull requests (FEA-1226). Read surface over
 * the `pull_requests` table for the Dashboard "Pull Requests" tile and page.
 * Materialized into the generated tree as server/routes/pull-requests.js by
 * build-agent-monitor.mjs (so `../db` and `../lib/pull-request-store` resolve).
 */
"use strict";

const { Router } = require("express");
const { spawn } = require("child_process");
const { db } = require("../db");
const prStore = require("../lib/pull-request-store");

// Idempotent — also created by the db.js build patch; safe to ensure here so
// the route works regardless of init ordering.
prStore.ensurePullRequestSchema(db);

// Open a URL with the OS handler. The dashboard runs in a sandboxed iframe,
// so an <a target="_blank"> cannot reliably escape to the browser — the
// sidecar (a local Node process) opens it instead. Mirrors the osOpen helper
// in agent-monitor-plans/plans-route.js. The URL is never client-supplied:
// the /:id/open route looks up the PR's own stored pr_url, so there is no
// arbitrary-open vector.
function osOpen(url) {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.unref();
}

const router = Router();
const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

// GET /api/pull-requests/stats  → counts for the Dashboard tile
router.get("/stats", (_req, res) => {
  res.json({
    pull_requests: prStore.countPullRequests(db),
    sessions_with_pull_requests: prStore.countSessionsWithPullRequests(db),
    repos: prStore.countRepos(db),
  });
});

// GET /api/pull-requests/sessions?limit=&offset=
// One row per session that produced ≥1 PR — the "Pull Requests" page table.
router.get("/sessions", (req, res) => {
  const limit = prStore.clampInt(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = prStore.clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  res.json({
    sessions: prStore.listSessionsWithPullRequests(db, { limit, offset }),
    total: prStore.countSessionsWithPullRequests(db),
    limit,
    offset,
  });
});

// GET /api/pull-requests/session-ids  → [{session_id, c}] — backs per-row chips
router.get("/session-ids", (_req, res) => {
  res.json({ sessions: prStore.sessionIdsWithPullRequests(db) });
});

// GET /api/pull-requests?session_id=&repo=&limit=&offset=
// Flat PR list (the "group by PR" view).
router.get("/", (req, res) => {
  const limit = prStore.clampInt(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = prStore.clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const sessionId =
    typeof req.query.session_id === "string" && req.query.session_id.trim()
      ? req.query.session_id.trim()
      : null;
  const repo =
    typeof req.query.repo === "string" && req.query.repo.trim()
      ? req.query.repo.trim()
      : null;
  res.json({
    pull_requests: prStore.listPullRequests(db, { sessionId, repo, limit, offset }),
    total: prStore.countPullRequests(db, { sessionId, repo }),
    limit,
    offset,
  });
});

// POST /api/pull-requests/:id/open  — open the PR on GitHub in the OS browser.
// Takes the row id, not a URL — the opened URL is the trusted stored pr_url.
router.post("/:id/open", (req, res) => {
  const row = db
    .prepare(`SELECT pr_url FROM pull_requests WHERE id = ?`)
    .get(req.params.id);
  if (!row) {
    return res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "pull request not found" } });
  }
  try {
    osOpen(row.pr_url);
  } catch (e) {
    return res
      .status(500)
      .json({ error: { code: "OPEN_FAILED", message: e && e.message } });
  }
  res.json({ ok: true, url: row.pr_url });
});

module.exports = router;
