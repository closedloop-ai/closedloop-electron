/**
 * @file Express router for the cross-pack skills aggregate (FEA-1224 / PLN-651).
 * Joins the `skills` inventory table against the existing `events` table for
 * invocation counts and recent-invocation history. No parallel
 * `skill_invocations` table exists — this is the only read path.
 * Materialized into the generated tree as server/routes/skills.js by
 * build-agent-monitor.mjs (so `../db` and `../lib/pack-store` resolve).
 */
"use strict";

const { Router } = require("express");
const { db } = require("../db");
const packStore = require("../lib/pack-store");

packStore.ensurePackSchema(db);

const router = Router();

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 50;

function clampInt(raw, fallback, min, max) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

// GET /api/skills — cross-pack inventory + invocation counts.
router.get("/", (_req, res) => {
  try {
    res.json({ items: packStore.listSkills(db) });
  } catch (err) {
    res.status(500).json({ error: { message: err && err.message } });
  }
});

// GET /api/skills/:name/invocations?limit=&offset=
router.get("/:name/invocations", (req, res) => {
  try {
    const limit = clampInt(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    res.json({
      items: packStore.listSkillInvocations(db, req.params.name, {
        limit,
        offset,
      }),
    });
  } catch (err) {
    res.status(500).json({ error: { message: err && err.message } });
  }
});

module.exports = router;
