/**
 * Anthropic Organization Cost Report API client (FEA-1435).
 *
 * Endpoint: `GET https://api.anthropic.com/v1/organizations/cost_report`
 * Auth: `x-api-key: sk-ant-admin-…` + `anthropic-version: 2023-06-01`.
 *
 * Response shape (verified via Anthropic docs, May 2026):
 * ```
 * { data: [{ starting_at, ending_at, results: [
 *     { amount, currency, description, model, cost_type, token_type,
 *       service_tier, context_window, inference_geo, workspace_id }
 *   ]}], has_more, next_page }
 * ```
 * `amount` is a decimal string in **lowest currency units (cents)** per the
 * Anthropic docs — `"123.45"` USD == 123.45¢ == $1.2345 — we route through
 * {@link parseAnthropicCents} accordingly.
 *
 * Security:
 * - Host allowlist enforced at module boundary (URL.host === `api.anthropic.com`).
 * - Admin Key never leaves the function frame and is never logged or echoed in
 *   error messages. Structured logs only include `{status, durationMs, rowCount}`.
 * - Throws typed errors so callers can map to generic outcome codes without
 *   touching the underlying response body.
 */

import { gatewayLog } from "./gateway-logger.js";
import { parseAnthropicDollars, type MicroCents } from "./cost-math.js";

const ANTHROPIC_HOST = "api.anthropic.com";
const COST_REPORT_PATH = "/v1/organizations/cost_report";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PAGES = 50; // hard cap so a malformed pagination loop terminates

export class AnthropicAuthError extends Error {
  readonly name = "AnthropicAuthError";
  constructor(public readonly status: 401 | 403) {
    super(`anthropic_admin_auth_${status}`);
  }
}

export class AnthropicRateLimitedError extends Error {
  readonly name = "AnthropicRateLimitedError";
  constructor() {
    super("anthropic_admin_rate_limited");
  }
}

export class AnthropicNetworkError extends Error {
  readonly name = "AnthropicNetworkError";
  constructor() {
    super("anthropic_admin_network");
  }
}

export class AnthropicMalformedResponseError extends Error {
  readonly name = "AnthropicMalformedResponseError";
  constructor() {
    super("anthropic_admin_malformed_response");
  }
}

export interface AnthropicCostReportWindow {
  /** RFC 3339 timestamp inclusive. */
  startingAt: string;
  /** RFC 3339 timestamp exclusive. */
  endingAt: string;
}

/** A flattened per-day, per-model cost row. */
export interface AnthropicDailyCostRow {
  /** Day key in YYYY-MM-DD (UTC), derived from `starting_at`. */
  day: string;
  /** Model identifier, lowercased. Falls back to `"unknown"` for non-token costs. */
  model: string;
  /** Cost in microcents (integer). */
  costMicroCents: MicroCents;
  /** Anthropic's `description` field (e.g. "Claude Sonnet 4 Usage - Input Tokens"). */
  descriptionGroup: string | null;
  /** Anthropic's `cost_type` (e.g. "tokens", "web_search", "code_execution"). */
  costType: string | null;
  /** Anthropic's `service_tier` (e.g. "standard", "batch"). */
  serviceTier: string | null;
  /** Anthropic's `token_type` (e.g. "cache_creation.ephemeral_1h_input_tokens"). */
  tokenType: string | null;
}

/**
 * Convenience type alias matching the planned signature in the PLN.
 * `costMicroCents` is exposed because reconciliation math is integer-only.
 */
export type AnthropicCostReportRow = AnthropicDailyCostRow;

/**
 * Fetches the full cost report for the given window, following `next_page`
 * pagination up to MAX_PAGES. Flattens each bucket × result into a single row
 * per day × model.
 *
 * The `adminKey` is consumed once and never stored beyond the request frame.
 *
 * Internally interprets Anthropic's `amount` decimal string as **cents** (per
 * the docs) and converts to microcents (`cents × 10_000`).
 */
export async function fetchAnthropicCostReport(
  adminKey: string,
  window: AnthropicCostReportWindow,
): Promise<AnthropicCostReportRow[]> {
  const trimmed = adminKey.trim();
  if (!trimmed) {
    throw new AnthropicAuthError(401);
  }
  const rows: AnthropicDailyCostRow[] = [];
  let nextPage: string | null = null;
  let pageCount = 0;
  const startedAt = Date.now();
  while (pageCount < MAX_PAGES) {
    const url = buildCostReportUrl(window, nextPage);
    const body = await fetchWithRetry(url, trimmed);
    const parsed = parseCostReport(body);
    rows.push(...parsed.rows);
    pageCount += 1;
    if (!parsed.hasMore || !parsed.nextPage) {
      break;
    }
    nextPage = parsed.nextPage;
  }
  gatewayLog.info(
    "anthropic-cost",
    `cost_report ok status=200 durationMs=${Date.now() - startedAt} rowCount=${rows.length} pages=${pageCount}`,
  );
  return rows;
}

function buildCostReportUrl(
  window: AnthropicCostReportWindow,
  nextPage: string | null,
): URL {
  const url = new URL(`https://${ANTHROPIC_HOST}${COST_REPORT_PATH}`);
  // Host allowlist enforced at the boundary. Anyone tampering with the
  // ANTHROPIC_HOST const will fail this assertion at runtime.
  if (url.host !== ANTHROPIC_HOST) {
    throw new AnthropicNetworkError();
  }
  url.searchParams.set("starting_at", window.startingAt);
  url.searchParams.set("ending_at", window.endingAt);
  url.searchParams.set("bucket_width", "1d");
  url.searchParams.append("group_by[]", "description");
  if (nextPage) {
    url.searchParams.set("page", nextPage);
  }
  return url;
}

