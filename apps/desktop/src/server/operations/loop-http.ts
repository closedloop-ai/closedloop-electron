/**
 * Consolidated HTTP helpers for Desktop loop runner communication.
 *
 * Exports `postLoopEvent`, `postLoopEventBounded`, and `uploadArtifacts`
 * for use by symphony-loop.ts, output-tailer.ts, and loop-finalizer.ts.
 *
 * Accepts `getToken: () => LoopTokenMeta | null` (a synchronous provider
 * resolved per-request) rather than a static token string, enabling token
 * rotation across the lifetime of a long-running loop (AC-001, AC-002).
 *
 * Logging is dual-channeled: per-loop `loopLog`/`loopError` for the UI and
 * `gatewayLog` for the durable main.log (preserved from symphony-loop.ts).
 *
 * 401 handling (AC-005): when a request receives a 401 response and a
 * `setToken` callback is provided, `refreshToken` is called exactly once.
 * On success the new token is persisted via `setToken` and the original
 * request is retried once. If the refresh itself returns 401 the error is
 * surfaced as a non-retryable auth failure.
 *
 * 409 stale_idempotency_key handling (AC-008): when `/refresh-token` responds
 * with 409 and an `error` body field of `"stale_idempotency_key"`, the cached
 * key is discarded, a fresh UUID is generated and persisted, and the refresh
 * request is retried exactly once. A second consecutive 409 is surfaced as a
 * non-retryable auth failure.
 *
 * Proactive refresh scheduling (AC-004): `scheduleProactiveRefresh`
 * sets a per-loop timer that fires at `expiresAt - refreshSkew` (default
 * 30 min). On fire, the same refresh logic is invoked, the new token is
 * persisted, and the timer is rescheduled. Tokens without `expiresAt` (opaque
 * tokens) are skipped. `cancelProactiveRefresh` cancels a scheduled timer.
 *
 * Heartbeat scheduling (AC-012): `scheduleHeartbeat` sets a per-loop
 * repeating timer (default 30 min, configurable via
 * `CLOSEDLOOP_HEARTBEAT_INTERVAL_MS`) that issues `POST /heartbeat` using the
 * current token from the provider. Errors are logged but not thrown
 * (fire-and-forget). `cancelHeartbeat` cancels the timer. If the server
 * returns 404, the base URL is recorded in `oldServersWithoutFeature` and
 * heartbeat is skipped for that URL for the remainder of the process (AC-010).
 */

import crypto from "node:crypto";
import { gatewayLog } from "../../main/gateway-logger.js";
import type { LoopTokenMeta } from "../../main/loop-token-store.js";
import {
  loopError,
  loopLog,
} from "./symphony-utils.js";

// ---------------------------------------------------------------------------
// Capability advertisement (T-6.2, AC-013)
// ---------------------------------------------------------------------------

/**
 * Returns the loop HTTP capabilities supported by this desktop runner.
 *
 * Advertised in the `desktop.hello` handshake via `getCapabilities` so the
 * server can snapshot these into `Loop.runnerCapabilities` at dispatch
 * (AC-013).
 *
 * - `loopRunnerRefreshSupported`: this runner calls `/refresh-token` both
 *   proactively (before expiry) and reactively (on 401) to keep long-running
 *   loops alive.
 * - `loopRunnerHeartbeatSupported`: this runner sends `POST /heartbeat` every
 *   30 minutes for RUNNING loops so the server can distinguish a live runner
 *   from a silent disconnect.
 */
export function getLoopHttpCapabilities(): {
  loopRunnerRefreshSupported: true;
  loopRunnerHeartbeatSupported: true;
} {
  return {
    loopRunnerRefreshSupported: true,
    loopRunnerHeartbeatSupported: true,
  };
}

// ---------------------------------------------------------------------------
// Old-server detection (AC-010)
// ---------------------------------------------------------------------------

/**
 * Module-level Set of server base URLs that have returned 404 for either the
 * `/heartbeat` or `/refresh-token` endpoint. Entries are keyed by the endpoint
 * URL (e.g. `"https://api.example.com/heartbeat"`).
 *
 * - Populated on first 404 response from `/heartbeat` or `/refresh-token`.
 * - Checked before each heartbeat request and before each refresh attempt.
 * - Never persisted to disk — re-probed on the next app launch (AC-010).
 * - Shared between heartbeat and refresh-token 404 tracking so that a single
 *   Set covers both features.
 */
export const oldServersWithoutFeature = new Set<string>();

// ---------------------------------------------------------------------------
// powerMonitor wake-from-sleep integration (T-6.1)
// ---------------------------------------------------------------------------

/**
 * Minimal interface for Electron's `powerMonitor` module.
 * Using a structural interface instead of importing the full Electron type
 * keeps this module importable in plain Node.js test environments.
 */
export interface PowerMonitorLike {
  on(event: "resume", listener: () => void): void;
  off(event: "resume", listener: () => void): void;
}

/**
 * Module-level reference to the injected powerMonitor instance.
 * Set once at startup via `configurePowerMonitor`. Null in test environments
 * that do not call `configurePowerMonitor`.
 */
let activePowerMonitor: PowerMonitorLike | null = null;

/**
 * Whether `resumeListener` is currently registered on `activePowerMonitor`.
 * Guards against duplicate `on` calls and spurious `off` calls (e.g. when
 * `cancelProactiveRefresh` is called idempotently after the listener was
 * already removed).
 */
