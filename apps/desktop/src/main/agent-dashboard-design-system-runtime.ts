import path from "node:path";
import { app, ipcMain, type BrowserWindow } from "electron";
import { AgentHookListener } from "./agent-monitor-listener.js";
import { CollectorManager } from "./collectors/collector-manager.js";
import {
  loadMeteredUsageRows,
  type MeteredUsageRow,
} from "./reconciliation-worker.js";
import type { SessionPageRequest } from "../shared/agent-db-contract.js";
import { detectBillingMode } from "./billing-mode-detector.js";
import { openAgentDatabase, type AgentDatabase } from "./database/index.js";
import { coerceDbId } from "./database/ipc-validation.js";
import { createLifecycle } from "./database/lifecycle.js";
import { resolveAgentDashboardDatabasePathForUserData } from "./agent-dashboard-database-startup.js";
import { isAgentMonitorHooksEnabled } from "./agent-monitor-hooks.js";

export { prepareAgentDashboardDatabaseStartup } from "./agent-dashboard-database-startup.js";

const DESIGN_SYSTEM_DB_IPC_CHANNELS = [
  "desktop:db:get-sessions",
  "desktop:db:get-sessions-page",
  "desktop:db:get-kanban-pages",
  "desktop:db:get-session",
  "desktop:db:get-session-details",
  "desktop:db:get-agents",
  "desktop:db:get-events",
  "desktop:db:get-dashboard-summary",
  "desktop:db:get-sessions-with-details",
  "desktop:db:get-event-feed",
  "desktop:db:get-events-with-session",
  "desktop:db:get-event-count-by-type",
  "desktop:db:get-token-analytics",
  "desktop:db:get-agent-hierarchy",
  "desktop:db:get-analytics",
  "desktop:db:get-workflow-data",
] as const;

export interface AgentDashboardDesignSystemRuntimeOptions {
  getWindow: () => BrowserWindow | null;
  onTerminalFailure: (reason: string) => void;
  userDataPath?: string;
  log?: (scope: string, message: string) => void;
}

export interface AgentDashboardDesignSystemRuntime {
  connection: AgentDatabase["connection"];
  getUrl: () => string | null;
  isReady: () => boolean;
  start: () => void;
  stop: () => Promise<void>;
  close: () => void;
  restartCollectors: () => void;
  registerIpcHandlers: () => void;
  loadMeteredUsageRows: (cutoffIso: string) => MeteredUsageRow[];
}

/**
 * Resolve the opt-in design-system dashboard database. This helper lives inside
 * the dynamic boundary so default/legacy boot never imports code that can create
 * or migrate `agent-dashboard.sqlite`.
 */
export function resolveAgentDashboardDatabasePath(
  userDataPath = app.getPath("userData"),
): string {
  return resolveAgentDashboardDatabasePathForUserData(userDataPath);
}

/**
 * Create the in-process design-system dashboard runtime. Import this module only
 * after the Labs flag has selected design-system mode; all imports below this
 * boundary can open SQLite, bind the hook port, register IPC, or start watchers.
 */
export function createAgentDashboardDesignSystemRuntime(
  options: AgentDashboardDesignSystemRuntimeOptions,
): AgentDashboardDesignSystemRuntime {
  const log = options.log ?? (() => {});
  const agentDatabase = openAgentDatabase(
    resolveAgentDashboardDatabasePath(options.userDataPath),
  );
  let dbIpcRegistered = false;
  let closed = false;

  const lifecycle = createLifecycle(agentDatabase.connection, {
    tokenUsage: agentDatabase.tokenUsage,
    detectBillingMode,
    emit: (sessionId: string) => {
      agentDatabase.sessions.handleSessionMutation(sessionId);
      options.getWindow()?.webContents.send("desktop:db:changed", { sessionId });
    },
    log: (message: string) => log("agent-lifecycle", message),
  });

  const hookListener = new AgentHookListener({
    lifecycle,
    log: (message: string) => log("agent-monitor-listener", message),
    onBindError: options.onTerminalFailure,
  });

  const collectorManager = new CollectorManager({
    agentDatabase,
    detectBillingMode,
    stateDir: path.join(options.userDataPath ?? app.getPath("userData"), "agent-monitor"),
    emit: (sessionId?: string) => {
      options.getWindow()?.webContents.send("desktop:db:changed", { sessionId });
    },
    shouldWatchClaude: () => !isAgentMonitorHooksEnabled(),
    log: (message: string) => log("agent-collectors", message),
  });

  const runtime: AgentDashboardDesignSystemRuntime = {
    connection: agentDatabase.connection,
    getUrl: () => hookListener.getUrl(),
    isReady: () => hookListener.isReady(),
    start: () => {
      if (closed) {
        return;
      }
      void hookListener.start();
      collectorManager.start();
    },
    stop: async () => {
      if (closed) {
        return;
      }
      collectorManager.stop();
      await hookListener.stop();
    },
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      unregisterDesignSystemDbIpcHandlers();
      agentDatabase.close();
    },
    restartCollectors: () => {
      if (closed) {
        return;
      }
      collectorManager.stop();
      collectorManager.start();
    },
    registerIpcHandlers: () => {
      if (dbIpcRegistered) {
        return;
      }
      dbIpcRegistered = true;
      registerDesignSystemDbIpcHandlers(agentDatabase);
    },
    loadMeteredUsageRows: (cutoffIso: string) =>
      loadMeteredUsageRows(agentDatabase.connection, cutoffIso),
  };

  return runtime;
}

