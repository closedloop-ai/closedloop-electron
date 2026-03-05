import { contextBridge, ipcRenderer } from "electron";

const desktopApi = {
  getSettings: () => ipcRenderer.invoke("desktop:get-settings") as Promise<unknown>,
  updateSettings: (partial: unknown) =>
    ipcRenderer.invoke("desktop:update-settings", partial) as Promise<unknown>,
  getRuntimeStatus: () => ipcRenderer.invoke("desktop:get-runtime-status") as Promise<unknown>,
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
  pickSandboxDirectory: () => ipcRenderer.invoke("desktop:pick-sandbox-directory") as Promise<unknown>,
  getDangerousAutoApprove: () =>
    ipcRenderer.invoke("desktop:get-dangerous-auto-approve") as Promise<boolean>,
  setDangerousAutoApprove: (enabled: boolean) =>
    ipcRenderer.invoke("desktop:set-dangerous-auto-approve", enabled) as Promise<boolean>,
  checkForUpdate: () => ipcRenderer.invoke("desktop:check-for-update") as Promise<unknown>,
  applyUpdate: () => ipcRenderer.invoke("desktop:apply-update") as Promise<unknown>
};

contextBridge.exposeInMainWorld("desktopApi", desktopApi);

ipcRenderer.on("desktop:navigate-tab", (_event, tab: string) => {
  window.dispatchEvent(new CustomEvent("desktop:navigate-tab", { detail: tab }));
});

ipcRenderer.on("desktop:update-available", (_event, result) => {
  window.dispatchEvent(new CustomEvent("desktop:update-available", { detail: result }));
});
