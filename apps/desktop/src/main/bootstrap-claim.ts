import type {
  GatewaySigningKeyStore,
  GatewaySigningKeyUnavailableReason,
} from "./gateway-signing-key-store.js";

export interface BootstrapClaimPayload {
  onboardingAttemptId: string;
  webAppOrigin: string;
  gatewayId: string;
  gatewayPublicKeyPem: string;
}

export type BootstrapClaimDiagnostic = {
  reason: GatewaySigningKeyUnavailableReason;
  surface: "bootstrap_claim";
};

export type BootstrapClaimResult =
  | { kind: "claimed"; apiKey: string }
  | { kind: "manual_fallback"; reason: GatewaySigningKeyUnavailableReason }
  | { kind: "failed"; statusCode?: number; error: string };

export interface ClaimDesktopManagedApiKeyOptions {
  apiOrigin: string;
  onboardingAttemptId: string;
  webAppOrigin: string;
  gatewayId: string;
  signingKeys: Pick<GatewaySigningKeyStore, "getOrCreate">;
  bootstrapToken?: string;
  fetchImpl?: typeof fetch;
  onDiagnostic?: (diagnostic: BootstrapClaimDiagnostic) => void;
}

/**
 * Builds the exact Phase A bootstrap claim body required for Phase B-capable Desktop.
 */
export function buildBootstrapClaimPayload(input: BootstrapClaimPayload): BootstrapClaimPayload {
  const payload = {
    onboardingAttemptId: input.onboardingAttemptId.trim(),
    webAppOrigin: input.webAppOrigin.trim(),
    gatewayId: input.gatewayId.trim(),
    gatewayPublicKeyPem: input.gatewayPublicKeyPem.trim(),
  };
  if (
    !payload.onboardingAttemptId ||
    !payload.webAppOrigin ||
    !payload.gatewayId ||
    !payload.gatewayPublicKeyPem
  ) {
    throw new Error("bootstrap claim requires onboardingAttemptId, webAppOrigin, gatewayId, and gatewayPublicKeyPem");
  }
  return payload;
}

/**
 * Claims a Desktop-managed API key, or returns manual fallback before any network call if PoP is unavailable.
 */
export async function claimDesktopManagedApiKey(
  options: ClaimDesktopManagedApiKeyOptions
): Promise<BootstrapClaimResult> {
  const keyPair = options.signingKeys.getOrCreate(options.gatewayId);
  if (!keyPair.ok) {
    options.onDiagnostic?.({
      surface: "bootstrap_claim",
      reason: keyPair.reason,
    });
    return { kind: "manual_fallback", reason: keyPair.reason };
  }

  let payload: BootstrapClaimPayload;
  try {
    payload = buildBootstrapClaimPayload({
      onboardingAttemptId: options.onboardingAttemptId,
      webAppOrigin: options.webAppOrigin,
      gatewayId: options.gatewayId,
      gatewayPublicKeyPem: keyPair.keyPair.publicKeySpkiPem,
    });
  } catch {
    options.onDiagnostic?.({
      surface: "bootstrap_claim",
      reason: "key_import_failed",
    });
    return { kind: "manual_fallback", reason: "key_import_failed" };
  }

  const fetchFn = options.fetchImpl ?? fetch;
  const url = new URL("/desktop/bootstrap/claim", options.apiOrigin);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const bootstrapToken = options.bootstrapToken?.trim();
  if (bootstrapToken) {
    headers.Authorization = `Bearer ${bootstrapToken}`;
  }

  let response: Response;
  try {
    response = await fetchFn(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch {
    return {
      kind: "failed",
      statusCode: 502,
      error: "bootstrap claim request failed",
    };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    return {
      kind: "failed",
      statusCode: response.status,
      error: extractErrorMessage(body) ?? `bootstrap claim failed (${response.status})`,
    };
  }

  const apiKey = extractApiKey(body);
  if (!apiKey) {
    return {
      kind: "failed",
      statusCode: response.status,
      error: "bootstrap claim response missing apiKey",
    };
  }

  return { kind: "claimed", apiKey };
}

function extractApiKey(body: unknown): string | null {
  const payload = unwrapData(body);
  for (const key of ["apiKey", "cloudApiKey", "key"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function extractErrorMessage(body: unknown): string | null {
  const record = asRecord(body);
  if (typeof record.error === "string") {
    return record.error;
  }
  const errorRecord = asRecord(record.error);
  if (typeof errorRecord.message === "string") {
    return errorRecord.message;
  }
  return null;
}

function unwrapData(body: unknown): Record<string, unknown> {
  const record = asRecord(body);
  if (record.success === true && record.data && typeof record.data === "object") {
    return asRecord(record.data);
  }
  return record;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
