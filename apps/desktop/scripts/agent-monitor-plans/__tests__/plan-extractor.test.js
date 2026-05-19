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

const fs = require("node:fs");
const os = require("node:os");
const nodePath = require("node:path");
const {
  extractPlansFromSession,
  extractPlanFromHookEvent,
  extractPlansFromPlansDir,
  extractProposedPlanText,
  isPlanFilePath,
  titleFromMarkdown,
} = require("../plan-extractor");
const {
  ensurePlanSchema,
  upsertPlanCapture,
  listPlans,
  countPlans,
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

test("extractPlansFromSession suppresses fallback proposed-plan text when a matching Codex plan item exists", () => {
  const caps = extractPlansFromSession({
    sessionId: "cx",
    plans: [
      {
        source: "codex-proposed-plan",
        content: "# Shared Plan\nstep 1",
        timestamp: "t1",
      },
      {
        source: "codex-plan-item",
        content: "# Shared Plan\nstep 1",
        timestamp: "t2",
      },
    ],
  });
  assert.equal(caps.length, 1);
  assert.equal(caps[0].source, "codex-plan-item");
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
    transcript_path: "/u/.claude/projects/proj/h1.jsonl",
  });
  assert.equal(b.source, "claude-plan-write");
  assert.equal(b.file_path, "/u/.claude/plans/x.md");
  assert.equal(b.source_log_path, "/u/.claude/projects/proj/h1.jsonl");
});

test("extractPlanFromHookEvent returns null for non-plan events", () => {
  assert.equal(extractPlanFromHookEvent("PreToolUse", { tool_name: "ExitPlanMode", tool_input: { plan: "x" } }), null);
  assert.equal(extractPlanFromHookEvent("PostToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }), null);
  assert.equal(extractPlanFromHookEvent("PostToolUse", { tool_name: "Write", tool_input: { file_path: "/src/a.ts", content: "c" } }), null);
  assert.equal(extractPlanFromHookEvent("Stop", {}), null);
});

test("extractPlansFromPlansDir scans ~/.claude/plans-style .md files", () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "plansdir-"));
  fs.writeFileSync(nodePath.join(dir, "a.md"), "# Plan A\nstep 1");
  fs.writeFileSync(nodePath.join(dir, "b.md"), "no heading body");
  fs.writeFileSync(nodePath.join(dir, "notes.txt"), "ignored (not .md)");
  fs.writeFileSync(nodePath.join(dir, "empty.md"), "   ");

  const caps = extractPlansFromPlansDir(dir);
  assert.equal(caps.length, 2, "only non-empty .md files");
  const a = caps.find((c) => c.file_path.endsWith("a.md"));
  assert.equal(a.harness, "claude");
  assert.equal(a.source, "claude-plan-file");
  assert.equal(a.capture_method, "file");
  assert.equal(a.confidence, 1.0);
  assert.equal(a.needs_confirmation, 0);
  assert.equal(a.title, "Plan A");
  assert.equal(a.created_from_session_id, null);
  assert.ok(a.file_path.endsWith("a.md"), "plan file path recorded");
  assert.equal(a.source_log_path, null, "plans-dir file has no agent log");
  assert.ok(/^[0-9a-f]{64}$/.test(a.content_sha256));
});

test("plan-store persists file_path and backfills session/log links on dedup", () => {
  const db = freshDb();
  // First pass: plans-dir backfill — file_path set, no agent log.
  const c1 = {
    harness: "claude",
    source: "claude-plan-file",
    capture_method: "file",
    created_from_session_id: null,
    title: "Linkable",
    file_path: "/u/.claude/plans/linkable.md",
    source_log_path: null,
    content_markdown: "# Linkable\nbody",
    content_sha256: require("../plan-extractor").sha256("# Linkable\nbody"),
    confidence: 1,
    needs_confirmation: 0,
    source_event_ref: "plansdir:linkable.md",
    captured_at: null,
  };
  const r1 = upsertPlanCapture(db, c1);
  let p = getPlan(db, r1.planId);
  assert.equal(p.file_path, "/u/.claude/plans/linkable.md");
  assert.equal(p.source_log_path, null);
  assert.equal(p.created_from_session_id, null);

  // Same file/content later via the import sink, now WITH an agent log →
  // deduped (same plan_key + sha256) but the log link is backfilled.
  const r2 = upsertPlanCapture(db, {
    ...c1,
    created_from_session_id: "S1",
    source_log_path: "/u/.claude/projects/p/S1.jsonl",
  });
  assert.equal(r2.deduped, true);
  assert.equal(r2.planId, r1.planId);
  p = getPlan(db, r1.planId);
  assert.equal(p.file_path, "/u/.claude/plans/linkable.md");
  assert.equal(p.source_log_path, "/u/.claude/projects/p/S1.jsonl");
  assert.equal(p.created_from_session_id, "S1");
});

test("extractPlansFromPlansDir tolerates a missing directory", () => {
  assert.deepEqual(
    extractPlansFromPlansDir("/no/such/dir/at/all/plans"),
    [],
  );
});

test("plans-dir captures upsert + dedupe across runs (gate-independent)", () => {
  const db = freshDb();
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "plansdir2-"));
  fs.writeFileSync(nodePath.join(dir, "p.md"), "# P\nv1");
  const [c1] = extractPlansFromPlansDir(dir);
  const r1 = upsertPlanCapture(db, c1);
  assert.equal(r1.created, true);
  // Second startup, unchanged file → dedupe, no new version.
  const [c1again] = extractPlansFromPlansDir(dir);
  assert.equal(upsertPlanCapture(db, c1again).deduped, true);
  // File edited → new version on the same plan_key.
  fs.writeFileSync(nodePath.join(dir, "p.md"), "# P\nv2 edited");
  const [c2] = extractPlansFromPlansDir(dir);
  const r2 = upsertPlanCapture(db, c2);
  assert.equal(r2.planId, r1.planId);
  assert.equal(r2.version, 2);
});

test("Codex proposed-plan and plan-item variants share one plan when they describe the same plan", () => {
  const db = freshDb();
  const caps = extractPlansFromSession({
    sessionId: "cx",
    plans: [
      {
        source: "codex-proposed-plan",
        content: "# Shared Plan\ninitial outline",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        source: "codex-plan-item",
        content: "# Shared Plan\ninitial outline\nfinal step",
        timestamp: "2026-01-01T00:01:00.000Z",
      },
    ],
  });

  assert.equal(caps.length, 2);
  const first = upsertPlanCapture(db, caps[0]);
  const second = upsertPlanCapture(db, caps[1]);
  assert.equal(second.planId, first.planId);
  assert.equal(listVersions(db, first.planId).length, 2);
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

test("listPlans/countPlans apply needs_confirmation filtering before pagination", () => {
  const db = freshDb();
  for (const cap of extractPlansFromSession({
    sessionId: "cx",
    plans: [
      {
        source: "codex-proposed-plan",
        content: "# Needs Review\nfirst",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        source: "codex-proposed-plan",
        content: "# Needs Review Too\nsecond",
        timestamp: "2026-01-01T00:01:00.000Z",
      },
      {
        source: "codex-plan-item",
        content: "# Already Confirmed\nthird",
        timestamp: "2026-01-01T00:02:00.000Z",
      },
    ],
  })) {
    upsertPlanCapture(db, cap);
  }

  const filtered = listPlans(db, {
    sessionId: "cx",
    needsConfirmation: true,
    limit: 1,
    offset: 0,
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].title, "Needs Review Too");
  assert.equal(countPlans(db, { sessionId: "cx", needsConfirmation: true }), 2);
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
