import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  lazy,
  Suspense,
  startTransition,
} from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { Topbar } from "./components/layout/Topbar";
import { UpdateBanner } from "./components/UpdateBanner";
import { SessionNavContext } from "./components/sessions/session-nav";

const DashboardPage = lazy(() => import("./components/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const SettingsPanel = lazy(() => import("./components/settings/SettingsPanel").then((m) => ({ default: m.SettingsPanel })));
const KanbanView = lazy(() => import("./components/kanban/KanbanView").then((m) => ({ default: m.KanbanView })));
const ActivityFeedView = lazy(() => import("./components/feed/ActivityFeedView").then((m) => ({ default: m.ActivityFeedView })));
const AnalyticsView = lazy(() => import("./components/analytics/AnalyticsView").then((m) => ({ default: m.AnalyticsView })));
const WorkflowsView = lazy(() => import("./components/workflows/WorkflowsView").then((m) => ({ default: m.WorkflowsView })));
const ApprovalsPanel = lazy(() => import("./components/approvals/ApprovalsPanel").then((m) => ({ default: m.ApprovalsPanel })));
const ActivityPanel = lazy(() => import("./components/activity/ActivityPanel").then((m) => ({ default: m.ActivityPanel })));
const LogsPanel = lazy(() => import("./components/logs/LogsPanel").then((m) => ({ default: m.LogsPanel })));
const SessionDetailView = lazy(() => import("./components/sessions/SessionDetailView").then((m) => ({ default: m.SessionDetailView })));

export type NavId =
  | "dashboard"
  | "kanban"
  | "activity"
  | "analytics"
  | "workflows"
  | "approvals"
  | "requests"
  | "diagnostics"
  | "settings";

const DEFAULT_NAV_ID: NavId = "dashboard";

function isNavId(value: string | null): value is NavId {
  return value === "dashboard"
    || value === "kanban"
    || value === "activity"
    || value === "analytics"
    || value === "workflows"
    || value === "approvals"
    || value === "requests"
    || value === "diagnostics"
    || value === "settings";
}

function readHashState(): { navId: NavId; detailSessionId: string | null } {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const tab = params.get("tab");
  const sessionId = params.get("sessionId");

  return {
    navId: isNavId(tab) ? tab : DEFAULT_NAV_ID,
    detailSessionId: sessionId && sessionId.length > 0 ? sessionId : null,
  };
}

function writeHashState(navId: NavId, detailSessionId: string | null): void {
  const params = new URLSearchParams();
  params.set("tab", navId);
  if (detailSessionId) {
    params.set("sessionId", detailSessionId);
  }
  window.location.hash = params.toString();
}

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-[var(--muted-foreground)]">Loading...</p>
    </div>
  );
}

export default function App() {
  const initialHashState = readHashState();
  const [navId, setNavId] = useState<NavId>(initialHashState.navId);
  const [detailSessionId, setDetailSessionId] = useState<string | null>(
    initialHashState.detailSessionId,
  );
  const [visitedNavIds, setVisitedNavIds] = useState<NavId[]>([initialHashState.navId]);
  const [runtimeStatus, setRuntimeStatus] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    window.desktopApi
      .getRuntimeStatus()
      .then((s) => setRuntimeStatus(s as Record<string, unknown>))
      .catch(() => {});
  }, []);

  const navigate = useCallback((id: NavId) => {
    startTransition(() => {
      setNavId(id);
      setDetailSessionId(null);
      setVisitedNavIds((current) => (current.includes(id) ? current : [...current, id]));
    });
    writeHashState(id, null);
  }, []);

  const handleBack = useCallback(() => {
    startTransition(() => {
      setDetailSessionId(null);
    });
    writeHashState(navId, null);
  }, [navId]);

  useEffect(() => {
    const syncFromHash = () => {
      const nextState = readHashState();
      startTransition(() => {
        setNavId(nextState.navId);
        setDetailSessionId(nextState.detailSessionId);
        setVisitedNavIds((current) => (
          current.includes(nextState.navId) ? current : [...current, nextState.navId]
        ));
      });
    };

    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent<string>) => {
      navigate(e.detail as NavId);
    };
    window.addEventListener("desktop:navigate-tab", handler as EventListener);
    return () =>
      window.removeEventListener("desktop:navigate-tab", handler as EventListener);
  }, [navigate]);

  const sessionNav = useMemo(
    () => ({
      openSession: (id: string) => {
        startTransition(() => {
          setDetailSessionId(id);
        });
        writeHashState(navId, id);
      },
    }),
    [navId],
  );

  const [collapsed, setCollapsed] = useState(false);
  const toggleSidebar = useCallback(() => setCollapsed((c) => !c), []);

  const healthy = runtimeStatus?.gatewayHealthy === true;

  const renderPage = useCallback((pageId: NavId) => {
    switch (pageId) {
      case "dashboard":
        return <DashboardPage />;
      case "kanban":
        return <KanbanView />;
      case "activity":
        return <ActivityFeedView />;
      case "analytics":
        return <AnalyticsView />;
      case "workflows":
        return <WorkflowsView />;
      case "approvals":
        return <ApprovalsPanel />;
      case "requests":
        return <ActivityPanel />;
      case "diagnostics":
        return <LogsPanel />;
      case "settings":
        return <SettingsPanel />;
      default:
        return <DashboardPage />;
    }
  }, []);

  const content = detailSessionId ? (
    <SessionDetailView sessionId={detailSessionId} onBack={handleBack} />
  ) : (
    <Suspense fallback={<PageFallback />}>
      {visitedNavIds.map((pageId) => {
        const active = pageId === navId;
        return (
          <div
            key={pageId}
            aria-hidden={active ? undefined : true}
            className={active ? "block h-full" : "hidden h-full"}
          >
            {renderPage(pageId)}
          </div>
        );
      })}
    </Suspense>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <Sidebar
        collapsed={collapsed}
        activeNav={navId}
        onNavigate={navigate}
        runtimeHealthy={healthy}
      />
      <div className="flex flex-col flex-1 min-w-0">
        <UpdateBanner />
        <Topbar
          collapsed={collapsed}
          onToggleSidebar={toggleSidebar}
          navId={navId}
          runtimeStatus={runtimeStatus}
        />
        <main className="flex-1 overflow-auto">
          <SessionNavContext.Provider value={sessionNav}>
            {content}
          </SessionNavContext.Provider>
        </main>
      </div>
    </div>
  );
}
