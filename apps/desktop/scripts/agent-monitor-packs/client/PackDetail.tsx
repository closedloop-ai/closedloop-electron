/**
 * @file PackDetail.tsx — full-page pack detail view (FEA-1314 v4).
 *
 * Replaces the v3 CatalogDetail modal. Rendered at the `/packs/:packId`
 * route — clicking a card on the Packs page navigates here rather than
 * opening a modal overlay. Same content layout as v3 (description,
 * status, install commands, contents listing, README) plus a "Back to
 * Packs" link in the header.
 *
 * For installed packs, also surfaces the on-disk inventory (real install
 * rows + actually-detected skills) by joining the catalog contents with
 * the pack-scanner's agent_packs/skills tables via /api/packs/:pack_id.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { CatalogEntry } from "./CatalogCard";
import { InstallModal } from "./InstallModal";
import {
  resolvePackModalHarness,
  resolvePackPreviewCommand,
  usesAutoDetectedInstallCommand,
} from "./PackInstallModalUtils";

interface ReadmeResponse {
  pack_id: string;
  readme_excerpt: string;
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
}

interface InstalledInstall {
  pack_id: string;
  harness: string;
  install_path: string;
  install_kind: "symlink" | "directory";
  source_url: string | null;
  version: string | null;
}

interface InstalledSkill {
  skill_id: string;
  name: string;
  harness: string;
  install_path: string;
  description: string | null;
}

interface SessionUsageRow {
  session_id: string;
  session_name: string | null;
  session_cwd: string | null;
  session_harness: string;
  session_model: string | null;
  session_started_at: string | null;
  tool_calls: number;
  first_used_at: string;
  last_used_at: string;
}

interface SessionUsageResponse {
  items: SessionUsageRow[];
  total: number;
}

interface InstalledDetail {
  pack_id: string;
  version: string | null;
  harnesses: string[];
  installs: InstalledInstall[];
  skills: InstalledSkill[];
}

function formatRelativeShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  const days = Math.floor(ms / 86400000);
  if (days >= 30) return `${Math.floor(days / 30)}mo`;
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(ms / 3600000);
  if (hours >= 1) return `${hours}h`;
  const mins = Math.floor(ms / 60000);
  if (mins >= 1) return `${mins}m`;
  return "now";
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

export function PackDetail() {
  const navigate = useNavigate();
  const { packId } = useParams<{ packId: string }>();
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [readme, setReadme] = useState<string | null>(null);
  const [readmeError, setReadmeError] = useState<string | null>(null);
  const [readmeLoading, setReadmeLoading] = useState(false);
  const [contents, setContents] = useState<ContentsItem[] | null>(null);
  const [contentsLoading, setContentsLoading] = useState(false);
  const [contentsError, setContentsError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<InstalledDetail | null>(null);
  const [sessions, setSessions] = useState<SessionUsageRow[] | null>(null);
  const [sessionsTotal, setSessionsTotal] = useState(0);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsLimit, setSessionsLimit] = useState(25);

  const [error, setError] = useState<string | null>(null);
  const [installModal, setInstallModal] = useState<{
    harness: string;
    action: "install" | "uninstall";
  } | null>(null);

  // Derived install-modal state. MUST be declared AFTER the `installModal`
  // useState above: referencing `installModal` before its declaration hits the
  // temporal dead zone and throws a render-time ReferenceError. Because Vite/
  // esbuild only strips types (no type-check) and this client is outside the
  // desktop tsconfig, tsc never flags it — so the crash only shows at runtime,
  // blanking the whole embedded app once the catalog fetch makes `entry` truthy.
  const resolvedInstallModal = entry && installModal
    ? (() => {
        const harness = resolvePackModalHarness(entry, installModal.harness, installModal.action);
        const command = resolvePackPreviewCommand(entry, harness, installModal.action);
        if (!command) return null;
        return {
          harness,
          action: installModal.action,
          command,
          commandIsAutoDetect: usesAutoDetectedInstallCommand(harness, installModal.action),
        };
      })()
    : null;

  const loadEntry = useCallback(async () => {
    if (!packId) return;
    try {
      const res = await fetch(`/api/catalog/${encodeURIComponent(packId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEntry((await res.json()) as CatalogEntry);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [packId]);

  const loadInstalled = useCallback(async () => {
    if (!packId) return;
    try {
      const res = await fetch(`/api/packs/${encodeURIComponent(packId)}`);
      if (res.status === 404) {
        setInstalled(null);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setInstalled((await res.json()) as InstalledDetail);
    } catch {
      setInstalled(null);
    }
  }, [packId]);

  const loadReadme = useCallback(async () => {
    if (!packId) return;
    setReadmeLoading(true);
    try {
      const res = await fetch(`/api/catalog/${encodeURIComponent(packId)}/readme`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || `HTTP ${res.status}`);
      }
      const data: ReadmeResponse = await res.json();
      setReadme(data.readme_excerpt || null);
    } catch (e) {
      setReadmeError(e instanceof Error ? e.message : String(e));
    } finally {
      setReadmeLoading(false);
    }
  }, [packId]);

  const loadContents = useCallback(async () => {
    if (!packId) return;
    setContentsLoading(true);
    try {
      const res = await fetch(
        `/api/catalog/${encodeURIComponent(packId)}/contents`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || `HTTP ${res.status}`);
      }
      const data: ContentsResponse = await res.json();
      setContents(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setContentsError(e instanceof Error ? e.message : String(e));
    } finally {
      setContentsLoading(false);
    }
  }, [packId]);

  const loadSessions = useCallback(async () => {
    if (!packId) return;
    setSessionsLoading(true);
    try {
      const res = await fetch(
        `/api/packs/${encodeURIComponent(packId)}/sessions?limit=${sessionsLimit}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as SessionUsageResponse;
      setSessions(Array.isArray(data.items) ? data.items : []);
      setSessionsTotal(typeof data.total === "number" ? data.total : 0);
    } catch {
      setSessions([]);
      setSessionsTotal(0);
    } finally {
      setSessionsLoading(false);
    }
  }, [packId, sessionsLimit]);

  useEffect(() => {
    loadEntry();
    loadInstalled();
    loadReadme();
    loadContents();
    loadSessions();
  }, [loadEntry, loadInstalled, loadReadme, loadContents, loadSessions]);

  if (!packId) return null;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-3">
        <button
          onClick={() => navigate("/packs")}
          className="text-xs text-gray-400 hover:text-gray-200"
        >
          ← Back to Packs
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      )}

      {entry && (
        <>
          {/* Header */}
          <div className="mb-6 flex items-start justify-between gap-3 border-b border-border pb-4">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-gray-50">
                {entry.display_name}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                {entry.category && (
                  <span className="rounded bg-surface-3 text-gray-300 px-1.5 py-0.5">
                    {entry.category}
                  </span>
                )}
                <span className="font-mono">{entry.pack_id}</span>
                {entry.stars != null && (
                  <span>★ {formatStars(entry.stars)}</span>
                )}
                {entry.forks != null && (
                  <span>⑂ {formatStars(entry.forks)}</span>
                )}
                {entry.last_release && (
                  <span className="font-mono">{entry.last_release}</span>
                )}
                {entry.verified ? (
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
            {/* GitHub is always the primary link — it points at the actual
                source location (subdirectory for marketplace plugins, repo
                root otherwise). marketplace_url renders as a secondary if set. */}
            {entry.github_url && (
              <a
                href={entry.github_url}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] rounded border border-accent/40 bg-accent/10 text-accent px-2.5 py-1 hover:bg-accent/20 flex-shrink-0"
                title="GitHub source"
              >
                GitHub →
              </a>
            )}
            {entry.marketplace_url && (
              <a
                href={entry.marketplace_url}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] rounded border border-border bg-surface-2 text-gray-400 px-2.5 py-1 hover:bg-surface-3 flex-shrink-0"
                title="Marketplace listing"
              >
                Marketplace →
              </a>
            )}
          </div>

          {/* Body */}
          <div className="space-y-5">
            {/* Description */}
            {(entry.description_live || entry.description) && (
              <section>
                <p className="text-sm text-gray-300 leading-relaxed">
                  {entry.description_live || entry.description}
                </p>
              </section>
            )}

            {/* Status */}
            <section>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
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
            </section>

            {/* Install commands */}
            <section>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
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
                    const isInstalled = entry.installed_harnesses.includes(h);
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
                            isInstalled ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-emerald-300">
                                  installed
                                </span>
                                {uninstallCmd && (
                                  <button
                                    onClick={() =>
                                      setInstallModal({
                                        harness: resolvePackModalHarness(entry, h, "uninstall"),
                                        action: "uninstall",
                                      })
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
                                  setInstallModal({
                                    harness: h,
                                    action: "install",
                                  })
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
            </section>

            {/* Installed inventory (only when installed) */}
            {installed && installed.installs.length > 0 && (
              <section>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                  Installed inventory · {installed.installs.length} install
                  {installed.installs.length === 1 ? "" : "s"}
                </div>
                <div className="space-y-1">
                  {installed.installs.map((i) => (
                    <div
                      key={`${i.harness}|${i.install_path}`}
                      className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-gray-200">
                          {i.harness}
                          {i.version && (
                            <span className="ml-1.5 text-[10px] text-gray-400">
                              v{i.version}
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] font-mono text-gray-500">
                          {i.install_kind}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-gray-400 truncate mt-0.5">
                        {i.install_path}
                      </div>
                    </div>
                  ))}
                </div>
                {installed.skills.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                      Detected on disk · {installed.skills.length}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                      {installed.skills.map((s) => (
                        <div
                          key={s.skill_id}
                          className="rounded border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 text-[11px] font-mono text-gray-200 truncate"
                          title={s.description || s.name}
                        >
                          /{s.name}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Per-session usage history (FEA-1314 v8). Sourced retroactively
                from the events table — works for currently-installed AND
                tombstoned packs, as long as a session ever touched a path
                in the pack's detection_patterns set. */}
            <section>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                Used in sessions
                {sessions && sessions.length > 0 && (
                  <span className="ml-1 text-gray-400 normal-case font-normal">
                    ({sessionsTotal === sessions.length
                      ? sessionsTotal
                      : `showing ${sessions.length} of ${sessionsTotal}`}
                    )
                  </span>
                )}
              </div>
              {sessionsLoading && !sessions ? (
                <div className="text-[11px] text-gray-500 italic">Loading…</div>
              ) : !sessions || sessions.length === 0 ? (
                <div className="text-[11px] text-gray-500 italic">
                  No session usage detected for this pack yet. Sessions appear
                  here once any tool call touches the pack's files (install
                  dir, plugin cache, or known per-project paths like{" "}
                  <code className="font-mono">_bmad/</code> /{" "}
                  <code className="font-mono">.gstack/</code>).
                </div>
              ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead className="bg-surface-3 text-[10px] uppercase tracking-wide text-gray-400">
                      <tr>
                        <th className="text-left px-2.5 py-1.5 font-medium">Session</th>
                        <th className="text-left px-2.5 py-1.5 font-medium">When</th>
                        <th className="text-left px-2.5 py-1.5 font-medium">Project</th>
                        <th className="text-left px-2.5 py-1.5 font-medium">Harness · Model</th>
                        <th className="text-right px-2.5 py-1.5 font-medium">Tool calls</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {sessions.map((s) => {
                        const project = s.session_cwd
                          ? s.session_cwd.split("/").filter(Boolean).slice(-1)[0]
                          : "—";
                        const when = formatRelativeShort(s.last_used_at);
                        return (
                          <tr
                            key={s.session_id}
                            className="hover:bg-surface-3/50 cursor-pointer"
                            onClick={() => navigate(`/sessions/${s.session_id}`)}
                            title={`Click to open session\nLast used: ${new Date(s.last_used_at).toLocaleString()}\nStarted: ${s.session_started_at ? new Date(s.session_started_at).toLocaleString() : "unknown"}`}
                          >
                            <td className="px-2.5 py-1.5 font-mono text-gray-200 truncate max-w-[18rem]">
                              {s.session_name || s.session_id.slice(0, 8)}
                            </td>
                            <td className="px-2.5 py-1.5 text-gray-400 whitespace-nowrap">
                              {when}
                            </td>
                            <td
                              className="px-2.5 py-1.5 font-mono text-gray-400 truncate max-w-[12rem]"
                              title={s.session_cwd || ""}
                            >
                              {project}
                            </td>
                            <td className="px-2.5 py-1.5 text-gray-400 truncate max-w-[12rem]">
                              <span className="font-mono">{s.session_harness}</span>
                              {s.session_model && (
                                <span className="text-gray-500"> · {s.session_model}</span>
                              )}
                            </td>
                            <td className="px-2.5 py-1.5 text-right font-mono text-gray-200">
                              {s.tool_calls}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {sessionsTotal > sessions.length && (
                    <div className="bg-surface-3/30 px-2.5 py-1.5 text-center">
                      <button
                        onClick={() => setSessionsLimit(sessionsLimit + 25)}
                        className="text-[11px] text-gray-400 hover:text-gray-200"
                      >
                        Show {Math.min(25, sessionsTotal - sessions.length)} more →
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Contents — pre-install or catalog listing */}
            <section>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                Contents
                {contents && contents.length > 0 && (
                  <span className="ml-1 text-gray-400 normal-case font-normal">
                    ({contents.length}, from GitHub)
                  </span>
                )}
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
                (() => {
                  const groups = new Map<string, ContentsItem[]>();
                  for (const c of contents) {
                    const key = c.category || c.kind || "items";
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key)!.push(c);
                  }
                  return [...groups.entries()].map(([group, items]) => (
                    <div key={group} className="mb-3">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                        {group}{" "}
                        <span className="text-gray-600">({items.length})</span>
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
                })()
              )}
            </section>

            {/* README */}
            <section>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
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
                <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-gray-300 bg-surface-2 border border-border rounded-lg p-3 max-h-[50vh] overflow-auto font-mono">
                  {readme}
                </pre>
              ) : (
                <p className="text-[11px] text-gray-500 italic">
                  No README available.
                </p>
              )}
            </section>
          </div>
        </>
      )}

      {resolvedInstallModal && entry && (
        <InstallModal
          packId={entry.pack_id}
          packDisplayName={entry.display_name}
          harness={resolvedInstallModal.harness}
          action={resolvedInstallModal.action}
          command={resolvedInstallModal.command}
          commandIsAutoDetect={resolvedInstallModal.commandIsAutoDetect}
          projectScoped={entry.project_scoped === 1}
          onClose={() => setInstallModal(null)}
          onCompleted={() => {
            loadEntry();
            loadInstalled();
          }}
        />
      )}
    </div>
  );
}
