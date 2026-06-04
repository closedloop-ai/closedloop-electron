import type { ApiKeyProvenance } from "./api-key-store.js";
import type { DesktopCommandEvent } from "./cloud-protocol.js";
import type { DesktopPopSigner } from "./desktop-pop.js";
import type { DesktopPopUnavailableReporter } from "./desktop-pop-sign-utils.js";
import {
  fetchLoopExecutionCredentials,
  type FetchLoopExecutionCredentialsOptions,
} from "./loop-execution-credentials-client.js";

type FetchExecutionCredentials = (
  options: FetchLoopExecutionCredentialsOptions,
) => Promise<Record<string, unknown>>;

export const SIGNED_LOOP_LAUNCH_MANAGED_KEY_ERROR =
  "Signed loop launch requires a desktop-managed key with request signing; the active config uses a manually configured key or cannot load its signing key. Re-run managed onboarding.";

export type ManagedPopSigningReadinessReason =
  | "ready"
  | "user_created_key"
  | "signing_unavailable"
  | "missing_signer";

export type ManagedPopSigningReadiness = {
  provenance: ApiKeyProvenance;
  signingReady: boolean;
  reason: ManagedPopSigningReadinessReason;
};

export interface LoopCommandPreparationOptions {
  getApiOrigin: () => string;
  getApiKey: () => string | null;
  getApiKeyProvenance: () => ApiKeyProvenance | null;
  getManagedPopSigningReadiness?: () => ManagedPopSigningReadiness;
  getComputeTargetId: () => string | null;
  signDesktopRequest?: DesktopPopSigner;
  onDesktopPopUnavailable?: DesktopPopUnavailableReporter;
  fetchExecutionCredentials?: FetchExecutionCredentials;
}

/**
 * Replaces verified loop-launch browser intents with one-shot execution credentials.
 * Loop kill commands must keep their original body because the local kill route
 * reads `loopId` from that payload.
 */
export async function prepareLoopCommandForExecution(
  command: DesktopCommandEvent,
  options: LoopCommandPreparationOptions,
): Promise<DesktopCommandEvent> {
  if (command.path !== "/api/gateway/symphony/loop") {
    return command;
  }
  const body = asRecord(command.body);
  const loopId = typeof body.loopId === "string" ? body.loopId : null;
  if (!loopId || body.userIntent === undefined) {
    return command;
  }
  assertManagedSigningReady(options);
  const apiKey = options.getApiKey();
  const computeTargetId = options.getComputeTargetId();
  if (!(apiKey && computeTargetId)) {
    throw new Error("loop execution credentials unavailable");
  }
  const fetchExecutionCredentials =
    options.fetchExecutionCredentials ?? fetchLoopExecutionCredentials;
  return {
    ...command,
    body: await fetchExecutionCredentials({
      apiOrigin: options.getApiOrigin(),
      apiKey,
      apiKeyProvenance: options.getApiKeyProvenance() ?? "USER_CREATED",
      computeTargetId,
      loopId,
      commandId: command.commandId,
      signDesktopRequest: options.signDesktopRequest,
      onDesktopPopUnavailable: options.onDesktopPopUnavailable,
    }),
  };
}

function getDefaultReadiness(
  options: LoopCommandPreparationOptions,
): ManagedPopSigningReadiness {
  const provenance = options.getApiKeyProvenance() ?? "USER_CREATED";
  const signingReady =
    provenance === "DESKTOP_MANAGED" && options.signDesktopRequest !== undefined;
  return {
    provenance,
    signingReady,
    reason: signingReady
      ? "ready"
      : provenance === "DESKTOP_MANAGED"
        ? "missing_signer"
        : "user_created_key",
  };
}

function assertManagedSigningReady(
  options: LoopCommandPreparationOptions,
): void {
  const readiness =
    options.getManagedPopSigningReadiness?.() ?? getDefaultReadiness(options);
  if (readiness.provenance === "DESKTOP_MANAGED" && readiness.signingReady) {
    return;
  }
  if (readiness.provenance === "DESKTOP_MANAGED") {
    options.onDesktopPopUnavailable?.(
      "loop_execution_credentials",
      readiness.reason,
    );
  }
  throw new Error(SIGNED_LOOP_LAUNCH_MANAGED_KEY_ERROR);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
