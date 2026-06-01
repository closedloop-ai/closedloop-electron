import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@closedloop-ai/design-system/components/ui/card";
import { MetricCard } from "@closedloop-ai/design-system/components/ui/primitives/metric-card";
import { LineChart } from "@closedloop-ai/design-system/components/ui/primitives/line-chart";
import { DonutChart } from "@closedloop-ai/design-system/components/ui/primitives/donut-chart";
import type { TokenAnalytics, EventCountByType } from "../../main/database/types";

const MODEL_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

export function AnalyticsView() {
  const [tokens, setTokens] = useState<TokenAnalytics | null>(null);
  const [eventTypes, setEventTypes] = useState<EventCountByType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      window.desktopApi.db.getTokenAnalytics(),
      window.desktopApi.db.getEventCountByType(),
    ])
      .then(([tokenData, eventData]) => {
        setTokens(tokenData as TokenAnalytics);
        setEventTypes(eventData as EventCountByType[]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-[var(--muted-foreground)]">Loading analytics...</p>
      </div>
    );
  }

  const totalTokens = tokens
    ? tokens.totalInputTokens + tokens.totalOutputTokens
    : 0;

  const metrics = [
    { label: "Total Tokens", value: totalTokens.toLocaleString() },
    { label: "Input Tokens", value: tokens?.totalInputTokens.toLocaleString() ?? "0" },
    { label: "Output Tokens", value: tokens?.totalOutputTokens.toLocaleString() ?? "0" },
    { label: "Cache Saved", value: (tokens ? tokens.totalCacheReadTokens + tokens.totalCacheWriteTokens : 0).toLocaleString() },
  ];

  const tokenSegments = tokens
    ? [
        { label: "Input", value: tokens.totalInputTokens, color: MODEL_COLORS[0] },
        { label: "Output", value: tokens.totalOutputTokens, color: MODEL_COLORS[1] },
        { label: "Cache Read", value: tokens.totalCacheReadTokens, color: MODEL_COLORS[2] },
        { label: "Cache Write", value: tokens.totalCacheWriteTokens, color: MODEL_COLORS[3] },
      ].filter((s) => s.value > 0)
    : [];

  const eventSegments = eventTypes.map((e, i) => ({
    label: e.eventType,
    value: e.count,
    color: MODEL_COLORS[i % MODEL_COLORS.length],
  }));

  const tokenByModelSegments = tokens?.byModel.map((m, i) => ({
    label: m.model,
    value: m.inputTokens + m.outputTokens,
    color: MODEL_COLORS[i % MODEL_COLORS.length],
  })) ?? [];

  const dayPoints: { label: string; value: number }[] = (tokens?.byDay ?? []).map((d) => ({
    label: d.day,
    value: d.inputTokens + d.outputTokens,
  }));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--foreground)]">Analytics</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Token usage and event metrics
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {metrics.map((m) => (
          <MetricCard key={m.label} label={m.label} value={m.value} icon={m.icon} />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Token Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {tokenSegments.length > 0 ? (
              <DonutChart
                segments={tokenSegments}
                formatTotal={(t) => t.toLocaleString()}
                centerLabel="Tokens"
              />
            ) : (
              <p className="py-8 text-sm text-center text-[var(--muted-foreground)]">No token data</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Events by Type</CardTitle>
          </CardHeader>
          <CardContent>
            {eventSegments.length > 0 ? (
              <DonutChart
                segments={eventSegments}
                formatTotal={(t) => t.toLocaleString()}
                centerLabel="Events"
              />
            ) : (
              <p className="py-8 text-sm text-center text-[var(--muted-foreground)]">No event data</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Token Usage by Model</CardTitle>
        </CardHeader>
        <CardContent>
          {tokenByModelSegments.length > 0 ? (
            <div className="space-y-2">
              {tokenByModelSegments.map((seg) => (
                <div key={seg.label} className="flex items-center gap-3">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: seg.color }}
                  />
                  <span className="flex-1 text-sm text-[var(--foreground)]">{seg.label}</span>
                  <span className="text-sm font-medium text-[var(--foreground)]">
                    {seg.value.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-8 text-sm text-center text-[var(--muted-foreground)]">No model data</p>
          )}
        </CardContent>
      </Card>

      {dayPoints.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Daily Token Usage (Last 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <LineChart
                points={dayPoints}
                color={MODEL_COLORS[0]}
                valueFormatter={(v) => v.toLocaleString()}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
