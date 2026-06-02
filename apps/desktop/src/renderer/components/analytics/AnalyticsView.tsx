import { Card, CardContent, CardHeader, CardTitle } from "@closedloop-ai/design-system/components/ui/card";
import { MetricCard } from "@closedloop-ai/design-system/components/ui/primitives/metric-card";
import { LineChart } from "@closedloop-ai/design-system/components/ui/primitives/line-chart";
import { DonutChart } from "@closedloop-ai/design-system/components/ui/primitives/donut-chart";
import { RankedBar } from "@closedloop-ai/design-system/components/ui/primitives/ranked-bar";
import { ActivityHeatmap } from "@closedloop-ai/design-system/components/ui/primitives/activity-heatmap";
import { SegmentedBar } from "@closedloop-ai/design-system/components/ui/primitives/segmented-bar";
import { Coins, ArrowDownToLine, ArrowUpFromLine, DatabaseZap } from "lucide-react";
import { useQueryCache } from "../../hooks/useQueryCache";
import type { AnalyticsData } from "../../../main/database/types";

const PALETTE = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

const STATUS_COLORS: Record<string, string> = {
  running: "#3b82f6", active: "#3b82f6", completed: "#10b981",
  failed: "#ef4444", error: "#ef4444", stopped: "#6b7280",
  waiting: "#f59e0b", abandoned: "#9ca3af",
};

function buildHeatmapWeeks(dailyEvents: Array<{ date: string; count: number }>) {
  const counts = new Map(dailyEvents.map((d) => [d.date, d.count]));
  const weeks: Array<Array<{ date: string; count: number }>> = [];
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 364);
  start.setDate(start.getDate() - start.getDay());

  let week: Array<{ date: string; count: number }> = [];
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    week.push({ date: iso, count: counts.get(iso) ?? 0 });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) weeks.push(week);
  return weeks;
}

