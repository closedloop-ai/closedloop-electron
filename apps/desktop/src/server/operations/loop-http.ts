import crypto from "node:crypto";
import { gatewayLog } from "../../main/gateway-logger.js";
import { loopError, loopLog } from "./symphony-utils.js";

// ---------------------------------------------------------------------------
// Consolidated HTTP helpers for loop event posting and artifact upload.
//
// All three functions accept `getToken: () => string | null` so that
// long-lived closures (output tailer, boot-recovery) resolve the current
// token on every request rather than capturing a stale string at
// construction time.
//
// Return shape is a discriminated union on `kind` so callers (notably the
// output tailer's retry classifier) can branch on a typed field rather than
// parsing substrings out of the human-readable `error` string.
// ---------------------------------------------------------------------------

export type HeartbeatRevivalFields = {
  revived: boolean;
  token?: string;
  expiresAt?: Date;
  jti?: string;
};

export type LoopHttpResult =
  | ({ success: true; status: number } & Partial<HeartbeatRevivalFields>)
  | { success: false; kind: "http"; status: number; error: string }
  | { success: false; kind: "network"; error: string }
  | { success: false; kind: "timeout"; error: "timeout" }
  | { success: false; kind: "auth"; error: "missing_token" };

/**
 * POST a single loop event to the cloud API.
 *
 * Auto-injects a `timestamp` field when not already present in `eventBody`
 * (matches ECS harness `reportEvent()` behaviour).
 * Generates a fresh `x-loop-event-nonce` UUID on every call.
 *
 * Short-circuits with `kind: "auth"` when `getToken()` returns null so the
 * caller can skip the round trip and the inevitable 401.
 */
export async function postLoopEvent(
  apiBaseUrl: string,
  loopId: string,
  getToken: () => string | null,
  eventBody: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<LoopHttpResult> {
  const url = `${apiBaseUrl}/loops/${encodeURIComponent(loopId)}/events`;
  // Auto-inject timestamp on every event (matches ECS harness reportEvent())
  const payload: Record<string, unknown> = {
    ...eventBody,
    timestamp: eventBody.timestamp ?? new Date().toISOString(),
  };
  loopLog(loopId, `POST event: ${payload.type}`, url);
  const token = getToken();
  if (token === null) {
    loopError(loopId, "No loop token available for event POST", url);
    gatewayLog.warn(
      "loop-event",
      `POST loopEvent type=${payload.type} loopId=${loopId} skipped: missing token`,
    );
    return { success: false, kind: "auth", error: "missing_token" };
  }
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-loop-event-nonce": crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
      signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      loopError(
        loopId,
        `Event POST failed: ${resp.status} ${resp.statusText}`,
        text,
      );
      gatewayLog.error(
        "loop-event",
        `POST loopEvent type=${payload.type} loopId=${loopId} url=${url} failed: ${resp.status} ${resp.statusText} ${text}`,
      );
      return {
        success: false,
        kind: "http",
        status: resp.status,
        error: "HTTP " + resp.status + " " + resp.statusText,
      };
    }
    loopLog(loopId, `Event POST success: ${resp.status}`);
    gatewayLog.info(
      "loop-event",
      `POST loopEvent type=${payload.type} loopId=${loopId} status=${resp.status}`,
    );
    return { success: true, status: resp.status };
  } catch (err) {
    if (signal?.aborted) {
      return { success: false, kind: "timeout", error: "timeout" };
    }
    const msg = err instanceof Error ? err.message : String(err);
    loopError(loopId, "Failed to post event:", err);
    gatewayLog.error(
      "loop-event",
      `POST loopEvent type=${payload.type} loopId=${loopId} network error: ${msg}`,
    );
    return { success: false, kind: "network", error: msg };
  }
}

/**
 * POST a loop event with an AbortController-based timeout.
 *
 * Uses `postLoopEvent` internally; aborts the fetch if `timeoutMs` elapses
 * before a response is received.  Defaults to a 1 000 ms timeout.
 */
export async function postLoopEventBounded(
  apiBaseUrl: string,
  loopId: string,
  getToken: () => string | null,
  eventBody: Record<string, unknown>,
  timeoutMs = 1000,
): Promise<LoopHttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await postLoopEvent(
      apiBaseUrl,
      loopId,
      getToken,
      eventBody,
      controller.signal,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST artifact data to the cloud upload-artifacts endpoint.
 *
 * Unlike `postLoopEvent`, this call does NOT include `x-loop-event-nonce`
 * (artifact uploads are not idempotency-keyed events).
 *
 * Short-circuits with `kind: "auth"` when `getToken()` returns null.
 */
export async function uploadArtifacts(
  apiBaseUrl: string,
  loopId: string,
  getToken: () => string | null,
  body: Record<string, unknown>,
): Promise<LoopHttpResult> {
  const url = `${apiBaseUrl}/loops/${encodeURIComponent(loopId)}/upload-artifacts`;
  loopLog(loopId, "Uploading artifacts...", url);
  const token = getToken();
  if (token === null) {
    loopError(loopId, "No loop token available for artifact upload", url);
    gatewayLog.warn(
      "loop-upload",
      `Artifact upload for loopId=${loopId} skipped: missing token`,
    );
    return { success: false, kind: "auth", error: "missing_token" };
  }
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      loopError(
        loopId,
        `Upload failed: ${resp.status} ${resp.statusText}`,
        text,
      );
      gatewayLog.error(
        "loop-upload",
        `Artifact upload to ${url} failed: ${resp.status} ${resp.statusText} ${text}`,
      );
      return {
        success: false,
        kind: "http",
        status: resp.status,
        error: `HTTP ${resp.status} ${resp.statusText}`,
      };
    }
    loopLog(loopId, `Upload success: ${resp.status}`);
    gatewayLog.info(
      "loop-upload",
      `Artifact upload for loopId=${loopId}: ${resp.status}`,
    );
    return { success: true, status: resp.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    loopError(loopId, "Failed to upload artifacts:", err);
    gatewayLog.error("loop-upload", `Artifact upload network error: ${msg}`);
    return { success: false, kind: "network", error: msg };
  }
}

