/**
 * @file plan-extractor.js
 * @description Pure, dependency-free detection of implementation plans from
 * normalized agent session data and from live Claude Code hook payloads.
 *
 * Structured signals only (PoC decision — no heading/template text heuristic):
 *   Claude Code:
 *     - ExitPlanMode tool_use  → input.plan (+ input.planFilePath)   [high]
 *     - Write tool_use to the Claude plans dir → input.content       [high]
 *   Codex (surfaced into session.plans[] by codex-parser):
 *     - item_completed / item.type === "Plan" → item.text            [high]
 *     - <proposed_plan>…</proposed_plan> in an assistant message     [medium]
 *
 * Emits a normalized PlanCapture consumed by plan-store.upsertPlanCapture.
 * Part of CLOSEDLOOP plan-extraction (FEA-1189 / PLN-613, builds on FEA-1169).
 */
"use strict";

const crypto = require("crypto");

const PROPOSED_PLAN_RE = /<proposed_plan>([\s\S]*?)<\/proposed_plan>/i;

/** sha256 of the trimmed content — the dedup / versioning key. */
function sha256(text) {
  return crypto
    .createHash("sha256")
    .update(String(text == null ? "" : text).trim())
    .digest("hex");
}

/**
 * True when a Write target looks like a Claude plan file. Tolerant by design:
 * the strategy treats `~/.claude/plans/*.md` (or a configured plans dir) as the
 * signal, so we match the `/.claude/plans/` path segment regardless of home
 * expansion or OS path separator. Structured-only: we do NOT guess from
 * arbitrary `*.md` writes.
 */
function isPlanFilePath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) return false;
  const norm = filePath.replace(/\\/g, "/");
  return norm.includes("/.claude/plans/");
}

function basenameNoExt(filePath) {
  if (typeof filePath !== "string") return null;
  const base = filePath.replace(/\\/g, "/").split("/").filter(Boolean).pop();
  if (!base) return null;
  return base.replace(/\.mdx?$/i, "");
}

/** First Markdown H1 (`# Title`) else a sensible fallback. */
function titleFromMarkdown(markdown, fallback) {
  if (typeof markdown === "string") {
    for (const rawLine of markdown.split("\n", 40)) {
      const m = /^\s{0,3}#\s+(.+?)\s*#*\s*$/.exec(rawLine);
      if (m && m[1].trim()) return m[1].trim().slice(0, 200);
    }
  }
  return fallback;
}

/**
 * Canonical PlanCapture factory. Keeps the parser path and the hook path
 * emitting an identical shape so plan-store stays single-path.
 */
function makeCapture({
  harness,
  source,
  captureMethod,
  sessionId,
  content,
  filePath = null,
  sourceLogPath = null,
  confidence,
  sourceEventRef = null,
  capturedAt = null,
}) {
  const contentMarkdown = String(content == null ? "" : content);
  const title = titleFromMarkdown(
    contentMarkdown,
    basenameNoExt(filePath) || `Plan (${source})`,
  );
  return {
    harness,
    source,
    capture_method: captureMethod,
    created_from_session_id: sessionId || null,
    title,
    file_path: filePath,
    source_log_path: sourceLogPath,
    content_markdown: contentMarkdown,
    content_sha256: sha256(contentMarkdown),
    confidence,
    needs_confirmation: confidence < 0.9 ? 1 : 0,
    source_event_ref: sourceEventRef,
    captured_at: capturedAt,
  };
}

/**
 * Best-effort path to the Claude Code session transcript a plan was pulled
 * from. Claude slugifies cwd by replacing `/` and `.` with `-` and stores the
 * transcript at `<CLAUDE_HOME>/projects/<slug>/<sessionId>.jsonl` (same
 * convention the upstream watchdog uses). Returns null if it can't be resolved.
 */
