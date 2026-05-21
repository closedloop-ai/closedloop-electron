/**
 * @file PacksInstalled.tsx — installed-packs inventory view (FEA-1224).
 * Extracted into its own file by FEA-1314 so the Packs page can tab between
 * "Installed" (this) and "Catalog" (PacksCatalog.tsx). Content is the
 * original Packs.tsx body, minus the outer page header (now owned by the
 * tab shell).
 */
import { useCallback, useEffect, useState } from "react";

interface PackSummary {
  pack_id: string;
  version: string | null;
  harnesses: string;
  install_count: number;
  first_detected_at: string;
  last_seen_at: string;
  skill_count: number;
}

interface PackInstall {
  pack_id: string;
  harness: string;
  install_path: string;
  install_kind: "symlink" | "directory";
  source_url: string | null;
  version: string | null;
  detected_at: string;
  last_seen_at: string;
}

interface PackSkill {
  skill_id: string;
  pack_id: string | null;
  harness: string;
  install_path: string;
  name: string;
  version: string | null;
  description: string | null;
}

interface PackAssociation {
  project_path: string;
  pack_id: string;
  detected_at: string;
  last_seen_at: string;
}

interface PackDetail {
  pack_id: string;
  version: string | null;
  harnesses: string[];
  installs: PackInstall[];
  skills: PackSkill[];
  associations: PackAssociation[];
}

function fmt(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

export function PacksInstalled() {
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PackDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/packs");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPacks(Array.isArray(data.items) ? data.items : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/packs/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: PackDetail = await res.json();
      setDetail(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const totalInstalls = packs.reduce((sum, p) => sum + p.install_count, 0);
  const totalSkills = packs.reduce((sum, p) => sum + p.skill_count, 0);

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        Installed agent skill packs discovered on disk by the pack scanner.
        {packs.length > 0 && (
          <>
            {" "}
            <span className="text-gray-400">
              {packs.length} pack{packs.length === 1 ? "" : "s"} ·{" "}
              {totalInstalls} install{totalInstalls === 1 ? "" : "s"} ·{" "}
              {totalSkills} skill{totalSkills === 1 ? "" : "s"}
            </span>
          </>
        )}
      </p>

      {error && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[22rem_1fr] gap-4">
        <div className="space-y-1.5">
          {loading ? (
            <p className="text-xs text-gray-500">Loading…</p>
          ) : packs.length === 0 ? (
            <p className="text-xs text-gray-500 italic">
              No packs detected yet. Browse the Catalog tab to discover and
              install popular packs.
            </p>
          ) : (
            packs.map((p) => {
              const active = p.pack_id === selectedId;
              return (
                <button
                  key={p.pack_id}
                  onClick={() => setSelectedId(p.pack_id)}
                  className={`block w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                    active
                      ? "bg-accent/10 border-accent/30"
                      : "bg-surface-2 border-border hover:bg-surface-3"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-mono text-gray-100 truncate">
                      {p.pack_id}
                    </span>
                    {p.version && (
                      <span className="flex-shrink-0 text-[10px] font-mono rounded bg-surface-3 text-gray-400 px-1.5 py-0.5">
                        v{p.version}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500">
                    <span>{p.harnesses}</span>
                    <span>·</span>
                    <span>
                      {p.skill_count} skill{p.skill_count === 1 ? "" : "s"}
                    </span>
                    <span>·</span>
                    <span>
                      {p.install_count} install
                      {p.install_count === 1 ? "" : "s"}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface-1 p-4 min-h-[24rem]">
          {!detail ? (
            <p className="text-xs text-gray-500 italic">
              Select a pack to view installs, skills, and project associations.
            </p>
          ) : (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-gray-50 font-mono">
                  {detail.pack_id}
                </h2>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {detail.version ? `v${detail.version} · ` : ""}
                  {detail.harnesses.join(", ")}
                </p>
              </div>

              <section>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                  Installs ({detail.installs.length})
                </div>
                <div className="space-y-1">
                  {detail.installs.map((i) => (
                    <div
                      key={`${i.harness}|${i.install_path}`}
                      className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-gray-200">
                          {i.harness}
                        </span>
                        <span className="text-[10px] font-mono text-gray-500">
                          {i.install_kind}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-gray-400 truncate mt-0.5">
                        {i.install_path}
                      </div>
                      {i.source_url && (
                        <div className="text-[10px] text-gray-500 truncate mt-0.5">
                          {i.source_url}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                  Skills ({detail.skills.length})
                </div>
                {detail.skills.length === 0 ? (
                  <p className="text-[11px] text-gray-500 italic">
                    No skills parsed.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                    {detail.skills.map((s) => (
                      <div
                        key={s.skill_id}
                        className="rounded border border-border bg-surface-2 px-2 py-1 text-[11px] font-mono text-gray-200 truncate"
                        title={s.description || s.name}
                      >
                        /{s.name}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                  Project associations ({detail.associations.length})
                </div>
                {detail.associations.length === 0 ? (
                  <p className="text-[11px] text-gray-500 italic">
                    No per-project markers detected.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {detail.associations.map((a) => (
                      <div
                        key={a.project_path}
                        className="rounded border border-border bg-surface-2 px-3 py-1.5 text-[11px] font-mono text-gray-300 truncate"
                        title={`last seen ${fmt(a.last_seen_at)}`}
                      >
                        {a.project_path}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
