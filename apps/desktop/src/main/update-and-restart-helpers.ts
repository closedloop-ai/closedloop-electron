import type { GatewayApprovalResult } from "../server/router.js";

export type PackagedUpdateState = {
  availableVersion: string | null;
  downloadedVersion: string | null;
};

export function buildUpdateAndRestartDisabledResult(): GatewayApprovalResult {
  return {
    allow: false,
    statusCode: 501,
    payload: {
      error: "feature_disabled",
      feature: "update_and_restart",
    },
  };
}

export function shouldHonorAlwaysAllowRule(
  operationId: string,
  forceInteractiveOperations: ReadonlySet<string>
): boolean {
  return !forceInteractiveOperations.has(operationId);
}

export function canApplyPackagedUpdate(
  currentVersion: string,
  state: PackagedUpdateState
): boolean {
  return Boolean(
    state.downloadedVersion && state.downloadedVersion !== currentVersion
  );
}

export function resolvePackagedUpdateCheckResult(
  currentVersion: string,
  state: PackagedUpdateState,
  remoteVersion?: string
): { updateAvailable: boolean; version?: string } {
  if (canApplyPackagedUpdate(currentVersion, state)) {
    return {
      updateAvailable: true,
      version: state.downloadedVersion ?? undefined,
    };
  }

  return remoteVersion
    ? { updateAvailable: false, version: remoteVersion }
    : { updateAvailable: false };
}
