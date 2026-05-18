/**
 * @file Express router for captured implementation plans (FEA-1189 / PLN-613).
 * Read + light triage surface over the strategy §9.2 plans / plan_versions
 * tables. Materialized into the generated tree as server/routes/plans.js by
 * build-agent-monitor.mjs (so `../db` and `../lib/plan-store` resolve).
 */
"use strict";

const { Router } = require("express");
const { db } = require("../db");
const planStore = require("../lib/plan-store");

// Idempotent — also created by the db.js build patch; safe to ensure here so
// the route works regardless of init ordering.
planStore.ensurePlanSchema(db);

let broadcast = () => {};
try {
  broadcast = require("../websocket").broadcast || broadcast;
} catch {
  /* websocket optional in some test contexts */
}

const router = Router();

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 50;

function clampInt(raw, fallback, min, max) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

// GET /api/plans?session_id=&needs_confirmation=1&limit=&offset=
router.get("/", (req, res) => {
  const limit = clampInt(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const sessionId =
    typeof req.query.session_id === "string" && req.query.session_id.trim()
      ? req.query.session_id.trim()
      : null;

  let plans = planStore.listPlans(db, { sessionId, limit, offset });
  if (req.query.needs_confirmation === "1") {
    plans = plans.filter((p) => p.needs_confirmation === 1);
  }

  const total = sessionId
    ? db
        .prepare(
          "SELECT COUNT(*) AS c FROM plans WHERE created_from_session_id = ?",
        )
        .get(sessionId).c
    : db.prepare("SELECT COUNT(*) AS c FROM plans").get().c;

  res.json({ plans, limit, offset, total });
});

// GET /api/plans/:id  → plan + full version history
router.get("/:id", (req, res) => {
  const plan = planStore.getPlan(db, req.params.id);
  if (!plan) {
    return res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "plan not found" } });
  }
  res.json({ plan });
});

// GET /api/plans/:id/versions
router.get("/:id/versions", (req, res) => {
  res.json({ versions: planStore.listVersions(db, req.params.id) });
});

// POST /api/plans/:id/confirm  — accept a low-confidence capture
router.post("/:id/confirm", (req, res) => {
  const ok = planStore.confirmPlan(db, req.params.id);
  if (!ok) {
    return res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "plan not found" } });
  }
  const plan = planStore.getPlan(db, req.params.id);
  broadcast("plan_updated", plan);
  res.json({ ok: true, plan });
});

// POST /api/plans/:id/reject  — discard a false-positive capture
router.post("/:id/reject", (req, res) => {
  const ok = planStore.rejectPlan(db, req.params.id);
  if (!ok) {
    return res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "plan not found" } });
  }
  const plan = planStore.getPlan(db, req.params.id);
  broadcast("plan_updated", plan);
  res.json({ ok: true, plan });
});

module.exports = router;
