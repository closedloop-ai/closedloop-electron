import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@closedloop-ai/design-system/components/ui/card";
import { Badge } from "@closedloop-ai/design-system/components/ui/badge";
import { MetricCard } from "@closedloop-ai/design-system/components/ui/primitives/metric-card";
import { RankedBar } from "@closedloop-ai/design-system/components/ui/primitives/ranked-bar";
import { MonitorDot, Bot, Zap, Layers } from "lucide-react";
import type { DashboardSummary, AnalyticsData } from "../../main/database/types";

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = () => {
      Promise.all([
        window.desktopApi.db.getDashboardSummary(),
        window.desktopApi.db.getAnalytics(),
      ])
        .then(([summaryData, analyticsData]) => {
          if (mounted) {
            setSummary(summaryData as DashboardSummary);
            setAnalytics(analyticsData as AnalyticsData);
            setError(false);
          }
        })
        .catch(() => { if (mounted) setError(true); });
    };
    load();
    const interval = setInterval(load, 3000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-[var(--destructive)]">Failed to load dashboard data.</p>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-[var(--muted-foreground)]">Loading dashboard data...</p>
      </div>
    );
  }

  const toolUsage = analytics?.toolUsage ?? [];
  const maxToolCount = toolUsage.length > 0 ? toolUsage[0].count : 1;

  const effectivenessData = analytics?.agentsByType ?? [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--foreground)]">Sessions</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Agent sessions and activity overview
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Sessions" value={summary.totalSessions} detail={`${summary.activeSessions} active`} icon={MonitorDot} />
        <MetricCard label="Agents" value={summary.totalAgents} icon={Bot} />
        <MetricCard label="Events" value={summary.totalEvents} icon={Zap} />
        <MetricCard label="Event Types" value={analytics?.eventsByType.length ?? 0} icon={Layers} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {summary.recentSessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm">
                      {session.name || "Unnamed Session"}
                    </p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {session.model ?? "Unknown model"}
                      {session.cwd ? ` · ${session.cwd}` : ""}
                    </p>
                  </div>
                  <div className="ml-4 flex items-center gap-2">
                    <Badge variant={session.status === "running" ? "default" : "secondary"}>
                      {session.status}
                    </Badge>
                    <span className="text-xs text-[var(--muted-foreground)] whitespace-nowrap">
                      {session.startedAt ? new Date(session.startedAt).toLocaleDateString() : ""}
                    </span>
                  </div>
                </div>
              ))}
              {summary.recentSessions.length === 0 && (
                <p className="text-sm text-[var(--muted-foreground)] py-8 text-center">
                  No sessions recorded yet.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tool Usage</CardTitle>
          </CardHeader>
          <CardContent>
            {toolUsage.length > 0 ? (
              <div className="space-y-2">
                {toolUsage.slice(0, 8).map((t) => (
                  <RankedBar
                    key={t.toolName}
                    label={<span className="font-mono text-xs">{t.toolName}</span>}
                    value={t.count}
                    percent={(t.count / maxToolCount) * 100}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)] py-8 text-center">
                No tool usage data yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {effectivenessData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Agent Types</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-[var(--muted-foreground)]">
                    <th className="py-2 text-left font-medium">Type</th>
                    <th className="py-2 text-right font-medium">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {effectivenessData.map((a) => (
                    <tr key={a.type} className="border-b border-[var(--border)]">
                      <td className="py-2 font-mono text-xs">{a.type}</td>
                      <td className="py-2 text-right">{a.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
