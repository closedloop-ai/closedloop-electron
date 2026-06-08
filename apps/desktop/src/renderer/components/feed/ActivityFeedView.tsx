import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@closedloop-ai/design-system/components/ui/button";
import { Badge } from "@closedloop-ai/design-system/components/ui/badge";
import { EmptyState } from "@closedloop-ai/design-system/components/ui/empty-state";
import { Input } from "@closedloop-ai/design-system/components/ui/input";
import { MetricCard } from "@closedloop-ai/design-system/components/ui/primitives/metric-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@closedloop-ai/design-system/components/ui/select";
import { Zap, Wrench, AlertCircle, Layers } from "lucide-react";
import type { EventRow } from "../../../shared/agent-db-contract";
import {
  DASHBOARD_GRID_CLASS_NAME,
  DASHBOARD_METRIC_CARD_CLASS_NAME,
  DashboardCard,
  LoadingState,
  PageShell,
} from "../layout/page-shell";

const EVENT_TYPE_TONES: Record<string, string> = {
  tool_use: "bg-blue-500/10 text-blue-600",
  tool_result: "bg-green-500/10 text-green-600",
  error: "bg-red-500/10 text-red-600",
  thinking: "bg-yellow-500/10 text-yellow-700",
  text: "bg-zinc-500/10 text-zinc-600",
};

function eventTypeColor(eventType: string): string {
  return EVENT_TYPE_TONES[eventType] ?? "bg-zinc-500/10 text-zinc-600";
}

interface EventWithSession extends EventRow {
  sessionName: string | null;
}

export function ActivityFeedView() {
  const [events, setEvents] = useState<EventWithSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (paused) return;
    window.desktopApi.db
      .getEventFeed()
      .then((data) => setEvents(data as EventWithSession[]))
      .catch(() => {});
  }, [paused]);

  useEffect(() => {
    load();
    setLoading(false);
  }, [load]);

  useEffect(() => {
    if (paused) return;
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load, paused]);

  const eventTypes = useMemo(() => {
    const types = new Set(events.map((e) => e.eventType));
    return Array.from(types).sort();
  }, [events]);

  const filtered = useMemo(() => {
    let result = events;
    if (typeFilter !== "all") {
      result = result.filter((e) => e.eventType === typeFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          (e.summary ?? "").toLowerCase().includes(q) ||
          (e.toolName ?? "").toLowerCase().includes(q) ||
          (e.sessionName ?? "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [events, typeFilter, search]);

  const toolCount = events.filter((e) => e.eventType === "tool_use" || e.eventType === "tool_result").length;
  const errorCount = events.filter((e) => e.eventType === "error").length;

  if (loading) {
    return <LoadingState label="activity feed" />;
  }

  return (
    <PageShell title="Activity Feed" description="Real-time agent event stream">
      <div className="flex justify-end">
        <Button
          variant={paused ? "default" : "outline"}
          size="sm"
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? "Resume" : "Pause"}
        </Button>
      </div>

      <div className={DASHBOARD_GRID_CLASS_NAME}>
        <MetricCard className={DASHBOARD_METRIC_CARD_CLASS_NAME} label="Events" value={events.length} icon={Zap} />
        <MetricCard className={DASHBOARD_METRIC_CARD_CLASS_NAME} label="Tool Calls" value={toolCount} icon={Wrench} />
        <MetricCard className={DASHBOARD_METRIC_CARD_CLASS_NAME} label="Errors" value={errorCount} icon={AlertCircle} />
        <MetricCard className={DASHBOARD_METRIC_CARD_CLASS_NAME} label="Types" value={eventTypes.length} icon={Layers} />
      </div>

      <DashboardCard title="Events" contentClassName="p-0">
        <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 md:flex-row md:items-center">
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events..."
            className="h-11 flex-1 rounded-xl bg-[var(--background)]"
          />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-11 w-full rounded-xl bg-[var(--background)] md:w-[12rem]">
              <SelectValue placeholder="Event type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {eventTypes.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 p-3">
          {filtered.length === 0 && (
            <EmptyState
              icon={Zap}
              title={search || typeFilter !== "all" ? "No matching events" : "No events recorded yet"}
              description={search || typeFilter !== "all" ? "Adjust the current filters to widen the event feed." : undefined}
              className="py-12"
            />
          )}
          {filtered.map((event) => (
            <div key={event.id}>
              <div
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-[var(--background)] p-3 text-sm transition-colors hover:bg-[var(--accent)]"
                onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}
              >
                <span
                  className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${eventTypeColor(event.eventType)}`}
                >
                  {event.eventType.replace(/_/g, " ").slice(0, 12)}
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  {event.summary && (
                    <p className="truncate text-[var(--foreground)]">{event.summary}</p>
                  )}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--muted-foreground)]">
                    {event.sessionName && <span>{event.sessionName}</span>}
                    {event.toolName && <span className="font-mono">{event.toolName}</span>}
                    {event.createdAt && <span>{new Date(event.createdAt).toLocaleTimeString()}</span>}
                  </div>
                </div>
                {event.toolName && (
                  <Badge variant="outline" className="shrink-0 text-[10px]">{event.toolName}</Badge>
                )}
              </div>
              {expandedId === event.id && event.data && (
                <div className="mx-3 mb-2 mt-1 max-h-48 overflow-auto rounded-xl bg-[var(--muted)] p-3 font-mono text-xs">
                  <pre className="whitespace-pre-wrap break-all text-[var(--foreground)]">
                    {(() => { try { return JSON.stringify(JSON.parse(event.data), null, 2); } catch { return event.data; } })()}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      </DashboardCard>
    </PageShell>
  );
}