function registerDesignSystemDbIpcHandlers(agentDatabase: AgentDatabase): void {
  ipcMain.handle("desktop:db:get-sessions", () => agentDatabase.sessions.getAll());

  ipcMain.handle("desktop:db:get-sessions-page", (_event, request: unknown) =>
    agentDatabase.sessions.getPage(coerceSessionPageRequest(request)),
  );

  ipcMain.handle("desktop:db:get-kanban-pages", (_event, statuses: unknown, limit: unknown) => {
    const safeStatuses = Array.isArray(statuses) ? statuses.filter((s): s is string => typeof s === "string") : [];
    const safeLimit = typeof limit === "number" && Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 25;
    return agentDatabase.sessions.getKanbanPages(safeStatuses, safeLimit);
  });

  ipcMain.handle("desktop:db:get-session", (_event, id: unknown) => {
    const sessionId = coerceDbId(id);
    if (sessionId === null) return undefined;
    return agentDatabase.sessions.getById(sessionId);
  });

  ipcMain.handle("desktop:db:get-session-details", (_event, id: unknown) => {
    const sessionId = coerceDbId(id);
    if (sessionId === null) return undefined;
    return agentDatabase.sessions.getDetailsById(sessionId);
  });

  ipcMain.handle("desktop:db:get-agents", (_event, sessionId: unknown) => {
    const id = coerceDbId(sessionId);
    if (id === null) return [];
    return agentDatabase.agents.getBySession(id);
  });

  ipcMain.handle(
    "desktop:db:get-events",
    (_event, sessionId: unknown, agentId?: unknown) => {
      const sid = coerceDbId(sessionId);
      if (sid === null) return [];
      const aid = coerceDbId(agentId);
      if (aid !== null) {
        return agentDatabase.events.getBySessionAndAgent(sid, aid);
      }
      return agentDatabase.events.getBySession(sid);
    },
  );

  ipcMain.handle("desktop:db:get-dashboard-summary", () =>
    agentDatabase.getSummary(),
  );

  ipcMain.handle("desktop:db:get-sessions-with-details", () =>
    agentDatabase.sessions.getAllWithDetails(),
  );

  ipcMain.handle("desktop:db:get-event-feed", () =>
    agentDatabase.events.getAll(),
  );

  ipcMain.handle("desktop:db:get-events-with-session", (_event, sessionId: unknown) => {
    const id = coerceDbId(sessionId);
    if (id === null) return [];
    return agentDatabase.events.getWithSession(id);
  });

  ipcMain.handle("desktop:db:get-event-count-by-type", () =>
    agentDatabase.events.getCountByType(),
  );

  ipcMain.handle("desktop:db:get-token-analytics", () =>
    agentDatabase.dashboard.getTokenAnalytics(),
  );

  ipcMain.handle("desktop:db:get-agent-hierarchy", (_event, sessionId: unknown) => {
    const id = coerceDbId(sessionId);
    if (id === null) return [];
    return agentDatabase.agents.getBySessionWithChildren(id, agentDatabase.events);
  });

  ipcMain.handle("desktop:db:get-analytics", () =>
    agentDatabase.dashboard.getAnalytics(),
  );

  ipcMain.handle("desktop:db:get-workflow-data", () =>
    agentDatabase.dashboard.getWorkflowData(),
  );
}

function unregisterDesignSystemDbIpcHandlers(): void {
  for (const channel of DESIGN_SYSTEM_DB_IPC_CHANNELS) {
    ipcMain.removeHandler(channel);
  }
}

function coerceSessionPageRequest(value: unknown): SessionPageRequest | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  return {
    limit: typeof raw.limit === "number" ? raw.limit : undefined,
    offset: typeof raw.offset === "number" ? raw.offset : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
    q: typeof raw.q === "string" ? raw.q : undefined,
  };
}
