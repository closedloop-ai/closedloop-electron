import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@closedloop-ai/design-system/components/ui/card";
import { Badge } from "@closedloop-ai/design-system/components/ui/badge";
import { MetricCard } from "@closedloop-ai/design-system/components/ui/primitives/metric-card";
import type { EventRow } from "../../main/database/types";

const EVENT_TYPE_TONES: Record<string, string> = {
  tool_use: "bg-blue-500/10 text-blue-400",
  tool_result: "bg-green-500/10 text-green-400",
  error: "bg-red-500/10 text-red-400",
  thinking: "bg-yellow-500/10 text-yellow-400",
  text: "bg-zinc-500/10 text-zinc-300",
};

function eventTypeColor(eventType: string): string {
  return EVENT_TYPE_TONES[eventType] ?? "bg-zinc-500/10 text-zinc-300";
}

interface EventWithSession extends EventRow {
  sessionName: string | null;
}

export function ActivityFeedView() {
  const [events, setEvents] = useState<EventWithSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);

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

  const toolCount = events.filter((e) => e.eventType === "tool_use" || e.eventType === "tool_result").length;
  const errorCount = events.filter((e) => e.eventType === "error").length;

  const metrics = [
    { label: "Events", value: events.length },
    { label: "Tool Calls", value: toolCount },
    { label: "Errors", value: errorCount },
    { label: "Types", value: new Set(events.map((e) => e.eventType)).size },
  ];

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
        <button
          onClick={() => setPaused((p) => !p)}
          className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
            paused
              ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
              : "bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700"
          }`}
        >
          {paused ? "Paused — click to resume" : "Pause"}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {metrics.map((m) => (
          <MetricCard key={m.label} label={m.label} value={m.value} icon={m.icon} />
        ))}
      </div>

      <div className="space-y-1">
        {events.length === 0 && (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">
            No events recorded yet.
          </div>
        )}
        {events.map((event) => (
          <div
            key={event.id}
            className="flex items-start gap-3 rounded-lg border border-zinc-800 p-3 text-sm"
          >
            <span
              className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${eventTypeColor(event.eventType)}`}
            >
              {event.eventType.slice(0, 8)}
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              {event.summary && (
                <p className="truncate text-[var(--foreground)]">{event.summary}</p>
              )}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--muted-foreground)]">
                {event.sessionName && (
                  <span>{event.sessionName}</span>
                )}
                {event.toolName && (
                  <span className="font-mono">{event.toolName}</span>
                )}
                {event.createdAt && (
                  <span>{new Date(event.createdAt).toLocaleTimeString()}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