/**
 * GET the current status of a cloud loop.
 *
 * Returns `{ kind: 'active' }` for any running/non-terminal status,
 * `{ kind: 'timed_out' }` when the API reports status === 'TIMED_OUT',
 * `{ kind: 'unauthorized' }` on HTTP 401 (so callers can refresh and retry
 * via a typed branch rather than a string-equality check),
 * or `{ kind: 'error', message }` on other HTTP errors / network failures.
 *
 * Uses an AbortController timeout (default 5 000 ms) matching the
 * postLoopEventBounded pattern.
 */
export type CloudLoopStatus =
  | { kind: "timed_out" }
  | { kind: "active" }
  | { kind: "unauthorized" }
  | { kind: "error"; message: string; status?: number };

export async function getCloudLoopStatus(
  apiBaseUrl: string,
  loopId: string,
  getToken: () => string | null,
  timeoutMs = 5000,
): Promise<CloudLoopStatus> {
  const url = `${apiBaseUrl}/loops/${encodeURIComponent(loopId)}`;
  const token = getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token ?? ""}`,
      },
      signal: controller.signal,
    });
    if (resp.status === 401) {
      return { kind: "unauthorized" };
    }
    if (!resp.ok) {
      return { kind: "error", message: `HTTP ${resp.status}`, status: resp.status };
    }
    const raw = (await resp.json()) as Record<string, unknown>;
    const status = typeof raw?.status === "string" ? raw.status : null;
    if (status === null) {
      gatewayLog.warn(
        "loop-status",
        `Unexpected response shape for loopId=${loopId}: ${JSON.stringify(raw)}`,
      );
      return { kind: "active" };
    }
    if (status === "TIMED_OUT") {
      return { kind: "timed_out" };
    }
    return { kind: "active" };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST a heartbeat to `/loops/:id/heartbeat`.
 *
 * Returns the same `LoopHttpResult` discriminated union as `postLoopEvent`
 * so callers can branch on `kind === "http" && status === 404` without
 * parsing strings.
 *
 * When `getSessionToken` is supplied and resolves to a non-null string, the
 * token is forwarded as `X-Session-Token`. The server uses this to attempt
 * revival of a TIMED_OUT loop. On a successful revival response the returned
 * success object includes `revived: true` plus the replacement runner token
 * fields (`token`, `expiresAt`, `jti`).
 */
export async function postLoopHeartbeat(
  apiBaseUrl: string,
  loopId: string,
  getToken: () => string | null,
  getSessionToken?: () => Promise<string | null>,
): Promise<LoopHttpResult> {
  const url = `${apiBaseUrl}/loops/${encodeURIComponent(loopId)}/heartbeat`;
  const token = getToken();
  if (token === null) {
    return { success: false, kind: "auth", error: "missing_token" };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  if (getSessionToken !== undefined) {
    const sessionToken = await getSessionToken();
    if (sessionToken !== null) {
      headers["X-Session-Token"] = sessionToken;
    }
  }

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
    });
    if (!resp.ok) {
      return {
        success: false,
        kind: "http",
        status: resp.status,
        error: `HTTP ${resp.status} ${resp.statusText}`,
      };
    }

    const revivalFields = await parseHeartbeatRevivalFields(resp);
    return { success: true, status: resp.status, ...revivalFields };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, kind: "network", error: msg };
  }
}

/**
 * Attempts to parse revival fields from a successful heartbeat response body.
 *
 * Returns a `HeartbeatRevivalFields` partial when `revived` is true and the
 * body contains valid token fields; returns an empty object otherwise.
 * Never throws — a malformed body is treated as a non-revival response.
 */
async function parseHeartbeatRevivalFields(
  resp: Response,
): Promise<Partial<HeartbeatRevivalFields>> {
  try {
    const raw = (await resp.json()) as Record<string, unknown>;
    // The API wraps the payload in { success, data }; unwrap if present.
    const data =
      raw.data !== undefined && typeof raw.data === "object" && raw.data !== null
        ? (raw.data as Record<string, unknown>)
        : raw;

    if (data.revived !== true) {
      return {};
    }
    const result: HeartbeatRevivalFields = { revived: true };
    if (typeof data.token === "string") {
      result.token = data.token;
    }
    if (typeof data.expiresAt === "string") {
      const parsed = new Date(data.expiresAt);
      if (!isNaN(parsed.getTime())) {
        result.expiresAt = parsed;
      }
    }
    if (typeof data.jti === "string") {
      result.jti = data.jti;
    }
    return result;
  } catch {
    return {};
  }
}
