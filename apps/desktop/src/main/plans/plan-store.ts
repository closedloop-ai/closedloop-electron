/**
 * @file plan-store.ts
 * @description PGlite persistence + extraction for captured plans. Combines
 * the old plan-store.js, plan-extractor.js, and plan-backfill.js into a single
 * first-party ESM module for the design-system dashboard runtime.
 *
 * Schema lives in PGLITE_SCHEMA (pglite.ts) — no schema creation here.
 * All DB calls use the PGlite async query API with positional $N params.
 *
 * Part of CLOSEDLOOP plan-extraction (FEA-1189 / PLN-613).
 */

import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Results } from "@electric-sql/pglite";

type DbClient = {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<Results<T>>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function uuid(): string {
  return randomUUID();
}

function sha256(text: string | null | undefined): string {
  return createHash("sha256")
    .update(String(text == null ? "" : text).trim())
    .digest("hex");
}

function nonEmpty(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Plan key derivation (from plan-store.js)
// ---------------------------------------------------------------------------

function firstPlanLine(markdown: string | null | undefined): string | null {
  if (typeof markdown !== "string") return null;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s{0,3}#+\s*/, "").trim();
    if (line) return line.slice(0, 120);
  }
  return null;
}

function normalizePlanKeyPart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized.length > 0 ? normalized : null;
}

export function planKeyFor(capture: PlanCapture): string {
  if (capture.file_path) {
    const base = String(capture.file_path)
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
      .pop();
    if (base) return base;
  }
  const keyPart =
    normalizePlanKeyPart(firstPlanLine(capture.content_markdown)) ||
    normalizePlanKeyPart(capture.title) ||
    normalizePlanKeyPart(capture.source) ||
    "plan";
  const sessionKey = capture.created_from_session_id || "nosession";
  if (capture.harness === "codex") {
    return `${sessionKey}:codex:${keyPart}`;
  }
  return `${sessionKey}:${keyPart}`;
}

// ---------------------------------------------------------------------------
// Title extraction (from plan-extractor.js)
// ---------------------------------------------------------------------------