export function AnalyticsView() {
  const { data, loading } = useQueryCache<AnalyticsData>(
    "db:analytics",
    () => window.desktopApi.db.getAnalytics() as Promise<AnalyticsData>,
    10_000, 15_000,
  );

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-[var(--muted-foreground)]">Loading analytics...</p>
      </div>
    );
  }

  const { tokens, eventsByType, toolUsage, dailyEvents, sessionsByStatus, agentsByStatus, agentsByType } = data;
  const totalTokens = tokens.totalInputTokens + tokens.totalOutputTokens;
  const cacheTokens = tokens.totalCacheReadTokens + tokens.totalCacheWriteTokens;

  const tokenSegments = [
    { label: "Input", value: tokens.totalInputTokens, color: PALETTE[0] },
    { label: "Output", value: tokens.totalOutputTokens, color: PALETTE[1] },
    { label: "Cache Read", value: tokens.totalCacheReadTokens, color: PALETTE[2] },
    { label: "Cache Write", value: tokens.totalCacheWriteTokens, color: PALETTE[3] },
  ].filter((s) => s.value > 0);

  const sessionSegments = sessionsByStatus.map((s, i) => ({
    label: s.status, value: s.count, color: STATUS_COLORS[s.status] ?? PALETTE[i % PALETTE.length],
  }));

  const agentStatusSegments = agentsByStatus.map((s, i) => ({
    label: s.status, value: s.count, color: STATUS_COLORS[s.status] ?? PALETTE[i % PALETTE.length],
  }));

  const eventSegments = eventsByType.slice(0, 8).map((e, i) => ({
    label: e.eventType, value: e.count, color: PALETTE[i % PALETTE.length],
  }));

  const agentTypeSegments = agentsByType.slice(0, 8).map((a, i) => ({
    key: a.type, label: a.type, value: a.count,
    colorClassName: `bg-[${PALETTE[i % PALETTE.length]}]`,
  }));
  const agentTypeTotal = agentsByType.reduce((s, a) => s + a.count, 0);

  const dayPoints = (tokens.byDay ?? []).map((d) => ({
    label: d.day, value: d.inputTokens + d.outputTokens,
  }));

  const maxToolCount = toolUsage.length > 0 ? toolUsage[0].count : 1;
  const heatmapWeeks = buildHeatmapWeeks(dailyEvents);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--foreground)]">Analytics</h1>
        <p className="text-sm text-[var(--muted-foreground)]">Token usage, event metrics, and activity trends</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <MetricCard label="Total Tokens" value={totalTokens.toLocaleString()} detail={`${data.totalSessions} sessions`} icon={Coins} />
        <MetricCard label="Input Tokens" value={tokens.totalInputTokens.toLocaleString()} icon={ArrowDownToLine} />
        <MetricCard label="Output Tokens" value={tokens.totalOutputTokens.toLocaleString()} icon={ArrowUpFromLine} />
        <MetricCard label="Cache Saved" value={cacheTokens.toLocaleString()} detail={totalTokens > 0 ? `${Math.round((cacheTokens / (totalTokens + cacheTokens)) * 100)}% cache rate` : undefined} icon={DatabaseZap} />
      </div>

      {dailyEvents.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Activity Heatmap</CardTitle></CardHeader>
          <CardContent>
            <ActivityHeatmap weeks={heatmapWeeks} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Token Distribution</CardTitle></CardHeader>
          <CardContent>
            {tokenSegments.length > 0 ? (
              <DonutChart segments={tokenSegments} formatTotal={(t) => t.toLocaleString()} centerLabel="Tokens" />
            ) : (
              <p className="py-8 text-sm text-center text-[var(--muted-foreground)]">No token data</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Sessions by Status</CardTitle></CardHeader>
          <CardContent>
            {sessionSegments.length > 0 ? (
              <DonutChart segments={sessionSegments} formatTotal={(t) => `${t}`} centerLabel="Sessions" />
            ) : (
              <p className="py-8 text-sm text-center text-[var(--muted-foreground)]">No session data</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Agents by Status</CardTitle></CardHeader>
          <CardContent>
            {agentStatusSegments.length > 0 ? (
              <DonutChart segments={agentStatusSegments} formatTotal={(t) => `${t}`} centerLabel="Agents" />
            ) : (
              <p className="py-8 text-sm text-center text-[var(--muted-foreground)]">No agent data</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Events by Type</CardTitle></CardHeader>
          <CardContent>
            {eventSegments.length > 0 ? (
              <DonutChart segments={eventSegments} formatTotal={(t) => t.toLocaleString()} centerLabel="Events" />
            ) : (
              <p className="py-8 text-sm text-center text-[var(--muted-foreground)]">No event data</p>
            )}
          </CardContent>
        </Card>
      </div>

      {agentTypeSegments.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Agent Type Distribution</CardTitle></CardHeader>
          <CardContent>
            <SegmentedBar segments={agentTypeSegments} total={agentTypeTotal} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Tool Usage</CardTitle></CardHeader>
        <CardContent>
          {toolUsage.length > 0 ? (
            <div className="space-y-2">
              {toolUsage.slice(0, 15).map((t) => (
                <RankedBar
                  key={t.toolName}
                  label={<span className="font-mono text-xs">{t.toolName}</span>}
                  value={t.count}
                  percent={(t.count / maxToolCount) * 100}
                />
              ))}
            </div>
          ) : (
            <p className="py-8 text-sm text-center text-[var(--muted-foreground)]">No tool usage data</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Token Usage by Model</CardTitle></CardHeader>
        <CardContent>
          {tokens.byModel.length > 0 ? (
            <div className="space-y-2">
              {tokens.byModel.map((m) => {
                const modelTotal = m.inputTokens + m.outputTokens;
                const maxModel = tokens.byModel[0] ? tokens.byModel[0].inputTokens + tokens.byModel[0].outputTokens : 1;
                return (
                  <RankedBar
                    key={m.model}
                    label={<span className="font-mono text-xs">{m.model}</span>}
                    value={modelTotal.toLocaleString()}
                    percent={(modelTotal / maxModel) * 100}
                    description={<span className="text-[var(--muted-foreground)]">{m.sessions} sessions</span>}
                  />
                );
              })}
            </div>
          ) : (
            <p className="py-8 text-sm text-center text-[var(--muted-foreground)]">No model data</p>
          )}
        </CardContent>
      </Card>

      {dayPoints.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Daily Token Usage (Last 30 Days)</CardTitle></CardHeader>
          <CardContent>
            <div className="h-48">
              <LineChart points={dayPoints} color={PALETTE[0]} valueFormatter={(v) => v.toLocaleString()} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
