/**
 * Claude Code Analytics API client (FEA-1436).
 *
 * Endpoint: `GET https://api.anthropic.com/v1/organizations/usage_report/claude_code`
 * Auth: `x-api-key: sk-ant-admin-…` + `anthropic-version: 2023-06-01`.
 *
 * The endpoint returns data for a **single UTC day** identified by
 * `starting_at=YYYY-MM-DD`. The plan's `{startingAt, endingAt}` window is
 * expanded one day at a time client-side — the API itself has no range
 * support. Each per-day request paginates via cursor (`page=…`).
 *
 * Plan deviation, documented at WebFetch time:
 * - Plan signature was `(adminKey, {startingAt, endingAt})`; live API only
 *   accepts a single-day `starting_at`. We adapt by iterating day-by-day
 *   within the requested window.
 * - Plan returned shape was `{users: [{userId, day, sessions, tokens,
 *   estimatedCostUsd, productivity?}]}`. The live API has no `userId` — the
 *   user identifier is `actor.email_address` (user_actor) or
 *   `actor.api_key_name` (api_actor). We normalize to a `userId` synthesized
 *   from the actor — `email:foo@bar.com` or `api_key:my-key-name`.
 *
 * Plan-tier gating (404/403) — Solo/Pro orgs receive `404 not_found_error` and
 * Team/Enterprise orgs without the right admin permission receive `403`. The
 * caller (reconciliation-worker) treats both as "feature unsupported" and
 * persists a `feature_capability` flag so subsequent runs skip.
 *
 * Security:
 * - Host allowlist enforced at module boundary (URL.host === `api.anthropic.com`).
 * - Admin Key never leaves the function frame and is never logged or echoed
 *   in error messages — same discipline as `anthropic-admin-client.ts`.
 */

import { gatewayLog } from "./gateway-logger.js";

const ANTHROPIC_HOST = "api.anthropic.com";
const ANALYTICS_PATH = "/v1/organizations/usage_report/claude_code";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PAGES_PER_DAY = 50;
const DEFAULT_LIMIT = 1000;

/**
 * Plan tier doesn't include this endpoint. The worker treats this as a
 * persistent capability negative — sets a `feature_capability` flag so
 * subsequent runs skip.
 */
export class ClaudeCodeAnalyticsUnsupportedError extends Error {
  readonly name = "ClaudeCodeAnalyticsUnsupportedError";
  constructor(public readonly status: 403 | 404) {
    super(`claude_code_analytics_unsupported_${status}`);
  }
}

export class ClaudeCodeAnalyticsAuthError extends Error {
  readonly name = "ClaudeCodeAnalyticsAuthError";
  constructor(public readonly status: 401) {
    super(`claude_code_analytics_auth_${status}`);
  }
}

export class ClaudeCodeAnalyticsRateLimitedError extends Error {
  readonly name = "ClaudeCodeAnalyticsRateLimitedError";
  constructor() {
    super("claude_code_analytics_rate_limited");
  }
}

export class ClaudeCodeAnalyticsNetworkError extends Error {
  readonly name = "ClaudeCodeAnalyticsNetworkError";
  constructor() {
    super("claude_code_analytics_network");
  }
}

/**
 * H1: thrown when the API host responds with a 3xx redirect. We pass
 * `redirect: "error"` to `fetch()` so undici throws instead of silently
 * forwarding the `x-api-key` Admin Key to the redirect target. The user-facing
 * message intentionally instructs verifying network configuration rather than
 * echoing the redirect target.
 */
export class ClaudeCodeAnalyticsRedirectError extends Error {
  readonly name = "ClaudeCodeAnalyticsRedirectError";
  constructor() {
    super(
      "claude_code_analytics_redirect: host did not respond directly — verify network configuration",
    );
  }
}

export class ClaudeCodeAnalyticsMalformedResponseError extends Error {
  readonly name = "ClaudeCodeAnalyticsMalformedResponseError";
  constructor() {
    super("claude_code_analytics_malformed_response");
  }
}

export interface ClaudeCodeAnalyticsWindow {
  /** RFC 3339 timestamp inclusive (UTC). Day-by-day iteration internally. */
  startingAt: string;
  /** RFC 3339 timestamp exclusive (UTC). */
  endingAt: string;
}

/**
 * Normalized per-user-per-day analytics row. `userId` is a synthesized stable
 * key derived from the actor object (which lacks a true user UUID).
 */
