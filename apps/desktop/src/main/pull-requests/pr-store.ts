/**
 * @file pr-store.ts
 * @description PGlite persistence, extraction, and backfill for captured pull
 * requests. Combines the old pull-request-store.js, pr-extractor.js,
 * pr-parsers.js, and pr-backfill.js into a single first-party ESM module for
 * the design-system dashboard runtime.
 *
 * Schema lives in PGLITE_SCHEMA (pglite.ts) — no schema creation here.
 * All DB calls use the PGlite async query API with positional $N params.
 *
 * Part of CLOSEDLOOP engineer GitHub activity capture (FEA-1226).
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { Results } from "@electric-sql/pglite";
import type {
  PrRecord,
  PrSessionGroup,
  PrStats,
} from "../../shared/agent-db-contract.js";

type DbClient = {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<Results<T>>;
};

interface PrRow extends Record<string, unknown> {
  id: string;
  session_id: string | null;
  pr_url: string;
  pr_number: number | null;
  repo_full_name: string | null;
  branch_name: string | null;
  head_sha: string | null;
  title: string | null;
  harness: string | null;
  observed_at: string | null;
  created_at: string | null;
}

function toPrRecord(row: PrRow): PrRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    prUrl: row.pr_url,
    prNumber: row.pr_number,
    repoFullName: row.repo_full_name,
    branchName: row.branch_name,
    headSha: row.head_sha,
    title: row.title,
    harness: row.harness,
    observedAt: row.observed_at,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

/** Deterministic 16-hex id — same PR in the same session dedups to one row. */
function pullRequestId(
  harness: string,
  sessionId: string,
  prUrl: string,
): string {
  return createHash("sha256")
    .update(`${harness}|${sessionId}|${prUrl}`)
    .digest("hex")
    .slice(0, 16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// PR URL parsing (from pr-parsers.js)
// ---------------------------------------------------------------------------

const GITHUB_PR_URL_RE =
  /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(?!new\b)(\d+)/g;

const FIXTURE_OWNER_RE =
  /^(?:owner|acme|org|example|test-org|sample|fixtures?|placeholder|repo)$/i;

const PENDING_COMMAND_CAP = 256;

export function isFixtureOwner(owner: string): boolean {
  return FIXTURE_OWNER_RE.test(owner);
}

interface PrUrlRef {
  prUrl: string;
  prNumber: number;
  repoFullName: string;
  owner: string;
}

export function extractPrUrlsFromText(text: unknown): PrUrlRef[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const seen = new Set<string>();
  const refs: PrUrlRef[] = [];
  for (const match of text.matchAll(GITHUB_PR_URL_RE)) {
    const owner = match[1];
    const repo = match[2];
    const prNumberRaw = match[3];
    if (!owner || !repo || !prNumberRaw) continue;
    if (isFixtureOwner(owner)) continue;
    const prNumber = Number.parseInt(prNumberRaw, 10);
    if (!Number.isFinite(prNumber) || prNumber <= 0) continue;
    const prUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;
    if (seen.has(prUrl)) continue;
    seen.add(prUrl);
    refs.push({ prUrl, prNumber, repoFullName: `${owner}/${repo}`, owner });
  }
  return refs;
}

export function isPrCreateCommand(cmd: unknown): boolean {
  if (typeof cmd !== "string") return false;
  return /(?:^|[;&|(\n\t])\s*(?:\S+=\S+\s+)*gh\s+pr\s+create(?:$|[\s'")])/.test(
    cmd,
  );
}

export function safeParseLine(
  line: unknown,
): Record<string, unknown> | null {
  if (typeof line !== "string") return null;
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Session parser state + line parser (from pr-parsers.js)
// ---------------------------------------------------------------------------

interface SessionParserState {
  claudeBashCommands: Map<string, string>;
  codexCallCommands: Map<string, string>;
  codexSessionId: string | null;
}

export function createSessionParserState(): SessionParserState {
  return {
    claudeBashCommands: new Map(),
    codexCallCommands: new Map(),
    codexSessionId: null,
  };
}

function flattenContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      if (typeof item === "string") {
        parts.push(item);
      } else if (isRecord(item)) {
        for (const key of ["text", "output", "content", "result"]) {
          if (typeof item[key] === "string") parts.push(item[key] as string);
        }
      }
    }
    return parts.join("\n");
  }
  return "";
}

function rememberCommand(
  map: Map<string, string>,
  key: string,
  command: string,
): void {
  map.delete(key);
  map.set(key, command);
  if (map.size > PENDING_COMMAND_CAP) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

function extractCodexCommand(args: unknown): string {
  if (typeof args !== "string") return "";
  try {
    const parsed = JSON.parse(args);
    if (isRecord(parsed) && typeof parsed.cmd === "string")
      return parsed.cmd as string;
  } catch {
    /* arguments not JSON — fall through */
  }
  return args;
}

function extractParsedCmd(parsedCmd: unknown): string {
  if (!Array.isArray(parsedCmd)) return "";
  return parsedCmd
    .map((entry: unknown) =>
      isRecord(entry) && typeof entry.cmd === "string"
        ? (entry.cmd as string)
        : "",
    )
    .filter((c: string) => c.length > 0)
    .join(" && ");
}

function extractHeadBranch(command: string): string | null {
  const match = /--head[=\s]+(\S+)/.exec(command);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Per-harness line parsers (from pr-parsers.js)
// ---------------------------------------------------------------------------

interface PrDraft {
  prUrl: string;
  prNumber: number;
  repoFullName: string;
  branchName: string | null;
  headSha: string | null;
  harness: string;
  externalSessionId: string;
  observedAt?: string;
  title?: string | null;
}

function loopEvent(
  parsed: Record<string, unknown>,
  fallbackSessionId: string,
): PrDraft[] {
  const prUrl = typeof parsed.prUrl === "string" ? parsed.prUrl : null;
  if (!prUrl) return [];
  const refs = extractPrUrlsFromText(prUrl);
  if (refs.length === 0) return [];
  const ref = refs[0];
  const sessionId =
    typeof parsed.sessionId === "string" && parsed.sessionId
      ? parsed.sessionId
      : fallbackSessionId;
  return [
    {
      prUrl: ref.prUrl,
      prNumber: ref.prNumber,
      repoFullName: ref.repoFullName,
      branchName:
        typeof parsed.branchName === "string" ? parsed.branchName : null,
      headSha:
        typeof parsed.commitSha === "string" ? parsed.commitSha : null,
      harness: "closedloop-loop",
      externalSessionId: sessionId,
    },
  ];
}

function claudeEvents(
  parsed: Record<string, unknown>,
  fallbackSessionId: string,
  state: SessionParserState,
): PrDraft[] {
  const message = isRecord(parsed.message) ? parsed.message : null;
  const content =
    message && Array.isArray(message.content) ? message.content : [];

  if (parsed.type === "assistant") {
    for (const block of content) {
      if (
        !isRecord(block) ||
        block.type !== "tool_use" ||
        block.name !== "Bash"
      )
        continue;
      const id = typeof block.id === "string" ? block.id : null;
      const input = isRecord(block.input) ? block.input : null;
      const command =
        input && typeof input.command === "string"
          ? (input.command as string)
          : "";
      if (id) rememberCommand(state.claudeBashCommands, id, command);
    }
    return [];
  }

  const sessionId =
    typeof parsed.sessionId === "string" && parsed.sessionId
      ? parsed.sessionId
      : fallbackSessionId;
  const branchName =
    typeof parsed.gitBranch === "string" && parsed.gitBranch
      ? parsed.gitBranch
      : null;
  const events: PrDraft[] = [];
  for (const block of content) {
    if (!isRecord(block) || block.type !== "tool_result") continue;
    const toolUseId =
      typeof block.tool_use_id === "string" ? block.tool_use_id : null;
    const command = toolUseId
      ? state.claudeBashCommands.get(toolUseId)
      : undefined;
    if (toolUseId) state.claudeBashCommands.delete(toolUseId);
    if (!isPrCreateCommand(command)) continue;
    const body = flattenContent(block.content);
    for (const ref of extractPrUrlsFromText(body)) {
      events.push({
        prUrl: ref.prUrl,
        prNumber: ref.prNumber,
        repoFullName: ref.repoFullName,
        branchName,
        headSha: null,
        harness: "claude-code",
        externalSessionId: sessionId,
      });
    }
  }
  return events;
}

function codexEventsFor(
  body: string,
  command: string,
  sessionId: string,
): PrDraft[] {
  const branchName = extractHeadBranch(command);
  return extractPrUrlsFromText(body).map((ref) => ({
    prUrl: ref.prUrl,
    prNumber: ref.prNumber,
    repoFullName: ref.repoFullName,
    branchName,
    headSha: null,
    harness: "codex",
    externalSessionId: sessionId,
  }));
}

function codexEvents(
  parsed: Record<string, unknown>,
  fallbackSessionId: string,
  state: SessionParserState,
): PrDraft[] {
  const payload = isRecord(parsed.payload) ? parsed.payload : null;
  if (!payload) return [];
  const sessionId = state.codexSessionId || fallbackSessionId;

  switch (payload.type) {
    case "function_call": {
      const callId =
        typeof payload.call_id === "string" ? payload.call_id : null;
      const command = extractCodexCommand(payload.arguments);
      if (callId) rememberCommand(state.codexCallCommands, callId, command);
      return [];
    }
    case "function_call_output": {
      const callId =
        typeof payload.call_id === "string" ? payload.call_id : null;
      const command = callId
        ? state.codexCallCommands.get(callId)
        : undefined;
      if (callId) state.codexCallCommands.delete(callId);
      if (!isPrCreateCommand(command)) return [];
      return codexEventsFor(
        flattenContent(payload.output),
        command || "",
        sessionId,
      );
    }
    case "exec_command_end": {
      const command = extractParsedCmd(payload.parsed_cmd);
      if (!isPrCreateCommand(command)) return [];
      return codexEventsFor(
        flattenContent(payload.aggregated_output),
        command,
        sessionId,
      );
    }
    default:
      return [];
  }
}

export function parseSessionLine(
  parsed: Record<string, unknown>,
  fallbackSessionId: string,
  state: SessionParserState,
): PrDraft[] {
  if (!isRecord(parsed)) return [];
  switch (parsed.type) {
    case "pr-link":
      return loopEvent(parsed, fallbackSessionId);
    case "assistant":
    case "user":
      return claudeEvents(parsed, fallbackSessionId, state);
    case "event_msg":
    case "response_item":
      return codexEvents(parsed, fallbackSessionId, state);
    case "session_meta": {
      const payload = isRecord(parsed.payload) ? parsed.payload : null;
      if (payload && typeof payload.id === "string") {
        state.codexSessionId = payload.id;
      }
      return [];
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Extraction: from pre-read JSONL text (from pr-extractor.js)
// ---------------------------------------------------------------------------

export function extractPullRequestsFromText(
  text: string,
  sessionId: string | null,
): PrDraft[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const canonicalSessionId =
    typeof sessionId === "string" ? sessionId : null;
  const state = createSessionParserState();
  const observedAt = new Date().toISOString();
  const out: PrDraft[] = [];

  for (const line of text.split("\n")) {
    if (!line) continue;
    const parsed = safeParseLine(line);
    if (!parsed) continue;
    for (const ev of parseSessionLine(
      parsed,
      canonicalSessionId || "",
      state,
    )) {
      out.push({
        prUrl: ev.prUrl,
        prNumber: ev.prNumber,
        repoFullName: ev.repoFullName,
        branchName: ev.branchName,
        headSha: ev.headSha,
        harness: ev.harness,
        externalSessionId: canonicalSessionId || ev.externalSessionId,
        observedAt,
      });
    }
  }
  return out;
}

/**
 * Session-shaped entry used by the live importSession PR-extract block.
 * Reads the file from disk and delegates to extractPullRequestsFromText.
 * Returns [] on read failure for backward compat.
 */
export function extractPullRequestsFromSession(session: {
  sessionId?: string;
  sourceLogPath?: string;
}): PrDraft[] {
  if (!session || typeof session.sourceLogPath !== "string") return [];
  let text: string;
  try {
    text = readFileSync(session.sourceLogPath, "utf8");
  } catch {
    return [];
  }
  return extractPullRequestsFromText(text, session.sessionId ?? null);
}

// ---------------------------------------------------------------------------
// Extraction: from live hook event data
// ---------------------------------------------------------------------------

interface HookEventData {
  tool_name?: string;
  tool_input?: Record<string, unknown> | null;
  tool_result?: unknown;
  session_id?: string;
  transcript_path?: string;
  git_branch?: string;
}

export function extractPrFromEvent(
  data: HookEventData | null | undefined,
  harness: string,
  sessionId: string | null,
): PrDraft | null {
  if (!data || typeof data !== "object") return null;
  const _toolName = data.tool_name;
  const input =
    data.tool_input && typeof data.tool_input === "object"
      ? data.tool_input
      : null;

  if (!isPrCreateCommand(input?.command)) return null;

  // Extract PR URL from tool result
  const resultText = flattenContent(data.tool_result);
  const refs = extractPrUrlsFromText(resultText);
  if (refs.length === 0) return null;

  const ref = refs[0];
  const branchName =
    typeof data.git_branch === "string" && data.git_branch
      ? data.git_branch
      : extractHeadBranch(
          typeof input?.command === "string" ? (input.command as string) : "",
        );

  return {
    prUrl: ref.prUrl,
    prNumber: ref.prNumber,
    repoFullName: ref.repoFullName,
    branchName,
    headSha: null,
    harness,
    externalSessionId: sessionId || data.session_id || "",
    observedAt: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// DB: upsertPullRequest
// ---------------------------------------------------------------------------

interface PullRequestInput {
  externalSessionId: string;
  prUrl: string;
  prNumber: number;
  repoFullName: string;
  branchName?: string | null;
  headSha?: string | null;
  title?: string | null;
  harness: string;
  observedAt?: string;
}

export async function upsertPullRequest(
  db: DbClient,
  pr: PullRequestInput,
): Promise<{ id: string; created: boolean }> {
  const id = pullRequestId(pr.harness, pr.externalSessionId, pr.prUrl);
  const existingResult = await db.query<{ id: string } & Record<string, unknown>>(
    `SELECT id FROM pull_requests WHERE id = $1`,
    [id],
  );

  if (existingResult.rows.length > 0) {
    await db.query(
      `UPDATE pull_requests
         SET branch_name = COALESCE(branch_name, $1),
             head_sha    = COALESCE(head_sha, $2),
             title       = COALESCE(title, $3)
       WHERE id = $4`,
      [pr.branchName || null, pr.headSha || null, pr.title || null, id],
    );
    return { id, created: false };
  }

  await db.query(
    `INSERT INTO pull_requests
       (id, session_id, pr_url, pr_number, repo_full_name, branch_name,
        head_sha, title, harness, observed_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      pr.externalSessionId || null,
      pr.prUrl,
      pr.prNumber,
      pr.repoFullName,
      pr.branchName || null,
      pr.headSha || null,
      pr.title || null,
      pr.harness,
      pr.observedAt || nowIso(),
      nowIso(),
    ],
  );
  return { id, created: true };
}

// ---------------------------------------------------------------------------
// DB: list / count / stats
// ---------------------------------------------------------------------------

interface PrListFilters {
  sessionId?: string | null;
  repo?: string | null;
  limit?: number;
  offset?: number;
}

function buildPrFilter(opts: PrListFilters): {
  where: string;
  params: unknown[];
  nextParam: number;
} {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (opts.sessionId) {
    clauses.push(`session_id = $${idx}`);
    params.push(opts.sessionId);
    idx++;
  }
  if (opts.repo) {
    clauses.push(`repo_full_name = $${idx}`);
    params.push(opts.repo);
    idx++;
  }
  return {
    where: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
    nextParam: idx,
  };
}

export async function listPullRequests(
  db: DbClient,
  opts: PrListFilters = {},
): Promise<PrRecord[]> {
  const { limit = 100, offset = 0 } = opts;
  const { where, params, nextParam } = buildPrFilter(opts);
  const result = await db.query<PrRow>(
    `SELECT * FROM pull_requests${where}
     ORDER BY observed_at DESC LIMIT $${nextParam} OFFSET $${nextParam + 1}`,
    [...params, limit, offset],
  );
  return result.rows.map(toPrRecord);
}

export async function countPullRequests(
  db: DbClient,
  opts: Omit<PrListFilters, "limit" | "offset"> = {},
): Promise<number> {
  const { where, params } = buildPrFilter(opts);
  const result = await db.query<{ c: number } & Record<string, unknown>>(
    `SELECT COUNT(*)::int AS c FROM pull_requests${where}`,
    params,
  );
  return result.rows[0]?.c ?? 0;
}

export async function countRepos(db: DbClient): Promise<number> {
  const result = await db.query<{ c: number } & Record<string, unknown>>(
    `SELECT COUNT(DISTINCT repo_full_name)::int AS c FROM pull_requests`,
  );
  return result.rows[0]?.c ?? 0;
}

export async function getPrStats(db: DbClient): Promise<PrStats> {
  const result = await db.query<{
    total_prs: number;
    total_repos: number;
    total_sessions: number;
  } & Record<string, unknown>>(
    `SELECT
       COUNT(*)::int AS total_prs,
       COUNT(DISTINCT repo_full_name)::int AS total_repos,
       COUNT(DISTINCT session_id)::int AS total_sessions
     FROM pull_requests`,
  );
  const row = result.rows[0];
  return {
    totalPrs: row?.total_prs ?? 0,
    repos: row?.total_repos ?? 0,
    sessionsWithPrs: row?.total_sessions ?? 0,
  };
}

// ---------------------------------------------------------------------------
// DB: session-grouped PR listing
// ---------------------------------------------------------------------------

export async function listPrSessions(
  db: DbClient,
  opts: { limit?: number; offset?: number } = {},
): Promise<PrSessionGroup[]> {
  const { limit = 100, offset = 0 } = opts;
  const result = await db.query<{
    session_id: string | null;
    session_name: string | null;
    session_started_at: string | null;
    session_cwd: string | null;
    pr_count: number;
    last_pr_at: string | null;
    harness: string | null;
  } & Record<string, unknown>>(
    `SELECT
       pr.session_id                         AS session_id,
       s.name                                AS session_name,
       s.started_at                          AS session_started_at,
       s.cwd                                 AS session_cwd,
       COUNT(*)::int                         AS pr_count,
       MAX(pr.observed_at)                   AS last_pr_at,
       MIN(pr.harness)                       AS harness
     FROM pull_requests pr
     LEFT JOIN sessions s ON s.id = pr.session_id
     GROUP BY pr.session_id, s.name, s.started_at, s.cwd
     ORDER BY last_pr_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  const rows: PrSessionGroup[] = [];
  for (const row of result.rows) {
    const prsResult = await db.query<PrRow>(
      `SELECT id, session_id, pr_url, pr_number, repo_full_name, branch_name, head_sha,
              title, harness, observed_at, created_at
       FROM pull_requests WHERE session_id IS NOT DISTINCT FROM $1
       ORDER BY observed_at DESC`,
      [row.session_id],
    );
    rows.push({
      sessionId: row.session_id ?? "unknown",
      sessionName: row.session_name,
      cwd: row.session_cwd,
      harness: row.harness,
      startedAt: row.session_started_at,
      prs: prsResult.rows.map(toPrRecord),
    });
  }
  return rows;
}

export async function countSessionsWithPullRequests(
  db: DbClient,
): Promise<number> {
  const result = await db.query<{ c: number } & Record<string, unknown>>(
    `SELECT COUNT(*)::int AS c FROM (SELECT 1 FROM pull_requests GROUP BY session_id) sub`,
  );
  return result.rows[0]?.c ?? 0;
}

export async function sessionIdsWithPullRequests(
  db: DbClient,
): Promise<{ session_id: string; c: number }[]> {
  const result = await db.query<
    { session_id: string; c: number } & Record<string, unknown>
  >(
    `SELECT session_id, COUNT(*)::int AS c FROM pull_requests
     WHERE session_id IS NOT NULL GROUP BY session_id`,
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// DB: backfill mtime cache
// ---------------------------------------------------------------------------

export async function markBackfillSeen(
  db: DbClient,
  sessionId: string,
  filePath: string,
  mtime: number,
): Promise<void> {
  await db.query(
    `INSERT INTO pr_backfill_seen (session_id, file_path, file_mtime_ms, scanned_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(session_id) DO UPDATE SET
       file_path = EXCLUDED.file_path,
       file_mtime_ms = EXCLUDED.file_mtime_ms,
       scanned_at = EXCLUDED.scanned_at`,
    [sessionId, filePath, mtime, nowIso()],
  );
}

async function getBackfillSeen(
  db: DbClient,
  sessionId: string,
): Promise<{ file_mtime_ms: number } | null> {
  const result = await db.query<
    { file_mtime_ms: number } & Record<string, unknown>
  >(
    `SELECT file_mtime_ms FROM pr_backfill_seen WHERE session_id = $1`,
    [sessionId],
  );
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Backfill: scan Claude session transcripts for PR artifacts
// ---------------------------------------------------------------------------

function resolveClaudeProjectsDir(): string {
  return (
    process.env.CLAUDE_PROJECTS_DIR ||
    join(
      process.env.CLAUDE_HOME || join(homedir(), ".claude"),
      "projects",
    )
  );
}

interface SessionRow {
  id: string;
  sourceLogPath?: string;
}

export async function backfillPrsFromTranscripts(
  db: DbClient,
  sessionRows?: SessionRow[],
  options?: { projectsDir?: string },
): Promise<{
  captured: number;
  deduped: number;
  scanned: number;
  skipped: number;
  errors: number;
}> {
  const projectsDir = options?.projectsDir ?? resolveClaudeProjectsDir();
  let captured = 0;
  let deduped = 0;
  let scanned = 0;
  let skipped = 0;
  let errors = 0;

  // If sessionRows are provided, scan those specific sessions.
  if (sessionRows && sessionRows.length > 0) {
    for (const session of sessionRows) {
      if (!session.sourceLogPath) continue;
      const filePath = session.sourceLogPath;
      const sessionId = session.id;

      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(filePath);
      } catch {
        continue;
      }
      const mtimeMs = stat.mtimeMs;

      const seen = await getBackfillSeen(db, sessionId);
      if (seen && seen.file_mtime_ms === mtimeMs) {
        skipped += 1;
        continue;
      }

      scanned += 1;

      let text: string;
      try {
        text = readFileSync(filePath, "utf8");
      } catch {
        errors += 1;
        continue;
      }

      let fileSucceeded = true;
      try {
        for (const draft of extractPullRequestsFromText(text, sessionId)) {
          try {
            const r = await upsertPullRequest(db, draft);
            if (r.created) captured += 1;
            else deduped += 1;
          } catch {
            fileSucceeded = false;
            errors += 1;
          }
        }
      } catch {
        fileSucceeded = false;
        errors += 1;
      }

      if (fileSucceeded) {
        try {
          await markBackfillSeen(db, sessionId, filePath, mtimeMs);
        } catch {
          errors += 1;
        }
      }
    }
    return { captured, deduped, scanned, skipped, errors };
  }

  // Fallback: walk the Claude projects directory
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch (e: unknown) {
    if (e && typeof e === "object" && (e as NodeJS.ErrnoException).code !== "ENOENT") {
      return { captured, deduped, scanned, skipped, errors: 1 };
    }
    return { captured, deduped, scanned, skipped, errors };
  }

  for (const projDir of projectDirs) {
    const projPath = join(projectsDir, projDir);
    let files: string[];
    try {
      files = readdirSync(projPath).filter((f) => f.endsWith(".jsonl"));
    } catch (e: unknown) {
      if (
        e &&
        typeof e === "object" &&
        (e as NodeJS.ErrnoException).code !== "ENOENT"
      ) {
        errors += 1;
      }
      continue;
    }
    for (const file of files) {
      const filePath = join(projPath, file);
      const sessionId = basename(file, ".jsonl");

      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(filePath);
      } catch (e: unknown) {
        if (
          e &&
          typeof e === "object" &&
          (e as NodeJS.ErrnoException).code !== "ENOENT"
        ) {
          errors += 1;
        }
        continue;
      }
      const mtimeMs = stat.mtimeMs;

      const seen = await getBackfillSeen(db, sessionId);
      if (seen && seen.file_mtime_ms === mtimeMs) {
        skipped += 1;
        continue;
      }

      scanned += 1;

      let text: string;
      try {
        text = readFileSync(filePath, "utf8");
      } catch {
        errors += 1;
        continue;
      }

      let fileSucceeded = true;
      try {
        for (const draft of extractPullRequestsFromText(text, sessionId)) {
          try {
            const r = await upsertPullRequest(db, draft);
            if (r.created) captured += 1;
            else deduped += 1;
          } catch {
            fileSucceeded = false;
            errors += 1;
          }
        }
      } catch {
        fileSucceeded = false;
        errors += 1;
      }

      if (fileSucceeded) {
        try {
          await markBackfillSeen(db, sessionId, filePath, mtimeMs);
        } catch {
          errors += 1;
        }
      }
    }
  }

  return { captured, deduped, scanned, skipped, errors };
}

// ---------------------------------------------------------------------------
// Utility re-export
// ---------------------------------------------------------------------------

export function clampInt(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
