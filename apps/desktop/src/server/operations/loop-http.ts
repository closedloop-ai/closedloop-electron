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
// ---------------------------------------------------------------------------

/**
 * POST a single loop event to the cloud API.
 *
 * Auto-injects a `timestamp` field when not already present in `eventBody`
 * (matches ECS harness `reportEvent()` behaviour).
 * Generates a fresh `x-loop-event-nonce` UUID on every call.
 *
 * Returns `{ success: true }` on 2xx, otherwise `{ success: false, error }`.
 * Network errors are caught and returned as `{ success: false, error }` too.
 */
export async function postLoopEvent(
  apiBaseUrl: string,
  loopId: string,
  getToken: () => string | null,
  eventBody: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ success: boolean; error?: string }> {
  const url = `${apiBaseUrl}/loops/${encodeURIComponent(loopId)}/events`;
  // Auto-inject timestamp on every event (matches ECS harness reportEvent())
  const payload: Record<string, unknown> = {
    ...eventBody,
    timestamp: eventBody.timestamp ?? new Date().toISOString(),
  };
  loopLog(loopId, `POST event: ${payload.type}`, url);
  const token = getToken();
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token ?? ""}`,
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
        error: "HTTP " + resp.status + " " + resp.statusText,
      };
    }
    loopLog(loopId, `Event POST success: ${resp.status}`);
    gatewayLog.info(
      "loop-event",
      `POST loopEvent type=${payload.type} loopId=${loopId} status=${resp.status}`,
    );
    return { success: true };
  } catch (err) {
    if (signal?.aborted) {
      return { success: false, error: "timeout" };
    }
    const msg = err instanceof Error ? err.message : String(err);
    loopError(loopId, "Failed to post event:", err);
    gatewayLog.error(
      "loop-event",
      `POST loopEvent type=${payload.type} loopId=${loopId} network error: ${msg}`,
    );
    return { success: false, error: msg };
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
): Promise<{ success: boolean; error?: string }> {
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
 * Returns `{ success: true }` on 2xx, otherwise `{ success: false, error }`.
 */
export async function uploadArtifacts(
  apiBaseUrl: string,
  loopId: string,
  getToken: () => string | null,
  body: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  const url = `${apiBaseUrl}/loops/${encodeURIComponent(loopId)}/upload-artifacts`;
  loopLog(loopId, "Uploading artifacts...", url);
  const token = getToken();
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token ?? ""}`,
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
        error: `HTTP ${resp.status} ${resp.statusText}`,
      };
    }
    loopLog(loopId, `Upload success: ${resp.status}`);
    gatewayLog.info(
      "loop-upload",
      `Artifact upload for loopId=${loopId}: ${resp.status}`,
    );
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    loopError(loopId, "Failed to upload artifacts:", err);
    gatewayLog.error("loop-upload", `Artifact upload network error: ${msg}`);
    return { success: false, error: msg };
  }
}
