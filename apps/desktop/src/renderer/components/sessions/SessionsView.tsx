import { useEffect, useState } from "react";
import { Button } from "@closedloop-ai/design-system/components/ui/button";
import { MetricCard } from "@closedloop-ai/design-system/components/ui/primitives/metric-card";
import { SessionTable } from "@closedloop-ai/design-system/components/ui/composites/session-table";
import { MonitorDot, Activity, Bot, Coins } from "lucide-react";
import { useQueryCache } from "../../hooks/useQueryCache";
import type { SessionRow } from "@closedloop-ai/design-system/components/ui/types";
import type { DashboardSummary, SessionPage, SessionWithAgents } from "../../../shared/agent-db-contract";

const OVERVIEW_CARD_CLASS_NAME =
  "min-h-0 gap-0 rounded-xl border-border/70 bg-card shadow-sm [&>div:first-child]:px-5 [&>div:first-child]:pt-4 [&>div:first-child]:pb-2 [&_[data-slot='card-description']]:text-[10px] [&_[data-slot='card-title']]:text-[1.75rem] [&>div:last-child]:px-5 [&>div:last-child]:pb-4 [&>div:last-child]:text-xs";

function adaptSession(raw: SessionWithAgents): SessionRow {
  return {
    id: raw.id,
    name: raw.name ?? "Unnamed Session",
    repo: raw.cwd ?? "",
    model: raw.model ?? "",
    harness: raw.harness ?? "claude",
    status: raw.status,
    startedAt: raw.startedAt ?? "",
    lastActivity: raw.updatedAt ?? raw.startedAt ?? "",
    cost: 0,
    agents: raw.agentCount,
    totalTokens: raw.totalTokens,
    awaitingInputSince: raw.awaitingInputSince,
  };
}

const STATUS_OPTIONS = ["all", "active", "waiting", "completed", "abandoned", "error"] as const;
const PAGE_SIZE = 25;

interface SessionsViewProps {
  showOverview?: boolean;
}

export function SessionsView({ showOverview = true }: SessionsViewProps) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: summary } = useQueryCache<DashboardSummary>(
    "db:summary",
    () => window.desktopApi.db.getDashboardSummary(),
  );
  const { data: sessionPage, loading } = useQueryCache<SessionPage>(
    `db:sessions-page:${page}:${statusFilter}:${debouncedSearch}`,
    () => window.desktopApi.db.getSessionsPage({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      status: statusFilter === "all" ? undefined : statusFilter,
      q: debouncedSearch || undefined,
    }),
  );

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, statusFilter]);

  const sessions = sessionPage?.sessions ?? [];
  const total = sessionPage?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-[var(--muted-foreground)]">Loading sessions...</p>
      </div>
    );
  }

  return (
    <div className={showOverview ? "mx-auto flex w-full max-w-[1500px] flex-col gap-6 p-6" : "flex flex-col gap-5"}>
      {showOverview ? (
        <>
          <div className="space-y-1">
            <h1 className="text-[1.75rem] font-semibold tracking-tight text-[var(--foreground)]">Sessions</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              All agent sessions ({summary?.totalSessions ?? total} total)
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard className={OVERVIEW_CARD_CLASS_NAME} label="Total Sessions" value={summary?.totalSessions ?? total} icon={MonitorDot} />
            <MetricCard className={OVERVIEW_CARD_CLASS_NAME} label="Active" value={summary?.activeSessions ?? 0} icon={Activity} />
            <MetricCard className={OVERVIEW_CARD_CLASS_NAME} label="Agents" value={summary?.totalAgents ?? 0} icon={Bot} />
            <MetricCard className={OVERVIEW_CARD_CLASS_NAME} label="Tokens" value={(summary?.totalTokens ?? 0).toLocaleString()} icon={Coins} />
          </div>
        </>
      ) : null}

      <section className="rounded-[1.25rem] border border-border/80 bg-card/96 shadow-sm">
        <div className="flex flex-col gap-4 border-b border-border/70 px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight text-[var(--foreground)]">Session Explorer</h2>
            <p className="text-sm text-[var(--muted-foreground)]">
              Search, filter, and drill into recorded loops and agent runs.
            </p>
          </div>
          <div className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            {from.toLocaleString()}-{to.toLocaleString()} of {total.toLocaleString()} shown
          </div>
        </div>

        <div className="flex flex-col gap-3 px-5 py-4 xl:flex-row xl:items-center">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sessions..."
          className="h-11 flex-1 rounded-xl border border-[var(--input-border)] bg-[var(--background)] px-4 text-sm text-[var(--foreground)] shadow-sm placeholder:text-[var(--muted-foreground)]"
        />
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
              className="min-w-[5.5rem] rounded-full"
            >
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </Button>
          ))}
        </div>
        </div>

        <div className="px-3 pb-3">
          <div className="overflow-hidden rounded-2xl border border-border/70 bg-[var(--background)]">
            <SessionTable
              rows={sessions.map(adaptSession)}
              getSessionHref={(row: SessionRow) => `#tab=dashboard&sessionId=${encodeURIComponent(row.id)}`}
              emptyState={
                <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">
                  {search || statusFilter !== "all"
                    ? "No sessions match the current filters."
                    : "No sessions recorded yet."}
                </div>
              }
            />
          </div>
          {totalPages > 1 ? (
            <div className="flex items-center justify-between px-2 pt-3 text-xs text-[var(--muted-foreground)]">
              <span>
                Page {page + 1} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                  disabled={page === 0}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
                  disabled={page >= totalPages - 1}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
