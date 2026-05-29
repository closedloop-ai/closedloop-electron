import type { ManagedKeyHintState } from "../shared/contracts.js";
import { contextBridge, ipcRenderer } from "electron";

const desktopApi = {
  getSettings: () => ipcRenderer.invoke("desktop:get-settings") as Promise<unknown>,
  updateSettings: (partial: unknown) =>
    ipcRenderer.invoke("desktop:update-settings", partial) as Promise<unknown>,
  getRuntimeStatus: () => ipcRenderer.invoke("desktop:get-runtime-status") as Promise<unknown>,
  listCommandSigningKeys: () =>
    ipcRenderer.invoke("desktop:list-command-signing-keys") as Promise<unknown>,
  listAuthorizedKeys: () =>
    ipcRenderer.invoke("desktop:list-authorized-keys") as Promise<unknown>,
  authorizeKey: (payload: unknown) =>
    ipcRenderer.invoke("desktop:authorize-key", payload) as Promise<unknown>,
  removeAuthorizedKey: (fingerprint: string) =>
    ipcRenderer.invoke("desktop:remove-authorized-key", fingerprint) as Promise<unknown>,
  listOrgPublicKeys: () =>
    ipcRenderer.invoke("desktop:list-org-public-keys") as Promise<unknown>,
  approveOrgPublicKey: (fingerprint: string) =>
    ipcRenderer.invoke("desktop:approve-org-public-key", fingerprint) as Promise<unknown>,
  rejectOrgPublicKey: (fingerprint: string) =>
    ipcRenderer.invoke("desktop:reject-org-public-key", fingerprint) as Promise<unknown>,
  authorizeCommandSigningKey: (fingerprint: string) =>
    ipcRenderer.invoke("desktop:authorize-command-signing-key", fingerprint) as Promise<unknown>,
  revokeCommandSigningKey: (fingerprint: string) =>
    ipcRenderer.invoke("desktop:revoke-command-signing-key", fingerprint) as Promise<unknown>,
  getActivityEvents: () => ipcRenderer.invoke("desktop:get-activity-events") as Promise<unknown>,
  clearActivityEvents: () =>
    ipcRenderer.invoke("desktop:clear-activity-events") as Promise<unknown>,
  getPendingApprovals: () =>
    ipcRenderer.invoke("desktop:get-pending-approvals") as Promise<unknown>,
  approveApproval: (approvalId: string) =>
    ipcRenderer.invoke("desktop:approve-approval", approvalId) as Promise<unknown>,
  denyApproval: (approvalId: string) =>
    ipcRenderer.invoke("desktop:deny-approval", approvalId) as Promise<unknown>,
  alwaysAllowApproval: (approvalId: string) =>
    ipcRenderer.invoke("desktop:always-allow-approval", approvalId) as Promise<unknown>,
  clearPendingApprovals: () =>
    ipcRenderer.invoke("desktop:clear-pending-approvals") as Promise<unknown>,
  getResolvedApprovals: () =>
    ipcRenderer.invoke("desktop:get-resolved-approvals") as Promise<unknown>,
  clearResolvedApprovals: () =>
    ipcRenderer.invoke("desktop:clear-resolved-approvals") as Promise<unknown>,
  getApiKeyStatus: () => ipcRenderer.invoke("desktop:get-api-key-status") as Promise<unknown>,
  setApiKey: (apiKey: string) =>
    ipcRenderer.invoke("desktop:set-api-key", apiKey) as Promise<unknown>,
  clearApiKey: () => ipcRenderer.invoke("desktop:clear-api-key") as Promise<unknown>,
  getCloudCommandsPaused: () =>
    ipcRenderer.invoke("desktop:get-cloud-commands-paused") as Promise<unknown>,
  setCloudCommandsPaused: (paused: boolean) =>
    ipcRenderer.invoke("desktop:set-cloud-commands-paused", paused) as Promise<unknown>,
  getCloudConnectionEnabled: () =>
    ipcRenderer.invoke("desktop:get-cloud-connection-enabled") as Promise<unknown>,
  setCloudConnectionEnabled: (enabled: boolean) =>
    ipcRenderer.invoke("desktop:set-cloud-connection-enabled", enabled) as Promise<unknown>,
  getOnboardingState: () => ipcRenderer.invoke("desktop:get-onboarding-state") as Promise<unknown>,
  completeOnboarding: (payload: unknown) =>
    ipcRenderer.invoke("desktop:complete-onboarding", payload) as Promise<unknown>,
  // FEA-1333: mark the one-time Agent Dashboard welcome as seen.
  markDashboardWelcomeSeen: () =>
    ipcRenderer.invoke("desktop:mark-dashboard-welcome-seen") as Promise<{
      ok: boolean;
    }>,
  startDeviceOnboarding: (payload: unknown) =>
    ipcRenderer.invoke("desktop:start-device-onboarding", payload) as Promise<unknown>,
  dismissOnboardingPopup: (payload: { permanent: boolean }) =>
    ipcRenderer.invoke("desktop:dismiss-onboarding-popup", payload) as Promise<unknown>,
  onboardingPopupCta: () =>
    ipcRenderer.invoke("desktop:onboarding-popup-cta") as Promise<unknown>,
  pickSandboxDirectory: () =>
    ipcRenderer.invoke("desktop:pick-sandbox-directory") as Promise<{
      path: string;
      isGitRepo: boolean;
      suggestedPath: string | undefined;
    } | null>,
  inspectSandboxPath: (path: string) =>
    ipcRenderer.invoke("desktop:inspect-sandbox-path", path) as Promise<{
      path: string;
      isGitRepo: boolean;
      suggestedPath: string | undefined;
    } | null>,
  getDangerousAutoApprove: () =>
    ipcRenderer.invoke("desktop:get-dangerous-auto-approve") as Promise<boolean>,
  setDangerousAutoApprove: (enabled: boolean) =>
    ipcRenderer.invoke("desktop:set-dangerous-auto-approve", enabled) as Promise<boolean>,
  removeAlwaysAllowRule: (ruleId: string) =>
    ipcRenderer.invoke("desktop:remove-always-allow-rule", ruleId) as Promise<unknown>,
  checkForUpdate: () => ipcRenderer.invoke("desktop:check-for-update") as Promise<unknown>,
  applyUpdate: () => ipcRenderer.invoke("desktop:apply-update") as Promise<unknown>,
  isDebugAuthEnabled: () => ipcRenderer.invoke("desktop:is-debug-auth-enabled") as Promise<boolean>,
  mintDebugToken: (origin?: string) =>
    ipcRenderer.invoke("desktop:mint-debug-token", origin) as Promise<unknown>,
  listRunningJobs: () => ipcRenderer.invoke("desktop:list-running-jobs") as Promise<unknown>,
  listCompletedJobs: () => ipcRenderer.invoke("desktop:list-completed-jobs") as Promise<unknown>,
  getJob: (jobId: string) => ipcRenderer.invoke("desktop:get-job", jobId) as Promise<unknown>,
  getJobLogTail: (jobId: string, lines?: number) =>
    ipcRenderer.invoke("desktop:get-job-log-tail", jobId, lines) as Promise<unknown>,
  getLogs: () => ipcRenderer.invoke("desktop:get-logs") as Promise<unknown>,
  clearLogs: () => ipcRenderer.invoke("desktop:clear-logs") as Promise<unknown>,
  getLogFilePath: () =>
    ipcRenderer.invoke("desktop:get-log-file-path") as Promise<string>,
  openLogFile: () => ipcRenderer.invoke("desktop:open-log-file") as Promise<unknown>,
  getAppVersion: () => ipcRenderer.invoke("desktop:get-app-version") as Promise<string>,
  getBinaryPaths: () => ipcRenderer.invoke("desktop:get-binary-paths") as Promise<unknown>,
  patchBinaryPaths: (patch: unknown) =>
    ipcRenderer.invoke("desktop:patch-binary-paths", patch) as Promise<unknown>,
  detectCliTools: () =>
    ipcRenderer.invoke("desktop:detect-cli-tools") as Promise<unknown>,
  saveConfig: (name: string) =>
    ipcRenderer.invoke("desktop:save-config", { name }) as Promise<unknown>,
  findMatchingConfig: () =>
    ipcRenderer.invoke("desktop:find-matching-config") as Promise<unknown>,
  listConfigs: () =>
    ipcRenderer.invoke("desktop:list-configs") as Promise<unknown>,
  deleteConfig: (id: string) =>
    ipcRenderer.invoke("desktop:delete-config", { id }) as Promise<unknown>,
  renameConfig: (id: string, name: string) =>
    ipcRenderer.invoke("desktop:rename-config", { id, name }) as Promise<unknown>,
  applyConfig: (id: string) =>
    ipcRenderer.invoke("desktop:apply-config", { id }) as Promise<unknown>,
  getAgentMonitorUrl: () =>
    ipcRenderer.invoke("desktop:get-agent-monitor-url") as Promise<{
      url: string | null;
      ready: boolean;
      enabled: boolean;
      planExtractionEnabled: boolean;
    }>,
  openAgentMonitor: () =>
    ipcRenderer.invoke("desktop:open-agent-monitor") as Promise<unknown>,
  getAgentMonitorHooksEnabled: () =>
    ipcRenderer.invoke(
      "desktop:get-agent-monitor-hooks-enabled",
    ) as Promise<boolean>,
  setAgentMonitorHooksEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(
      "desktop:set-agent-monitor-hooks-enabled",
      enabled,
    ) as Promise<{ ok: boolean; enabled: boolean; error?: string }>,
  getAllFlags: () =>
    ipcRenderer.invoke("desktop:get-all-flags") as Promise<unknown>,
  onFlagsChanged: (callback: () => void) => {
    ipcRenderer.on("desktop:flags-changed", callback);
  },
  // FEA-1334: cold-start ingest progress for the floating progress card.
  // Resolves null when the sidecar is unreachable or has no progress yet.
  getAgentMonitorIngestProgress: () =>
    ipcRenderer.invoke(
      "desktop:get-agent-monitor-ingest-progress",
    ) as Promise<{
      running: boolean;
      startedAt: number | null;
      updatedAt: number | null;
      finishedAt: number | null;
      total: number;
      parsed: number;
      imported: number;
      byHarness: Record<
        string,
        { total: number; parsed: number; imported: number; complete: boolean }
      >;
    } | null>,
  // FEA-1334: clear the dashboard DB and restart the sidecar so it re-imports
  // every agent session from scratch. The progress banner tracks the re-import.
  reprocessAgentLogs: () =>
    ipcRenderer.invoke("desktop:reprocess-agent-logs") as Promise<{
      ok: boolean;
      error?: string;
    }>,
  /**
   * Returns the current state of the managed-key revival limitation hint (D5).
   * The main process reads provenance from apiKeyStore — renderer does not control
   * what is returned.
   */
  getManagedKeyHintState: () =>
    ipcRenderer.invoke("desktop:get-managed-key-hint-state") as Promise<ManagedKeyHintState>,
  /**
   * Dismisses the managed-key revival limitation hint (D5).
   * The main process records the current provenance from apiKeyStore.
   * The renderer does not supply any arguments — provenance is main-process-only.
   */
  dismissManagedKeyHint: () =>
    ipcRenderer.invoke("desktop:dismiss-managed-key-hint") as Promise<{ success: boolean }>,
  // FEA-1435: Cost reconciliation Admin Keys + worker controls.
  getAnthropicAdminKeyStatus: () =>
    ipcRenderer.invoke("cost-reconciliation:get-anthropic-key-status") as Promise<{
      set: boolean;
      setAt?: string;
      lastValidatedAt?: string;
    }>,
  setAnthropicAdminKey: (key: string) =>
    ipcRenderer.invoke("cost-reconciliation:set-anthropic-key", { key }) as Promise<{
      success: boolean;
      error?: string;
      entriesReturned?: number;
    }>,
  clearAnthropicAdminKey: () =>
    ipcRenderer.invoke("cost-reconciliation:clear-anthropic-key") as Promise<{
      success: boolean;
    }>,
  getOpenAIAdminKeyStatus: () =>
    ipcRenderer.invoke("cost-reconciliation:get-openai-key-status") as Promise<{
      set: boolean;
      setAt?: string;
      lastValidatedAt?: string;
    }>,
  setOpenAIAdminKey: (key: string) =>
    ipcRenderer.invoke("cost-reconciliation:set-openai-key", { key }) as Promise<{
      success: boolean;
      error?: string;
      entriesReturned?: number;
    }>,
  clearOpenAIAdminKey: () =>
    ipcRenderer.invoke("cost-reconciliation:clear-openai-key") as Promise<{
      success: boolean;
    }>,
  triggerReconciliationRun: () =>
    ipcRenderer.invoke("cost-reconciliation:trigger-run") as Promise<{ queued: boolean }>,
  getReconciliationStatus: () =>
    ipcRenderer.invoke("cost-reconciliation:get-status") as Promise<{
      lastRunAt: string | null;
      dayRangeCovered: { from: string; to: string } | null;
      avgDriftPct: number | null;
      rowCount: number;
      enabled: boolean;
      intervalHours: number;
    }>,
  setReconciliationEnabled: (enabled: boolean) =>
    ipcRenderer.invoke("cost-reconciliation:set-enabled", { enabled }) as Promise<{
      success: boolean;
      enabled: boolean;
    }>,
  // FEA-1436: drift diagnostics.
  getReconciliationDriftRows: (daysBack?: number) =>
    ipcRenderer.invoke("cost-reconciliation:get-drift-rows", { daysBack }) as Promise<{
      rows: {
        day: string;
        vendor: string;
        model: string;
        localEstimateMicroCents: number;
        vendorBilledMicroCents: number;
        driftMicroCents: number;
        driftPct: number | null;
        causeHint: string | null;
        computedAt: string;
      }[];
    }>,
  getReconciliationDriftRollup: () =>
    ipcRenderer.invoke("cost-reconciliation:get-drift-rollup") as Promise<{
      avgDriftPct: number | null;
      totalDriftDollars: number;
      rowCount: number;
      daysCovered: number;
      sparklineDaily: { day: string; driftPct: number | null }[];
    }>,
  exportReconciliationDay: (day: string, vendor: string, model: string) =>
    ipcRenderer.invoke("cost-reconciliation:export-day", { day, vendor, model }) as Promise<
      | {
          ok: true;
          blob: {
            schemaVersion: 1;
            generatedAt: string;
            reconciliation: unknown;
            tokenUsage: unknown[];
          };
        }
      | { ok: false; error: string }
    >,
  getClaudeCodeAnalytics: () =>
    ipcRenderer.invoke("cost-reconciliation:get-claude-code-analytics") as Promise<{
      users: {
        userId: string;
        daysActive: number;
        sessions: number;
        tokens: number;
        anthropicEstimateUsd: number;
        localEstimateUsd: number | null;
        gapUsd: number | null;
      }[];
    }>,
};

contextBridge.exposeInMainWorld("desktopApi", desktopApi);

ipcRenderer.on("desktop:navigate-tab", (_event, tab: string) => {
  window.dispatchEvent(new CustomEvent("desktop:navigate-tab", { detail: tab }));
});

ipcRenderer.on("desktop:navigate-settings-tab", (_event, tab: string) => {
  window.dispatchEvent(new CustomEvent("desktop:navigate-settings-tab", { detail: tab }));
});

ipcRenderer.on("desktop:command-keys-changed", () => {
  window.dispatchEvent(new CustomEvent("desktop:command-keys-changed"));
});

ipcRenderer.on("desktop:update-available", (_event, result) => {
  window.dispatchEvent(new CustomEvent("desktop:update-available", { detail: result }));
});

ipcRenderer.on("desktop:update-status", (_event, result) => {
  window.dispatchEvent(new CustomEvent("desktop:update-status", { detail: result }));
});

ipcRenderer.on("desktop:onboarding-state-changed", () => {
  window.dispatchEvent(new CustomEvent("desktop:onboarding-state-changed"));
});

ipcRenderer.on("desktop:show-onboarding-popup", () => {
  window.dispatchEvent(new CustomEvent("desktop:show-onboarding-popup"));
});
