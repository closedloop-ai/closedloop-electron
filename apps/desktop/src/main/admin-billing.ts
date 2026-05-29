/**
 * @file admin-billing.ts
 * @description Desktop-main (ESM) shared foundation for the vendor billing
 * "admin" clients used by nightly cost reconciliation (FEA-1435/1436). It holds
 * the normalized billed-entry shape, an injectable fetch surface, the
 * network-allowlist guard, and a small JSON request helper. The vendor-specific
 * URL building and response parsing live in anthropic-admin-client.ts /
 * openai-admin-client.ts.
 *
 * ── Security posture ─────────────────────────────────────────────────────────
 * These clients carry an org-level Admin key. Two rules are enforced here:
 *   1. The Admin key is sent ONLY in request headers, NEVER in the URL/query
 *      (query strings leak into logs and referrers). Callers pass headers.
 *   2. Every outbound request host is checked against a fixed allowlist
 *      (api.anthropic.com / api.openai.com) via assertAllowedAdminHost, so a
 *      misconfigured base URL can never ship the Admin key to another host.
 * Errors thrown here include the HTTP status and the vendor's own error body
 * (which never contains your key) but never the key itself.
 */
import {
  centsToMicroCents,
  parseDecimalCentsToMicroCents,
  usdToMicroCents,
} from "./cost-math.js";

/** A single vendor-billed line, normalized to the reconciliation grain. */
export interface VendorBilledEntry {
  /** UTC calendar day, ISO `YYYY-MM-DD`, derived from the time bucket start. */
  day: string;
  /** Vendor-reported model id, or null when the vendor does not break out per model. */
  model: string | null;
  /** Billed amount for this entry, in integer micro-cents (see cost-math.ts). */
  amountMicroCents: number;
  /** Vendor cost descriptor for diagnostics (Anthropic cost_type / OpenAI line_item). */
  label: string | null;
}

/** One parsed page of a paginated billing response. */
export interface ParsedBillingPage {
  entries: VendorBilledEntry[];
  hasMore: boolean;
  nextPage: string | null;
}

/** Minimal Response surface the clients depend on (a structural subset of fetch's Response). */
export interface AdminFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** Injectable fetch so tests can mock the network without touching it. */
export type AdminFetchLike = (
  url: string,
  init: { method: "GET"; headers: Record<string, string> },
) => Promise<AdminFetchResponse>;

/** Default fetch implementation (Electron main / Node 22 global fetch). */
export const DEFAULT_ADMIN_FETCH: AdminFetchLike = async (url, init) => {
  return fetch(url, init);
};

/** Hosts the admin clients are permitted to contact. */
export const ANTHROPIC_API_HOST = "api.anthropic.com";
export const OPENAI_API_HOST = "api.openai.com";

/**
 * Throw unless `url` is https and its host exactly matches `allowedHost`. This
 * is the network allowlist: it guarantees the Admin key can only ever leave the
 * machine toward the intended vendor host.
 */
export function assertAllowedAdminHost(url: string, allowedHost: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Admin API URL is not a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Admin API URL must use https (got ${parsed.protocol})`);
  }
  if (parsed.host !== allowedHost) {
    throw new Error(
      `Admin API host not allowed: ${parsed.host} (expected ${allowedHost})`,
    );
  }
}

/**
 * GET `url` with `headers`, returning the parsed JSON body. Throws on a non-2xx
 * with the status and a truncated copy of the vendor's error body (never the
 * Admin key, which is only ever in the request headers).
 */
export async function requestAdminJson(
  url: string,
  headers: Record<string, string>,
  fetchImpl: AdminFetchLike,
  vendorLabel: string,
): Promise<unknown> {
  const response = await fetchImpl(url, { method: "GET", headers });
  if (!response.ok) {
    let bodyHint = "";
    try {
      const body = await response.text();
      bodyHint = body ? `: ${body.slice(0, 200)}` : "";
    } catch {
      bodyHint = "";
    }
    throw new Error(`${vendorLabel} admin API HTTP ${response.status}${bodyHint}`);
  }
  return response.json();
}

/** Narrow an unknown to a plain object, else null. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** UTC `YYYY-MM-DD` from an RFC 3339 timestamp string; throws if unparseable. */
export function utcDayFromRfc3339(value: unknown, vendorLabel: string): string {
  if (typeof value !== "string") {
    throw new Error(`${vendorLabel} billing: time bucket start is missing`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${vendorLabel} billing: invalid time bucket start`);
  }
  return date.toISOString().slice(0, 10);
}

/** UTC `YYYY-MM-DD` from a Unix-seconds timestamp; throws if non-finite. */
export function utcDayFromUnixSeconds(value: unknown, vendorLabel: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${vendorLabel} billing: time bucket start is missing`);
  }
  return new Date(value * 1000).toISOString().slice(0, 10);
}

// Re-export the unit converters the vendor parsers use, so the clients import
// money math from one place.
export { centsToMicroCents, parseDecimalCentsToMicroCents, usdToMicroCents };