function deriveClaudeTranscriptPath(cwd, sessionId) {
  if (!cwd || !sessionId) return null;
  try {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const home =
      process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude");
    const slug = String(cwd).replace(/[/.]/g, "-");
    const p = path.join(home, "projects", slug, `${sessionId}.jsonl`);
    return fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

function nonEmpty(s) {
  return typeof s === "string" && s.trim().length > 0;
}

/**
 * Extract plan captures from a normalized session object (the shape produced
 * by parseSessionFile for Claude and parseRolloutFile for Codex). Covers the
 * import / watch path — works with hooks OFF (the default).
 *
 * @param {object} session normalized session ({ sessionId, toolUses[], plans[]? })
 * @param {"log"|"import"} [captureMethod="log"]
 * @returns {Array<object>} PlanCapture[]
 */
function extractPlansFromSession(session, captureMethod = "log") {
  if (!session || typeof session !== "object") return [];
  const sessionId = session.sessionId || null;
  const out = [];
  // The agent log this plan was pulled from (Claude transcript JSONL).
  const claudeLog = deriveClaudeTranscriptPath(session.cwd, sessionId);

  // --- Claude Code: ExitPlanMode + plans-dir Write tool_use blocks ---
  const toolUses = Array.isArray(session.toolUses) ? session.toolUses : [];
  for (const tu of toolUses) {
    if (!tu || typeof tu !== "object") continue;
    const input = tu.input && typeof tu.input === "object" ? tu.input : null;
    if (!input) continue;

    if (tu.name === "ExitPlanMode" && nonEmpty(input.plan)) {
      out.push(
        makeCapture({
          harness: "claude",
          source: "claude-exitplanmode",
          captureMethod,
          sessionId,
          content: input.plan,
          filePath:
            input.planFilePath ||
            input.plan_file_path ||
            input.planFile ||
            null,
          sourceLogPath: claudeLog,
          confidence: 1.0,
          sourceEventRef: `ExitPlanMode@${tu.timestamp || ""}`,
          capturedAt: tu.timestamp || null,
        }),
      );
    } else if (
      tu.name === "Write" &&
      isPlanFilePath(input.file_path) &&
      nonEmpty(input.content)
    ) {
      out.push(
        makeCapture({
          harness: "claude",
          source: "claude-plan-write",
          captureMethod,
          sessionId,
          content: input.content,
          filePath: input.file_path,
          sourceLogPath: claudeLog,
          confidence: 1.0,
          sourceEventRef: `Write@${tu.timestamp || ""}`,
          capturedAt: tu.timestamp || null,
        }),
      );
    }
  }

  // --- Codex: plan items surfaced by codex-parser into session.plans[] ---
  const codexPlans = Array.isArray(session.plans) ? session.plans : [];
  for (const cp of codexPlans) {
    if (!cp || typeof cp !== "object" || !nonEmpty(cp.content)) continue;
    const isProposed = cp.source === "codex-proposed-plan";
    out.push(
      makeCapture({
        harness: "codex",
        source: cp.source || "codex-plan-item",
        captureMethod,
        sessionId,
        content: cp.content,
        filePath: null,
        confidence: isProposed ? 0.6 : 1.0,
        sourceEventRef: `${cp.source || "codex-plan"}@${cp.timestamp || ""}`,
        capturedAt: cp.timestamp || null,
      }),
    );
  }

  return out;
}

/**
 * Extract a single plan capture from a live Claude Code hook payload. Only
 * PostToolUse carries a completed tool result; ExitPlanMode / plans-dir Write
 * are the structured signals. Returns null for everything else.
 *
 * @param {string} hookType e.g. "PostToolUse"
 * @param {object} data hook stdin payload ({ session_id, tool_name, tool_input })
 * @returns {object|null} PlanCapture or null
 */
function extractPlanFromHookEvent(hookType, data) {
  if (hookType !== "PostToolUse" || !data || typeof data !== "object") {
    return null;
  }
  const toolName = data.tool_name;
  const input =
    data.tool_input && typeof data.tool_input === "object"
      ? data.tool_input
      : null;
  if (!input) return null;
  const sessionId = data.session_id || null;
  const ts = new Date().toISOString();
  // The hook payload carries the exact transcript path — most reliable source.
  const logPath =
    typeof data.transcript_path === "string" && data.transcript_path
      ? data.transcript_path
      : null;

  if (toolName === "ExitPlanMode" && nonEmpty(input.plan)) {
    return makeCapture({
      harness: "claude",
      source: "claude-exitplanmode",
      captureMethod: "hook",
      sessionId,
      content: input.plan,
      filePath:
        input.planFilePath || input.plan_file_path || input.planFile || null,
      sourceLogPath: logPath,
      confidence: 1.0,
      sourceEventRef: `hook:ExitPlanMode@${ts}`,
      capturedAt: ts,
    });
  }
  if (
    toolName === "Write" &&
    isPlanFilePath(input.file_path) &&
    nonEmpty(input.content)
  ) {
    return makeCapture({
      harness: "claude",
      source: "claude-plan-write",
      captureMethod: "hook",
      sessionId,
      content: input.content,
      filePath: input.file_path,
      sourceLogPath: logPath,
      confidence: 1.0,
      sourceEventRef: `hook:Write@${ts}`,
      capturedAt: ts,
    });
  }
  return null;
}

/**
 * Scan a Claude plans directory (`~/.claude/plans/*.md`) for plan files. This
 * is the strategy §8.3 "file capture" method and the strongest gate-independent
 * Claude signal — these files are exactly the ExitPlanMode / Write targets and
 * exist on disk regardless of whether their session was ever imported.
 *
 * @param {string} plansDir absolute path to the plans directory
 * @returns {Array<object>} PlanCapture[] (source=claude-plan-file, method=file)
 */
function extractPlansFromPlansDir(plansDir) {
  const fs = require("fs");
  const path = require("path");
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(plansDir, { withFileTypes: true });
  } catch {
    return out; // dir absent — nothing to backfill
  }
  for (const ent of entries) {
    if (!ent.isFile() || !/\.mdx?$/i.test(ent.name)) continue;
    const fp = path.join(plansDir, ent.name);
    let content;
    let capturedAt = null;
    try {
      content = fs.readFileSync(fp, "utf8");
      capturedAt = new Date(fs.statSync(fp).mtimeMs).toISOString();
    } catch {
      continue;
    }
    if (!nonEmpty(content)) continue;
    out.push(
      makeCapture({
        harness: "claude",
        source: "claude-plan-file",
        captureMethod: "file",
        sessionId: null,
        content,
        filePath: fp,
        confidence: 1.0,
        sourceEventRef: `plansdir:${ent.name}`,
        capturedAt,
      }),
    );
  }
  return out;
}

/** Parse a <proposed_plan> block out of assistant text (Codex fallback). */
function extractProposedPlanText(text) {
  if (typeof text !== "string") return null;
  const m = PROPOSED_PLAN_RE.exec(text);
  const inner = m && m[1] ? m[1].trim() : "";
  return inner.length > 0 ? inner : null;
}

module.exports = {
  extractPlansFromSession,
  extractPlanFromHookEvent,
  extractPlansFromPlansDir,
  extractProposedPlanText,
  isPlanFilePath,
  titleFromMarkdown,
  sha256,
  makeCapture,
};
