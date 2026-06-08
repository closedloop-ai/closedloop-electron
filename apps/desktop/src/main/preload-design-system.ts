import { ipcRenderer } from "electron";
import type {
  AgentHierarchyNode,
  AgentRow,
  AnalyticsData,
  CatalogEntry,
  CatalogMutationResult,
  DashboardCoreFeatures,
  DashboardPackSummary,
  DashboardPlanSummary,
  DashboardPullRequestSummary,
  DashboardSkillSummary,
  DashboardSubAgentSummary,
  DashboardSummary,
  DashboardToolSummary,
  EventCountByType,
  EventRow,
  EventWithSession,
  InstallOutputChunk,
  InstallRunRecord,
  InstalledPack,
  InstalledPackDetail,
  KanbanPages,
  PlanRecord,
  PlanVersionRecord,
  PrRecord,
  PrSessionGroup,
  PrStats,
  SessionPage,
  SessionPageRequest,
  SessionRow,
  SessionWithAgents,
  SkillInvocation,
  SkillWithInvocations,
  TokenAnalytics,
  WorkflowQueryData,
} from "../shared/agent-db-contract.js";
import { exposeDesktopApi } from "./preload-common.js";

const designSystemDashboardApi = {
  db: {
    getSessions: () => ipcRenderer.invoke("desktop:db:get-sessions") as Promise<SessionRow[]>,
    getSession: (id: string) => ipcRenderer.invoke("desktop:db:get-session", id) as Promise<SessionRow | undefined>,
    getSessionDetails: (id: string) => ipcRenderer.invoke("desktop:db:get-session-details", id) as Promise<SessionWithAgents | undefined>,
    getAgents: (sessionId: string) => ipcRenderer.invoke("desktop:db:get-agents", sessionId) as Promise<AgentRow[]>,
    getEvents: (sessionId: string, agentId?: string) => ipcRenderer.invoke("desktop:db:get-events", sessionId, agentId) as Promise<EventRow[]>,
    getDashboardSummary: () => ipcRenderer.invoke("desktop:db:get-dashboard-summary") as Promise<DashboardSummary>,
    getSessionsWithDetails: () => ipcRenderer.invoke("desktop:db:get-sessions-with-details") as Promise<SessionWithAgents[]>,
    getSessionsPage: (request?: SessionPageRequest) => ipcRenderer.invoke("desktop:db:get-sessions-page", request) as Promise<SessionPage>,
    getKanbanPages: (statuses: string[], limit: number) => ipcRenderer.invoke("desktop:db:get-kanban-pages", statuses, limit) as Promise<KanbanPages>,
    getEventFeed: () => ipcRenderer.invoke("desktop:db:get-event-feed") as Promise<EventWithSession[]>,
    getEventsWithSession: (sessionId: string) => ipcRenderer.invoke("desktop:db:get-events-with-session", sessionId) as Promise<EventWithSession[]>,
    getEventCountByType: () => ipcRenderer.invoke("desktop:db:get-event-count-by-type") as Promise<EventCountByType[]>,
    getTokenAnalytics: () => ipcRenderer.invoke("desktop:db:get-token-analytics") as Promise<TokenAnalytics>,
    getAgentHierarchy: (sessionId: string) => ipcRenderer.invoke("desktop:db:get-agent-hierarchy", sessionId) as Promise<AgentHierarchyNode[]>,
    getAnalytics: () => ipcRenderer.invoke("desktop:db:get-analytics") as Promise<AnalyticsData>,
    getWorkflowData: () => ipcRenderer.invoke("desktop:db:get-workflow-data") as Promise<WorkflowQueryData>,
    getCoreFeatures: () => ipcRenderer.invoke("desktop:db:get-core-features") as Promise<DashboardCoreFeatures>,
    getPacks: () => ipcRenderer.invoke("desktop:db:get-packs") as Promise<DashboardPackSummary[]>,
    getSkills: () => ipcRenderer.invoke("desktop:db:get-skills") as Promise<DashboardSkillSummary[]>,
    getTools: () => ipcRenderer.invoke("desktop:db:get-tools") as Promise<DashboardToolSummary[]>,
    getSubAgents: () => ipcRenderer.invoke("desktop:db:get-subagents") as Promise<DashboardSubAgentSummary[]>,
    getPlans: () => ipcRenderer.invoke("desktop:db:get-plans") as Promise<DashboardPlanSummary[]>,
    getPullRequests: () => ipcRenderer.invoke("desktop:db:get-pull-requests") as Promise<DashboardPullRequestSummary[]>,

    // Catalog (FEA-1314)
    getCatalog: () => ipcRenderer.invoke("desktop:db:get-catalog") as Promise<CatalogEntry[]>,
    getCatalogEntry: (packId: string) => ipcRenderer.invoke("desktop:db:get-catalog-entry", packId) as Promise<CatalogEntry | null>,
    getCatalogReadme: (packId: string) => ipcRenderer.invoke("desktop:db:get-catalog-readme", packId) as Promise<string | null>,
    getCatalogContents: (packId: string) => ipcRenderer.invoke("desktop:db:get-catalog-contents", packId) as Promise<unknown[] | null>,
    getCatalogHistory: (packId: string) => ipcRenderer.invoke("desktop:db:get-catalog-history", packId) as Promise<Array<{ fetchedAt: string; stars: number; forks: number }>>,
    catalogInstall: (packId: string, harness: string, cwd?: string) => ipcRenderer.invoke("desktop:db:catalog-install", packId, harness, cwd) as Promise<CatalogMutationResult>,
    catalogUninstall: (packId: string, harness: string, cwd?: string) => ipcRenderer.invoke("desktop:db:catalog-uninstall", packId, harness, cwd) as Promise<CatalogMutationResult>,
    catalogRefresh: () => ipcRenderer.invoke("desktop:db:catalog-refresh") as Promise<void>,
    getInstallRuns: (packId?: string) => ipcRenderer.invoke("desktop:db:get-install-runs", packId) as Promise<InstallRunRecord[]>,

    // Installed packs (FEA-1224)
    getInstalledPacks: () => ipcRenderer.invoke("desktop:db:get-installed-packs") as Promise<InstalledPack[]>,
    getPackDetail: (packId: string) => ipcRenderer.invoke("desktop:db:get-pack-detail", packId) as Promise<InstalledPackDetail | null>,
    getPackSessions: (packId: string) => ipcRenderer.invoke("desktop:db:get-pack-sessions", packId) as Promise<unknown[]>,
    getAllSkills: () => ipcRenderer.invoke("desktop:db:get-all-skills") as Promise<SkillWithInvocations[]>,
    getSkillInvocations: (name: string) => ipcRenderer.invoke("desktop:db:get-skill-invocations", name) as Promise<SkillInvocation[]>,
    getRecentProjects: () => ipcRenderer.invoke("desktop:db:get-recent-projects") as Promise<string[]>,

    // Plans (FEA-1189)
    getPlansList: (opts?: { sessionId?: string; needsConfirmation?: boolean; limit?: number; offset?: number }) =>
      ipcRenderer.invoke("desktop:db:get-plans-list", opts) as Promise<PlanRecord[]>,
    getPlan: (id: string) => ipcRenderer.invoke("desktop:db:get-plan", id) as Promise<PlanRecord | null>,
    getPlanVersions: (planId: string) => ipcRenderer.invoke("desktop:db:get-plan-versions", planId) as Promise<PlanVersionRecord[]>,
    confirmPlan: (id: string) => ipcRenderer.invoke("desktop:db:confirm-plan", id) as Promise<void>,
    rejectPlan: (id: string) => ipcRenderer.invoke("desktop:db:reject-plan", id) as Promise<void>,
    openPlan: (id: string, target?: string) => ipcRenderer.invoke("desktop:db:open-plan", id, target) as Promise<void>,

    // Pull Requests (FEA-1226)
    getPrStats: () => ipcRenderer.invoke("desktop:db:get-pr-stats") as Promise<PrStats>,
    getPrSessions: (opts?: { limit?: number; offset?: number }) =>
      ipcRenderer.invoke("desktop:db:get-pr-sessions", opts) as Promise<PrSessionGroup[]>,
    getPrList: (opts?: { sessionId?: string; repo?: string; limit?: number; offset?: number }) =>
      ipcRenderer.invoke("desktop:db:get-pr-list", opts) as Promise<PrRecord[]>,
    openPr: (id: string) => ipcRenderer.invoke("desktop:db:open-pr", id) as Promise<void>,
  },
  /**
   * Subscribe to in-process DB-change pushes. The design renderer listens for
   * these events to refresh DB-backed query state without polling.
   */
  onDbChanged: (callback: (payload: { sessionId?: string }) => void) => {
    const handler = (_event: unknown, payload: { sessionId?: string }) => callback(payload);
    ipcRenderer.on("desktop:db:changed", handler);
    return () => ipcRenderer.removeListener("desktop:db:changed", handler);
  },
  /** Subscribe to streamed pack install/uninstall output (FEA-1314). */
  onInstallOutput: (callback: (payload: InstallOutputChunk) => void) => {
    const handler = (_event: unknown, payload: InstallOutputChunk) =>
      callback(payload);
    ipcRenderer.on("desktop:pack:install-output", handler);
    return () => ipcRenderer.removeListener("desktop:pack:install-output", handler);
  },
};

exposeDesktopApi(designSystemDashboardApi);
