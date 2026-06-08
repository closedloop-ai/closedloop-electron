import { MetricCard } from "@closedloop-ai/design-system/components/ui/primitives/metric-card";
import { MonitorDot, Bot, Zap, Layers } from "lucide-react";
import { useQueryCache } from "../../hooks/useQueryCache";
import { SessionsView } from "../sessions/SessionsView";
import type { DashboardSummary } from "../../../shared/agent-db-contract";
import {
  DASHBOARD_GRID_CLASS_NAME,
  DASHBOARD_METRIC_CARD_CLASS_NAME,
  PageShell,
} from "../layout/page-shell";

export function DashboardPage() {
  const { data: summary, error } = useQueryCache<DashboardSummary>(
    "db:summary",
    () => window.desktopApi.db.getDashboardSummary(),
    3_000, 5_000,
  );

  if (error) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-[var(--destructive)]">Failed to load data.</p>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-[var(--muted-foreground)]">Loading...</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <PageShell
        title="Sessions"
        description="High-level loop volume and direct access to the session explorer."
      >
        <div className={DASHBOARD_GRID_CLASS_NAME}>
          <MetricCard className={DASHBOARD_METRIC_CARD_CLASS_NAME} label="Sessions" value={summary.totalSessions} detail={`${summary.activeSessions} active`} icon={MonitorDot} />
          <MetricCard className={DASHBOARD_METRIC_CARD_CLASS_NAME} label="Agents" value={summary.totalAgents} icon={Bot} />
          <MetricCard className={DASHBOARD_METRIC_CARD_CLASS_NAME} label="Events" value={summary.totalEvents} icon={Zap} />
          <MetricCard className={DASHBOARD_METRIC_CARD_CLASS_NAME} label="Event Types" value={summary.eventTypeCount} icon={Layers} />
        </div>

        <SessionsView showOverview={false} />
      </PageShell>
    </div>
  );
}
