/**
 * @file Express router for installed agent skill packs (FEA-1224 / PLN-651).
 * Read surface over the `agent_packs`, `skills`, and
 * `project_pack_associations` inventory tables. Materialized into the
 * generated tree as server/routes/packs.js by build-agent-monitor.mjs (so
 * `../db` and `../lib/pack-store` resolve).
 */
"use strict";

const { Router } = require("express");
const { db } = require("../db");
const packStore = require("../lib/pack-store");

// Idempotent — also created by the db.js build patch; safe to ensure here so
// the route works regardless of init ordering.
packStore.ensurePackSchema(db);

const router = Router();

// GET /api/packs — one row per pack_id with install/skill counts.
router.get("/", (_req, res) => {
  try {
    res.json({ items: packStore.listPacks(db) });
  } catch (err) {
    res.status(500).json({ error: { message: err && err.message } });
  }
});

// GET /api/packs/:pack_id — pack detail: installs, skills, project associations.
router.get("/:pack_id", (req, res) => {
  try {
    const pack = packStore.getPack(db, req.params.pack_id);
    if (!pack) {
      return res.status(404).json({ error: { message: "pack not found" } });
    }
    res.json(pack);
  } catch (err) {
    res.status(500).json({ error: { message: err && err.message } });
  }
});

// GET /api/packs/:pack_id/skills — skills belonging to a specific pack.
router.get("/:pack_id/skills", (req, res) => {
  try {
    res.json({ items: packStore.listSkillsForPack(db, req.params.pack_id) });
  } catch (err) {
    res.status(500).json({ error: { message: err && err.message } });
  }
});

// GET /api/packs/:pack_id/sessions — per-session usage rollup, derived
// retroactively from events.data path-matching. Powers the "Used in N
// sessions" table on the Pack detail page.
//
// Query params: limit (default 25), offset (default 0).
// Response: { items: [{session_id, session_name, session_cwd, session_harness,
//                      session_model, session_started_at, tool_calls,
//                      first_used_at, last_used_at}, ...],
//             total: number }
router.get("/:pack_id/sessions", (req, res) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 25, 1),
      200,
    );
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    res.json({
      items: packStore.listPackSessions(db, req.params.pack_id, {
        limit,
        offset,
      }),
      total: packStore.countPackSessions(db, req.params.pack_id),
    });
  } catch (err) {
    res.status(500).json({ error: { message: err && err.message } });
  }
});

module.exports = router;
