/**
 * @file CatalogCard.tsx — single pack card for the Catalog tab (FEA-1314).
 * Renders display name, category, star count + sparkline, description,
 * installed/not-installed status, per-harness install buttons, and a
 * GitHub link.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkline } from "./Sparkline";
import { InstallModal } from "./InstallModal";

export interface CatalogEntry {
  pack_id: string;
  display_name: string;
  category: string | null;
  github_url: string;
  /** Optional secondary catalog/marketplace listing (e.g. anthropics/claude-plugins-official).
   *  When set, the UI renders a faint "Marketplace →" link next to the primary "GitHub →". */
  marketplace_url: string | null;
  description: string | null;
  description_live: string | null;
  harnesses: string[];
  install_commands: Record<string, string>;
  uninstall_commands: Record<string, string>;
  install_notes: string | null;
  placeholder_reason: string | null;
  verified?: number;
  stars: number | null;
  forks: number | null;
  last_release: string | null;
  last_fetched_at: string | null;
  /** When 1, one install satisfies ALL harnesses in `harnesses` (e.g. RTK:
   *  brew binary on PATH used by both claude and codex). UI collapses the
   *  per-harness install buttons into one "Install" button. */
  harness_agnostic?: number;
  /** When 1, install command operates on the current working directory
   *  (e.g. BMad's `--directory .`). UI switches to a copy-command flow so
   *  the user can run the interactive installer in their own terminal. */
  project_scoped?: number;
  /** When 1, ONE install command sets up all detected harnesses in one run
   *  (e.g. gstack's codex command is a superset of its claude command). UI
   *  shows ONE Install button; server detects which CLIs are installed and
   *  picks the right command. */
  single_install?: number;
  /** Optional required-or-recommended next-steps block popped by the install
   *  modal after a successful install. Used for packs that install OK but
   *  need configuration before they're functional (Claude Code Router needs
   *  provider keys; context7 optionally needs an Upstash key). */
  post_install?: {
    title: string;
    body: string;
    copy_command?: string;
    url?: string;
    required?: boolean;
  } | null;
  installed_harnesses: string[];
  installed_skill_count: number;
  /** ISO timestamp of the most recent tombstone — set when at least one
   *  install row exists with uninstalled_at IS NOT NULL and no current install
   *  is active. Drives the amber "Previously installed" badge. */
  uninstalled_at?: string | null;
  /** Retroactive usage stats derived by joining `agent_packs.install_path`
   *  against `events.data`. Surfaces gstack/bmad/etc. activity that already
   *  lives in the events table even when the pack is uninstalled. */
  usage?: {
    tool_calls: number;
    sessions: number;
    first_used_at: string | null;
    last_used_at: string | null;
  } | null;
  history?: Array<{ fetched_at: string; stars: number | null; forks: number | null }>;
}

interface CatalogCardProps {
  pack: CatalogEntry;
  /** Optional star history for sparkline; falls back to entry.history if present. */
  history?: Array<{ stars: number | null }>;
  onAfterRun?: () => void;
}

function formatStars(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Relative-time formatter for "last used" / "uninstalled" badges. */
function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "";
  const days = Math.floor(ms / 86400000);
  if (days >= 30) {
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  }
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(ms / 3600000);
  if (hours >= 1) return `${hours}h ago`;
  return "just now";
}

