import type {
  SessionRow,
  AgentRow,
  EventRow,
  EventWithSession,
  EventCountByType,
  KanbanPages,
  SessionPage,
  SessionPageRequest,
  SessionWithAgents,
  DashboardSummary,
  DashboardCoreFeatures,
  DashboardPackSummary,
  DashboardPlanSummary,
  DashboardPullRequestSummary,
  DashboardSkillSummary,
  DashboardSubAgentSummary,
  DashboardToolSummary,
  TokenAnalytics,
  AnalyticsData,
  WorkflowQueryData,
  AgentHierarchyNode,
  CatalogEntry,
  CatalogMutationResult,
  InstallOutputChunk,
  InstallRunRecord,
  InstalledPack,
  InstalledPackDetail,
  SkillWithInvocations,
  SkillInvocation,
  PlanRecord,
  PlanVersionRecord,
  PrStats,
  PrSessionGroup,
  PrRecord,
} from "../../shared/agent-db-contract";

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
  getAgentMonitorCodexHooksOptIn: () => Promise<boolean>;
  setAgentMonitorCodexHooksOptIn: (optIn: boolean) => Promise<AgentMonitorHookResult>;
  /** @deprecated Replaced by in-process dashboard database */
  getAgentMonitorData?: (query: string) => Promise<unknown>;
  /** Database IPC channels (typed against the in-process repository shapes). */
  db: {
    getSessions: () => Promise<SessionRow[]>;
    getSession: (id: string) => Promise<SessionRow | undefined>;
    getSessionDetails: (id: string) => Promise<SessionWithAgents | undefined>;
    getAgents: (sessionId: string) => Promise<AgentRow[]>;
    getEvents: (sessionId: string, agentId?: string) => Promise<EventRow[]>;
    getDashboardSummary: () => Promise<DashboardSummary>;
    getSessionsWithDetails: () => Promise<SessionWithAgents[]>;
    getSessionsPage: (request?: SessionPageRequest) => Promise<SessionPage>;
    getKanbanPages: (statuses: string[], limit: number) => Promise<KanbanPages>;
    getEventFeed: () => Promise<EventWithSession[]>;
    getEventsWithSession: (sessionId: string) => Promise<EventWithSession[]>;
    getEventCountByType: () => Promise<EventCountByType[]>;
    getTokenAnalytics: () => Promise<TokenAnalytics>;
    getAgentHierarchy: (sessionId: string) => Promise<AgentHierarchyNode[]>;
    getAnalytics: () => Promise<AnalyticsData>;
    getWorkflowData: () => Promise<WorkflowQueryData>;
    getCoreFeatures: () => Promise<DashboardCoreFeatures>;
    getPacks: () => Promise<DashboardPackSummary[]>;
    getSkills: () => Promise<DashboardSkillSummary[]>;
    getTools: () => Promise<DashboardToolSummary[]>;
    getSubAgents: () => Promise<DashboardSubAgentSummary[]>;
    getPlans: () => Promise<DashboardPlanSummary[]>;
    getPullRequests: () => Promise<DashboardPullRequestSummary[]>;

    // Catalog (FEA-1314)
    getCatalog: () => Promise<CatalogEntry[]>;
    getCatalogEntry: (packId: string) => Promise<CatalogEntry | null>;
    getCatalogReadme: (packId: string) => Promise<string | null>;
    getCatalogContents: (packId: string) => Promise<unknown[] | null>;
    getCatalogHistory: (packId: string) => Promise<Array<{ fetchedAt: string; stars: number; forks: number }>>;
    catalogInstall: (packId: string, harness: string, cwd?: string) => Promise<CatalogMutationResult>;
    catalogUninstall: (packId: string, harness: string, cwd?: string) => Promise<CatalogMutationResult>;
    catalogRefresh: () => Promise<void>;
    getInstallRuns: (packId?: string) => Promise<InstallRunRecord[]>;

    // Installed packs (FEA-1224)
    getInstalledPacks: () => Promise<InstalledPack[]>;
    getPackDetail: (packId: string) => Promise<InstalledPackDetail | null>;
    getPackSessions: (packId: string) => Promise<unknown[]>;
    getAllSkills: () => Promise<SkillWithInvocations[]>;
    getSkillInvocations: (name: string) => Promise<SkillInvocation[]>;
    getRecentProjects: () => Promise<string[]>;

    // Plans (FEA-1189)
    getPlansList: (opts?: { sessionId?: string; needsConfirmation?: boolean; limit?: number; offset?: number }) => Promise<PlanRecord[]>;
    getPlan: (id: string) => Promise<PlanRecord | null>;
    getPlanVersions: (planId: string) => Promise<PlanVersionRecord[]>;
    confirmPlan: (id: string) => Promise<void>;
    rejectPlan: (id: string) => Promise<void>;
    openPlan: (id: string, target?: string) => Promise<void>;

    // Pull Requests (FEA-1226)
    getPrStats: () => Promise<PrStats>;
    getPrSessions: (opts?: { limit?: number; offset?: number }) => Promise<PrSessionGroup[]>;
    getPrList: (opts?: { sessionId?: string; repo?: string; limit?: number; offset?: number }) => Promise<PrRecord[]>;
    openPr: (id: string) => Promise<void>;
  };
  /** Live DB-change push subscription; returns an unsubscribe fn. */
  onDbChanged: (callback: (payload: { sessionId?: string }) => void) => () => void;
  /** Subscribe to streamed pack install/uninstall output (FEA-1314). */
  onInstallOutput?: (callback: (payload: InstallOutputChunk) => void) => () => void;
}

declare global {
  interface Window {
    desktopApi: DesktopApi;
  }
}