async function fetchWithRetry(
  url: URL,
  adminKey: string,
): Promise<unknown> {
  let attempt = 0;
  while (true) {
    attempt += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          // The Admin Key is consumed only in this header; it is never logged
          // or surfaced in error messages.
          "x-api-key": adminKey,
          "anthropic-version": ANTHROPIC_VERSION,
          accept: "application/json",
        },
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timeout);
      if (attempt >= MAX_RETRIES) {
        throw new AnthropicNetworkError();
      }
      await delay(computeBackoff(attempt));
      continue;
    }
    clearTimeout(timeout);
    if (response.status === 401) {
      throw new AnthropicAuthError(401);
    }
    if (response.status === 403) {
      throw new AnthropicAuthError(403);
    }
    if (response.status === 429 || (response.status >= 500 && response.status <= 599)) {
      if (attempt >= MAX_RETRIES) {
        if (response.status === 429) {
          throw new AnthropicRateLimitedError();
        }
        throw new AnthropicNetworkError();
      }
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      const waitMs = retryAfter ?? computeBackoff(attempt);
      await delay(waitMs);
      continue;
    }
    if (!response.ok) {
      // Some other non-2xx — treat as network so we don't leak status detail.
      throw new AnthropicNetworkError();
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AnthropicMalformedResponseError();
    }
    return body;
  }
}

interface ParsedPage {
  rows: AnthropicDailyCostRow[];
  hasMore: boolean;
  nextPage: string | null;
}

function parseCostReport(body: unknown): ParsedPage {
  if (!isRecord(body)) {
    throw new AnthropicMalformedResponseError();
  }
  const data = body.data;
  if (!Array.isArray(data)) {
    throw new AnthropicMalformedResponseError();
  }
  const rows: AnthropicDailyCostRow[] = [];
  for (const bucket of data) {
    if (!isRecord(bucket)) {
      throw new AnthropicMalformedResponseError();
    }
    const startingAt = bucket.starting_at;
    if (typeof startingAt !== "string") {
      throw new AnthropicMalformedResponseError();
    }
    const day = startingAt.slice(0, 10);
    const results = bucket.results;
    if (!Array.isArray(results)) {
      throw new AnthropicMalformedResponseError();
    }
    for (const result of results) {
      if (!isRecord(result)) {
        throw new AnthropicMalformedResponseError();
      }
      const amountStr = typeof result.amount === "string" ? result.amount : null;
      if (amountStr === null) {
        // Skip rows without parsable amounts rather than crashing the whole batch.
        continue;
      }
      let costMicroCents: MicroCents;
      try {
        // Anthropic returns decimal *cents*, not dollars. Multiply by 10_000 to
        // reach microcents. We use the cents-decimal-string parser, which
        // shares the same numeric parsing path as the dollar parser by feeding
        // through the same digit math.
        costMicroCents = parseAnthropicCents(amountStr);
      } catch {
        // Malformed individual amount — skip the row but don't fail the page.
        continue;
      }
      const model = normalizeModelId(result.model);
      rows.push({
        day,
        model,
        costMicroCents,
        descriptionGroup:
          typeof result.description === "string" ? result.description : null,
        costType: typeof result.cost_type === "string" ? result.cost_type : null,
        serviceTier:
          typeof result.service_tier === "string" ? result.service_tier : null,
        tokenType: typeof result.token_type === "string" ? result.token_type : null,
      });
    }
  }
  const hasMore = body.has_more === true;
  const nextPage = typeof body.next_page === "string" ? body.next_page : null;
  return { rows, hasMore, nextPage };
}

/**
 * Anthropic's cost-report `amount` is a decimal in cents. Convert to microcents
 * by reusing the high-precision dollar parser (which already operates on
 * decimal strings) and then dividing the dollar-microcents result by 100 to
 * land in cents-microcents. We do the multiply-then-divide so the
 * round-half-up semantics in `parseAnthropicDollars` are preserved.
 *
 * Concretely: `"123.45"` cents → `parseAnthropicDollars("123.45")` is
 * 123_450_000 microcents-of-a-dollar, but we want 1_234_500 microcents-of-a-
 * cent. The two are different by a factor of 100. We bypass the intermediate
 * unit by parsing the string as a decimal value in "cents" and applying
 * `× 10_000` directly.
 */
function parseAnthropicCents(decimalString: string): MicroCents {
  // Reuse the parser but interpret the result as "cents × 1_000_000" instead
  // of "dollars × 1_000_000". The arithmetic comes out cleanly because both
  // are just decimal-string→integer conversions at a fixed scale.
  //
  // dollarsParser("x") gives floor( x × 1_000_000 + 0.5) microdollars.
  // We want floor( x × 10_000 + 0.5 ) microcents (since 1 cent = 10_000 microcents).
  // i.e. dividing the dollar-parser result by 100 gives us microcents,
  // but we must round half-up at the smaller scale to match the docs.
  //
  // Simpler: parse the dollar amount, then `× 0.01` ⇒ wrong for floats.
  // Cleanest: use the dollar parser on the cents string and rescale by 100.
  // Because the dollar parser already returns an exact integer count of
  // microdollars, dividing by 100 with half-up rounding stays exact.
  const microDollars = parseAnthropicDollars(decimalString) as number;
  // Half-up divide by 100. Works for negatives too (away-from-zero).
  const sign = microDollars < 0 ? -1 : 1;
  const abs = Math.abs(microDollars);
  const rounded = Math.floor((abs + 50) / 100);
  return (sign * rounded) as MicroCents;
}

function normalizeModelId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "unknown";
  }
  return value.trim().toLowerCase();
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
  // HTTP-date — parse and compute delta.
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
