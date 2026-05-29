/**
 * OpenAI Organization Costs API client (FEA-1435).
 *
 * Endpoint: `GET https://api.openai.com/v1/organization/costs`
 * Auth: `Authorization: Bearer sk-admin-…`.
 *
 * Response shape (OpenAI Costs API, released late 2024):
 * ```
 * { object: "page",
 *   data: [{ object: "bucket", start_time, end_time, results: [
 *     { object: "organization.costs.result",
 *       amount: { value: <number>, currency: "usd" },
 *       line_item: "<string|null>",
 *       project_id: "<string|null>" }
 *   ]}],
 *   has_more, next_page }
 * ```
 *
 * Note: the Costs API does **not** include model-level breakdowns — only
 * `line_item` (which can be model-shaped like "gpt-4.1-2025-04-14" or
 * generic like "Image generation"). We map `line_item` to `model` for the
 * reconciliation join and fall back to `"unknown"` when null.
 *
 * Currency: only `amount.currency === "usd"` is supported. International orgs
 * billed in GBP/EUR throw `OpenAIMalformedResponseError` rather than silently
 * treating foreign amounts as USD at 1:1 (see review finding M5).
 *
 * Security: host allowlist enforced at module boundary; Admin Key never logged.
 */

import { gatewayLog } from "./gateway-logger.js";
import { parseOpenAIDollars, type MicroCents } from "./cost-math.js";

const OPENAI_HOST = "api.openai.com";
const COSTS_PATH = "/v1/organization/costs";
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PAGES = 50;

export class OpenAIAuthError extends Error {
  readonly name = "OpenAIAuthError";
  constructor(public readonly status: 401 | 403) {
    super(`openai_admin_auth_${status}`);
  }
}

export class OpenAIRateLimitedError extends Error {
  readonly name = "OpenAIRateLimitedError";
  constructor() {
    super("openai_admin_rate_limited");
  }
}

export class OpenAINetworkError extends Error {
  readonly name = "OpenAINetworkError";
  constructor() {
    super("openai_admin_network");
  }
}

/**
 * H1: thrown when the API host responds with a 3xx redirect. We pass
 * `redirect: "error"` to `fetch()` so undici throws instead of silently
 * following the Location header (which would forward the
 * `Authorization: Bearer` Admin Key to the redirect target). A DNS hijack or
 * compromise of an OpenAI subdomain could otherwise exfiltrate the Admin Key.
 * The user-facing message intentionally instructs verifying network
 * configuration rather than echoing the redirect target.
 */
export class OpenAIRedirectError extends Error {
  readonly name = "OpenAIRedirectError";
  constructor() {
    super(
      "openai_admin_redirect: host did not respond directly — verify network configuration",
    );
  }
}

export class OpenAIMalformedResponseError extends Error {
  readonly name = "OpenAIMalformedResponseError";
  constructor() {
    super("openai_admin_malformed_response");
  }
}

export interface OpenAICostsWindow {
  /** Unix seconds, inclusive. */
  startTime: number;
  /** Unix seconds, exclusive. */
  endTime: number;
}

export interface OpenAIDailyCostRow {
  /** Day key in YYYY-MM-DD (UTC), derived from `start_time`. */
  day: string;
  /** Model identifier, lowercased. `"unknown"` when `line_item` is null. */
  model: string;
  /** Cost in microcents (integer). */
  costMicroCents: MicroCents;
  /** Original `line_item` value (may be model-shaped or generic). */
  lineItem: string | null;
  /** Project ID when grouped by project; otherwise null. */
  projectId: string | null;
}

export async function fetchOpenAICosts(
  adminKey: string,
  window: OpenAICostsWindow,
  options?: { signal?: AbortSignal },
): Promise<OpenAIDailyCostRow[]> {
  const trimmed = adminKey.trim();
  if (!trimmed) {
    throw new OpenAIAuthError(401);
  }
  const rows: OpenAIDailyCostRow[] = [];
  let nextPage: string | null = null;
  let pageCount = 0;
  const startedAt = Date.now();
  while (pageCount < MAX_PAGES) {
    const url = buildCostsUrl(window, nextPage);
    const body = await fetchWithRetry(url, trimmed, options?.signal);
    const parsed = parseCosts(body);
    rows.push(...parsed.rows);
    pageCount += 1;
    if (!parsed.hasMore || !parsed.nextPage) {
      break;
    }
    nextPage = parsed.nextPage;
  }
  gatewayLog.info(
    "openai-cost",
    `costs ok status=200 durationMs=${Date.now() - startedAt} rowCount=${rows.length} pages=${pageCount}`,
  );
  return rows;
}

