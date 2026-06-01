import { useState, useCallback, useEffect } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { Topbar } from "./components/layout/Topbar";
import { DashboardPage } from "./components/dashboard/DashboardPage";
import { ApprovalsPanel } from "./components/approvals/ApprovalsPanel";
import { ActivityPanel } from "./components/activity/ActivityPanel";
import { LogsPanel } from "./components/logs/LogsPanel";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { SessionsView } from "./components/sessions/SessionsView";
import { ActivityFeedView } from "./components/feed/ActivityFeedView";
import { AnalyticsView } from "./components/analytics/AnalyticsView";
import { KanbanView } from "./components/kanban/KanbanView";
import { WorkflowsView } from "./components/workflows/WorkflowsView";

export type NavId =
  | "dashboard"
  | "kanban"
  | "sessions"
  | "activity-feed"
  | "analytics"
  | "workflows"
  | "cc-config"
  | "run"
  | "plans"
  | "agent-settings"
  | "approvals"
  | "requests"
  | "diagnostics"
  | "settings";

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

  const healthy = runtimeStatus?.healthy === true;

  const content = (() => {
    switch (navId) {
      case "dashboard":
        return <DashboardPage />;
      case "sessions":
        return <SessionsView />;
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
          {content}
        </main>
      </div>
    </div>
  );
}
