import crypto from "node:crypto";
import { gatewayLog } from "./gateway-logger.js";
import { isEndpointDisabled, markEndpointDisabled } from "./loop-404-gate.js";
import { parseJwtExpiry } from "./jwt-utils.js";
import { type LoopTokenMeta, type LoopTokenStore } from "./loop-token-store.js";
import type { LoopHttpResult } from "../server/operations/loop-http.js";

// ---------------------------------------------------------------------------
// Refresh result types
// ---------------------------------------------------------------------------

export type RefreshLoopTokenResult =
  | { success: true; meta: LoopTokenMeta }
  | { success: false; retryable: false; error: string };

// ---------------------------------------------------------------------------
// Module-scoped singleflight map (populated in T-2.2)
// ---------------------------------------------------------------------------

const inflight = new Map<string, Promise<RefreshLoopTokenResult>>();

// ---------------------------------------------------------------------------
// Internal: single HTTP refresh attempt
// ---------------------------------------------------------------------------

async function attemptRefresh(
  loopId: string,
  apiBaseUrl: string,
  getToken: () => string | null,
  loopTokenStore: LoopTokenStore,
  idempotencyKey: string,
): Promise<RefreshLoopTokenResult> {
  const token = getToken();
  if (token === null) {
    return { success: false, retryable: false, error: "missing_token" };
  }

  const endpointPath = `/loops/${encodeURIComponent(loopId)}/refresh-token`;
  const url = `${apiBaseUrl}${endpointPath}`;

  if (isEndpointDisabled(apiBaseUrl, endpointPath)) {
    gatewayLog.warn(
      "loop-refresh",
      `Skipping refresh for loopId=${loopId}: endpoint disabled (prior 404)`,
    );
    return { success: false, retryable: false, error: "endpoint_disabled" };
  }

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    gatewayLog.error("loop-refresh", `Network error refreshing loopId=${loopId}: ${msg}`);
    return { success: false, retryable: false, error: msg };
  }

  if (resp.status === 401) {
    const text = await resp.text().catch(() => "");
    gatewayLog.warn(
      "loop-refresh",
      `Non-retryable auth failure refreshing loopId=${loopId}: ${resp.status} ${text}`,
    );
    return { success: false, retryable: false, error: `HTTP 401 ${text}` };
  }

  if (resp.status === 404) {
    const text = await resp.text().catch(() => "");
    gatewayLog.warn(
      "loop-refresh",
      `404 received for loopId=${loopId}; disabling endpoint ${endpointPath} on ${apiBaseUrl}`,
    );
    markEndpointDisabled(apiBaseUrl, endpointPath);
    return { success: false, retryable: false, error: `HTTP 404 ${text}` };
  }

  if (resp.status === 409) {
    // 409 indicates RACE_LOST — will be handled by the caller with a retry.
    const text = await resp.text().catch(() => "");
    return { success: false, retryable: false, error: `HTTP 409 ${text}` };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    gatewayLog.error(
      "loop-refresh",
      `Refresh failed for loopId=${loopId}: ${resp.status} ${text}`,
    );
    return { success: false, retryable: false, error: `HTTP ${resp.status} ${text}` };
  }

  // Parse success response: { token, expiresAt, jti }
  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    return { success: false, retryable: false, error: "malformed refresh response" };
  }

  const record = (body !== null && typeof body === "object" && !Array.isArray(body))
    ? body as Record<string, unknown>
    : {};
  const newToken = typeof record.token === "string" ? record.token : null;
  const jti = typeof record.jti === "string" ? record.jti : undefined;

  if (!newToken) {
    return { success: false, retryable: false, error: "refresh response missing token" };
  }

  // Extract exp from the new JWT; convert seconds -> milliseconds for LoopTokenMeta.
  const expSeconds = parseJwtExpiry(newToken);
  const expiresAt = expSeconds !== null ? expSeconds * 1000 : undefined;

  const meta: LoopTokenMeta = {
    token: newToken,
    expiresAt,
    jti,
    lastIdempotencyKey: idempotencyKey,
  };

  loopTokenStore.setLoopToken(loopId, meta);

  gatewayLog.info(
    "loop-refresh",
    `Token refreshed for loopId=${loopId} jti=${jti ?? "unknown"} expiresAt=${expiresAt ?? "unknown"}`,
  );

  return { success: true, meta };
}

// ---------------------------------------------------------------------------
// Extract error code from a 409 response body (if already read as text)
// ---------------------------------------------------------------------------

