import crypto from "node:crypto";
import { gatewayLog } from "../../main/gateway-logger.js";
import type { OperationRequestContext } from "../operation-dispatcher.js";
import { loopError, loopLog } from "./symphony-utils.js";

// ---------------------------------------------------------------------------
// HTTP API communication (events + artifact upload)
// ---------------------------------------------------------------------------

export async function postLoopEvent(
  apiBaseUrl: string,
  loopId: string,
  token: string,
  eventBody: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ success: boolean; error?: string }> {
  const url = `${apiBaseUrl}/loops/${loopId}/events`;
  // Auto-inject timestamp on every event (matches ECS harness reportEvent())
  const payload: Record<string, unknown> = {
    ...eventBody,
    timestamp: eventBody.timestamp ?? new Date().toISOString(),
  };
  loopLog(loopId, `POST event: ${payload.type}`, url);
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
        `POST ${payload.type} to ${url} failed: ${resp.status} ${resp.statusText} ${text}`,
      );
      return {
        success: false,
        error: "HTTP " + resp.status + " " + resp.statusText,
      };
    }
    loopLog(loopId, `Event POST success: ${resp.status}`);
    gatewayLog.info(
      "loop-event",
      `POST ${payload.type} for loopId=${loopId}: ${resp.status}`,
    );
    return { success: true };
  } catch (err) {
    // Re-throw AbortError so postLoopEventBounded's catch can label it "timeout"
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    const msg = err instanceof Error ? err.message : String(err);
    loopError(loopId, "Failed to post event:", err);
    gatewayLog.error(
      "loop-event",
      `POST ${payload.type} network error: ${msg}`,
    );
    return { success: false, error: msg };
  }
}

export async function postLoopEventBounded(
  apiBaseUrl: string,
  loopId: string,
  token: string,
  eventBody: Record<string, unknown>,
  timeoutMs = 1000,
): Promise<{ success: boolean; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await postLoopEvent(
      apiBaseUrl,
      loopId,
      token,
      eventBody,
      controller.signal,
    );
  } catch {
    return { success: false, error: "timeout" };
  } finally {
    clearTimeout(timer);
  }
}

export async function uploadArtifacts(
  apiBaseUrl: string,
  loopId: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  const url = `${apiBaseUrl}/loops/${loopId}/upload-artifacts`;
  loopLog(loopId, "Uploading artifacts...", url);
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

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

export function json(
  context: OperationRequestContext,
  status: number,
  payload: unknown,
): void {
  context.response.statusCode = status;
  context.response.setHeader("content-type", "application/json");
  context.response.end(JSON.stringify(payload));
}

export function parseJsonBody(
  context: OperationRequestContext,
): Record<string, unknown> | null {
  if (!context.body.trim()) {
    return null;
  }
  try {
    return JSON.parse(context.body) as Record<string, unknown>;
  } catch {
    return null;
  }
}
