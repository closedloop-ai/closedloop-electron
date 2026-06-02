/**
 * @file SubAgents.tsx — sub-agent dispatch browser (FEA-1224 / PLN-651).
 * Groups distinct `subagent_type` values from the existing `agents` table by
 * dispatch count. Right panel shows recent dispatches for the selected type.
 * No new endpoints or tables — data is sourced entirely from /api/agents.
 * Build-copied into the pinned client as src/pages/SubAgents.tsx by
 * build-agent-monitor.mjs (pre Vite build).
 */
import { useCallback, useEffect, useMemo, useState } from "react";

interface Agent {
  id: string;
  session_id: string;
  name: string | null;
  type: string;
  subagent_type: string | null;
  status: string;
  task: string | null;
  current_tool: string | null;
  started_at: string;
  ended_at: string | null;
  updated_at: string;
}

function fmt(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

function duration(started: string, ended: string | null): string {
  if (!ended) return "running";
  const a = new Date(started).getTime();
  const b = new Date(ended).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return "—";
  const secs = Math.max(0, Math.round((b - a) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const UNTYPED = "(untyped)";

export function SubAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agents?limit=500");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = data.agents ?? data.items ?? [];
      const subs = Array.isArray(items)
        ? items.filter((a: Agent) => a && a.type === "subagent")
        : [];
      setAgents(subs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const m = new Map<string, Agent[]>();
    for (const a of agents) {
      const k = a.subagent_type || UNTYPED;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(a);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [agents]);

  const selectedDispatches = useMemo(() => {
    if (!selected) return [];
    return groups.find(([k]) => k === selected)?.[1] ?? [];
  }, [selected, groups]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-gray-100">Sub-agents</h1>
        <p className="text-xs text-gray-500">
          Sub-agent dispatch types observed across sessions. Sourced from the
          existing agents table — no new data is written.
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
          ) : groups.length === 0 ? (
            <p className="text-xs text-gray-500 italic">
              No sub-agent dispatches captured yet.
            </p>
          ) : (
            groups.map(([type, items]) => {
              const active = type === selected;
              return (
                <button
                  key={type}
                  onClick={() => setSelected(type)}
                  className={`block w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                    active
                      ? "bg-accent/10 border-accent/30"
                      : "bg-surface-2 border-border hover:bg-surface-3"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-mono text-gray-100 truncate">
                      {type}
                    </span>
                    <span className="flex-shrink-0 text-[10px] font-mono text-gray-400">
                      {items.length}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface-1 p-4 min-h-[24rem]">
          {!selected ? (
            <p className="text-xs text-gray-500 italic">
              Select a sub-agent type to view recent dispatches.
            </p>
          ) : (
            <div>
              <h2 className="text-base font-semibold text-gray-50 font-mono mb-3">
                {selected}
              </h2>
              {selectedDispatches.length === 0 ? (
                <p className="text-xs text-gray-500 italic">
                  No dispatches recorded.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {selectedDispatches.map((d) => (
                    <div
                      key={d.id}
                      className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2 text-gray-400">
                        <span className="truncate">{d.name || d.id}</span>
                        <span className="flex-shrink-0">
                          {duration(d.started_at, d.ended_at)} · {d.status}
                        </span>
                      </div>
                      {d.task && (
                        <div className="text-[11px] text-gray-300 mt-0.5 line-clamp-2">
                          {d.task}
                        </div>
                      )}
                      <div className="text-[10px] text-gray-500 truncate font-mono mt-0.5">
                        session: {d.session_id} · {fmt(d.started_at)}
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