export function titleFromMarkdown(
  markdown: string | null | undefined,
  fallback: string,
): string {
  if (typeof markdown === "string") {
    for (const rawLine of markdown.split("\n", 40)) {
      const m = /^\s{0,3}#\s+(.+?)\s*#*\s*$/.exec(rawLine);
      if (m && m[1].trim()) return m[1].trim().slice(0, 200);
    }
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Plan file path detection (from plan-extractor.js)
// ---------------------------------------------------------------------------

export function isPlanFilePath(filePath: unknown): boolean {
  if (typeof filePath !== "string" || filePath.length === 0) return false;
  const norm = filePath.replace(/\\/g, "/");
  return norm.includes("/.claude/plans/");
}

function basenameNoExt(filePath: string | null | undefined): string | null {
  if (typeof filePath !== "string") return null;
  const base = filePath
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop();
  if (!base) return null;
  return base.replace(/\.mdx?$/i, "");
}

// ---------------------------------------------------------------------------
// PlanCapture shape (the normalized object that all extraction paths emit)
// ---------------------------------------------------------------------------

export interface PlanCapture {
  harness: string;
  source: string;
  capture_method: string;
  created_from_session_id: string | null;
  title: string;
  file_path: string | null;
  source_log_path: string | null;
  content_markdown: string;
  content_sha256: string;
  confidence: number;
  needs_confirmation: boolean;
  source_event_ref: string | null;
  captured_at: string | null;
}

export function makeCapture(opts: {
  harness: string;
  source: string;
  captureMethod: string;
  sessionId: string | null;
  content: string | null | undefined;
  filePath?: string | null;
  sourceLogPath?: string | null;
  confidence: number;
  sourceEventRef?: string | null;
  capturedAt?: string | null;
}): PlanCapture {
  const contentMarkdown = String(opts.content == null ? "" : opts.content);
  const title = titleFromMarkdown(
    contentMarkdown,
    basenameNoExt(opts.filePath ?? null) || `Plan (${opts.source})`,
  );
  return {
    harness: opts.harness,
    source: opts.source,
    capture_method: opts.captureMethod,
    created_from_session_id: opts.sessionId || null,
    title,
    file_path: opts.filePath ?? null,
    source_log_path: opts.sourceLogPath ?? null,
    content_markdown: contentMarkdown,
    content_sha256: sha256(contentMarkdown),
    confidence: opts.confidence,
    needs_confirmation: opts.confidence < 0.9,
    source_event_ref: opts.sourceEventRef ?? null,
    captured_at: opts.capturedAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Extraction: from session objects (import/watch path)
// ---------------------------------------------------------------------------

const PROPOSED_PLAN_RE = /<proposed_plan>([\s\S]*?)<\/proposed_plan>/i;

export function extractProposedPlanText(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const m = PROPOSED_PLAN_RE.exec(text);
  const inner = m && m[1] ? m[1].trim() : "";
  return inner.length > 0 ? inner : null;
}

function deriveClaudeTranscriptPath(
  cwd: string | null | undefined,
  sessionId: string | null | undefined,
): string | null {
  if (!cwd || !sessionId) return null;
  try {
    const home = process.env.CLAUDE_HOME || join(homedir(), ".claude");
    const slug = String(cwd).replace(/[/.]/g, "-");
    const p = join(home, "projects", slug, `${sessionId}.jsonl`);
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

interface ToolUseInput {
  plan?: string;
  planFilePath?: string;
  plan_file_path?: string;
  planFile?: string;
  file_path?: string;
  content?: string;
}

interface ToolUseEntry {
  name?: string;
  input?: ToolUseInput | null;
  timestamp?: string;
}

interface CodexPlan {
  source?: string;
  content?: string;
  timestamp?: string;
}

interface NormalizedSessionForPlans {
  sessionId?: string | null;
  cwd?: string | null;
  toolUses?: ToolUseEntry[];
  plans?: CodexPlan[];
}

export function extractPlansFromSession(
  session: NormalizedSessionForPlans | null | undefined,
  captureMethod: "log" | "import" = "log",
): PlanCapture[] {
  if (!session || typeof session !== "object") return [];
  const sessionId = session.sessionId || null;
  const out: PlanCapture[] = [];
  const claudeLog = deriveClaudeTranscriptPath(session.cwd, sessionId);

  // Claude Code: ExitPlanMode + plans-dir Write tool_use blocks
  const toolUses = Array.isArray(session.toolUses) ? session.toolUses : [];
  for (const tu of toolUses) {
    if (!tu || typeof tu !== "object") continue;
    const input =
      tu.input && typeof tu.input === "object" ? tu.input : null;
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
            input.planFilePath || input.plan_file_path || input.planFile || null,
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

  // Codex: plan items surfaced by codex-parser into session.plans[]
  const codexPlans = Array.isArray(session.plans) ? session.plans : [];
  const structuredCodexPlanHashes = new Set(
    codexPlans
      .filter(
        (cp): cp is CodexPlan =>
          cp != null &&
          typeof cp === "object" &&
          cp.source === "codex-plan-item" &&
          nonEmpty(cp.content),
      )
      .map((cp) => sha256(cp.content)),
  );
  for (const cp of codexPlans) {
    if (!cp || typeof cp !== "object" || !nonEmpty(cp.content)) continue;
    const isProposed = cp.source === "codex-proposed-plan";
    if (isProposed && structuredCodexPlanHashes.has(sha256(cp.content))) {
      continue;
    }
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

// ---------------------------------------------------------------------------
// Extraction: from live Claude Code hook payload
// ---------------------------------------------------------------------------

interface HookEventData {
  tool_name?: string;
  tool_input?: ToolUseInput | null;
  session_id?: string;
  transcript_path?: string;
}

export function extractPlanFromEvent(
  data: HookEventData | null | undefined,
  harness: string,
): { plan: PlanCapture } | null {
  if (!data || typeof data !== "object") return null;
  const toolName = data.tool_name;
  const input =
    data.tool_input && typeof data.tool_input === "object"
      ? data.tool_input
      : null;
  if (!input) return null;
  const sessionId = data.session_id || null;
  const ts = new Date().toISOString();
  const logPath =
    typeof data.transcript_path === "string" && data.transcript_path
      ? data.transcript_path
      : null;

  if (toolName === "ExitPlanMode" && nonEmpty(input.plan)) {
    return {
      plan: makeCapture({
        harness,
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
      }),
    };
  }
  if (
    toolName === "Write" &&
    isPlanFilePath(input.file_path) &&
    nonEmpty(input.content)
  ) {
    return {
      plan: makeCapture({
        harness,
        source: "claude-plan-write",
        captureMethod: "hook",
        sessionId,
        content: input.content,
        filePath: input.file_path,
        sourceLogPath: logPath,
        confidence: 1.0,
        sourceEventRef: `hook:Write@${ts}`,
        capturedAt: ts,
      }),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Extraction: from ~/.claude/plans/ directory (file capture)
// ---------------------------------------------------------------------------

export function extractPlansFromPlansDir(plansDir: string): PlanCapture[] {
  const out: PlanCapture[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(plansDir, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (!ent.isFile() || !/\.mdx?$/i.test(ent.name)) continue;
    const fp = join(plansDir, ent.name);
    let content: string;
    let capturedAt: string | null = null;
    try {
      content = readFileSync(fp, "utf8");
      capturedAt = new Date(statSync(fp).mtimeMs).toISOString();
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

// ---------------------------------------------------------------------------
// DB: find existing plan row
// ---------------------------------------------------------------------------

interface PlanRow extends Record<string, unknown> {
  id: string;
  plan_key: string | null;
  harness: string | null;
  created_from_session_id: string | null;
  file_path: string | null;
  source_log_path: string | null;
  updated_at: string | null;
}

async function findExistingPlan(
  db: DbClient,
  capture: PlanCapture,
  planKey: string,
): Promise<PlanRow | null> {
  const harness = capture.harness || null;
  const sessionId = capture.created_from_session_id || null;

  if (capture.file_path) {
    const result = await db.query<PlanRow>(
      `SELECT * FROM plans
       WHERE harness IS NOT DISTINCT FROM $1 AND plan_key = $2
         AND (file_path = $3 OR file_path IS NULL)
       ORDER BY CASE WHEN file_path = $4 THEN 0 ELSE 1 END,
                CASE WHEN created_from_session_id IS NULL THEN 1 ELSE 0 END,
                updated_at DESC
       LIMIT 1`,
      [harness, planKey, capture.file_path, capture.file_path],
    );
    return result.rows[0] ?? null;
  }

  const result = await db.query<PlanRow>(
    `SELECT * FROM plans
     WHERE harness IS NOT DISTINCT FROM $1
       AND created_from_session_id IS NOT DISTINCT FROM $2
       AND plan_key = $3
     ORDER BY updated_at DESC
     LIMIT 1`,
    [harness, sessionId, planKey],
  );
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// DB: upsertPlan (upsertPlanCapture)
// ---------------------------------------------------------------------------

interface UpsertPlanResult {
  planId: string;
  versionId: string | null;
  version: number;
  deduped: boolean;
  created: boolean;
}

export async function upsertPlan(
  db: DbClient,
  capture: PlanCapture,
): Promise<UpsertPlanResult> {
  const planKey = planKeyFor(capture);
  const sessionId = capture.created_from_session_id || null;
  const ts = capture.captured_at || nowIso();

  const existingPlan = await findExistingPlan(db, capture, planKey);

  let planId: string;
  let created = false;

  if (existingPlan) {
    planId = existingPlan.id;
    const latestResult = await db.query<{
      content_sha256: string;
      version_number: number;
    } & Record<string, unknown>>(
      `SELECT content_sha256, version_number
       FROM plan_versions WHERE plan_id = $1
       ORDER BY version_number DESC LIMIT 1`,
      [planId],
    );
    const latest = latestResult.rows[0] ?? null;

    if (latest && latest.content_sha256 === capture.content_sha256) {
      // Identical content — no-op for versioning, backfill links if missing.
      if (capture.file_path || capture.source_log_path) {
        await db.query(
          `UPDATE plans
             SET created_from_session_id = COALESCE(created_from_session_id, $1),
                 file_path = COALESCE(file_path, $2),
                 source_log_path = COALESCE(source_log_path, $3)
           WHERE id = $4`,
          [
            sessionId,
            capture.file_path || null,
            capture.source_log_path || null,
            planId,
          ],
        );
      } else if (sessionId) {
        await db.query(
          `UPDATE plans
             SET created_from_session_id = COALESCE(created_from_session_id, $1)
           WHERE id = $2`,
          [sessionId, planId],
        );
      }
      return {
        planId,
        versionId: null,
        version: latest.version_number,
        deduped: true,
        created: false,
      };
    }
  } else {
    planId = uuid();
    await db.query(
      `INSERT INTO plans
        (id, title, status, source,
         capture_method, harness, created_from_session_id, created_from_event_id,
         plan_key, file_path, source_log_path, needs_confirmation, confidence,
         sync_state, metadata, created_at, updated_at)
       VALUES ($1, $2, 'active', 'captured', $3, $4, $5, $6, $7, $8, $9, $10, $11,
               'local_only', NULL, $12, $13)`,
      [
        planId,
        capture.title || null,
        capture.capture_method || null,
        capture.harness || null,
        sessionId,
        capture.source_event_ref || null,
        planKey,
        capture.file_path || null,
        capture.source_log_path || null,
        capture.needs_confirmation,
        capture.confidence,
        ts,
        ts,
      ],
    );
    created = true;
  }

  // Determine next version number
  const nextRow = await db.query<{ n: number } & Record<string, unknown>>(
    `SELECT COALESCE(MAX(version_number), 0) AS n
     FROM plan_versions WHERE plan_id = $1`,
    [planId],
  );
  const versionNumber = (nextRow.rows[0]?.n ?? 0) + 1;
  const versionId = uuid();

  await db.query(
    `INSERT INTO plan_versions
      (id, plan_id, version_number, content_markdown, content_json,
       content_sha256, author_type, author_user_id, source_session_id,
       source_event_ref, capture_method, created_at)
     VALUES ($1, $2, $3, $4, NULL, $5, 'agent', NULL, $6, $7, $8, $9)`,
    [
      versionId,
      planId,
      versionNumber,
      capture.content_markdown,
      capture.content_sha256,
      sessionId,
      capture.source_event_ref || null,
      capture.capture_method || null,
      ts,
    ],
  );

  // Refresh the plan's latest-capture signals.
  await db.query(
    `UPDATE plans
       SET title = COALESCE($1, title),
           capture_method = COALESCE($2, capture_method),
           harness = COALESCE($3, harness),
           created_from_session_id = COALESCE(created_from_session_id, $4),
           file_path = COALESCE($5, file_path),
           source_log_path = COALESCE($6, source_log_path),
           needs_confirmation = $7,
           confidence = $8,
           updated_at = $9
     WHERE id = $10`,
    [
      capture.title || null,
      capture.capture_method || null,
      capture.harness || null,
      sessionId,
      capture.file_path || null,
      capture.source_log_path || null,
      capture.needs_confirmation,
      capture.confidence,
      ts,
      planId,
    ],
  );

  return {
    planId,
    versionId,
    version: versionNumber,
    deduped: false,
    created,
  };
}

// ---------------------------------------------------------------------------
// DB: upsertPlanVersion
// ---------------------------------------------------------------------------

export interface PlanVersionInput {
  plan_id: string;
  content_markdown: string;
  content_sha256?: string;
  author_type?: string;
  author_user_id?: string | null;
  source_session_id?: string | null;
  source_event_ref?: string | null;
  capture_method?: string | null;
}

export async function upsertPlanVersion(
  db: DbClient,
  version: PlanVersionInput,
): Promise<{ versionId: string; versionNumber: number; deduped: boolean }> {
  const contentSha = version.content_sha256 ?? sha256(version.content_markdown);

  // Check for dedup
  const latestResult = await db.query<{
    content_sha256: string;
    version_number: number;
  } & Record<string, unknown>>(
    `SELECT content_sha256, version_number
     FROM plan_versions WHERE plan_id = $1
     ORDER BY version_number DESC LIMIT 1`,
    [version.plan_id],
  );
  const latest = latestResult.rows[0] ?? null;
  if (latest && latest.content_sha256 === contentSha) {
    return {
      versionId: "",
      versionNumber: latest.version_number,
      deduped: true,
    };
  }

  const versionNumber = (latest?.version_number ?? 0) + 1;
  const versionId = uuid();
  const ts = nowIso();

  await db.query(
    `INSERT INTO plan_versions
      (id, plan_id, version_number, content_markdown, content_json,
       content_sha256, author_type, author_user_id, source_session_id,
       source_event_ref, capture_method, created_at)
     VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10, $11)`,
    [
      versionId,
      version.plan_id,
      versionNumber,
      version.content_markdown,
      contentSha,
      version.author_type ?? "agent",
      version.author_user_id ?? null,
      version.source_session_id ?? null,
      version.source_event_ref ?? null,
      version.capture_method ?? null,
      ts,
    ],
  );

  // Refresh the plan's updated_at timestamp.
  await db.query(
    `UPDATE plans SET updated_at = $1 WHERE id = $2`,
    [ts, version.plan_id],
  );

  return { versionId, versionNumber, deduped: false };
}

// ---------------------------------------------------------------------------
// DB: list / get / count
// ---------------------------------------------------------------------------

interface PlanListFilters {
  sessionId?: string | null;
  needsConfirmation?: boolean | null;
  limit?: number;
  offset?: number;
}

function buildPlanListFilters(opts: PlanListFilters): {
  clause: string;
  params: unknown[];
  nextParam: number;
} {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (opts.sessionId) {
    clauses.push(`created_from_session_id = $${idx}`);
    params.push(opts.sessionId);
    idx++;
  }
  if (typeof opts.needsConfirmation === "boolean") {
    clauses.push(`needs_confirmation = $${idx}`);
    params.push(opts.needsConfirmation);
    idx++;
  }
  return {
    clause: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
    nextParam: idx,
  };
}

export async function listPlans(
  db: DbClient,
  opts: PlanListFilters = {},
): Promise<Record<string, unknown>[]> {
  const { limit = 100, offset = 0 } = opts;
  const filters = buildPlanListFilters(opts);
  const result = await db.query(
    `SELECT * FROM plans${filters.clause}
     ORDER BY updated_at DESC LIMIT $${filters.nextParam} OFFSET $${filters.nextParam + 1}`,
    [...filters.params, limit, offset],
  );
  return result.rows;
}

export async function countPlans(
  db: DbClient,
  opts: Omit<PlanListFilters, "limit" | "offset"> = {},
): Promise<number> {
  const filters = buildPlanListFilters(opts);
  const result = await db.query<{ c: number } & Record<string, unknown>>(
    `SELECT COUNT(*)::int AS c FROM plans${filters.clause}`,
    filters.params,
  );
  return result.rows[0]?.c ?? 0;
}

export async function getPlanVersions(
  db: DbClient,
  planId: string,
): Promise<Record<string, unknown>[]> {
  const result = await db.query(
    `SELECT id, plan_id, version_number, content_markdown, content_sha256,
            author_type, source_session_id, source_event_ref, capture_method,
            created_at
     FROM plan_versions WHERE plan_id = $1
     ORDER BY version_number ASC`,
    [planId],
  );
  return result.rows;
}

export async function getPlan(
  db: DbClient,
  id: string,
): Promise<(Record<string, unknown> & { versions: Record<string, unknown>[] }) | null> {
  const result = await db.query(`SELECT * FROM plans WHERE id = $1`, [id]);
  const plan = result.rows[0];
  if (!plan) return null;
  const versions = await getPlanVersions(db, id);
  return { ...plan, versions };
}

// ---------------------------------------------------------------------------
// DB: confirm / reject
// ---------------------------------------------------------------------------

export async function confirmPlan(db: DbClient, id: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE plans
       SET needs_confirmation = FALSE, status = 'confirmed', updated_at = $1
     WHERE id = $2`,
    [nowIso(), id],
  );
  return (result.affectedRows ?? 0) > 0;
}

export async function rejectPlan(db: DbClient, id: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE plans
       SET needs_confirmation = FALSE, status = 'rejected', updated_at = $1
     WHERE id = $2`,
    [nowIso(), id],
  );
  return (result.affectedRows ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Backfill: scan ~/.claude/plans/ and upsert (from plan-backfill.js)
// ---------------------------------------------------------------------------

function resolveClaudeHome(): string {
  return (
    process.env.CLAUDE_HOME || join(homedir(), ".claude")
  );
}

export async function backfillPlansFromDirectory(
  db: DbClient,
  plansDir?: string,
): Promise<{ captured: number; deduped: number; errors: number }> {
  const dir = plansDir ?? join(resolveClaudeHome(), "plans");
  let captured = 0;
  let deduped = 0;
  let errors = 0;

  for (const cap of extractPlansFromPlansDir(dir)) {
    try {
      const r = await upsertPlan(db, cap);
      if (r.deduped) {
        deduped += 1;
      } else {
        captured += 1;
      }
    } catch {
      errors += 1;
    }
  }

  return { captured, deduped, errors };
}
