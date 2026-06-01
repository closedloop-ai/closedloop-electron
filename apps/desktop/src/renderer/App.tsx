import { useState, useCallback, useEffect, lazy, Suspense } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { Topbar } from "./components/layout/Topbar";

const DashboardPage = lazy(() => import("./components/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const SettingsPanel = lazy(() => import("./components/settings/SettingsPanel").then((m) => ({ default: m.SettingsPanel })));
const ActivityFeedView = lazy(() => import("./components/feed/ActivityFeedView").then((m) => ({ default: m.ActivityFeedView })));
const AnalyticsView = lazy(() => import("./components/analytics/AnalyticsView").then((m) => ({ default: m.AnalyticsView })));
const KanbanView = lazy(() => import("./components/kanban/KanbanView").then((m) => ({ default: m.KanbanView })));
const WorkflowsView = lazy(() => import("./components/workflows/WorkflowsView").then((m) => ({ default: m.WorkflowsView })));
const ApprovalsPanel = lazy(() => import("./components/approvals/ApprovalsPanel").then((m) => ({ default: m.ApprovalsPanel })));
const ActivityPanel = lazy(() => import("./components/activity/ActivityPanel").then((m) => ({ default: m.ActivityPanel })));
const LogsPanel = lazy(() => import("./components/logs/LogsPanel").then((m) => ({ default: m.LogsPanel })));

export type NavId =
  | "dashboard"
  | "kanban"
  | "activity-feed"
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
  const [runtimeStatus, setRuntimeStatus] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    window.desktopApi
      .getRuntimeStatus()
      .then((s) => setRuntimeStatus(s as Record<string, unknown>))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent<string>) => {
      setNavId(e.detail as NavId);
    };
    window.addEventListener("desktop:navigate-tab", handler as EventListener);
    return () =>
      window.removeEventListener("desktop:navigate-tab", handler as EventListener);
  }, []);

  const [collapsed, setCollapsed] = useState(false);
  const toggleSidebar = useCallback(() => setCollapsed((c) => !c), []);

  const healthy = runtimeStatus?.gatewayHealthy === true;

  const content = (() => {
    switch (navId) {
      case "dashboard":
        return <DashboardPage />;
      case "activity-feed":
        return <ActivityFeedView />;
      case "analytics":
        return <AnalyticsView />;
      case "kanban":
        return <KanbanView />;
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
        onNavigate={setNavId}
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
          <Suspense fallback={<PageFallback />}>
            {content}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
