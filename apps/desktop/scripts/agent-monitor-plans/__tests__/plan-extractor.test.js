/**
 * @file Unit tests for plan-extractor + plan-store (FEA-1189 / PLN-613).
 * Run: node --test apps/desktop/scripts/agent-monitor-plans/__tests__/
 *
 * Uses Node's built-in node:sqlite (DatabaseSync) as the db handle — its
 * prepare/run/get/all/exec surface matches the better-sqlite3 / compat-sqlite
 * API plan-store targets at runtime.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");

const {
  extractPlansFromSession,
  extractPlanFromHookEvent,
  extractProposedPlanText,
  isPlanFilePath,
  titleFromMarkdown,
} = require("../plan-extractor");
const {
  ensurePlanSchema,
  upsertPlanCapture,
  listPlans,
  listVersions,
  getPlan,
  confirmPlan,
  rejectPlan,
} = require("../plan-store");

function freshDb() {
  const db = new DatabaseSync(":memory:");
  ensurePlanSchema(db);
  return db;
}

// ── plan-extractor: helpers ────────────────────────────────────────────────

test("isPlanFilePath matches the Claude plans dir, tolerant of separators", () => {
  assert.equal(isPlanFilePath("/Users/x/.claude/plans/foo.md"), true);
  assert.equal(isPlanFilePath("C:\\Users\\x\\.claude\\plans\\foo.md"), true);
  assert.equal(isPlanFilePath("/Users/x/project/src/index.md"), false);
  assert.equal(isPlanFilePath("/Users/x/plans/foo.md"), false); // not under .claude
  assert.equal(isPlanFilePath(""), false);
  assert.equal(isPlanFilePath(null), false);
});

test("titleFromMarkdown picks the first H1 else falls back", () => {
  assert.equal(titleFromMarkdown("# My Plan\n\nbody", "fb"), "My Plan");
  assert.equal(titleFromMarkdown("no heading here", "fb"), "fb");
  assert.equal(titleFromMarkdown("## sub\n# Real", "fb"), "Real");
});

test("extractProposedPlanText pulls the inner block", () => {
  assert.equal(
    extractProposedPlanText("pre <proposed_plan>do X\ndo Y</proposed_plan> post"),
    "do X\ndo Y",
  );
  assert.equal(extractProposedPlanText("no block"), null);
});

// ── plan-extractor: session (parser/import) path ───────────────────────────

test("extractPlansFromSession detects Claude ExitPlanMode (high confidence)", () => {
  const caps = extractPlansFromSession({
    sessionId: "sess-1",
    toolUses: [
      { name: "Read", timestamp: "t0", input: { file_path: "/a" } },
      {
        name: "ExitPlanMode",
        timestamp: "t1",
        input: { plan: "# Plan A\nstep", planFilePath: "/u/.claude/plans/a.md" },
      },
    ],
  });
  assert.equal(caps.length, 1);
  const c = caps[0];
  assert.equal(c.harness, "claude");
  assert.equal(c.source, "claude-exitplanmode");
  assert.equal(c.capture_method, "log");
  assert.equal(c.confidence, 1.0);
  assert.equal(c.needs_confirmation, 0);
  assert.equal(c.title, "Plan A");
  assert.equal(c.file_path, "/u/.claude/plans/a.md");
  assert.equal(c.created_from_session_id, "sess-1");
  assert.ok(/^[0-9a-f]{64}$/.test(c.content_sha256));
});

test("extractPlansFromSession detects plans-dir Write but ignores other Writes", () => {
  const caps = extractPlansFromSession({
    sessionId: "s",
    toolUses: [
      { name: "Write", timestamp: "t", input: { file_path: "/u/.claude/plans/p.md", content: "# P\nx" } },
      { name: "Write", timestamp: "t", input: { file_path: "/u/src/app.ts", content: "code" } },
    ],
  });
  assert.equal(caps.length, 1);
  assert.equal(caps[0].source, "claude-plan-write");
  assert.equal(caps[0].confidence, 1.0);
});

test("extractPlansFromSession detects Codex plan item (high) and proposed-plan (medium)", () => {
  const caps = extractPlansFromSession({
    sessionId: "cx",
    plans: [
      { source: "codex-plan-item", content: "# Codex Plan\n1", timestamp: "t1" },
      { source: "codex-proposed-plan", content: "loose plan", timestamp: "t2" },
    ],
  });
  assert.equal(caps.length, 2);
  const item = caps.find((c) => c.source === "codex-plan-item");
  const prop = caps.find((c) => c.source === "codex-proposed-plan");
  assert.equal(item.harness, "codex");
  assert.equal(item.confidence, 1.0);
  assert.equal(item.needs_confirmation, 0);
  assert.equal(prop.confidence, 0.6);
  assert.equal(prop.needs_confirmation, 1);
});

test("extractPlansFromSession ignores empty/malformed input", () => {
  assert.deepEqual(extractPlansFromSession(null), []);
  assert.deepEqual(extractPlansFromSession({ toolUses: [{ name: "ExitPlanMode", input: { plan: "  " } }] }), []);
});

// ── plan-extractor: live hook path ─────────────────────────────────────────

test("extractPlanFromHookEvent captures PostToolUse ExitPlanMode / plans-dir Write", () => {
  const a = extractPlanFromHookEvent("PostToolUse", {
    session_id: "h1",
    tool_name: "ExitPlanMode",
    tool_input: { plan: "# Hooked\nx" },
  });
  assert.ok(a);
  assert.equal(a.capture_method, "hook");
  assert.equal(a.source, "claude-exitplanmode");
  assert.equal(a.created_from_session_id, "h1");

  const b = extractPlanFromHookEvent("PostToolUse", {
    session_id: "h1",
    tool_name: "Write",
    tool_input: { file_path: "/u/.claude/plans/x.md", content: "# W\ny" },
  });
  assert.equal(b.source, "claude-plan-write");
});

test("extractPlanFromHookEvent returns null for non-plan events", () => {
  assert.equal(extractPlanFromHookEvent("PreToolUse", { tool_name: "ExitPlanMode", tool_input: { plan: "x" } }), null);
  assert.equal(extractPlanFromHookEvent("PostToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }), null);
  assert.equal(extractPlanFromHookEvent("PostToolUse", { tool_name: "Write", tool_input: { file_path: "/src/a.ts", content: "c" } }), null);
  assert.equal(extractPlanFromHookEvent("Stop", {}), null);
});

// ── plan-store: schema, versioning, dedup ──────────────────────────────────

test("upsertPlanCapture creates a plan + v1, then appends v2 on changed content", () => {
  const db = freshDb();
  const [cap] = extractPlansFromSession({
    sessionId: "S",
    toolUses: [{ name: "ExitPlanMode", timestamp: "t1", input: { plan: "# P\nv1", planFilePath: "/u/.claude/plans/p.md" } }],
  });

  const r1 = upsertPlanCapture(db, cap);
  assert.equal(r1.created, true);
  assert.equal(r1.version, 1);
  assert.equal(r1.deduped, false);

  const [cap2] = extractPlansFromSession({
    sessionId: "S",
    toolUses: [{ name: "ExitPlanMode", timestamp: "t2", input: { plan: "# P\nv2 changed", planFilePath: "/u/.claude/plans/p.md" } }],
  });
  const r2 = upsertPlanCapture(db, cap2);
  assert.equal(r2.created, false);
  assert.equal(r2.planId, r1.planId, "same plan_key → same plan");
  assert.equal(r2.version, 2);

  const versions = listVersions(db, r1.planId);
  assert.equal(versions.length, 2, "history is kept (append-only)");
  const plan = getPlan(db, r1.planId);
  assert.equal(plan.current_version_id, r2.versionId, "current points at v2");
});

test("upsertPlanCapture de-dupes identical content (no new version)", () => {
  const db = freshDb();
  const session = {
    sessionId: "S",
    toolUses: [{ name: "ExitPlanMode", timestamp: "t1", input: { plan: "# Same\nbody", planFilePath: "/u/.claude/plans/p.md" } }],
  };
  const [cap] = extractPlansFromSession(session);
  const r1 = upsertPlanCapture(db, cap);
  const [capAgain] = extractPlansFromSession(session);
  const r2 = upsertPlanCapture(db, capAgain);

  assert.equal(r2.deduped, true);
  assert.equal(r2.version, 1);
  assert.equal(listVersions(db, r1.planId).length, 1);
});

test("distinct plan_keys / sessions produce distinct plans", () => {
  const db = freshDb();
  const [a] = extractPlansFromSession({ sessionId: "A", toolUses: [{ name: "ExitPlanMode", input: { plan: "# A" } }] });
  const [b] = extractPlansFromSession({ sessionId: "B", toolUses: [{ name: "ExitPlanMode", input: { plan: "# B" } }] });
  const ra = upsertPlanCapture(db, a);
  const rb = upsertPlanCapture(db, b);
  assert.notEqual(ra.planId, rb.planId);
  assert.equal(listPlans(db).length, 2);
  assert.equal(listPlans(db, { sessionId: "A" }).length, 1);
});

test("confirm / reject clears needs_confirmation and sets status", () => {
  const db = freshDb();
  const [cap] = extractPlansFromSession({
    sessionId: "cx",
    plans: [{ source: "codex-proposed-plan", content: "loose", timestamp: "t" }],
  });
  const { planId } = upsertPlanCapture(db, cap);
  assert.equal(getPlan(db, planId).needs_confirmation, 1);

  assert.equal(confirmPlan(db, planId), true);
  let p = getPlan(db, planId);
  assert.equal(p.needs_confirmation, 0);
  assert.equal(p.status, "proposed");

  assert.equal(rejectPlan(db, planId), true);
  p = getPlan(db, planId);
  assert.equal(p.status, "rejected");
});
