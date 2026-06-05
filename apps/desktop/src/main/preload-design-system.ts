import { ipcRenderer } from "electron";
import type {
  AgentHierarchyNode,
  AgentRow,
  AnalyticsData,
  DashboardSummary,
  EventCountByType,
  EventRow,
  EventWithSession,
  SessionRow,
  SessionWithAgents,
  TokenAnalytics,
  WorkflowQueryData,
} from "../shared/agent-db-contract.js";
import { exposeDesktopApi } from "./preload-common.js";

const designSystemDashboardApi = {
  db: {
    getSessions: () => ipcRenderer.invoke("desktop:db:get-sessions") as Promise<SessionRow[]>,
    getSession: (id: string) => ipcRenderer.invoke("desktop:db:get-session", id) as Promise<SessionRow | undefined>,
    getAgents: (sessionId: string) => ipcRenderer.invoke("desktop:db:get-agents", sessionId) as Promise<AgentRow[]>,
    getEvents: (sessionId: string, agentId?: string) => ipcRenderer.invoke("desktop:db:get-events", sessionId, agentId) as Promise<EventRow[]>,
    getDashboardSummary: () => ipcRenderer.invoke("desktop:db:get-dashboard-summary") as Promise<DashboardSummary>,
    getSessionsWithDetails: () => ipcRenderer.invoke("desktop:db:get-sessions-with-details") as Promise<SessionWithAgents[]>,
    getEventFeed: () => ipcRenderer.invoke("desktop:db:get-event-feed") as Promise<EventWithSession[]>,
    getEventsWithSession: (sessionId: string) => ipcRenderer.invoke("desktop:db:get-events-with-session", sessionId) as Promise<EventWithSession[]>,
    getEventCountByType: () => ipcRenderer.invoke("desktop:db:get-event-count-by-type") as Promise<EventCountByType[]>,
    getTokenAnalytics: () => ipcRenderer.invoke("desktop:db:get-token-analytics") as Promise<TokenAnalytics>,
    getAgentHierarchy: (sessionId: string) => ipcRenderer.invoke("desktop:db:get-agent-hierarchy", sessionId) as Promise<AgentHierarchyNode[]>,
    getAnalytics: () => ipcRenderer.invoke("desktop:db:get-analytics") as Promise<AnalyticsData>,
    getWorkflowData: () => ipcRenderer.invoke("desktop:db:get-workflow-data") as Promise<WorkflowQueryData>,
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
};

exposeDesktopApi(designSystemDashboardApi);