let resumeListenerRegistered = false;

/**
 * The resume event listener registered on `activePowerMonitor`.
 * Stored so it can be removed with the exact same function reference.
 */
const resumeListener = (): void => {
  proactiveRefreshAllTokens();
};

/**
 * Inject the Electron `powerMonitor` instance.
 *
 * Call this once during app startup (e.g. from `GatewayRouter` constructor)
 * to enable wake-from-sleep token refresh. The listener is automatically
 * registered and deregistered as active loops start and end.
 *
 * @param pm  Electron's `powerMonitor` or a compatible stub.
 */
export function configurePowerMonitor(pm: PowerMonitorLike | null): void {
  // If we're replacing the power monitor, ensure any previously registered
  // listener is removed before swapping (handles test teardown).
  if (resumeListenerRegistered && activePowerMonitor !== null) {
    activePowerMonitor.off("resume", resumeListener);
    resumeListenerRegistered = false;
  }
  activePowerMonitor = pm;
}

// ---------------------------------------------------------------------------
// Proactive refresh scheduler (AC-004)
// ---------------------------------------------------------------------------

/**
 * How many milliseconds before `expiresAt` to fire the proactive refresh
 * timer. Configurable via env var `CLOSEDLOOP_TOKEN_REFRESH_SKEW_MS`; defaults
 * to 1800000 ms (30 minutes).
 */
const refreshSkew: number = (() => {
  const raw = process.env["CLOSEDLOOP_TOKEN_REFRESH_SKEW_MS"];
  if (raw !== undefined && raw.length > 0) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return 1800000;
})();

/**
 * Module-level map from loopId to the active proactive-refresh timer handle.
 * Allows `cancelProactiveRefresh` to clear a timer without the caller holding
 * a reference to the handle.
 */
const proactiveRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Parameters needed to perform a proactive token refresh for a loop.
 * Stored per-loop so that `proactiveRefreshAllTokens` can trigger an
 * immediate refresh on wake-from-sleep without the caller holding references.
 */
type LoopRefreshParams = {
  apiBaseUrl: string;
  getToken: () => LoopTokenMeta | null;
  setToken: (meta: LoopTokenMeta) => void;
};

/**
 * Module-level map from loopId to its refresh parameters.
 * Populated when `scheduleProactiveRefresh` is called and cleared when
 * `cancelProactiveRefresh` is called, so it always reflects active loops.
 */
const activeLoopRefreshParams = new Map<string, LoopRefreshParams>();

/**
 * Schedule a proactive token refresh timer for `loopId`.
 *
 * Reads the current token metadata via `getToken()`. If `expiresAt` is absent
 * (opaque token), scheduling is skipped entirely. Otherwise a timer is set to
 * fire at `expiresAt - refreshSkew`, clamped to `Date.now()` so that already-
 * expired windows fire immediately. On fire the refresh logic is invoked; on
 * success the new metadata is persisted via `setToken` and the timer is
 * rescheduled using the new `expiresAt`. On failure the timer is NOT
 * rescheduled — the 401-driven path will handle the next request.
 *
 * Any previously scheduled timer for the same `loopId` is cancelled before
 * the new one is set, so callers can safely call this after each successful
 * refresh without leaking handles.
 *
 * @param loopId      Identifies the loop whose token should be refreshed.
 * @param apiBaseUrl  Base URL of the ClosedLoop API (no trailing slash).
 * @param getToken    Synchronous provider returning the current token metadata.
 * @param setToken    Callback to persist updated token metadata to the store.
 */
export function scheduleProactiveRefresh(
  loopId: string,
  apiBaseUrl: string,
  getToken: () => LoopTokenMeta | null,
  setToken: (meta: LoopTokenMeta) => void,
): void {
  // Cancel any existing timer for this loop before scheduling a new one.
  cancelProactiveRefresh(loopId);

  const meta = getToken();
  if (meta === null || meta.expiresAt === undefined) {
    // Opaque token — skip scheduling.
    gatewayLog.info(
      "loop-http",
      `scheduleProactiveRefresh loopId=${loopId}: no expiresAt, skipping`,
    );
    return;
  }

  const delay = Math.max(meta.expiresAt - refreshSkew - Date.now(), 0);
  gatewayLog.info(
    "loop-http",
    `scheduleProactiveRefresh loopId=${loopId}: firing in ${delay}ms (expiresAt=${meta.expiresAt} skew=${refreshSkew})`,
  );

  const handle = setTimeout(() => {
    proactiveRefreshTimers.delete(loopId);
    const currentMeta = getToken();
    if (currentMeta === null) {
      gatewayLog.info(
        "loop-http",
        `scheduleProactiveRefresh loopId=${loopId}: token gone before refresh fired, skipping`,
      );
      return;
    }
    gatewayLog.info(
      "loop-http",
      `scheduleProactiveRefresh loopId=${loopId}: timer fired, calling refreshToken`,
    );
    void refreshToken(apiBaseUrl, currentMeta, loopId, setToken).then(
      (result) => {
        if (!result.ok) {
          gatewayLog.error(
            "loop-http",
            `scheduleProactiveRefresh loopId=${loopId}: refresh failed: ${result.error}`,
          );
          // Do not reschedule — 401-driven path will handle subsequent requests.
          return;
        }
        setToken(result.meta);
        gatewayLog.info(
          "loop-http",
          `scheduleProactiveRefresh loopId=${loopId}: refresh succeeded, rescheduling`,
        );
        // Reschedule using the new expiresAt from the refreshed token.
        scheduleProactiveRefresh(loopId, apiBaseUrl, getToken, setToken);
      },
    );
  }, delay);

  proactiveRefreshTimers.set(loopId, handle);
  // Register refresh params so proactiveRefreshAllTokens can trigger an
  // immediate refresh for this loop on wake-from-sleep (T-6.1).
  activeLoopRefreshParams.set(loopId, { apiBaseUrl, getToken, setToken });
  // Attach the resume listener on the first active loop so that wake-from-sleep
  // events trigger proactiveRefreshAllTokens for all running loops.
  if (activeLoopRefreshParams.size === 1 && activePowerMonitor !== null && !resumeListenerRegistered) {
    activePowerMonitor.on("resume", resumeListener);
    resumeListenerRegistered = true;
    gatewayLog.info(
      "loop-http",
      "scheduleProactiveRefresh: registered powerMonitor resume listener (first active loop)",
    );
  }
}

