import {
  buildManagedDesktopPopHeaders,
  type DesktopPopUnavailableReporter,
} from "./desktop-pop-sign-utils.js";
import type { ApiKeyProvenance } from "./api-key-store.js";
import type { DesktopPopSigner } from "./desktop-pop.js";

export interface FetchLoopExecutionCredentialsOptions {
  apiOrigin: string;
  apiKey: string;
  apiKeyProvenance: ApiKeyProvenance;
  computeTargetId: string;
  loopId: string;
  commandId: string;
  signDesktopRequest?: DesktopPopSigner;
  onDesktopPopUnavailable?: DesktopPopUnavailableReporter;
}

type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Fetches the one-shot Desktop loop execution body after command signature
 * verification. The browser never receives this payload.
 */
export async function fetchLoopExecutionCredentials(
  options: FetchLoopExecutionCredentialsOptions
): Promise<Record<string, unknown>> {
  const url = new URL(
    `/compute-targets/${encodeURIComponent(options.computeTargetId)}/loops/${encodeURIComponent(options.loopId)}/execution-credentials`,
    options.apiOrigin
  );
  const popHeaders = await buildManagedDesktopPopHeaders({
    apiKeyProvenance: options.apiKeyProvenance,
    signDesktopRequest: options.signDesktopRequest,
    request: {
      method: "POST",
      pathname: url.pathname,
    },
    surface: url.pathname,
    unavailableMessage:
      "PoP signing unavailable for loop execution credentials; continuing bearer-only compatibility mode",
    onUnavailable: options.onDesktopPopUnavailable,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      ...(popHeaders ?? {}),
    },
    body: JSON.stringify({ commandId: options.commandId }),
  });
  const payload = (await response.json().catch(() => null)) as
    | ApiResult<Record<string, unknown>>
    | null;
  if (!response.ok || !payload?.success) {
    throw new Error(
      payload && !payload.success
        ? payload.error
        : "Failed to fetch loop execution credentials"
    );
  }
  return payload.data;
}
