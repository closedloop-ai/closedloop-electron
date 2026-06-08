import path from "node:path";
import { app, ipcMain, type BrowserWindow } from "electron";
import { AgentHookListener } from "./agent-monitor-listener.js";
import { CollectorManager } from "./collectors/collector-manager.js";
import type { MeteredUsageRow } from "./reconciliation-worker.js";
import type { AgentSessionSyncSource } from "./agent-session-sync-service.js";
import type { SessionPageRequest } from "../shared/agent-db-contract.js";
import { detectBillingMode } from "./billing-mode-detector.js";
import { shell } from "electron";
import {
  openPgliteAgentDatabase,
  type PgliteAgentDatabase,
} from "./database/pglite.js";
import { coerceDbId } from "./database/ipc-validation.js";
import { isAgentMonitorHooksEnabled } from "./agent-monitor-hooks.js";
import * as catalogStore from "./packs/catalog-store.js";
import * as packStore from "./packs/pack-store.js";
import { runPackScanner } from "./packs/pack-scanner.js";
import { streamRun } from "./packs/install-orchestrator.js";
import { runCatalogFetch, scheduleCatalogFetch } from "./packs/catalog-fetcher.js";
import { refreshCatalogContents } from "./packs/catalog-contents.js";
import * as planStore from "./plans/plan-store.js";
import * as prStore from "./pull-requests/pr-store.js";
import catalogSeed from "./packs/catalog-seed.json" with { type: "json" };

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
  "desktop:db:get-core-features",
  "desktop:db:get-packs",
  "desktop:db:get-skills",
  "desktop:db:get-tools",
  "desktop:db:get-subagents",
  "desktop:db:get-plans",
  "desktop:db:get-pull-requests",
  // Catalog (FEA-1314)
  "desktop:db:get-catalog",
  "desktop:db:get-catalog-entry",
  "desktop:db:get-catalog-readme",
  "desktop:db:get-catalog-contents",
  "desktop:db:get-catalog-history",
  "desktop:db:catalog-install",
  "desktop:db:catalog-uninstall",
  "desktop:db:catalog-refresh",
  "desktop:db:get-install-runs",
  // Installed packs (FEA-1224)
  "desktop:db:get-installed-packs",
  "desktop:db:get-pack-detail",
  "desktop:db:get-pack-sessions",
  "desktop:db:get-all-skills",
  "desktop:db:get-skill-invocations",
  "desktop:db:get-recent-projects",
  // Plans (FEA-1189)
  "desktop:db:get-plans-list",
  "desktop:db:get-plan",
  "desktop:db:get-plan-versions",
  "desktop:db:confirm-plan",
  "desktop:db:reject-plan",
  "desktop:db:open-plan",
  // Pull Requests (FEA-1226)
  "desktop:db:get-pr-stats",
  "desktop:db:get-pr-sessions",
  "desktop:db:get-pr-list",
  "desktop:db:open-pr",
] as const;

export interface AgentDashboardDesignSystemRuntimeOptions {
  getWindow: () => BrowserWindow | null;
  getUserIdentity?: () => { userId: string | null; organizationId: string | null } | null;
  onTerminalFailure: (reason: string) => void;
  userDataPath?: string;
  log?: (scope: string, message: string) => void;
}

export interface AgentDashboardDesignSystemRuntime {
  connection: null;
  syncSource: AgentSessionSyncSource | null;
  getUrl: () => string | null;
  isReady: () => boolean;
  start: () => void;
  stop: () => Promise<void>;
  close: () => Promise<void> | void;
  restartCollectors: () => void;
  registerIpcHandlers: () => void;
  loadMeteredUsageRows: (cutoffIso: string) => MeteredUsageRow[] | Promise<MeteredUsageRow[]>;
}

/**
 * Resolve the opt-in design-system dashboard database. This helper lives inside
 * the dynamic boundary so default/legacy boot never imports code that can create
 * the PGlite data directory.
 */
export function resolveAgentDashboardDatabasePath(
  userDataPath = app.getPath("userData"),
): string {
  return path.join(userDataPath, "agent-dashboard.pgdata");
}