/**
 * Cancel the proactive refresh timer for `loopId` if one is active.
 * Safe to call when no timer is scheduled — it is a no-op in that case.
 *
 * Call this when a loop terminates or its token is deleted.
 *
 * @param loopId  Identifies the loop whose timer should be cancelled.
 */
export function cancelProactiveRefresh(loopId: string): void {
  activeLoopRefreshParams.delete(loopId);
  // Remove the resume listener when the last active loop ends so we stop
  // listening for wake-from-sleep events when no loops are running (T-6.1).
  if (activeLoopRefreshParams.size === 0 && activePowerMonitor !== null && resumeListenerRegistered) {
    activePowerMonitor.off("resume", resumeListener);
    resumeListenerRegistered = false;
    gatewayLog.info(
      "loop-http",
      "cancelProactiveRefresh: removed powerMonitor resume listener (no active loops)",
    );
  }
  const handle = proactiveRefreshTimers.get(loopId);
  if (handle !== undefined) {
    clearTimeout(handle);
    proactiveRefreshTimers.delete(loopId);
    gatewayLog.info(
      "loop-http",
      `cancelProactiveRefresh loopId=${loopId}: timer cancelled`,
    );
  }
}

// ---------------------------------------------------------------------------
// Wake-from-sleep proactive refresh (T-6.1)
// ---------------------------------------------------------------------------

/**
 * Trigger an immediate proactive token refresh for every active loop.
 *
 * Called when the system wakes from sleep so that loops whose tokens may have
 * expired during the sleep window are refreshed before the next request.
 * For each loop currently registered in `activeLoopRefreshParams`:
 *  1. Cancels the existing proactive-refresh timer (if any).
 *  2. Calls `refreshToken` via the singleflight wrapper.
 *  3. On success, persists the new token and reschedules the proactive timer.
 *  4. On failure, logs a warning — the 401-driven path will handle the next request.
 *
 * Fire-and-forget: errors do not propagate to the caller.
 */
