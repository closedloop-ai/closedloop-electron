import { MetricCard } from "@closedloop-ai/design-system/components/ui/primitives/metric-card";
import { MonitorDot, Bot, Zap, Layers } from "lucide-react";
import { useQueryCache } from "../../hooks/useQueryCache";
import { SessionsView } from "../sessions/SessionsView";
import type { DashboardSummary, AnalyticsData } from "../../main/database/types";

export function DashboardPage() {
  const { data: summary, error } = useQueryCache<DashboardSummary>(
    "db:summary",
    () => window.desktopApi.db.getDashboardSummary(),
    3_000, 5_000,
  );
  const { data: analytics } = useQueryCache<AnalyticsData>(
    "db:analytics",
    () => window.desktopApi.db.getAnalytics(),
    30_000, 60_000,
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
    <div className="flex flex-col h-full">
      <div className="p-6 pb-0 space-y-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard label="Sessions" value={summary.totalSessions} detail={`${summary.activeSessions} active`} icon={MonitorDot} />
          <MetricCard label="Agents" value={summary.totalAgents} icon={Bot} />
          <MetricCard label="Events" value={summary.totalEvents} icon={Zap} />
          <MetricCard label="Event Types" value={analytics?.eventsByType.length ?? 0} icon={Layers} />
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <SessionsView />
      </div>
    </div>
  );
}
