export interface AgentMonitorUrl {
  url: string | null;
  ready: boolean;
  enabled: boolean;
  planExtractionEnabled: boolean;
}

export interface SandboxInspectResult {
  path: string;
  isGitRepo: boolean;
  suggestedPath: string | undefined;
}

export interface AgentMonitorHookResult {
  ok: boolean;
  enabled: boolean;
  error?: string;
}

export interface DesktopApi {
  getSettings: () => Promise<unknown>;
  updateSettings: (partial: unknown) => Promise<unknown>;
  getRuntimeStatus: () => Promise<unknown>;
  listCommandSigningKeys: () => Promise<unknown>;
  listAuthorizedKeys: () => Promise<unknown>;
  authorizeKey: (payload: unknown) => Promise<unknown>;
  removeAuthorizedKey: (fingerprint: string) => Promise<unknown>;
  listOrgPublicKeys: () => Promise<unknown>;
  approveOrgPublicKey: (fingerprint: string) => Promise<unknown>;
  rejectOrgPublicKey: (fingerprint: string) => Promise<unknown>;
  authorizeCommandSigningKey: (fingerprint: string) => Promise<unknown>;
  revokeCommandSigningKey: (fingerprint: string) => Promise<unknown>;
  getActivityEvents: () => Promise<unknown>;
  clearActivityEvents: () => Promise<unknown>;
  getPendingApprovals: () => Promise<unknown>;
  approveApproval: (approvalId: string) => Promise<unknown>;
  denyApproval: (approvalId: string) => Promise<unknown>;
  alwaysAllowApproval: (approvalId: string) => Promise<unknown>;
  clearPendingApprovals: () => Promise<unknown>;
  getResolvedApprovals: () => Promise<unknown>;
  clearResolvedApprovals: () => Promise<unknown>;
  getApiKeyStatus: () => Promise<unknown>;
  setApiKey: (apiKey: string) => Promise<unknown>;
  clearApiKey: () => Promise<unknown>;
  getCloudCommandsPaused: () => Promise<unknown>;
  setCloudCommandsPaused: (paused: boolean) => Promise<unknown>;
  getCloudConnectionEnabled: () => Promise<unknown>;
  setCloudConnectionEnabled: (enabled: boolean) => Promise<unknown>;
  getOnboardingState: () => Promise<unknown>;
  completeOnboarding: (payload: unknown) => Promise<unknown>;
  startDeviceOnboarding: (payload: unknown) => Promise<unknown>;
  dismissOnboardingPopup: (payload: { permanent: boolean }) => Promise<unknown>;
  onboardingPopupCta: () => Promise<unknown>;
  pickSandboxDirectory: () => Promise<SandboxInspectResult | null>;
  inspectSandboxPath: (path: string) => Promise<SandboxInspectResult | null>;
  getDangerousAutoApprove: () => Promise<boolean>;
  setDangerousAutoApprove: (enabled: boolean) => Promise<boolean>;
  removeAlwaysAllowRule: (ruleId: string) => Promise<unknown>;
  checkForUpdate: () => Promise<unknown>;
  applyUpdate: () => Promise<unknown>;
  isDebugAuthEnabled: () => Promise<boolean>;
  mintDebugToken: (origin?: string) => Promise<unknown>;
  listRunningJobs: () => Promise<unknown>;
  listCompletedJobs: () => Promise<unknown>;
  getJob: (jobId: string) => Promise<unknown>;
  getJobLogTail: (jobId: string, lines?: number) => Promise<unknown>;
  getLogs: () => Promise<unknown>;
  clearLogs: () => Promise<unknown>;
  getLogFilePath: () => Promise<string>;
  openLogFile: () => Promise<unknown>;
  getAppVersion: () => Promise<string>;
  getBinaryPaths: () => Promise<unknown>;
  patchBinaryPaths: (patch: unknown) => Promise<unknown>;
  detectCliTools: () => Promise<unknown>;
  saveConfig: (name: string) => Promise<unknown>;
  findMatchingConfig: () => Promise<unknown>;
  listConfigs: () => Promise<unknown>;
  deleteConfig: (id: string) => Promise<unknown>;
  renameConfig: (id: string, name: string) => Promise<unknown>;
  applyConfig: (id: string) => Promise<unknown>;
  getAgentMonitorUrl: () => Promise<AgentMonitorUrl>;
  openAgentMonitor: () => Promise<unknown>;
  getAgentMonitorHooksEnabled: () => Promise<boolean>;
  setAgentMonitorHooksEnabled: (enabled: boolean) => Promise<AgentMonitorHookResult>;
  /** @deprecated Replaced by in-process SQLite database */
  getAgentMonitorData?: (query: string) => Promise<unknown>;
  /** Database IPC channels */
  db: {
    getSessions: () => Promise<unknown>;
    getSession: (id: string) => Promise<unknown>;
    getAgents: (sessionId: string) => Promise<unknown>;
    getEvents: (sessionId: string, agentId?: string) => Promise<unknown>;
    getDashboardSummary: () => Promise<unknown>;
    getSessionsWithDetails: () => Promise<unknown>;
    getEventFeed: () => Promise<unknown>;
    getEventsWithSession: (sessionId: string) => Promise<unknown>;
    getEventCountByType: () => Promise<unknown>;
    getTokenAnalytics: () => Promise<unknown>;
    getAgentHierarchy: (sessionId: string) => Promise<unknown>;
  };
}

declare global {
  interface Window {
    desktopApi: DesktopApi;
  }
}
