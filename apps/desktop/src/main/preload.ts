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
  // FEA-1435/1436: vendor Admin key intake + cost reconciliation. The bridge only
  // ever moves existence-only statuses, persisted drift rows, and key-free run
  // summaries — never the Admin key material itself (main-process only).
  getAdminKeyStatuses: () =>
    ipcRenderer.invoke("desktop:get-admin-key-statuses") as Promise<unknown>,
  setAdminKey: (vendor: string, key: string) =>
    ipcRenderer.invoke("desktop:set-admin-key", { vendor, key }) as Promise<unknown>,
  clearAdminKey: (vendor: string) =>
    ipcRenderer.invoke("desktop:clear-admin-key", vendor) as Promise<unknown>,
  runCostReconciliation: () =>
    ipcRenderer.invoke("desktop:run-cost-reconciliation") as Promise<unknown>,
  listCostReconciliation: (query?: unknown) =>
    ipcRenderer.invoke("desktop:list-cost-reconciliation", query) as Promise<unknown>,
  // FEA-1436: Claude Code per-user usage (Anthropic's own estimate). Returns
  // per-actor usage rows only — never any Admin key material.
  getClaudeCodeAnalytics: (query?: unknown) =>
    ipcRenderer.invoke("desktop:get-claude-code-analytics", query) as Promise<unknown>,
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
  db: {
    getSessions: () => ipcRenderer.invoke("desktop:db:get-sessions") as Promise<unknown>,
    getSession: (id: string) => ipcRenderer.invoke("desktop:db:get-session", id) as Promise<unknown>,
    getAgents: (sessionId: string) => ipcRenderer.invoke("desktop:db:get-agents", sessionId) as Promise<unknown>,
    getEvents: (sessionId: string, agentId?: string) => ipcRenderer.invoke("desktop:db:get-events", sessionId, agentId) as Promise<unknown>,
    getDashboardSummary: () => ipcRenderer.invoke("desktop:db:get-dashboard-summary") as Promise<unknown>,
    getSessionsWithDetails: () => ipcRenderer.invoke("desktop:db:get-sessions-with-details") as Promise<unknown>,
    getEventFeed: () => ipcRenderer.invoke("desktop:db:get-event-feed") as Promise<unknown>,
    getEventsWithSession: (sessionId: string) => ipcRenderer.invoke("desktop:db:get-events-with-session", sessionId) as Promise<unknown>,
    getEventCountByType: () => ipcRenderer.invoke("desktop:db:get-event-count-by-type") as Promise<unknown>,
    getTokenAnalytics: () => ipcRenderer.invoke("desktop:db:get-token-analytics") as Promise<unknown>,
    getAgentHierarchy: (sessionId: string) => ipcRenderer.invoke("desktop:db:get-agent-hierarchy", sessionId) as Promise<unknown>,
    getAnalytics: () => ipcRenderer.invoke("desktop:db:get-analytics") as Promise<unknown>,
    getWorkflowData: () => ipcRenderer.invoke("desktop:db:get-workflow-data") as Promise<unknown>,
  },
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
