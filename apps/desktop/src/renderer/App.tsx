import { useState, useCallback, useEffect, useMemo, lazy, Suspense } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { Topbar } from "./components/layout/Topbar";
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

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-[var(--muted-foreground)]">Loading...</p>
    </div>
  );
}

export default function App() {
  const [navId, setNavId] = useState<NavId>("dashboard");
  // Single-depth drill-down stack (nav-stack model; no router). When set, the
  // session detail view replaces the active nav page; Back / navigating clears.
  const [detailSessionId, setDetailSessionId] = useState<string | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    window.desktopApi
      .getRuntimeStatus()
      .then((s) => setRuntimeStatus(s as Record<string, unknown>))
      .catch(() => {});
  }, []);

  const navigate = useCallback((id: NavId) => {
    setDetailSessionId(null);
    setNavId(id);
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
    () => ({ openSession: (id: string) => setDetailSessionId(id) }),
    [],
  );

  const [collapsed, setCollapsed] = useState(false);
  const toggleSidebar = useCallback(() => setCollapsed((c) => !c), []);

  const healthy = runtimeStatus?.gatewayHealthy === true;

  const content = (() => {
    if (detailSessionId) {
      return <SessionDetailView sessionId={detailSessionId} onBack={() => setDetailSessionId(null)} />;
    }
    switch (navId) {
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
  })();

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <Sidebar
        collapsed={collapsed}
        activeNav={navId}
        onNavigate={navigate}
        runtimeHealthy={healthy}
      />
      <div className="flex flex-col flex-1 min-w-0">
        <Topbar
          collapsed={collapsed}
          onToggleSidebar={toggleSidebar}
          navId={navId}
          runtimeStatus={runtimeStatus}
        />
        <main className="flex-1 overflow-auto">
          <SessionNavContext.Provider value={sessionNav}>
            <Suspense fallback={<PageFallback />}>
              {content}
            </Suspense>
          </SessionNavContext.Provider>
        </main>
      </div>
    </div>
  );
}
