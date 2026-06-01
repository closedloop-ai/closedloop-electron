import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@closedloop-ai/design-system/components/ui/card";
import { Badge } from "@closedloop-ai/design-system/components/ui/badge";
import { MetricCard } from "@closedloop-ai/design-system/components/ui/primitives/metric-card";
import { RankedBar } from "@closedloop-ai/design-system/components/ui/primitives/ranked-bar";
import { MonitorDot, Bot, Zap, Layers } from "lucide-react";
import { useQueryCache } from "../../hooks/useQueryCache";
import { ActivityFeedView } from "../feed/ActivityFeedView";
import { SessionsView } from "../sessions/SessionsView";
import type { DashboardSummary, AnalyticsData } from "../../main/database/types";

type SessionsTab = "sessions" | "activity";

export function DashboardPage() {
  const [tab, setTab] = useState<SessionsTab>("sessions");

  const { data: summary, error } = useQueryCache<DashboardSummary>(
    "db:summary",
    () => window.desktopApi.db.getDashboardSummary() as Promise<DashboardSummary>,
    3_000, 5_000,
  );
  const { data: analytics } = useQueryCache<AnalyticsData>(
    "db:analytics",
    () => window.desktopApi.db.getAnalytics() as Promise<AnalyticsData>,
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

  const toolUsage = analytics?.toolUsage ?? [];
  const maxToolCount = toolUsage.length > 0 ? toolUsage[0].count : 1;

  return (
    <div className="flex flex-col h-full">
      {/* Summary cards */}
      <div className="p-6 pb-0 space-y-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard label="Sessions" value={summary.totalSessions} detail={`${summary.activeSessions} active`} icon={MonitorDot} />
          <MetricCard label="Agents" value={summary.totalAgents} icon={Bot} />
          <MetricCard label="Events" value={summary.totalEvents} icon={Zap} />
          <MetricCard label="Event Types" value={analytics?.eventsByType.length ?? 0} icon={Layers} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b px-6 pt-4 shrink-0">
        <button
          type="button"
          onClick={() => setTab("sessions")}
          className={`px-3 py-2 text-sm border-b-2 transition-colors ${
            tab === "sessions"
              ? "border-[var(--primary)] text-[var(--foreground)] font-medium"
              : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          }`}
        >
          Sessions
        </button>
        <button
          type="button"
          onClick={() => setTab("activity")}
          className={`px-3 py-2 text-sm border-b-2 transition-colors ${
            tab === "activity"
              ? "border-[var(--primary)] text-[var(--foreground)] font-medium"
              : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          }`}
        >
          Activity Feed
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {tab === "sessions" ? <SessionsView /> : <ActivityFeedView />}
      </div>
    </div>
  );
}