/**
 * Create the in-process design-system dashboard runtime. Import this module only
 * after the Labs flag has selected design-system mode; all imports below this
 * boundary can open PGlite, bind the hook port, register IPC, or start watchers.
 */
export async function createAgentDashboardDesignSystemRuntime(
  options: AgentDashboardDesignSystemRuntimeOptions,
): Promise<AgentDashboardDesignSystemRuntime> {
  const log = options.log ?? (() => {});
  let pgliteDatabase: PgliteAgentDatabase | null = null;
  const agentDatabase = await openPgliteAgentDatabase({
    dataDir: resolveAgentDashboardDatabasePath(options.userDataPath),
    detectBillingMode,
    emit: (sessionId: string) => {
      void pgliteDatabase?.sessions.handleSessionMutation(sessionId);
      options.getWindow()?.webContents.send("desktop:db:changed", { sessionId });
    },
    getUserIdentity: options.getUserIdentity,
    log: (message: string) => log("agent-pglite", message),
  });
  pgliteDatabase = agentDatabase;
  log(
    "agent-dashboard",
    "PGlite runtime active for Agent Dashboard database",
  );

  // The underlying PGlite client supports both query() and exec(), which
  // the pack/plan/PR store modules need for full result access.
  const dbForStores = agentDatabase.storeDb;
  void (async () => {
    try {
      await catalogStore.upsertCatalogSeed(dbForStores, catalogSeed);
      log("agent-dashboard", "Catalog seed applied");
    } catch (e) {
      log("agent-dashboard", `Catalog seed failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      await runPackScanner(dbForStores);
      log("agent-dashboard", "Pack scanner completed");
    } catch (e) {
      log("agent-dashboard", `Pack scanner failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      const plansDir = path.join(process.env.CLAUDE_HOME || path.join(app.getPath("home"), ".claude"), "plans");
      const captures = planStore.extractPlansFromPlansDir(plansDir);
      for (const c of captures) {
        await planStore.upsertPlan(dbForStores, c);
      }
      if (captures.length > 0) log("agent-dashboard", `Backfilled ${captures.length} plans from ~/.claude/plans/`);
    } catch (e) {
      log("agent-dashboard", `Plan backfill failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  })();

  let catalogFetchTimer: ReturnType<typeof setInterval> | null = null;
  // Schedule async GitHub catalog fetch (best-effort, non-blocking)
  void runCatalogFetch(dbForStores).catch(() => {});
  catalogFetchTimer = scheduleCatalogFetch(dbForStores);

  let dbIpcRegistered = false;
  let closed = false;

  const hookListener = new AgentHookListener({
    lifecycle: { processEvent: agentDatabase.processEvent },
    log: (message: string) => log("agent-monitor-listener", message),
    onBindError: options.onTerminalFailure,
  });

  const collectorManager = new CollectorManager({
    importer: agentDatabase.importer,
    detectBillingMode,
    stateDir: path.join(options.userDataPath ?? app.getPath("userData"), "agent-dashboard-ingest"),
    emit: (sessionId?: string) => {
      options.getWindow()?.webContents.send("desktop:db:changed", { sessionId });
    },
    shouldWatchClaude: () => !isAgentMonitorHooksEnabled(),
    log: (message: string) => log("agent-collectors", message),
  });

  const runtime: AgentDashboardDesignSystemRuntime = {
    connection: agentDatabase.connection,
    syncSource: agentDatabase.syncSource,
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
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      if (catalogFetchTimer) {
        clearInterval(catalogFetchTimer);
        catalogFetchTimer = null;
      }
      unregisterDesignSystemDbIpcHandlers();
      await agentDatabase.close();
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
      registerDesignSystemDbIpcHandlers(agentDatabase, options);
    },
    loadMeteredUsageRows: (cutoffIso: string) =>
      agentDatabase.loadMeteredUsageRows(cutoffIso),
  };

  return runtime;
}

function registerDesignSystemDbIpcHandlers(
  agentDatabase: PgliteAgentDatabase,
  options: AgentDashboardDesignSystemRuntimeOptions,
): void {
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
    return agentDatabase.agents.getBySessionWithChildren(id);
  });

  ipcMain.handle("desktop:db:get-analytics", () =>
    agentDatabase.dashboard.getAnalytics(),
  );

  ipcMain.handle("desktop:db:get-workflow-data", () =>
    agentDatabase.dashboard.getWorkflowData(),
  );

  ipcMain.handle("desktop:db:get-core-features", () =>
    agentDatabase.dashboard.getCoreFeatures(),
  );

  ipcMain.handle("desktop:db:get-packs", () =>
    agentDatabase.dashboard.getPacks(),
  );

  ipcMain.handle("desktop:db:get-skills", () =>
    agentDatabase.dashboard.getSkills(),
  );

  ipcMain.handle("desktop:db:get-tools", () =>
    agentDatabase.dashboard.getTools(),
  );

  ipcMain.handle("desktop:db:get-subagents", () =>
    agentDatabase.dashboard.getSubAgents(),
  );

  ipcMain.handle("desktop:db:get-plans", () =>
    agentDatabase.dashboard.getPlans(),
  );

  ipcMain.handle("desktop:db:get-pull-requests", () =>
    agentDatabase.dashboard.getPullRequests(),
  );

  // --- Catalog (FEA-1314) ---
  const dbForStores = agentDatabase.storeDb;

  ipcMain.handle("desktop:db:get-catalog", () =>
    catalogStore.listCatalog(dbForStores),
  );

  ipcMain.handle("desktop:db:get-catalog-entry", (_event, packId: unknown) => {
    if (typeof packId !== "string") return null;
    return catalogStore.getCatalog(dbForStores, packId);
  });

  ipcMain.handle("desktop:db:get-catalog-readme", async (_event, packId: unknown) => {
    if (typeof packId !== "string") return null;
    const entry = await catalogStore.getCatalog(dbForStores, packId);
    return entry?.readme_excerpt ?? null;
  });

  ipcMain.handle("desktop:db:get-catalog-contents", async (_event, packId: unknown) => {
    if (typeof packId !== "string") return null;
    const entry = await catalogStore.getCatalog(dbForStores, packId);
    if (!entry) return null;
    await refreshCatalogContents(dbForStores, entry);
    const refreshed = await catalogStore.getCatalog(dbForStores, packId);
    return refreshed?.contents_cache ?? null;
  });

  ipcMain.handle("desktop:db:get-catalog-history", (_event, packId: unknown) => {
    if (typeof packId !== "string") return [];
    return catalogStore.listHistory(dbForStores, packId);
  });

  ipcMain.handle("desktop:db:catalog-install", async (_event, packId: unknown, harness: unknown, cwd?: unknown) => {
    if (typeof packId !== "string" || typeof harness !== "string") return { started: false };
    return streamRun(dbForStores, {
      pack_id: packId,
      harness,
      action: "install",
      cwd: typeof cwd === "string" ? cwd : undefined,
      getWindow: options.getWindow,
      onComplete: () => void runPackScanner(dbForStores).catch(() => {}),
    });
  });

  ipcMain.handle("desktop:db:catalog-uninstall", async (_event, packId: unknown, harness: unknown) => {
    if (typeof packId !== "string" || typeof harness !== "string") return { started: false };
    return streamRun(dbForStores, {
      pack_id: packId,
      harness,
      action: "uninstall",
      getWindow: options.getWindow,
      onComplete: () => void runPackScanner(dbForStores).catch(() => {}),
    });
  });

  ipcMain.handle("desktop:db:catalog-refresh", () =>
    runCatalogFetch(dbForStores),
  );

  ipcMain.handle("desktop:db:get-install-runs", (_event, packId?: unknown) =>
    catalogStore.listInstallRuns(dbForStores, typeof packId === "string" ? { pack_id: packId } : {}),
  );

  // --- Installed Packs (FEA-1224) ---

  ipcMain.handle("desktop:db:get-installed-packs", () =>
    packStore.listPacks(dbForStores),
  );

  ipcMain.handle("desktop:db:get-pack-detail", (_event, packId: unknown) => {
    if (typeof packId !== "string") return null;
    return packStore.getPack(dbForStores, packId);
  });

  ipcMain.handle("desktop:db:get-pack-sessions", (_event, packId: unknown) => {
    if (typeof packId !== "string") return [];
    return packStore.listPackSessions(dbForStores, packId);
  });

  ipcMain.handle("desktop:db:get-all-skills", () =>
    packStore.listSkills(dbForStores),
  );

  ipcMain.handle("desktop:db:get-skill-invocations", (_event, name: unknown) => {
    if (typeof name !== "string") return [];
    return packStore.listSkillInvocations(dbForStores, name);
  });

  ipcMain.handle("desktop:db:get-recent-projects", async () => {
    const result = await dbForStores.query<{ cwd: string }>(
      `SELECT DISTINCT cwd FROM sessions WHERE cwd IS NOT NULL ORDER BY started_at DESC LIMIT 20`,
    );
    return result.rows.map((r) => r.cwd);
  });

  // --- Plans (FEA-1189) ---

  ipcMain.handle("desktop:db:get-plans-list", (_event, opts?: unknown) => {
    const o = typeof opts === "object" && opts !== null ? opts as Record<string, unknown> : {};
    return planStore.listPlans(dbForStores, {
      sessionId: typeof o.sessionId === "string" ? o.sessionId : undefined,
      needsConfirmation: typeof o.needsConfirmation === "boolean" ? o.needsConfirmation : undefined,
      limit: typeof o.limit === "number" ? o.limit : undefined,
      offset: typeof o.offset === "number" ? o.offset : undefined,
    });
  });

  ipcMain.handle("desktop:db:get-plan", (_event, id: unknown) => {
    if (typeof id !== "string") return null;
    return planStore.getPlan(dbForStores, id);
  });

  ipcMain.handle("desktop:db:get-plan-versions", (_event, planId: unknown) => {
    if (typeof planId !== "string") return [];
    return planStore.getPlanVersions(dbForStores, planId);
  });

  ipcMain.handle("desktop:db:confirm-plan", (_event, id: unknown) => {
    if (typeof id !== "string") return;
    return planStore.confirmPlan(dbForStores, id);
  });

  ipcMain.handle("desktop:db:reject-plan", (_event, id: unknown) => {
    if (typeof id !== "string") return;
    return planStore.rejectPlan(dbForStores, id);
  });

  ipcMain.handle("desktop:db:open-plan", async (_event, id: unknown, target?: unknown) => {
    if (typeof id !== "string") return;
    const plan = await planStore.getPlan(dbForStores, id);
    if (!plan) return;
    const filePath = String(target === "log" ? plan.source_log_path : plan.file_path);
    if (filePath && filePath !== "null" && filePath !== "undefined") void shell.openPath(filePath);
  });

  // --- Pull Requests (FEA-1226) ---

  ipcMain.handle("desktop:db:get-pr-stats", () =>
    prStore.getPrStats(dbForStores),
  );

  ipcMain.handle("desktop:db:get-pr-sessions", (_event, opts?: unknown) => {
    const o = typeof opts === "object" && opts !== null ? opts as Record<string, unknown> : {};
    return prStore.listPrSessions(dbForStores, {
      limit: typeof o.limit === "number" ? o.limit : undefined,
      offset: typeof o.offset === "number" ? o.offset : undefined,
    });
  });

  ipcMain.handle("desktop:db:get-pr-list", (_event, opts?: unknown) => {
    const o = typeof opts === "object" && opts !== null ? opts as Record<string, unknown> : {};
    return prStore.listPullRequests(dbForStores, {
      sessionId: typeof o.sessionId === "string" ? o.sessionId : undefined,
      repo: typeof o.repo === "string" ? o.repo : undefined,
      limit: typeof o.limit === "number" ? o.limit : undefined,
      offset: typeof o.offset === "number" ? o.offset : undefined,
    });
  });

  ipcMain.handle("desktop:db:open-pr", async (_event, id: unknown) => {
    if (typeof id !== "string") return;
    const prs = await prStore.listPullRequests(dbForStores);
    const pr = prs.find((p) => p.id === id);
    const prUrl = pr?.pr_url;
    if (typeof prUrl === "string") void shell.openExternal(prUrl);
  });
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
