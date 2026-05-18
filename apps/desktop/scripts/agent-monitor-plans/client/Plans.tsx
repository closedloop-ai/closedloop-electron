/**
 * @file Plans.tsx — dedicated cross-session plan browser (FEA-1189 / PLN-613).
 * CLOSEDLOOP plan-extraction PoC: lists implementation plans captured from
 * Claude Code / Codex logs + hooks, with version history and a confirm/reject
 * control for medium-confidence captures. Build-copied into the pinned client
 * as src/pages/Plans.tsx by build-agent-monitor.mjs (pre Vite build).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { eventBus } from "../lib/eventBus";
import type { WSMessage } from "../lib/types";

interface PlanVersion {
  id: string;
  version_number: number;
  content_markdown: string;
  capture_method: string | null;
  source_event_ref: string | null;
  created_at: string;
}

interface Plan {
  id: string;
  title: string | null;
  status: string;
  source: string;
  harness: string | null;
  capture_method: string | null;
  created_from_session_id: string | null;
  needs_confirmation: number;
  confidence: number | null;
  plan_key: string | null;
  file_path: string | null;
  source_log_path: string | null;
  updated_at: string;
  versions?: PlanVersion[];
}

function confidencePct(c: number | null): string {
  if (c == null) return "—";
  return `${Math.round(c * 100)}%`;
}

function fmt(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

export function Plans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/plans?limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPlans(Array.isArray(data.plans) ? data.plans : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOne = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSelected(data.plan ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    loadList();
    return eventBus.subscribe((msg: WSMessage) => {
      if (msg.type === "plan_captured" || msg.type === "plan_updated") {
        loadList();
        const open = selectedIdRef.current;
        if (open) loadOne(open);
      }
    });
  }, [loadList, loadOne]);

  useEffect(() => {
    if (selectedId) loadOne(selectedId);
    else setSelected(null);
  }, [selectedId, loadOne]);

  const act = useCallback(
    async (id: string, action: "confirm" | "reject") => {
      try {
        await fetch(`/api/plans/${encodeURIComponent(id)}/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        await loadList();
        await loadOne(id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [loadList, loadOne],
  );

  const openFile = useCallback(
    async (id: string, target: "plan" | "log") => {
      try {
        const res = await fetch(
          `/api/plans/${encodeURIComponent(id)}/open?target=${target}`,
          { method: "POST", headers: { "Content-Type": "application/json" } },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error?.message || `HTTP ${res.status}`);
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  const latest =
    selected?.versions && selected.versions.length > 0
      ? selected.versions[selected.versions.length - 1]
      : null;

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-gray-100">Plans</h1>
        <p className="text-xs text-gray-500">
          Implementation plans captured from Claude Code &amp; Codex sessions
          (logs + hooks) — no slash command required.
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[20rem_1fr] gap-4">
        {/* List */}
        <div className="space-y-1.5">
          {loading ? (
            <p className="text-xs text-gray-500">Loading…</p>
          ) : plans.length === 0 ? (
            <p className="text-xs text-gray-500 italic">
              No plans captured yet. Start a Claude Code or Codex session and
              produce a plan.
            </p>
          ) : (
            plans.map((p) => {
              const active = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`block w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                    active
                      ? "bg-accent/10 border-accent/30"
                      : "bg-surface-2 border-border hover:bg-surface-3"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-100 truncate">
                      {p.title || "(untitled plan)"}
                    </span>
                    {p.needs_confirmation === 1 && (
                      <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-amber-300 bg-amber-500/15 border border-amber-500/30 rounded px-1.5 py-0.5">
                        confirm
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500">
                    <span className="rounded bg-surface-3 px-1.5 py-0.5 text-gray-300">
                      {p.harness || "?"}
                    </span>
                    <span className="rounded bg-surface-3 px-1.5 py-0.5">
                      {p.source}
                    </span>
                    <span className="rounded bg-surface-3 px-1.5 py-0.5">
                      {p.capture_method || "?"}
                    </span>
                    <span title="detection confidence">
                      {confidencePct(p.confidence)}
                    </span>
                    <span className="ml-auto">{fmt(p.updated_at)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Detail */}
        <div className="rounded-lg border border-border bg-surface-1 p-4 min-h-[24rem]">
          {!selected ? (
            <p className="text-xs text-gray-500 italic">
              Select a plan to view its content and version history.
            </p>
          ) : (
            <div>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-gray-50 truncate">
                    {selected.title || "(untitled plan)"}
                  </h2>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    status: {selected.status} · session:{" "}
                    {selected.created_from_session_id || "—"} ·{" "}
                    {selected.versions?.length ?? 0} version(s) · confidence{" "}
                    {confidencePct(selected.confidence)}
                  </p>
                </div>
                {selected.needs_confirmation === 1 && (
                  <div className="flex flex-shrink-0 gap-2">
                    <button
                      onClick={() => act(selected.id, "confirm")}
                      className="text-xs font-medium rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 px-3 py-1.5 hover:bg-emerald-500/20"
                    >
                      Confirm — this is a plan
                    </button>
                    <button
                      onClick={() => act(selected.id, "reject")}
                      className="text-xs font-medium rounded-lg border border-border bg-surface-2 text-gray-300 px-3 py-1.5 hover:bg-surface-3"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>

              {(selected.file_path || selected.source_log_path) && (
                <div className="mb-3 space-y-1.5">
                  {selected.file_path && (
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-gray-500 w-16 flex-shrink-0">
                        Plan file
                      </span>
                      <button
                        onClick={() => openFile(selected.id, "plan")}
                        title={`Open ${selected.file_path}`}
                        className="font-mono text-accent hover:underline truncate text-left"
                      >
                        {selected.file_path}
                      </button>
                    </div>
                  )}
                  {selected.source_log_path && (
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-gray-500 w-16 flex-shrink-0">
                        Agent log
                      </span>
                      <button
                        onClick={() => openFile(selected.id, "log")}
                        title={`Open ${selected.source_log_path}`}
                        className="font-mono text-accent hover:underline truncate text-left"
                      >
                        {selected.source_log_path}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {selected.versions && selected.versions.length > 1 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {selected.versions.map((v) => (
                    <span
                      key={v.id}
                      className="text-[10px] font-mono rounded bg-surface-3 text-gray-400 px-1.5 py-0.5"
                      title={`${v.capture_method || ""} ${fmt(v.created_at)}`}
                    >
                      v{v.version_number}
                    </span>
                  ))}
                </div>
              )}

              <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-200 bg-surface-2 border border-border rounded-lg p-3 max-h-[60vh] overflow-auto">
                {latest ? latest.content_markdown : "(no content)"}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