export function CatalogCard({ pack, history, onAfterRun }: CatalogCardProps) {
  const navigate = useNavigate();
  const [modal, setModal] = useState<{
    harness: string;
    action: "install" | "uninstall";
  } | null>(null);

  const isInstalled = pack.installed_harnesses.length > 0;
  const goToDetail = () => navigate(`/packs/${encodeURIComponent(pack.pack_id)}`);
  const desc = pack.description_live || pack.description || "";
  const stars =
    (history && history.length > 0
      ? history.map((h) => h.stars)
      : (pack.history || []).map((h) => h.stars)) || [];

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-4 flex flex-col gap-3 min-h-[14rem] hover:border-accent/30 transition-colors">
      <button
        onClick={goToDetail}
        className="text-left flex items-start justify-between gap-2 group"
        aria-label={`Open ${pack.display_name} details`}
      >
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-100 truncate group-hover:text-accent">
            {pack.display_name}
          </h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500">
            {pack.category && (
              <span className="rounded bg-surface-3 text-gray-300 px-1.5 py-0.5">
                {pack.category}
              </span>
            )}
            <span className="font-mono">{pack.pack_id}</span>
            {pack.last_release && (
              <span className="font-mono">· {pack.last_release}</span>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-lg font-semibold text-gray-100 leading-none">
            ★ {formatStars(pack.stars)}
          </div>
          <div className="text-amber-300/70 mt-0.5">
            <Sparkline values={stars} width={64} height={14} />
          </div>
        </div>
      </button>

      {desc && (
        <p className="text-[11px] text-gray-400 line-clamp-3">{desc}</p>
      )}

      {pack.placeholder_reason && (
        <div className="text-[10px] text-amber-300/80 italic">
          {pack.placeholder_reason}
        </div>
      )}

      <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
        {isInstalled ? (
          <span className="rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 px-1.5 py-0.5">
            Installed ({pack.installed_harnesses.join(", ")})
          </span>
        ) : pack.uninstalled_at ? (
          <span
            className="rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 px-1.5 py-0.5"
            title={`Last installed copy was uninstalled ${new Date(pack.uninstalled_at).toLocaleString()}`}
          >
            Previously installed · uninstalled {formatRelative(pack.uninstalled_at)}
          </span>
        ) : (
          <span className="rounded bg-surface-3 text-gray-400 px-1.5 py-0.5">
            Not installed
          </span>
        )}
        {pack.installed_skill_count > 0 && (
          <span className="text-gray-500">
            · {pack.installed_skill_count} skill
            {pack.installed_skill_count === 1 ? "" : "s"}
          </span>
        )}
        {pack.usage && pack.usage.tool_calls > 0 && (
          <span
            className="text-gray-500"
            title={`${pack.usage.tool_calls} tool calls across ${pack.usage.sessions} session${pack.usage.sessions === 1 ? "" : "s"}; first ${pack.usage.first_used_at?.slice(0, 10)}, last ${pack.usage.last_used_at?.slice(0, 10)}`}
          >
            · used {pack.usage.tool_calls}× · last {formatRelative(pack.usage.last_used_at)}
          </span>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2 border-t border-border">
        {/* Collapse the per-harness button set into ONE button for:
            - `harness_agnostic` packs (RTK et al — one binary, all harnesses)
            - `single_install` packs (gstack — one command, server picks)
            For single_install we use the special "auto" harness sentinel that
            the orchestrator unpacks into "install for all detected CLIs". */}
        {(pack.harness_agnostic === 1 || pack.single_install === 1) &&
        pack.harnesses.length > 0
          ? (() => {
              const isSingleInstall = pack.single_install === 1;
              const harnessForCommand = isSingleInstall
                ? "auto"
                : pack.harnesses.find((h) => pack.install_commands[h]) ||
                  pack.harnesses[0];
              const firstHarness =
                pack.harnesses.find((h) => pack.install_commands[h]) ||
                pack.harnesses[0];
              const cmd = pack.install_commands[firstHarness];
              // For single_install/harness_agnostic packs, the user model is
              // "one install satisfies all harnesses". If ANY harness shows
              // installed (even from a legacy per-harness install), treat the
              // pack as installed — show Uninstall. Otherwise the card lights
              // up the green "Installed" badge but also presents an Install
              // button, which contradicts itself. (v0.15.56 fix.)
              const anyInstalled = pack.harnesses.some((h) =>
                pack.installed_harnesses.includes(h),
              );
              const tooltipPrefix = isSingleInstall
                ? `One install for all detected harnesses (${pack.harnesses.join(", ")})`
                : `One install registers for ${pack.harnesses.join(", ")} — this is a harness-agnostic CLI tool.`;
              if (!cmd) {
                return (
                  <a
                    href={pack.github_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] rounded border border-border bg-surface-3 text-gray-400 px-2 py-1 hover:bg-surface-2"
                    title="No install command in catalog seed — open the repo for instructions"
                  >
                    see repo
                  </a>
                );
              }
              if (anyInstalled) {
                const uninstall = pack.uninstall_commands[firstHarness];
                return (
                  <button
                    onClick={() =>
                      uninstall &&
                      setModal({
                        harness: harnessForCommand,
                        action: "uninstall",
                      })
                    }
                    disabled={!uninstall}
                    className="text-[10px] rounded border border-border bg-surface-3 text-gray-300 px-2 py-1 hover:bg-surface-2 disabled:opacity-50"
                    title={
                      uninstall
                        ? `Uninstall ${pack.display_name} (removes for all harnesses)`
                        : "No uninstall command in catalog seed"
                    }
                  >
                    Uninstall
                  </button>
                );
              }
              return (
                <button
                  onClick={() =>
                    setModal({ harness: harnessForCommand, action: "install" })
                  }
                  className="text-[10px] font-medium rounded border border-accent/40 bg-accent/10 text-accent px-2 py-1 hover:bg-accent/20"
                  title={tooltipPrefix}
                >
                  Install
                </button>
              );
            })()
          : pack.harnesses.map((h) => {
              const cmd = pack.install_commands[h];
              const installed = pack.installed_harnesses.includes(h);
              if (!cmd) {
                return (
                  <a
                    key={h}
                    href={pack.github_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] rounded border border-border bg-surface-3 text-gray-400 px-2 py-1 hover:bg-surface-2"
                    title="No install command in catalog seed — open the repo for instructions"
                  >
                    {h}: see repo
                  </a>
                );
              }
              if (installed) {
                const uninstall = pack.uninstall_commands[h];
                return (
                  <button
                    key={h}
                    onClick={() =>
                      uninstall && setModal({ harness: h, action: "uninstall" })
                    }
                    disabled={!uninstall}
                    className="text-[10px] rounded border border-border bg-surface-3 text-gray-300 px-2 py-1 hover:bg-surface-2 disabled:opacity-50"
                    title={
                      uninstall
                        ? `Uninstall ${pack.display_name} for ${h}`
                        : "No uninstall command in catalog seed"
                    }
                  >
                    Uninstall ({h})
                  </button>
                );
              }
              return (
                <button
                  key={h}
                  onClick={() => setModal({ harness: h, action: "install" })}
                  className="text-[10px] font-medium rounded border border-accent/40 bg-accent/10 text-accent px-2 py-1 hover:bg-accent/20"
                >
                  Install ({h})
                </button>
              );
            })}
        <div className="ml-auto flex items-center gap-1.5">
          {/* GitHub is always the primary link — it points at the actual source
              location (a subdirectory for marketplace plugins, a repo root
              otherwise). The optional Marketplace link points at the parent
              registry, rendered as a faint secondary. */}
          <a
            href={pack.github_url}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-gray-300 hover:text-gray-100"
            title="GitHub source"
          >
            GitHub →
          </a>
          {pack.marketplace_url && (
            <a
              href={pack.marketplace_url}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-gray-500 hover:text-gray-300"
              title="Marketplace listing"
            >
              Marketplace →
            </a>
          )}
        </div>
      </div>

      {modal &&
        (() => {
          // Resolve the command to PREVIEW in the modal. For most packs this
          // is just install_commands[harness]. For single_install packs, the
          // client uses the "auto" sentinel that the server resolves at run-
          // time — but the modal still needs SOMETHING to show. Pick the
          // codex variant when both exist (by convention codex is a superset
          // of claude for these packs); fall back to the first available
          // command. The server picks the actual command to run based on
          // detected CLIs, so the preview may differ slightly from what
          // executes — that's noted in the modal copy.
          //
          // INSTALL vs UNINSTALL differ for single_install packs:
          //  - install:   server picks one SUPERSET command (codex variant
          //               is a superset of claude). Preview = codex command.
          //  - uninstall: server JOINS all uninstall commands with `;` (they
          //               are disjoint cleanups; one is not a superset of
          //               the other). Preview = same joined string so the
          //               user sees what's about to actually run.
          const cmdMap =
            modal.action === "install"
              ? pack.install_commands
              : pack.uninstall_commands;
          let previewCommand: string;
          if (modal.harness === "auto") {
            if (modal.action === "uninstall") {
              previewCommand = pack.harnesses
                .map((h) => cmdMap[h])
                .filter((c): c is string => Boolean(c))
                .join(" ; ");
            } else {
              previewCommand =
                cmdMap["codex"] ||
                cmdMap["claude"] ||
                Object.values(cmdMap)[0] ||
                "";
            }
          } else {
            previewCommand = cmdMap[modal.harness] || "";
          }
          return (
            <InstallModal
              packId={pack.pack_id}
              packDisplayName={pack.display_name}
              harness={modal.harness}
              action={modal.action}
              command={previewCommand}
              commandIsAutoDetect={modal.harness === "auto"}
              projectScoped={pack.project_scoped === 1}
              postInstall={pack.post_install || null}
              onClose={() => setModal(null)}
              onCompleted={() => {
                if (onAfterRun) onAfterRun();
              }}
            />
          );
        })()}
    </div>
  );
}
