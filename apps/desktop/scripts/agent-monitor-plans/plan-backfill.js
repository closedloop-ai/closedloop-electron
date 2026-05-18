/**
 * @file plan-backfill.js — startup backfill of Claude plan files (FEA-1189).
 *
 * The upstream Claude legacy-session import is gated on a zero-row DB
 * (server/index.js: `if (existingCount === 0)`), so on a populated DB the
 * import — and the plan extraction wired into it — never runs for pre-existing
 * history. Codex import has no such gate. This module closes that gap: it
 * scans `~/.claude/plans/*.md` directly on EVERY startup (idempotent, like the
 * Codex import), so plans already on disk show up regardless of import state.
 *
 * Materialized into the generated server/lib by build-agent-monitor.mjs;
 * relative requires (./claude-home, ./plan-extractor, ./plan-store,
 * ../websocket) resolve there.
 */
"use strict";

const path = require("path");
const { extractPlansFromPlansDir } = require("./plan-extractor");
const { upsertPlanCapture } = require("./plan-store");

function resolveClaudeHome() {
  try {
    const h = require("./claude-home").getClaudeHome();
    if (h) return h;
  } catch {
    /* fall through */
  }
  return (
    process.env.CLAUDE_HOME ||
    path.join(require("os").homedir(), ".claude")
  );
}

/**
 * Scan the Claude plans directory and upsert every plan file. Synchronous +
 * best-effort: plans dirs are tiny (a handful of small .md files) so this is
 * safe at startup. sha256 dedup in plan-store makes re-runs no-ops.
 *
 * @returns {{captured:number, deduped:number}}
 */
function runClaudePlanBackfill(db) {
  let broadcast = null;
  try {
    broadcast = require("../websocket").broadcast;
  } catch {
    /* websocket optional */
  }
  const plansDir = path.join(resolveClaudeHome(), "plans");
  let captured = 0;
  let deduped = 0;
  for (const cap of extractPlansFromPlansDir(plansDir)) {
    try {
      const r = upsertPlanCapture(db, cap);
      if (r && r.deduped) {
        deduped += 1;
      } else {
        captured += 1;
        if (broadcast && r) {
          broadcast("plan_captured", {
            plan_id: r.planId,
            version: r.version,
            session_id: null,
          });
        }
      }
    } catch (e) {
      void e; // idempotent / non-fatal
    }
  }
  if (captured > 0) {
    console.log(
      `[plans] backfilled ${captured} plan file(s) from ${plansDir}`,
    );
  }
  return { captured, deduped };
}

module.exports = { runClaudePlanBackfill, resolveClaudeHome };
