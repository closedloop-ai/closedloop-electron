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
  upstream_github_url: string | null;
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
  installed_harnesses: string[];
  installed_skill_count: number;
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

      <div className="flex items-center gap-1.5 text-[10px]">
        {isInstalled ? (
          <span className="rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 px-1.5 py-0.5">
            Installed ({pack.installed_harnesses.join(", ")})
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
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2 border-t border-border">
        {pack.harnesses.map((h) => {
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
                onClick={() => uninstall && setModal({ harness: h, action: "uninstall" })}
                disabled={!uninstall}
                className="text-[10px] rounded border border-border bg-surface-3 text-gray-300 px-2 py-1 hover:bg-surface-2 disabled:opacity-50"
                title={uninstall ? `Uninstall ${pack.display_name} for ${h}` : "No uninstall command in catalog seed"}
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
          {pack.upstream_github_url && (
            <a
              href={pack.upstream_github_url}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-gray-500 hover:text-gray-300"
              title="Upstream source repo"
            >
              Source →
            </a>
          )}
          <a
            href={pack.github_url}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-gray-500 hover:text-gray-300"
            title={
              pack.upstream_github_url
                ? "Marketplace entry"
                : "GitHub repo"
            }
          >
            {pack.upstream_github_url ? "Marketplace →" : "GitHub →"}
          </a>
        </div>
      </div>

      {modal && (
        <InstallModal
          packId={pack.pack_id}
          packDisplayName={pack.display_name}
          harness={modal.harness}
          action={modal.action}
          command={
            modal.action === "install"
              ? pack.install_commands[modal.harness]
              : pack.uninstall_commands[modal.harness]
          }
          onClose={() => setModal(null)}
          onCompleted={() => {
            if (onAfterRun) onAfterRun();
          }}
        />
      )}
    </div>
  );
}
