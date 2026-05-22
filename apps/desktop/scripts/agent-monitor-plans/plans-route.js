/**
 * @file Express router for captured implementation plans (FEA-1189 / PLN-613).
 * Read + light triage surface over the strategy §9.2 plans / plan_versions
 * tables. Materialized into the generated tree as server/routes/plans.js by
 * build-agent-monitor.mjs (so `../db` and `../lib/plan-store` resolve).
 */
"use strict";

const { Router } = require("express");
const fs = require("fs");
const { spawn } = require("child_process");
const { db } = require("../db");
const planStore = require("../lib/plan-store");

// Open a local file with the OS handler. A file:// link can't escape the
// sandboxed dashboard iframe, so the sidecar (a local Node process) opens it.
// Path is never client-supplied — it's the plan's own stored file_path /
// source_log_path, validated to exist — so there's no arbitrary-open vector.
function osOpen(filePath) {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [filePath]]
      : process.platform === "win32"
        ? ["rundll32.exe", ["url.dll,FileProtocolHandler", filePath]]
        : ["xdg-open", [filePath]];
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.unref();
}

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
  const needsConfirmation =
    req.query.needs_confirmation === "1"
      ? true
      : req.query.needs_confirmation === "0"
        ? false
        : null;

  const plans = planStore.listPlans(db, {
    sessionId,
    needsConfirmation,
    limit,
    offset,
  });
  const total = planStore.countPlans(db, { sessionId, needsConfirmation });

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

// POST /api/plans/:id/open?target=plan|log  — open the plan .md file or the
// agent log it was pulled from, in the OS default app.
router.post("/:id/open", (req, res) => {
  const plan = planStore.getPlan(db, req.params.id);
  if (!plan) {
    return res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "plan not found" } });
  }
  const target = req.query.target === "log" ? "log" : "plan";
  const filePath =
    target === "log" ? plan.source_log_path : plan.file_path;
  if (!filePath) {
    return res.status(404).json({
      error: {
        code: "NO_PATH",
        message: `no ${target} path recorded for this plan`,
      },
    });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(410).json({
      error: { code: "FILE_GONE", message: `file no longer exists: ${filePath}` },
    });
  }
  try {
    osOpen(filePath);
  } catch (e) {
    return res.status(500).json({
      error: { code: "OPEN_FAILED", message: e && e.message },
    });
  }
  res.json({ ok: true, target, path: filePath });
});

module.exports = router;