export interface ClaudeCodeAnalyticsUserDay {
  /** Day key in YYYY-MM-DD (UTC). */
  day: string;
  /**
   * Synthesized user id. Format:
   * - `email:foo@bar.com` for user_actor
   * - `api_key:my-key-name` for api_actor
   * - `unknown:<json>` fallback for unparseable actor shapes
   */
  userId: string;
  /** Count of distinct Claude Code sessions for this user on this day. */
  sessions: number;
  /** Sum of input + output + cache_read + cache_creation across all models. */
  tokens: number;
  /**
   * Sum of `estimated_cost.amount` across all model_breakdown entries. The API
   * returns cents (integer); we convert to USD for the renderer.
   */
  estimatedCostUsd: number;
  /**
   * Optional productivity rollup. The API exposes lines added/removed, commits
   * created, and PRs created; we surface them as a small object so the
   * renderer can show or skip them.
   */
  productivity?: {
    linesAdded: number;
    linesRemoved: number;
    commits: number;
    pullRequests: number;
  };
}

/**
 * H2: per-day error envelope. A single transient 500 or malformed-JSON day in
 * a 30-day backfill window shouldn't discard rows collected from healthy days.
 * Each entry records the day key and a classified error name so the caller
 * can log structured warnings and surface a "partial" status when the failure
 * count crosses MAX_PARTIAL_FAILURE_DAYS.
 */
export interface ClaudeCodeAnalyticsDayError {
  day: string;
  /** Stable error.name from one of the typed error classes above, or "unknown". */
  errorName: string;
}

export interface ClaudeCodeAnalyticsResult {
  users: ClaudeCodeAnalyticsUserDay[];
  totalCount: number;
  /**
   * H2: days that failed mid-window. Empty when every requested day succeeded.
   * Auth, unsupported, and redirect errors still abort the whole call — those
   * are terminal signals about the key/host, not per-day transient failures.
   */
  errors: ClaudeCodeAnalyticsDayError[];
  /**
   * H2: true when the failure count crossed `MAX_PARTIAL_FAILURE_DAYS`. The
   * worker surfaces this in the diagnostics status block.
   */
  degraded: boolean;
}

/**
 * H2: a 30-day backfill with more than this many failed days is "degraded" —
 * we keep the partial result so successful days aren't lost, but we flag it
 * loudly so the user knows the per-user view is incomplete.
 */
export const MAX_PARTIAL_FAILURE_DAYS = 3;

/**
 * Fetches per-user Claude Code analytics rows for every day in `window`.
 *
 * Iterates day-by-day client-side because the live API only accepts a
 * single-day `starting_at`. Each day's request follows pagination via cursor.
 *
 * Throws ClaudeCodeAnalyticsUnsupportedError on 403/404 so the caller can
 * persist a capability flag and skip future runs.
 *
 * The `adminKey` is consumed only inside this function frame and never
 * appears in logs, error messages, or thrown error stacks.
 */
export async function fetchClaudeCodeAnalytics(
  adminKey: string,
  window: ClaudeCodeAnalyticsWindow,
  options?: { signal?: AbortSignal },
): Promise<ClaudeCodeAnalyticsResult> {
  const trimmed = adminKey.trim();
  if (!trimmed) {
    throw new ClaudeCodeAnalyticsAuthError(401);
  }
  const days = enumerateDays(window);
  const users: ClaudeCodeAnalyticsUserDay[] = [];
  const errors: ClaudeCodeAnalyticsDayError[] = [];
  const startedAt = Date.now();
  let totalPages = 0;
  for (const day of days) {
    // H2: per-day try/catch so a single bad day in a 30-day window doesn't
    // discard rows already collected from earlier successful days. Auth /
    // Unsupported / Redirect errors are terminal (the key or host is broken)
    // and re-thrown — partial-failure isolation only covers transient day-
    // shaped issues (5xx, 429-after-retries, malformed JSON, network blip).
    try {
      let nextPage: string | null = null;
      let pageCount = 0;
      while (pageCount < MAX_PAGES_PER_DAY) {
        const url = buildAnalyticsUrl(day, nextPage);
        const body = await fetchWithRetry(url, trimmed, options?.signal);
        const parsed = parseAnalyticsPage(body, day);
        users.push(...parsed.rows);
        pageCount += 1;
        totalPages += 1;
        if (!parsed.hasMore || !parsed.nextPage) {
          break;
        }
        nextPage = parsed.nextPage;
      }
      // FEA-1436: surface when we hit the per-day pagination ceiling so the
      // user knows the per-user attribution may be incomplete. The cap is a
      // safety net against malformed cursors; if a real org actually exceeds
      // 50 × 1000 = 50_000 users on a single day, we want to know about it.
      if (pageCount >= MAX_PAGES_PER_DAY) {
        gatewayLog.warn(
          "claude-code-analytics",
          `pagination ceiling hit day=${day} pages=${pageCount}; per-user view may be incomplete`,
        );
      }
    } catch (err) {
      // Terminal errors abort the whole window — they're not per-day signals.
      if (
        err instanceof ClaudeCodeAnalyticsAuthError ||
        err instanceof ClaudeCodeAnalyticsUnsupportedError ||
        err instanceof ClaudeCodeAnalyticsRedirectError
      ) {
        throw err;
      }
      const errorName =
        err && typeof err === "object" && "name" in err && typeof (err as { name?: unknown }).name === "string"
          ? ((err as { name: string }).name)
          : "unknown";
      errors.push({ day, errorName });
      gatewayLog.warn(
        "claude-code-analytics",
        `per-day fetch failed day=${day} error=${errorName}; continuing with remaining days`,
      );
      continue;
    }
  }
  const degraded = errors.length > MAX_PARTIAL_FAILURE_DAYS;
  gatewayLog.info(
    "claude-code-analytics",
    `claude_code_usage ok status=200 durationMs=${Date.now() - startedAt} userRows=${users.length} pages=${totalPages} days=${days.length} failedDays=${errors.length} degraded=${degraded}`,
  );
  return { users, totalCount: users.length, errors, degraded };
}

