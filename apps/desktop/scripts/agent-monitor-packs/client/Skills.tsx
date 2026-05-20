/**
 * @file Skills.tsx — cross-pack skill browser (FEA-1224 / PLN-651).
 * Groups installed skills by pack (gstack, bmad-method, Unattributed) with
 * version chips and invocation counts from the existing `events` table.
 * Right panel shows recent invocations for the selected skill. Build-copied
 * into the pinned client as src/pages/Skills.tsx by build-agent-monitor.mjs
 * (pre Vite build).
 */
import { useCallback, useEffect, useState } from "react";

interface Skill {
  skill_id: string;
  pack_id: string | null;
  harness: string;
  install_path: string;
  name: string;
  version: string | null;
  description: string | null;
  invocation_count: number;
  last_invoked_at: string | null;
}

interface Invocation {
  event_id: number;
  session_id: string;
  session_name: string | null;
  session_cwd: string | null;
  created_at: string;
  summary: string | null;
  data: string | null;
}

function fmt(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

const UNATTRIBUTED = "Unattributed / user-defined";

function groupKey(pack_id: string | null): string {
  return pack_id ?? UNATTRIBUTED;
}

export function Skills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selected, setSelected] = useState<Skill | null>(null);
  const [invocations, setInvocations] = useState<Invocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/skills");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSkills(Array.isArray(data.items) ? data.items : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadInvocations = useCallback(async (name: string) => {
    try {
      const res = await fetch(
        `/api/skills/${encodeURIComponent(name)}/invocations?limit=50`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setInvocations(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (selected) loadInvocations(selected.name);
    else setInvocations([]);
  }, [selected, loadInvocations]);

  const groups = new Map<string, Skill[]>();
  for (const s of skills) {
    const k = groupKey(s.pack_id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  }
  const orderedGroups = [...groups.entries()].sort(([a], [b]) => {
    if (a === UNATTRIBUTED) return 1;
    if (b === UNATTRIBUTED) return -1;
    return a.localeCompare(b);
  });

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-gray-100">Skills</h1>
        <p className="text-xs text-gray-500">
          Slash-command skills discovered on disk, grouped by pack. Invocation
          counts come from PreToolUse events captured by the hook pipeline.
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[22rem_1fr] gap-4">
        <div className="space-y-3">
          {loading ? (
            <p className="text-xs text-gray-500">Loading…</p>
          ) : skills.length === 0 ? (
            <p className="text-xs text-gray-500 italic">
              No skills discovered yet. Install a skill pack (e.g. gstack) into
              <code className="mx-1">~/.claude/skills/</code> and restart the
              dashboard.
            </p>
          ) : (
            orderedGroups.map(([group, items]) => (
              <div key={group}>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                  {group}{" "}
                  <span className="text-gray-600">({items.length})</span>
                </div>
                <div className="space-y-1">
                  {items.map((s) => {
                    const active = selected?.skill_id === s.skill_id;
                    return (
                      <button
                        key={s.skill_id}
                        onClick={() => setSelected(s)}
                        className={`block w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                          active
                            ? "bg-accent/10 border-accent/30"
                            : "bg-surface-2 border-border hover:bg-surface-3"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-mono text-gray-100 truncate">
                            /{s.name}
                          </span>
                          {s.version && (
                            <span className="flex-shrink-0 text-[10px] font-mono rounded bg-surface-3 text-gray-400 px-1.5 py-0.5">
                              v{s.version}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-500">
                          <span>{s.harness}</span>
                          <span>·</span>
                          <span>
                            {s.invocation_count} call
                            {s.invocation_count === 1 ? "" : "s"}
                          </span>
                          {s.last_invoked_at && (
                            <span className="ml-auto">
                              {fmt(s.last_invoked_at)}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface-1 p-4 min-h-[24rem]">
          {!selected ? (
            <p className="text-xs text-gray-500 italic">
              Select a skill to view recent invocations.
            </p>
          ) : (
            <div>
              <div className="mb-3">
                <h2 className="text-base font-semibold text-gray-50 font-mono">
                  /{selected.name}
                </h2>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {selected.pack_id || "Unattributed"} · {selected.harness}
                  {selected.version ? ` · v${selected.version}` : ""} ·{" "}
                  {selected.invocation_count} total call
                  {selected.invocation_count === 1 ? "" : "s"}
                </p>
                {selected.description && (
                  <p className="text-xs text-gray-300 mt-2">
                    {selected.description}
                  </p>
                )}
              </div>

              {invocations.length === 0 ? (
                <p className="text-xs text-gray-500 italic">
                  No invocations recorded yet.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {invocations.map((inv) => (
                    <div
                      key={inv.event_id}
                      className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2 text-gray-400">
                        <span className="truncate">
                          {inv.session_name || inv.session_id}
                        </span>
                        <span className="flex-shrink-0">
                          {fmt(inv.created_at)}
                        </span>
                      </div>
                      {inv.session_cwd && (
                        <div className="text-[10px] text-gray-500 truncate font-mono mt-0.5">
                          {inv.session_cwd}
                        </div>
                      )}
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