function extractCodeFromBody(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown> | null;
    if (parsed !== null && typeof parsed === "object" && typeof parsed.code === "string") {
      return parsed.code;
    }
  } catch {
    // Non-JSON body — no code to extract.
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public: refreshLoopToken with 409-RACE_LOST retry-once semantics
// ---------------------------------------------------------------------------

/**
 * Refreshes the loop runner token for the given loop by POSTing to
 * `/loops/:id/refresh-token`.
 *
 * - Generates an idempotency key via `crypto.randomUUID()`, persisted to
 *   `LoopTokenMeta.lastIdempotencyKey` so a force-quit during refresh can
 *   reuse it on next launch (AC-008).
 * - On 409 with code `RACE_LOST`, generates a fresh key and retries exactly
 *   once; a second consecutive 409 returns non-retryable failure (AC-005).
 * - On 401 (including `JTI_ALREADY_USED`), returns non-retryable failure
 *   immediately (AC-002).
 *
 * Callers that need singleflight deduplication should use
 * `refreshLoopTokenSingleflight` (T-2.2).
 */
export async function refreshLoopToken(
  loopId: string,
  apiBaseUrl: string,
  getToken: () => string | null,
  loopTokenStore: LoopTokenStore,
): Promise<RefreshLoopTokenResult> {
  // Use persisted idempotency key if available (force-quit recovery, AC-008).
  const stored = loopTokenStore.getLoopToken(loopId);
  const firstKey = stored?.lastIdempotencyKey ?? crypto.randomUUID();

  // Persist the idempotency key before the network call so a force-quit
  // mid-refresh can reuse it (AC-008). When no stored meta exists yet, skip
  // pre-persist — the key will be persisted on the successful response path.
  if (stored !== null && stored.lastIdempotencyKey !== firstKey) {
    loopTokenStore.setLoopToken(loopId, { ...stored, lastIdempotencyKey: firstKey });
  }

  const firstResult = await attemptRefresh(
    loopId,
    apiBaseUrl,
    getToken,
    loopTokenStore,
    firstKey,
  );

  if (firstResult.success) {
    return firstResult;
  }

  // Check for 409 RACE_LOST to trigger one retry with a fresh key.
  const is409 = firstResult.error.startsWith("HTTP 409");
  if (!is409) {
    return firstResult;
  }

  // Extract the code from the body text embedded in the error string.
  const bodyText = firstResult.error.slice("HTTP 409 ".length);
  const code = extractCodeFromBody(bodyText);

  if (code !== "RACE_LOST") {
    // 409 with a different code is non-retryable.
    return firstResult;
  }

  gatewayLog.info(
    "loop-refresh",
    `409 RACE_LOST for loopId=${loopId}; retrying with fresh idempotency key`,
  );

  const retryKey = crypto.randomUUID();

  // Persist the new key before the retry attempt (AC-008).
  const currentMeta = loopTokenStore.getLoopToken(loopId);
  if (currentMeta !== null) {
    loopTokenStore.setLoopToken(loopId, { ...currentMeta, lastIdempotencyKey: retryKey });
  }

  const retryResult = await attemptRefresh(
    loopId,
    apiBaseUrl,
    getToken,
    loopTokenStore,
    retryKey,
  );

  if (retryResult.success) {
    return retryResult;
  }

  // Second consecutive 409 (or any failure on retry) is non-retryable.
  gatewayLog.warn(
    "loop-refresh",
    `Retry also failed for loopId=${loopId}: ${retryResult.error}`,
  );
  return { success: false, retryable: false, error: retryResult.error };
}

// ---------------------------------------------------------------------------
// Public: withTokenRefreshRetry higher-order wrapper (T-2.3)
// ---------------------------------------------------------------------------

/**
 * Higher-order wrapper that intercepts `LoopHttpResult` responses with
 * `kind: "http"` and `status: 401` and retries the original request exactly
 * once after refreshing the loop token via the singleflight primitive.
 *
 * Design constraints:
 * - The `fn` callback receives the (potentially refreshed) `getToken` at retry
 *   time — since `getToken` reads from the store and the store is updated by
 *   the refresh, the retry call automatically picks up the new token.
 * - The refresh call uses NO abort signal so that a bounded-timeout abort on
 *   the original request does not cancel the in-flight refresh (AC-002).
 * - If the refresh itself returns a non-retryable failure (including a 401
 *   from the refresh endpoint), the original 401 is surfaced without retry.
 * - Only one retry is issued regardless of the result of the retry attempt.
 */
export async function withTokenRefreshRetry(
  loopId: string,
  apiBaseUrl: string,
  getToken: () => string | null,
  loopTokenStore: LoopTokenStore,
  fn: (getToken: () => string | null) => Promise<LoopHttpResult>,
): Promise<LoopHttpResult> {
  const firstResult = await fn(getToken);

  // Only intercept HTTP 401; all other results pass through unchanged.
  if (firstResult.success || firstResult.kind !== "http" || firstResult.status !== 401) {
    return firstResult;
  }

  gatewayLog.info(
    "loop-refresh",
    `401 intercepted for loopId=${loopId}; triggering token refresh`,
  );

  // Refresh via singleflight — intentionally uses no abort signal so that a
  // bounded-timeout abort on the original request cannot cancel the refresh.
  const refreshResult = await refreshLoopTokenSingleflight(
    loopId,
    apiBaseUrl,
    getToken,
    loopTokenStore,
  );

  if (!refreshResult.success) {
    // Refresh itself failed (including a 401 from the refresh endpoint).
    // Surface the original 401 rather than the refresh error.
    gatewayLog.warn(
      "loop-refresh",
      `Token refresh failed for loopId=${loopId}: ${refreshResult.error}; surfacing original 401`,
    );
    return firstResult;
  }

  gatewayLog.info(
    "loop-refresh",
    `Token refresh succeeded for loopId=${loopId}; retrying original request`,
  );

  // Retry the original request exactly once with the refreshed token now in
  // the store. The `getToken` closure already reads from the store, so the
  // retry call picks up the new token automatically.
  return fn(getToken);
}

// ---------------------------------------------------------------------------
// Public: singleflight wrapper (T-2.2 — exported for completeness)
// ---------------------------------------------------------------------------

/**
 * Wraps `refreshLoopToken` with per-loop singleflight deduplication.
 *
 * If a refresh is already in flight for `loopId`, the caller receives the
 * same Promise rather than issuing a new network request (AC-003).
 */
export function refreshLoopTokenSingleflight(
  loopId: string,
  apiBaseUrl: string,
  getToken: () => string | null,
  loopTokenStore: LoopTokenStore,
): Promise<RefreshLoopTokenResult> {
  const existing = inflight.get(loopId);
  if (existing !== undefined) {
    return existing;
  }

  const promise = refreshLoopToken(loopId, apiBaseUrl, getToken, loopTokenStore).finally(
    () => {
      inflight.delete(loopId);
    },
  );

  inflight.set(loopId, promise);
  return promise;
}