export function proactiveRefreshAllTokens(): void {
  if (activeLoopRefreshParams.size === 0) {
    gatewayLog.info(
      "loop-http",
      "proactiveRefreshAllTokens: no active loops, skipping",
    );
    return;
  }

  gatewayLog.info(
    "loop-http",
    `proactiveRefreshAllTokens: triggering refresh for ${activeLoopRefreshParams.size} active loop(s)`,
  );

  for (const [loopId, params] of activeLoopRefreshParams) {
    const { apiBaseUrl, getToken, setToken } = params;
    const meta = getToken();
    if (meta === null) {
      gatewayLog.info(
        "loop-http",
        `proactiveRefreshAllTokens loopId=${loopId}: no token available, skipping`,
      );
      continue;
    }
    void refreshTokenSingleflight(apiBaseUrl, meta, loopId, setToken).then(
      (result) => {
        if (!result.ok) {
          gatewayLog.error(
            "loop-http",
            `proactiveRefreshAllTokens loopId=${loopId}: refresh failed: ${result.error}`,
          );
          // Do not cancel the scheduled timer — it will continue from where it
          // was and the 401-driven path handles subsequent request failures.
          return;
        }
        setToken(result.meta);
        gatewayLog.info(
          "loop-http",
          `proactiveRefreshAllTokens loopId=${loopId}: refresh succeeded, rescheduling timer`,
        );
        // Reschedule the proactive timer using the new token's expiresAt.
        scheduleProactiveRefresh(loopId, apiBaseUrl, getToken, setToken);
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Heartbeat scheduler (AC-012)
// ---------------------------------------------------------------------------

/**
 * How many milliseconds between heartbeat POSTs.
 * Configurable via env var `CLOSEDLOOP_HEARTBEAT_INTERVAL_MS`; defaults
 * to 1800000 ms (30 minutes).
 */
const heartbeatIntervalMs: number = (() => {
  const raw = process.env["CLOSEDLOOP_HEARTBEAT_INTERVAL_MS"];
  if (raw !== undefined && raw.length > 0) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 1800000;
})();

/**
 * Module-level map from loopId to the active heartbeat interval handle.
 * Allows `cancelHeartbeat` to clear an interval without the caller holding
 * a reference to the handle.
 */
const heartbeatTimers = new Map<string, NodeJS.Timeout>();

/**
 * Schedule a periodic heartbeat for `loopId`.
 *
 * Issues `POST <apiBaseUrl>/heartbeat` on every `heartbeatIntervalMs`
 * interval using the current token from `getToken()`. Errors (including
 * network errors) are logged but not thrown — heartbeat is fire-and-forget.
 * If the server returns 404, the call is logged as a no-op (old server
 * without heartbeat support); subsequent ticks will retry (persistence across
 * the process lifetime is handled by T-5.2's old-server Set).
 *
 * Any previously scheduled heartbeat timer for the same `loopId` is cancelled
 * before the new one is set, so callers can safely re-call this without
 * leaking handles.
 *
 * @param loopId      Identifies the loop sending heartbeats.
 * @param apiBaseUrl  Base URL of the ClosedLoop API (no trailing slash).
 * @param getToken    Synchronous provider returning the current token metadata.
 */
export function scheduleHeartbeat(
  loopId: string,
  apiBaseUrl: string,
  getToken: () => LoopTokenMeta | null,
): void {
  // Cancel any existing timer for this loop before scheduling a new one.
  cancelHeartbeat(loopId);

  gatewayLog.info(
    "loop-http",
    `scheduleHeartbeat loopId=${loopId}: interval=${heartbeatIntervalMs}ms`,
  );

  const handle = setInterval(() => {
    const heartbeatUrl = `${apiBaseUrl}/heartbeat`;
    // Old-server check (AC-010): skip heartbeat for servers that previously
    // returned 404 for this endpoint during this process lifetime.
    if (oldServersWithoutFeature.has(heartbeatUrl)) {
      gatewayLog.info(
        "loop-http",
        `scheduleHeartbeat loopId=${loopId}: skipping — ${heartbeatUrl} returned 404 earlier (old server)`,
      );
      return;
    }
    const meta = getToken();
    if (meta === null) {
      gatewayLog.info(
        "loop-http",
        `scheduleHeartbeat loopId=${loopId}: no token available, skipping heartbeat`,
      );
      return;
    }
    gatewayLog.info(
      "loop-http",
      `scheduleHeartbeat loopId=${loopId}: sending heartbeat to ${heartbeatUrl}`,
    );
    void fetch(heartbeatUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${meta.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ loopId }),
    }).then(
      (resp) => {
        if (resp.status === 404) {
          // Record that this server does not support the heartbeat endpoint so
          // that subsequent ticks skip the request immediately (AC-010).
          oldServersWithoutFeature.add(heartbeatUrl);
          gatewayLog.info(
            "loop-http",
            `scheduleHeartbeat loopId=${loopId}: server returned 404 — heartbeat not supported, disabling for ${apiBaseUrl}`,
          );
          return;
        }
        if (!resp.ok) {
          gatewayLog.error(
            "loop-http",
            `scheduleHeartbeat loopId=${loopId}: heartbeat failed with status ${resp.status}`,
          );
          return;
        }
        gatewayLog.info(
          "loop-http",
          `scheduleHeartbeat loopId=${loopId}: heartbeat acknowledged (${resp.status})`,
        );
      },
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        gatewayLog.error(
          "loop-http",
          `scheduleHeartbeat loopId=${loopId}: heartbeat network error: ${msg}`,
        );
      },
    );
  }, heartbeatIntervalMs);

  heartbeatTimers.set(loopId, handle);
}

/**
 * Cancel the heartbeat timer for `loopId` if one is active.
 * Safe to call when no timer is scheduled — it is a no-op in that case.
 *
 * Call this when a loop terminates.
 *
 * @param loopId  Identifies the loop whose heartbeat timer should be cancelled.
 */
export function cancelHeartbeat(loopId: string): void {
  const handle = heartbeatTimers.get(loopId);
  if (handle !== undefined) {
    clearInterval(handle);
    heartbeatTimers.delete(loopId);
    gatewayLog.info(
      "loop-http",
      `cancelHeartbeat loopId=${loopId}: timer cancelled`,
    );
  }
}

// ---------------------------------------------------------------------------
// Singleflight map (AC-006)
// ---------------------------------------------------------------------------

/**
 * Module-level map from loopId to the in-flight refresh promise.
 * When a 401 triggers a token refresh, the promise is stored here so that
 * concurrent 401s for the same loop share the same refresh operation instead
 * of issuing multiple requests. The entry is removed after the promise
 * settles (whether resolved or rejected).
 */
const refreshInFlight = new Map<string, Promise<RefreshResult>>();

// ---------------------------------------------------------------------------
// refreshToken — internal helper (AC-005)
// ---------------------------------------------------------------------------

/**
 * Result of a token refresh attempt.
 */
type RefreshResult =
  | { ok: true; meta: LoopTokenMeta }
  | { ok: false; error: string; nonRetryable: boolean };

/**
 * Call `POST <apiBaseUrl>/refresh-token` to obtain a new token.
 *
 * Returns a typed discriminated union so callers can distinguish:
 * - Success: `{ ok: true, meta }` — new token ready to use
 * - Auth failure (refresh returned 401): `{ ok: false, nonRetryable: true }`
 * - Other error: `{ ok: false, nonRetryable: false }`
 *
 * Idempotency key handling (AC-011):
 * - Reuses `currentMeta.lastIdempotencyKey` if one exists (survives restarts).
 * - Generates a fresh `crypto.randomUUID()` otherwise.
 * - Persists the key to the store via `setToken` BEFORE making the request so
 *   a mid-refresh crash can reuse the same key on the next boot.
 * - Clears the key (via `setToken`) after a successful refresh or a
 *   non-retryable 401 failure so stale keys do not accumulate.
 *
 * 409 stale_idempotency_key handling (AC-008):
 * - When the server responds 409 with `error: "stale_idempotency_key"`, the
 *   cached key is discarded, a fresh UUID is generated and persisted, and the
 *   refresh request is retried exactly once with the new key.
 * - A second consecutive 409 is surfaced as a non-retryable auth failure so
 *   callers do not loop indefinitely.
 *
 * @param setToken  Callback to persist token metadata back to `LoopTokenStore`.
 *                  Required for idempotency key persistence and clearing.
 */
async function refreshToken(
  apiBaseUrl: string,
  currentMeta: LoopTokenMeta,
  loopId: string,
  setToken: (meta: LoopTokenMeta) => void,
): Promise<RefreshResult> {
  const url = `${apiBaseUrl}/refresh-token`;
  // Old-server check (AC-010): skip refresh for servers known to not support it.
  if (oldServersWithoutFeature.has(url)) {
    gatewayLog.info(
      "loop-http",
      `refreshToken loopId=${loopId}: skipping — ${url} returned 404 earlier (old server)`,
    );
    return { ok: false, error: "refresh endpoint not supported by server (old server)", nonRetryable: false };
  }
  // Reuse an existing idempotency key when one was persisted (e.g. after a
  // force-quit mid-refresh), otherwise generate a fresh one (AC-011).
  const idempotencyKey =
    currentMeta.lastIdempotencyKey ?? crypto.randomUUID();

  // Persist the key before sending the request so a crash during the refresh
  // call can recover with the same key on the next boot (AC-011).
  if (currentMeta.lastIdempotencyKey !== idempotencyKey) {
    setToken({ ...currentMeta, lastIdempotencyKey: idempotencyKey });
  }

  gatewayLog.info(
    "loop-http",
    `Refreshing token for loopId=${loopId} url=${url} idempotencyKey=${idempotencyKey}`,
  );
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${currentMeta.token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ loopId }),
    });
    if (resp.status === 401) {
      gatewayLog.error(
        "loop-http",
        `Token refresh for loopId=${loopId} returned 401 — non-retryable auth failure`,
      );
      // Clear the idempotency key on non-retryable failure so stale keys do
      // not linger in the store (AC-005, AC-011).
      const { lastIdempotencyKey: _dropped, ...metaWithoutKey } = currentMeta;
      setToken(metaWithoutKey);
      // Use "HTTP 401" prefix so isRetryableFinalizationError() classifies this
      // as non-retryable (401 is not 429 and not >=500).
      return { ok: false, error: "HTTP 401 refresh — non-retryable auth failure", nonRetryable: true };
    }
    // 409 stale_idempotency_key: discard cached key, generate a fresh one, and
    // retry the refresh exactly once (AC-008).
    if (resp.status === 409) {
      const bodyText = await resp.text().catch(() => "");
      let errorCode: string | undefined;
      try {
        const parsed: unknown = JSON.parse(bodyText);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          "error" in parsed &&
          typeof (parsed as Record<string, unknown>)["error"] === "string"
        ) {
          errorCode = (parsed as Record<string, string>)["error"];
        }
      } catch {
        // Non-JSON body — treat error code as absent.
      }
      if (errorCode === "stale_idempotency_key") {
        gatewayLog.info(
          "loop-http",
          `Token refresh for loopId=${loopId} returned 409 stale_idempotency_key — generating fresh key and retrying once`,
        );
        // Discard the stale key: generate a fresh UUID, persist it, then retry.
        const freshKey = crypto.randomUUID();
        setToken({ ...currentMeta, lastIdempotencyKey: freshKey });
        const retryResp = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${currentMeta.token}`,
            "Content-Type": "application/json",
            "Idempotency-Key": freshKey,
          },
          body: JSON.stringify({ loopId }),
        });
        if (retryResp.status === 409) {
          // Second consecutive 409 — surface as non-retryable (AC-008).
          const retryBodyText = await retryResp.text().catch(() => "");
          gatewayLog.error(
            "loop-http",
            `Token refresh for loopId=${loopId} returned second consecutive 409 — non-retryable auth failure: ${retryBodyText}`,
          );
          const { lastIdempotencyKey: _dropped2, ...metaWithoutKey2 } = currentMeta;
          setToken(metaWithoutKey2);
          return { ok: false, error: "HTTP 409 refresh — stale idempotency key persists after retry, non-retryable", nonRetryable: true };
        }
        if (retryResp.status === 401) {
          gatewayLog.error(
            "loop-http",
            `Token refresh for loopId=${loopId} retry returned 401 — non-retryable auth failure`,
          );
          const { lastIdempotencyKey: _dropped3, ...metaWithoutKey3 } = currentMeta;
          setToken(metaWithoutKey3);
          return { ok: false, error: "HTTP 401 refresh — non-retryable auth failure", nonRetryable: true };
        }
        if (!retryResp.ok) {
          const retryText = await retryResp.text().catch(() => "");
          gatewayLog.error(
            "loop-http",
            `Token refresh for loopId=${loopId} retry after stale key failed: ${retryResp.status} ${retryResp.statusText} ${retryText}`,
          );
          return { ok: false, error: `HTTP ${retryResp.status} ${retryResp.statusText}`, nonRetryable: false };
        }
        // Parse the new token from the retry response body.
        return parseRefreshSuccessBody(retryResp, loopId);
      }
      // 409 with a different error code — treat as a generic non-retryable failure.
      gatewayLog.error(
        "loop-http",
        `Token refresh for loopId=${loopId} returned 409: ${bodyText}`,
      );
      return { ok: false, error: `HTTP 409 ${bodyText}`, nonRetryable: false };
    }
    // 404 old-server detection (AC-010): if the server does not support the
    // refresh endpoint, record the URL so subsequent calls skip the attempt.
    if (resp.status === 404) {
      oldServersWithoutFeature.add(url);
      gatewayLog.info(
        "loop-http",
        `Token refresh for loopId=${loopId} returned 404 — refresh not supported by ${apiBaseUrl}, disabling for process lifetime`,
      );
      return { ok: false, error: "HTTP 404 refresh endpoint not supported by server", nonRetryable: false };
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      gatewayLog.error(
        "loop-http",
        `Token refresh for loopId=${loopId} failed: ${resp.status} ${resp.statusText} ${text}`,
      );
      return { ok: false, error: `HTTP ${resp.status} ${resp.statusText}`, nonRetryable: false };
    }
    return parseRefreshSuccessBody(resp, loopId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    gatewayLog.error("loop-http", `Token refresh for loopId=${loopId} network error: ${msg}`);
    return { ok: false, error: msg, nonRetryable: false };
  }
}

/**
 * Parse the token, expiresAt, and jti fields from a successful refresh
 * response body. The `lastIdempotencyKey` is NOT included in the returned
 * meta — it is cleared on successful refresh by callers via `setToken`
 * (AC-005, AC-011).
 */
async function parseRefreshSuccessBody(
  resp: Response,
  loopId: string,
): Promise<RefreshResult> {
  const raw: unknown = await resp.json().catch(() => null);
  if (raw === null || typeof raw !== "object") {
    gatewayLog.error(
      "loop-http",
      `Token refresh for loopId=${loopId} returned unexpected body shape`,
    );
    return { ok: false, error: "refresh response missing token field", nonRetryable: false };
  }
  const body = raw as Record<string, unknown>;
  if (typeof body["token"] !== "string") {
    gatewayLog.error(
      "loop-http",
      `Token refresh for loopId=${loopId} returned unexpected body shape`,
    );
    return { ok: false, error: "refresh response missing token field", nonRetryable: false };
  }
  const token = body["token"];
  const expiresAt = typeof body["expiresAt"] === "number" ? body["expiresAt"] : undefined;
  const jti = typeof body["jti"] === "string" ? body["jti"] : undefined;
  // New token metadata does NOT include lastIdempotencyKey — the key is
  // cleared on successful refresh (AC-005, AC-011).
  const meta: LoopTokenMeta = {
    token,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(jti !== undefined ? { jti } : {}),
  };
  gatewayLog.info(
    "loop-http",
    `Token refresh for loopId=${loopId} succeeded`,
  );
  return { ok: true, meta };
}

// ---------------------------------------------------------------------------
// refreshTokenSingleflight — singleflight wrapper (AC-006)
// ---------------------------------------------------------------------------

/**
 * Singleflight wrapper around {@link refreshToken}.
 *
 * If a refresh is already in-flight for `loopId`, returns the existing
 * promise so that concurrent 401s for the same loop share a single refresh
 * request instead of issuing multiple. The map entry is removed after the
 * promise settles regardless of outcome, so a subsequent 401 after a failed
 * refresh will start a fresh attempt.
 *
 * @param setToken  Forwarded to {@link refreshToken} for idempotency key
 *                  persistence and clearing (AC-011).
 */
function refreshTokenSingleflight(
  apiBaseUrl: string,
  currentMeta: LoopTokenMeta,
  loopId: string,
  setToken: (meta: LoopTokenMeta) => void,
): Promise<RefreshResult> {
  const existing = refreshInFlight.get(loopId);
  if (existing !== undefined) {
    gatewayLog.info(
      "loop-http",
      `Token refresh for loopId=${loopId} already in-flight — reusing promise (singleflight)`,
    );
    return existing;
  }
  const promise = refreshToken(apiBaseUrl, currentMeta, loopId, setToken).finally(() => {
    // Remove only if this is still the same promise (guard against an
    // overlapping cleanup race, though in practice this is not reachable
    // because the entry is set synchronously before the async work begins).
    if (refreshInFlight.get(loopId) === promise) {
      refreshInFlight.delete(loopId);
    }
  });
  refreshInFlight.set(loopId, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// postLoopEvent
// ---------------------------------------------------------------------------

/**
 * POST a single loop event to `<apiBaseUrl>/loops/<loopId>/events`.
 *
 * - Resolves the auth token synchronously via `getToken()` at call time.
 *   Returns `{ success: false, error: "no token" }` when the provider returns
 *   null (e.g. token has been deleted or was never stored).
 * - Auto-injects `timestamp` when not already present in `eventBody`.
 * - Includes the `x-loop-event-nonce` idempotency header on every request.
 * - Logs to both the per-loop log channel and the gateway durable log.
 * - On HTTP 401, calls `/refresh-token` exactly once (if `setToken` is
 *   provided), persists the new token, and retries the request once (AC-005).
 *   If the refresh itself returns 401, returns a non-retryable auth failure.
 *
 * @param apiBaseUrl  Base URL of the ClosedLoop API (no trailing slash).
 * @param loopId      Loop identifier used for URL construction and logging.
 * @param getToken    Synchronous token provider — called once per request.
 * @param eventBody   Arbitrary event payload; `timestamp` is auto-injected.
 * @param signal      Optional AbortSignal (e.g. from `postLoopEventBounded`).
 * @param setToken    Optional callback to persist a refreshed token. When
 *                    omitted, 401 responses are returned without refresh.
 */
export async function postLoopEvent(
  apiBaseUrl: string,
  loopId: string,
  getToken: () => LoopTokenMeta | null,
  eventBody: Record<string, unknown>,
  signal?: AbortSignal,
  setToken?: (meta: LoopTokenMeta) => void,
  timeoutMs?: number,
): Promise<{ success: boolean; error?: string }> {
  const meta = getToken();
  if (meta === null) {
    loopError(loopId, "postLoopEvent: no token available");
    gatewayLog.error(
      "loop-http",
      `POST loopEvent type=${String(eventBody.type)} loopId=${loopId}: no token available`,
    );
    return { success: false, error: "no token" };
  }

  // Per-fetch timer: when `timeoutMs` is provided, the initial and retry
  // fetches each get an independent AbortController + timer. This ensures a
  // slow refresh in between cannot consume the retry's timeout budget. When
  // `timeoutMs` is undefined, the caller-supplied `signal` (if any) is used
  // unchanged — preserves the legacy behavior for callers that pass a signal
  // directly.
  const armFetchSignal = (): { signal: AbortSignal | undefined; clear: () => void } => {
    if (timeoutMs === undefined) {
      return { signal, clear: () => {} };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return { signal: controller.signal, clear: () => clearTimeout(timer) };
  };

  const url = `${apiBaseUrl}/loops/${loopId}/events`;
  // Auto-inject timestamp on every event (matches ECS harness reportEvent())
  const payload: Record<string, unknown> = {
    ...eventBody,
    timestamp: eventBody.timestamp ?? new Date().toISOString(),
  };
  loopLog(loopId, `POST event: ${payload.type}`, url);
  try {
    const initial = armFetchSignal();
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${meta.token}`,
          "Content-Type": "application/json",
          "x-loop-event-nonce": crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
        signal: initial.signal,
      });
    } finally {
      initial.clear();
    }
    if (!resp.ok) {
      // 401 handling: attempt token refresh and retry exactly once (AC-005).
      // The refresh call runs outside any bounded abort window — only the
      // initial request and the retry are subject to per-fetch timeouts.
      if (resp.status === 401 && setToken !== undefined) {
        loopLog(loopId, "Event POST 401 — attempting token refresh");
        gatewayLog.info(
          "loop-http",
          `POST loopEvent type=${payload.type} loopId=${loopId} received 401, attempting refresh`,
        );
        const refreshResult = await refreshTokenSingleflight(apiBaseUrl, meta, loopId, setToken);
        if (!refreshResult.ok) {
          loopError(loopId, `Token refresh failed: ${refreshResult.error}`);
          return { success: false, error: refreshResult.error };
        }
        // Persist the new token metadata (lastIdempotencyKey is already cleared
        // inside refreshToken on success).
        setToken(refreshResult.meta);
        // Retry the original request exactly once with the new token, using a
        // fresh per-fetch timer so a slow refresh can't have consumed the
        // retry's budget.
        const retry = armFetchSignal();
        let retryResp: Response;
        try {
          retryResp = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${refreshResult.meta.token}`,
              "Content-Type": "application/json",
              "x-loop-event-nonce": crypto.randomUUID(),
            },
            body: JSON.stringify(payload),
            signal: retry.signal,
          });
        } finally {
          retry.clear();
        }
        if (!retryResp.ok) {
          const retryText = await retryResp.text().catch(() => "");
          loopError(
            loopId,
            `Event POST retry failed: ${retryResp.status} ${retryResp.statusText}`,
            retryText,
          );
          gatewayLog.error(
            "loop-http",
            `POST loopEvent type=${payload.type} loopId=${loopId} retry after refresh failed: ${retryResp.status} ${retryResp.statusText} ${retryText}`,
          );
          return {
            success: false,
            error: "HTTP " + retryResp.status + " " + retryResp.statusText,
          };
        }
        loopLog(loopId, `Event POST retry success after refresh: ${retryResp.status}`);
        gatewayLog.info(
          "loop-http",
          `POST loopEvent type=${payload.type} loopId=${loopId} retry after refresh status=${retryResp.status}`,
        );
        return { success: true };
      }

      const text = await resp.text().catch(() => "");
      loopError(
        loopId,
        `Event POST failed: ${resp.status} ${resp.statusText}`,
        text,
      );
      gatewayLog.error(
        "loop-http",
        `POST loopEvent type=${payload.type} loopId=${loopId} url=${url} failed: ${resp.status} ${resp.statusText} ${text}`,
      );
      return {
        success: false,
        error: "HTTP " + resp.status + " " + resp.statusText,
      };
    }
    loopLog(loopId, `Event POST success: ${resp.status}`);
    gatewayLog.info(
      "loop-http",
      `POST loopEvent type=${payload.type} loopId=${loopId} status=${resp.status}`,
    );
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    loopError(loopId, "Failed to post event:", err);
    gatewayLog.error(
      "loop-http",
      `POST loopEvent type=${payload.type} loopId=${loopId} network error: ${msg}`,
    );
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// postLoopEventBounded
// ---------------------------------------------------------------------------

/**
 * Thin wrapper around {@link postLoopEvent} that enforces a per-fetch
 * wall-clock timeout.
 *
 * The bounded timeout applies independently to the initial HTTP request and
 * to the retry after a token refresh — it does NOT cancel the refresh call
 * itself, and a slow refresh cannot consume the retry's timeout budget. Each
 * fetch is wrapped in its own AbortController + timer inside postLoopEvent.
 *
 * @param timeoutMs  Maximum milliseconds to wait for each HTTP request
 *                   (initial and retry are budgeted separately). Defaults to
 *                   1000 ms (1 second).
 * @param setToken   Optional callback to persist a refreshed token. When
 *                   omitted, 401 responses are returned without refresh.
 */
export async function postLoopEventBounded(
  apiBaseUrl: string,
  loopId: string,
  getToken: () => LoopTokenMeta | null,
  eventBody: Record<string, unknown>,
  timeoutMs = 1000,
  setToken?: (meta: LoopTokenMeta) => void,
): Promise<{ success: boolean; error?: string }> {
  try {
    return await postLoopEvent(
      apiBaseUrl,
      loopId,
      getToken,
      eventBody,
      undefined,
      setToken,
      timeoutMs,
    );
  } catch {
    return { success: false, error: "timeout" };
  }
}

// ---------------------------------------------------------------------------
// uploadArtifacts
// ---------------------------------------------------------------------------

/**
 * POST an artifact bundle to `<apiBaseUrl>/loops/<loopId>/upload-artifacts`.
 *
 * Resolves the auth token synchronously via `getToken()` at call time.
 * Returns `{ success: false, error: "no token" }` when the provider returns
 * null.
 *
 * On HTTP 401, calls `/refresh-token` exactly once (if `setToken` is
 * provided), persists the new token, and retries the upload once (AC-005).
 * If the refresh itself returns 401, returns a non-retryable auth failure.
 *
 * @param apiBaseUrl  Base URL of the ClosedLoop API (no trailing slash).
 * @param loopId      Loop identifier used for URL construction and logging.
 * @param getToken    Synchronous token provider — called once per request.
 * @param body        Artifact payload to JSON-serialize as the request body.
 * @param setToken    Optional callback to persist a refreshed token. When
 *                    omitted, 401 responses are returned without refresh.
 */
export async function uploadArtifacts(
  apiBaseUrl: string,
  loopId: string,
  getToken: () => LoopTokenMeta | null,
  body: Record<string, unknown>,
  setToken?: (meta: LoopTokenMeta) => void,
): Promise<{ success: boolean; error?: string }> {
  const meta = getToken();
  if (meta === null) {
    loopError(loopId, "uploadArtifacts: no token available");
    gatewayLog.error(
      "loop-http",
      `Artifact upload for loopId=${loopId}: no token available`,
    );
    return { success: false, error: "no token" };
  }

  const url = `${apiBaseUrl}/loops/${loopId}/upload-artifacts`;
  loopLog(loopId, "Uploading artifacts...", url);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${meta.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      // 401 handling: attempt token refresh and retry exactly once (AC-005).
      if (resp.status === 401 && setToken !== undefined) {
        loopLog(loopId, "Artifact upload 401 — attempting token refresh");
        gatewayLog.info(
          "loop-http",
          `Artifact upload for loopId=${loopId} received 401, attempting refresh`,
        );
        const refreshResult = await refreshTokenSingleflight(apiBaseUrl, meta, loopId, setToken);
        if (!refreshResult.ok) {
          loopError(loopId, `Token refresh failed: ${refreshResult.error}`);
          return { success: false, error: refreshResult.error };
        }
        // Persist the new token metadata (lastIdempotencyKey is already cleared
        // inside refreshToken on success).
        setToken(refreshResult.meta);
        // Retry the upload exactly once with the new token.
        const retryResp = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${refreshResult.meta.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (!retryResp.ok) {
          const retryText = await retryResp.text().catch(() => "");
          loopError(
            loopId,
            `Upload retry failed: ${retryResp.status} ${retryResp.statusText}`,
            retryText,
          );
          gatewayLog.error(
            "loop-http",
            `Artifact upload for loopId=${loopId} retry after refresh failed: ${retryResp.status} ${retryResp.statusText} ${retryText}`,
          );
          return {
            success: false,
            error: `HTTP ${retryResp.status} ${retryResp.statusText}`,
          };
        }
        loopLog(loopId, `Upload retry success after refresh: ${retryResp.status}`);
        gatewayLog.info(
          "loop-http",
          `Artifact upload for loopId=${loopId} retry after refresh status=${retryResp.status}`,
        );
        return { success: true };
      }

      const text = await resp.text().catch(() => "");
      loopError(
        loopId,
        `Upload failed: ${resp.status} ${resp.statusText}`,
        text,
      );
      gatewayLog.error(
        "loop-http",
        `Artifact upload to ${url} failed: ${resp.status} ${resp.statusText} ${text}`,
      );
      return {
        success: false,
        error: `HTTP ${resp.status} ${resp.statusText}`,
      };
    }
    loopLog(loopId, `Upload success: ${resp.status}`);
    gatewayLog.info(
      "loop-http",
      `Artifact upload for loopId=${loopId}: ${resp.status}`,
    );
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    loopError(loopId, "Failed to upload artifacts:", err);
    gatewayLog.error("loop-http", `Artifact upload network error: ${msg}`);
    return { success: false, error: msg };
  }
}