function buildAnalyticsUrl(day: string, nextPage: string | null): URL {
  const url = new URL(`https://${ANTHROPIC_HOST}${ANALYTICS_PATH}`);
  if (url.host !== ANTHROPIC_HOST) {
    // Host allowlist enforced at the boundary. Defensive — fails fast if a
    // tampered const ever sneaks through.
    throw new ClaudeCodeAnalyticsNetworkError();
  }
  url.searchParams.set("starting_at", day);
  url.searchParams.set("limit", String(DEFAULT_LIMIT));
  if (nextPage) {
    url.searchParams.set("page", nextPage);
  }
  return url;
}

async function fetchWithRetry(
  url: URL,
  adminKey: string,
  externalSignal: AbortSignal | undefined,
): Promise<unknown> {
  let attempt = 0;
  while (true) {
    attempt += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    // M3: forward upstream abort (worker.stop()) into this fetch.
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener("abort", onExternalAbort, { once: true });
      }
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          // The Admin Key is consumed only in this header; never logged.
          "x-api-key": adminKey,
          "anthropic-version": ANTHROPIC_VERSION,
          accept: "application/json",
        },
        signal: controller.signal,
        // H1: never follow 3xx redirects — undici would otherwise forward
        // the `x-api-key` Admin Key to the redirect target. We catch the
        // resulting TypeError below and map to ClaudeCodeAnalyticsRedirectError.
        redirect: "error",
      });
    } catch (err) {
      clearTimeout(timeout);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
      if (isRedirectError(err)) {
        throw new ClaudeCodeAnalyticsRedirectError();
      }
      if (attempt >= MAX_RETRIES) {
        throw new ClaudeCodeAnalyticsNetworkError();
      }
      await delay(computeBackoff(attempt));
      continue;
    }
    clearTimeout(timeout);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
    if (response.status === 401) {
      throw new ClaudeCodeAnalyticsAuthError(401);
    }
    // 403 / 404 → plan tier doesn't include this endpoint. Caller persists a
    // capability flag so subsequent runs short-circuit without re-hitting.
    if (response.status === 403) {
      throw new ClaudeCodeAnalyticsUnsupportedError(403);
    }
    if (response.status === 404) {
      throw new ClaudeCodeAnalyticsUnsupportedError(404);
    }
    if (response.status === 429 || (response.status >= 500 && response.status <= 599)) {
      if (attempt >= MAX_RETRIES) {
        if (response.status === 429) {
          throw new ClaudeCodeAnalyticsRateLimitedError();
        }
        throw new ClaudeCodeAnalyticsNetworkError();
      }
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      const waitMs = retryAfter ?? computeBackoff(attempt);
      await delay(waitMs);
      continue;
    }
    if (!response.ok) {
      // Some other non-2xx — generic network so we don't leak status detail.
      throw new ClaudeCodeAnalyticsNetworkError();
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ClaudeCodeAnalyticsMalformedResponseError();
    }
    return body;
  }
}

interface ParsedAnalyticsPage {
  rows: ClaudeCodeAnalyticsUserDay[];
  hasMore: boolean;
  nextPage: string | null;
}