function buildCostsUrl(window: OpenAICostsWindow, nextPage: string | null): URL {
  const url = new URL(`https://${OPENAI_HOST}${COSTS_PATH}`);
  if (url.host !== OPENAI_HOST) {
    throw new OpenAINetworkError();
  }
  url.searchParams.set("start_time", String(window.startTime));
  url.searchParams.set("end_time", String(window.endTime));
  url.searchParams.set("bucket_width", "1d");
  url.searchParams.append("group_by", "line_item");
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
          authorization: `Bearer ${adminKey}`,
          accept: "application/json",
        },
        signal: controller.signal,
        // H1: never follow 3xx redirects — undici would otherwise forward the
        // `Authorization: Bearer` header to the redirect target. We catch the
        // resulting TypeError below and map to OpenAIRedirectError.
        redirect: "error",
      });
    } catch (err) {
      clearTimeout(timeout);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
      if (isRedirectError(err)) {
        throw new OpenAIRedirectError();
      }
      if (attempt >= MAX_RETRIES) {
        throw new OpenAINetworkError();
      }
      await delay(computeBackoff(attempt));
      continue;
    }
    clearTimeout(timeout);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
    if (response.status === 401) {
      throw new OpenAIAuthError(401);
    }
    if (response.status === 403) {
      throw new OpenAIAuthError(403);
    }
    if (response.status === 429 || (response.status >= 500 && response.status <= 599)) {
      if (attempt >= MAX_RETRIES) {
        if (response.status === 429) {
          throw new OpenAIRateLimitedError();
        }
        throw new OpenAINetworkError();
      }
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      const waitMs = retryAfter ?? computeBackoff(attempt);
      await delay(waitMs);
      continue;
    }
    if (!response.ok) {
      throw new OpenAINetworkError();
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new OpenAIMalformedResponseError();
    }
    return body;
  }
}

interface ParsedPage {
  rows: OpenAIDailyCostRow[];
  hasMore: boolean;
  nextPage: string | null;
}

function parseCosts(body: unknown): ParsedPage {
  if (!isRecord(body)) {
    throw new OpenAIMalformedResponseError();
  }
  const data = body.data;
  if (!Array.isArray(data)) {
    throw new OpenAIMalformedResponseError();
  }
  const rows: OpenAIDailyCostRow[] = [];
  for (const bucket of data) {
    if (!isRecord(bucket)) {
      throw new OpenAIMalformedResponseError();
    }
    const startTime = bucket.start_time;
    if (typeof startTime !== "number" || !Number.isFinite(startTime)) {
      throw new OpenAIMalformedResponseError();
    }
    const day = new Date(startTime * 1000).toISOString().slice(0, 10);
    const results = bucket.results;
    if (!Array.isArray(results)) {
      throw new OpenAIMalformedResponseError();
    }
    for (const result of results) {
      if (!isRecord(result)) {
        throw new OpenAIMalformedResponseError();
      }
      const amount = result.amount;
      if (!isRecord(amount)) {
        continue;
      }
      const value = amount.value;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        continue;
      }
      // Currency must be present and USD — international orgs may receive GBP
      // or EUR amounts that would otherwise be silently treated as USD at 1:1.
      // We throw rather than silently skip so the user sees an unsupported-
      // currency error instead of a confusingly-zero cost report. The error
      // type intentionally does not echo the raw currency string back into the
      // message (defense-in-depth — the error surface should never leak
      // user-controllable data from the response).
      const currency = amount.currency;
      if (typeof currency !== "string" || currency.toLowerCase() !== "usd") {
        throw new OpenAIMalformedResponseError();
      }
      let costMicroCents: MicroCents;
      try {
        costMicroCents = parseOpenAIDollars(value);
      } catch {
        continue;
      }
      const lineItem = typeof result.line_item === "string" ? result.line_item : null;
      const projectId = typeof result.project_id === "string" ? result.project_id : null;
      rows.push({
        day,
        model: normalizeModelId(lineItem),
        costMicroCents,
        lineItem,
        projectId,
      });
    }
  }
  const hasMore = body.has_more === true;
  const nextPage = typeof body.next_page === "string" ? body.next_page : null;
  return { rows, hasMore, nextPage };
}

function normalizeModelId(value: string | null): string {
  if (!value || !value.trim()) {
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
