import { Badge } from "@closedloop-ai/design-system/components/ui/badge";
import { Button } from "@closedloop-ai/design-system/components/ui/button";
import { Download, ExternalLink, GitFork, Star, Trash2 } from "lucide-react";
import type { CatalogEntry } from "../../../shared/agent-db-contract";
import { DashboardCard, cx } from "../layout/page-shell";
import { Sparkline } from "./Sparkline";

export interface CatalogCardProps {
  entry: CatalogEntry;
  onInstall: (packId: string, harness: string) => void;
  onUninstall: (packId: string, harness: string) => void;
  onClick: (packId: string) => void;
  installing?: Record<string, boolean>;
}

export function CatalogCard({
  entry,
  onInstall,
  onUninstall,
  onClick,
  installing,
}: CatalogCardProps) {
  const isInstalled = entry.installedHarnesses.length > 0;
  const starHistory = entry.history?.map((h) => h.stars) ?? [];

  return (
    <DashboardCard
      className={cx(
        "cursor-pointer transition-shadow hover:shadow-md",
        isInstalled && "border-[var(--primary)]/30",
      )}
    >
      <div onClick={() => onClick(entry.packId)} className="space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold">{entry.displayName}</h3>
            {entry.category && (
              <span className="text-xs text-[var(--muted-foreground)]">{entry.category}</span>
            )}
          </div>
          {isInstalled ? (
            <Badge variant="default" className="shrink-0 text-[10px]">Installed</Badge>
          ) : (
            <Badge variant="outline" className="shrink-0 text-[10px]">Available</Badge>
          )}
        </div>

        {/* Description */}
        {entry.description && (
          <p className="line-clamp-2 text-xs text-[var(--muted-foreground)]">
            {entry.description}
          </p>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-4 text-xs text-[var(--muted-foreground)]">
          {entry.stars != null && (
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3" />
              {formatCount(entry.stars)}
            </span>
          )}
          {entry.forks != null && (
            <span className="flex items-center gap-1">
              <GitFork className="h-3 w-3" />
              {formatCount(entry.forks)}
            </span>
          )}
          {starHistory.length >= 2 && <Sparkline data={starHistory} />}
          {entry.githubUrl && (
            <a
              href={entry.githubUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="ml-auto hover:text-[var(--foreground)]"
              title="View on GitHub"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {/* Harness badges */}
        <div className="flex flex-wrap gap-1">
          {entry.harnesses.map((h) => (
            <Badge key={h} variant="outline" className="text-[10px]">{h}</Badge>
          ))}
        </div>
      </div>

      {/* Per-harness install/uninstall buttons */}
      <div
        className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border)] pt-3"
        onClick={(e) => e.stopPropagation()}
      >
        {entry.harnesses.map((harness) => {
          const installed = entry.installedHarnesses.includes(harness);
          const busy = installing?.[`${entry.packId}:${harness}`] ?? false;

          return installed ? (
            <Button
              key={harness}
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onUninstall(entry.packId, harness)}
              className="h-7 gap-1 text-xs"
            >
              <Trash2 className="h-3 w-3" />
              {busy ? "..." : `Uninstall (${harness})`}
            </Button>
          ) : (
            <Button
              key={harness}
              variant="default"
              size="sm"
              disabled={busy || !!entry.placeholderReason}
              onClick={() => onInstall(entry.packId, harness)}
              className="h-7 gap-1 text-xs"
              title={entry.placeholderReason ?? undefined}
            >
              <Download className="h-3 w-3" />
              {busy ? "..." : `Install (${harness})`}
            </Button>
          );
        })}
      </div>
    </DashboardCard>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
