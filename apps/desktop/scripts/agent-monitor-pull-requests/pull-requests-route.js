/**
 * @file Express router for captured pull requests (FEA-1226). Read surface over
 * the `pull_requests` table for the Dashboard "Pull Requests" tile and page.
 * Materialized into the generated tree as server/routes/pull-requests.js by
 * build-agent-monitor.mjs (so `../db` and `../lib/pull-request-store` resolve).
 */
"use strict";

const { Router } = require("express");
const { db } = require("../db");
const prStore = require("../lib/pull-request-store");

// Idempotent — also created by the db.js build patch; safe to ensure here so
// the route works regardless of init ordering.
prStore.ensurePullRequestSchema(db);

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

module.exports = router;