function parseAnalyticsPage(body: unknown, fallbackDay: string): ParsedAnalyticsPage {
  if (!isRecord(body)) {
    throw new ClaudeCodeAnalyticsMalformedResponseError();
  }
  const data = body.data;
  if (!Array.isArray(data)) {
    throw new ClaudeCodeAnalyticsMalformedResponseError();
  }
  const rows: ClaudeCodeAnalyticsUserDay[] = [];
  for (const record of data) {
    if (!isRecord(record)) {
      throw new ClaudeCodeAnalyticsMalformedResponseError();
    }
    // `date` is RFC 3339; fall back to the requested day if missing.
    const dateStr = typeof record.date === "string" ? record.date : null;
    const day = dateStr ? dateStr.slice(0, 10) : fallbackDay;
    const userId = synthesizeUserId(record.actor);
    const coreMetrics = isRecord(record.core_metrics) ? record.core_metrics : {};
    const sessions = clampNonNegativeInt(coreMetrics.num_sessions);
    const linesOfCode = isRecord(coreMetrics.lines_of_code) ? coreMetrics.lines_of_code : {};
    const productivity = {
      linesAdded: clampNonNegativeInt(linesOfCode.added),
      linesRemoved: clampNonNegativeInt(linesOfCode.removed),
      commits: clampNonNegativeInt(coreMetrics.commits_by_claude_code),
      pullRequests: clampNonNegativeInt(coreMetrics.pull_requests_by_claude_code),
    };
    let tokens = 0;
    let costCents = 0;
    const breakdown = Array.isArray(record.model_breakdown) ? record.model_breakdown : [];
    for (const entry of breakdown) {
      if (!isRecord(entry)) {
        continue;
      }
      const tokensObj = isRecord(entry.tokens) ? entry.tokens : {};
      tokens +=
        clampNonNegativeInt(tokensObj.input) +
        clampNonNegativeInt(tokensObj.output) +
        clampNonNegativeInt(tokensObj.cache_read) +
        clampNonNegativeInt(tokensObj.cache_creation);
      const cost = isRecord(entry.estimated_cost) ? entry.estimated_cost : null;
      if (cost && typeof cost.amount === "number" && Number.isFinite(cost.amount)) {
        costCents += cost.amount;
      }
    }
    rows.push({
      day,
      userId,
      sessions,
      tokens,
      // API returns cents — convert to dollars for the renderer.
      estimatedCostUsd: costCents / 100,
      productivity,
    });
  }
  const hasMore = body.has_more === true;
  const nextPage = typeof body.next_page === "string" ? body.next_page : null;
  // FEA-1436: `has_more=true` without a usable cursor is a contract
  // violation — fail loud instead of silently truncating the result set.
  if (hasMore && !nextPage) {
    throw new ClaudeCodeAnalyticsMalformedResponseError();
  }
  return { rows, hasMore, nextPage };
}

/**
 * Builds a stable user identifier from the `actor` object. Falls back to a
 * sentinel when the actor is missing or malformed so the row still lands —
 * we never let a malformed individual row break the whole page.
 */
function synthesizeUserId(actor: unknown): string {
  if (isRecord(actor)) {
    const type = typeof actor.type === "string" ? actor.type : null;
    if (type === "user_actor" && typeof actor.email_address === "string") {
      return `email:${actor.email_address.toLowerCase()}`;
    }
    if (type === "api_actor" && typeof actor.api_key_name === "string") {
      return `api_key:${actor.api_key_name}`;
    }
  }
  return "unknown:actor";
}

function clampNonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  const n = Math.floor(value);
  return n < 0 ? 0 : n;
}

function enumerateDays(window: ClaudeCodeAnalyticsWindow): string[] {
  const start = new Date(window.startingAt);
  const end = new Date(window.endingAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return [];
  }
  const days: string[] = [];
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  const endMs = end.getTime();
  while (cursor.getTime() < endMs) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) {
    return null;
  }
  const seconds = Number.parseFloat(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_BACKOFF_MS);
  }
  const target = Date.parse(header);
  if (!Number.isNaN(target)) {
    return Math.max(0, Math.min(target - Date.now(), MAX_BACKOFF_MS));
  }
  return null;
}

function computeBackoff(attempt: number): number {
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  const jitter = Math.random() * BASE_BACKOFF_MS;
  return exponential + jitter;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Detects undici's redirect-blocked error from `redirect: "error"`. Matches on
 * both message and cause to stay resilient to undici-version drift.
 */
function isRedirectError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const e = err as { message?: unknown; cause?: { message?: unknown; code?: unknown } };
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  const causeMsg =
    e.cause && typeof e.cause === "object" && typeof e.cause.message === "string"
      ? e.cause.message.toLowerCase()
      : "";
  const causeCode =
    e.cause && typeof e.cause === "object" && typeof e.cause.code === "string"
      ? (e.cause.code as string).toLowerCase()
      : "";
  return (
    msg.includes("redirect") ||
    causeMsg.includes("redirect") ||
    causeCode.includes("redirect")
  );
}
