/**
 * @file Tools.tsx — cross-session tool inventory (FEA-1224 / PLN-651).
 * Lists every tool observed in the existing `events` table by call count.
 * Right panel shows recent calls for the selected tool. No new endpoints or
 * tables — data is sourced entirely from /api/events/facets and /api/events.
 * Build-copied into the pinned client as src/pages/Tools.tsx by
 * build-agent-monitor.mjs (pre Vite build).
 */
import { useCallback, useEffect, useState } from "react";

interface ToolFacet {
  tool_name: string;
  count: number;
  last_seen?: string | null;
}

interface ToolEvent {
  id: number;
  session_id: string | null;
  event_type: string;
  tool_name: string | null;
  summary: string | null;
  created_at: string;
}

function fmt(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

export function Tools() {
  const [tools, setTools] = useState<ToolFacet[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<ToolEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFacets = useCallback(async () => {
    try {
      const res = await fetch("/api/events/facets");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Upstream shape varies; normalize to an array of {tool_name, count}.
      const raw = data.tools ?? data.tool_names ?? data.facets?.tool_name ?? [];
      const normalized: ToolFacet[] = Array.isArray(raw)
        ? raw
            .map((r: unknown) => {
              if (typeof r === "string") {
                return { tool_name: r, count: 0 };
              }
              if (r && typeof r === "object") {
                const rec = r as Record<string, unknown>;
                return {
                  tool_name: String(rec.tool_name ?? rec.name ?? ""),
                  count: Number(rec.count ?? rec.n ?? 0),
                  last_seen:
                    typeof rec.last_seen === "string" ? rec.last_seen : null,
                };
              }
              return { tool_name: "", count: 0 };
            })
            .filter((t) => t.tool_name)
        : [];
      normalized.sort((a, b) => b.count - a.count);
      setTools(normalized);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEvents = useCallback(async (tool: string) => {
    try {
      const res = await fetch(
        `/api/events?tool_name=${encodeURIComponent(tool)}&limit=50`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = data.events ?? data.items ?? [];
      setEvents(Array.isArray(items) ? items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    loadFacets();
  }, [loadFacets]);

  useEffect(() => {
    if (selected) loadEvents(selected);
    else setEvents([]);
  }, [selected, loadEvents]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-gray-100">Tools</h1>
        <p className="text-xs text-gray-500">
          Every tool observed across captured sessions, by call count. Sourced
          from the existing events table — no new data is written.
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[20rem_1fr] gap-4">
        <div className="space-y-1">
          {loading ? (
            <p className="text-xs text-gray-500">Loading…</p>
          ) : tools.length === 0 ? (
            <p className="text-xs text-gray-500 italic">
              No tool events captured yet.
            </p>
          ) : (
            tools.map((t) => {
              const active = t.tool_name === selected;
              return (
                <button
                  key={t.tool_name}
                  onClick={() => setSelected(t.tool_name)}
                  className={`block w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                    active
                      ? "bg-accent/10 border-accent/30"
                      : "bg-surface-2 border-border hover:bg-surface-3"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-mono text-gray-100 truncate">
                      {t.tool_name}
                    </span>
                    <span className="flex-shrink-0 text-[10px] font-mono text-gray-400">
                      {t.count}
                    </span>
                  </div>
                  {t.last_seen && (
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      last {fmt(t.last_seen)}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface-1 p-4 min-h-[24rem]">
          {!selected ? (
            <p className="text-xs text-gray-500 italic">
              Select a tool to view recent calls.
            </p>
          ) : (
            <div>
              <h2 className="text-base font-semibold text-gray-50 font-mono mb-3">
                {selected}
              </h2>
              {events.length === 0 ? (
                <p className="text-xs text-gray-500 italic">No recent calls.</p>
              ) : (
                <div className="space-y-1.5">
                  {events.map((ev) => (
                    <div
                      key={ev.id}
                      className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2 text-gray-400">
                        <span className="font-mono">{ev.event_type}</span>
                        <span className="flex-shrink-0">
                          {fmt(ev.created_at)}
                        </span>
                      </div>
                      {ev.summary && (
                        <div className="text-[11px] text-gray-300 mt-0.5 line-clamp-2">
                          {ev.summary}
                        </div>
                      )}
                      <div className="text-[10px] text-gray-500 truncate font-mono mt-0.5">
                        session: {ev.session_id || "—"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
