/**
 * @file CatalogDetail.tsx — pack detail modal (FEA-1314 v2).
 * Opens when the user clicks a catalog card. Pulls the README from
 * /api/catalog/:pack_id/readme on first open (server-cached for 24h),
 * shows full metadata, per-harness install instructions with copyable
 * commands, and harness-specific install buttons that hand off to
 * InstallModal.
 */
import { useEffect, useState } from "react";
import type { CatalogEntry } from "./CatalogCard";
import { InstallModal } from "./InstallModal";

interface CatalogDetailProps {
  packId: string;
  onClose: () => void;
  onAfterRun?: () => void;
}

interface ReadmeResponse {
  pack_id: string;
  readme_excerpt: string;
  readme_fetched_at?: string;
  cached?: boolean;
}

interface ContentsItem {
  name: string;
  kind: "skill" | "command" | "agent" | "plugin";
  description?: string | null;
  category?: string | null;
  path?: string | null;
  skill_count?: number;
  skills?: string[];
}

interface ContentsResponse {
  pack_id: string;
  items: ContentsItem[];
  contents_fetched_at?: string;
  cached?: boolean;
}

function formatStars(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* ignore */
        }
      }}
      className="text-[10px] rounded border border-border bg-surface-3 text-gray-400 px-1.5 py-0.5 hover:bg-surface-2 hover:text-gray-200"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export function CatalogDetail({ packId, onClose, onAfterRun }: CatalogDetailProps) {
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [readme, setReadme] = useState<string | null>(null);
  const [readmeLoading, setReadmeLoading] = useState(false);
  const [readmeError, setReadmeError] = useState<string | null>(null);
  const [contents, setContents] = useState<ContentsItem[] | null>(null);
  const [contentsLoading, setContentsLoading] = useState(false);
  const [contentsError, setContentsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [install, setInstall] = useState<{
    harness: string;
    action: "install" | "uninstall";
  } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/catalog/${encodeURIComponent(packId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (alive) setEntry(data as CatalogEntry);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });

    setReadmeLoading(true);
    fetch(`/api/catalog/${encodeURIComponent(packId)}/readme`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error?.message || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data: ReadmeResponse) => {
        if (alive) setReadme(data.readme_excerpt || null);
      })
      .catch((e) => {
        if (alive) setReadmeError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setReadmeLoading(false);
      });

    setContentsLoading(true);
    fetch(`/api/catalog/${encodeURIComponent(packId)}/contents`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error?.message || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data: ContentsResponse) => {
        if (alive) setContents(Array.isArray(data.items) ? data.items : []);
      })
      .catch((e) => {
        if (alive)
          setContentsError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setContentsLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [packId]);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 overflow-auto"
    >
      <div className="w-full max-w-4xl rounded-lg border border-border bg-surface-1 shadow-xl my-8 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b border-border p-4 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-gray-50 truncate">
              {entry?.display_name || packId}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
              {entry?.category && (
                <span className="rounded bg-surface-3 text-gray-300 px-1.5 py-0.5">
                  {entry.category}
                </span>
              )}
              <span className="font-mono">{packId}</span>
              {entry?.stars != null && (
                <span>★ {formatStars(entry.stars)}</span>
              )}
              {entry?.forks != null && <span>⑂ {formatStars(entry.forks)}</span>}
              {entry?.last_release && (
                <span className="font-mono">{entry.last_release}</span>
              )}
              {entry?.verified ? (
                <span className="rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 px-1.5 py-0.5">
                  verified install
                </span>
              ) : (
                <span className="rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 px-1.5 py-0.5">
                  unverified
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {entry?.github_url && (
              <a
                href={entry.github_url}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] rounded border border-border bg-surface-2 text-gray-300 px-2 py-1 hover:bg-surface-3"
              >
                GitHub →
              </a>
            )}
            <button
              onClick={onClose}
              className="text-xs rounded border border-border bg-surface-2 px-2.5 py-1 text-gray-300 hover:bg-surface-3"
            >
              Close
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {error}
            </div>
          )}

          {entry && (
            <>
              {/* Description */}
              {(entry.description_live || entry.description) && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                    Description
                  </div>
                  <p className="text-xs text-gray-300 leading-relaxed">
                    {entry.description_live || entry.description}
                  </p>
                </div>
              )}

              {/* Install status */}
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                  Status
                </div>
                <div className="text-xs">
                  {entry.installed_harnesses.length > 0 ? (
                    <span className="rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 px-1.5 py-0.5">
                      Installed ({entry.installed_harnesses.join(", ")}) ·{" "}
                      {entry.installed_skill_count} skill
                      {entry.installed_skill_count === 1 ? "" : "s"} detected
                    </span>
                  ) : (
                    <span className="rounded bg-surface-3 text-gray-400 px-1.5 py-0.5">
                      Not installed
                    </span>
                  )}
                </div>
              </div>

              {/* Per-harness install commands */}
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                  Install
                </div>
                {entry.harnesses.length === 0 ? (
                  <p className="text-[11px] text-gray-500 italic">
                    No harnesses declared.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {entry.harnesses.map((h) => {
                      const cmd = entry.install_commands[h];
                      const uninstallCmd = entry.uninstall_commands[h];
                      const installed = entry.installed_harnesses.includes(h);
                      return (
                        <div
                          key={h}
                          className="rounded-lg border border-border bg-surface-2 p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-mono text-gray-200">
                              {h}
                            </span>
                            {cmd ? (
                              installed ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] text-emerald-300">
                                    installed
                                  </span>
                                  {uninstallCmd && (
                                    <button
                                      onClick={() =>
                                        setInstall({ harness: h, action: "uninstall" })
                                      }
                                      className="text-[10px] rounded border border-border bg-surface-3 text-gray-300 px-2 py-1 hover:bg-surface-2"
                                    >
                                      Uninstall
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <button
                                  onClick={() =>
                                    setInstall({ harness: h, action: "install" })
                                  }
                                  className="text-[10px] font-medium rounded border border-accent/40 bg-accent/10 text-accent px-2 py-1 hover:bg-accent/20"
                                >
                                  Install
                                </button>
                              )
                            ) : (
                              <span className="text-[10px] text-amber-300/70">
                                no install command
                              </span>
                            )}
                          </div>
                          {cmd ? (
                            <div className="flex items-start gap-1.5">
                              <pre className="flex-1 text-[11px] font-mono text-gray-200 bg-black/30 border border-border rounded p-2 overflow-auto whitespace-pre-wrap break-all">
                                {cmd}
                              </pre>
                              <CopyButton text={cmd} />
                            </div>
                          ) : entry.placeholder_reason ? (
                            <p className="text-[11px] text-amber-300/80 italic">
                              {entry.placeholder_reason}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
                {entry.install_notes && (
                  <p className="mt-2 text-[11px] text-gray-500 italic">
                    {entry.install_notes}
                  </p>
                )}
              </div>

              {/* Contents — pre-install skill/command/agent listing */}
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    Contents{" "}
                    {contents && contents.length > 0 && (
                      <span className="text-gray-400 normal-case font-normal">
                        ({contents.length})
                      </span>
                    )}
                  </div>
                </div>
                {contentsLoading ? (
                  <p className="text-[11px] text-gray-500 italic">
                    Loading skill list from GitHub…
                  </p>
                ) : contentsError ? (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                    Could not load contents: {contentsError}.
                  </div>
                ) : contents == null || contents.length === 0 ? (
                  <p className="text-[11px] text-gray-500 italic">
                    No skills, commands, or agents listed for this pack.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {/* Group by category if present, otherwise by kind */}
                    {(() => {
                      const groups = new Map<string, ContentsItem[]>();
                      for (const c of contents) {
                        const key = c.category || c.kind || "items";
                        if (!groups.has(key)) groups.set(key, []);
                        groups.get(key)!.push(c);
                      }
                      return [...groups.entries()].map(([group, items]) => (
                        <div key={group} className="mb-2">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                            {group}{" "}
                            <span className="text-gray-600">
                              ({items.length})
                            </span>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                            {items.map((c) => (
                              <div
                                key={`${group}-${c.name}`}
                                className="rounded border border-border bg-surface-2 px-2 py-1 text-[11px] font-mono text-gray-200 truncate"
                                title={
                                  c.description ||
                                  (c.kind === "plugin" && c.skill_count
                                    ? `plugin · ${c.skill_count} skills`
                                    : c.name)
                                }
                              >
                                {c.kind === "command" ? "/" : ""}
                                {c.name}
                                {c.kind === "plugin" &&
                                  typeof c.skill_count === "number" && (
                                    <span className="text-gray-500">
                                      {" "}
                                      · {c.skill_count} skills
                                    </span>
                                  )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </div>

              {/* README */}
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                  README
                </div>
                {readmeLoading ? (
                  <p className="text-[11px] text-gray-500 italic">
                    Loading README from GitHub…
                  </p>
                ) : readmeError ? (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                    Could not load README: {readmeError}. View it directly on{" "}
                    <a
                      href={entry.github_url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      GitHub
                    </a>
                    .
                  </div>
                ) : readme ? (
                  <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-gray-300 bg-surface-2 border border-border rounded-lg p-3 max-h-[40vh] overflow-auto font-mono">
                    {readme}
                  </pre>
                ) : (
                  <p className="text-[11px] text-gray-500 italic">
                    No README available.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {install && entry && entry.install_commands[install.harness] && (
        <InstallModal
          packId={entry.pack_id}
          packDisplayName={entry.display_name}
          harness={install.harness}
          action={install.action}
          command={
            install.action === "install"
              ? entry.install_commands[install.harness]
              : entry.uninstall_commands[install.harness]
          }
          onClose={() => setInstall(null)}
          onCompleted={() => {
            if (onAfterRun) onAfterRun();
            // Re-fetch entry so the installed badge updates
            fetch(`/api/catalog/${encodeURIComponent(packId)}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((d) => d && setEntry(d as CatalogEntry));
          }}
        />
      )}
    </div>
  );
}
