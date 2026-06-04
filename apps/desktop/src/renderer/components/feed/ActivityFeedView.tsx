import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@closedloop-ai/design-system/components/ui/button";
import { Badge } from "@closedloop-ai/design-system/components/ui/badge";
import { MetricCard } from "@closedloop-ai/design-system/components/ui/primitives/metric-card";
import { Zap, Wrench, AlertCircle, Layers } from "lucide-react";
import type { EventRow } from "../../../shared/agent-db-contract";

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
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-[var(--muted-foreground)]">Loading activity feed...</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--foreground)]">Activity Feed</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Real-time agent event stream
          </p>
        </div>
        <Button
          variant={paused ? "default" : "outline"}
          size="sm"
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? "Resume" : "Pause"}
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <MetricCard label="Events" value={events.length} icon={Zap} />
        <MetricCard label="Tool Calls" value={toolCount} icon={Wrench} />
        <MetricCard label="Errors" value={errorCount} icon={AlertCircle} />
        <MetricCard label="Types" value={eventTypes.length} icon={Layers} />
      </div>

      <div className="flex items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search events..."
          className="flex-1 bg-[var(--input)] border border-[var(--input-border)] rounded-md px-3 py-1.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-[var(--input)] border border-[var(--input-border)] rounded-md px-3 py-1.5 text-sm text-[var(--foreground)]"
        >
          <option value="all">All types</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">
            {search || typeFilter !== "all" ? "No events match the current filters." : "No events recorded yet."}
          </div>
        )}
        {filtered.map((event) => (
          <div key={event.id}>
            <div
              className="flex items-start gap-3 rounded-lg border p-3 text-sm cursor-pointer hover:bg-[var(--accent)]"
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
              <div className="ml-10 mt-1 mb-2 p-3 bg-[var(--muted)] rounded text-xs font-mono overflow-auto max-h-48">
                <pre className="whitespace-pre-wrap break-all text-[var(--foreground)]">
                  {(() => { try { return JSON.stringify(JSON.parse(event.data), null, 2); } catch { return event.data; } })()}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
