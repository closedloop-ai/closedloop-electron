import { useEffect, useState } from "react";
import { Button } from "@closedloop-ai/design-system/components/ui/button";
import { Input } from "@closedloop-ai/design-system/components/ui/input";
import { MetricCard } from "@closedloop-ai/design-system/components/ui/primitives/metric-card";
import { SessionTable } from "@closedloop-ai/design-system/components/ui/composites/session-table";
import { MonitorDot, Activity, Bot, Coins } from "lucide-react";
import { useQueryCache } from "../../hooks/useQueryCache";
import type { SessionRow } from "@closedloop-ai/design-system/components/ui/types";
import type { DashboardSummary, SessionPage, SessionWithAgents } from "../../../shared/agent-db-contract";
import {
  DASHBOARD_GRID_CLASS_NAME,
  DASHBOARD_METRIC_CARD_CLASS_NAME,
  DashboardCard,
  LoadingState,
  PageShell,
} from "../layout/page-shell";

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
    return <LoadingState label="sessions" />;
  }

  const content = (
    <>
      {showOverview ? (
        <div className={DASHBOARD_GRID_CLASS_NAME}>
          <MetricCard className={DASHBOARD_METRIC_CARD_CLASS_NAME} label="Total Sessions" value={summary?.totalSessions ?? total} icon={MonitorDot} />
          <MetricCard className={DASHBOARD_METRIC_CARD_CLASS_NAME} label="Active" value={summary?.activeSessions ?? 0} icon={Activity} />
          <MetricCard className={DASHBOARD_METRIC_CARD_CLASS_NAME} label="Agents" value={summary?.totalAgents ?? 0} icon={Bot} />
          <MetricCard className={DASHBOARD_METRIC_CARD_CLASS_NAME} label="Tokens" value={(summary?.totalTokens ?? 0).toLocaleString()} icon={Coins} />
        </div>
      ) : null}

      <DashboardCard
        title="Session Explorer"
        description="Search, filter, and drill into recorded loops and agent runs."
        contentClassName="p-0"
      >
        <div className="flex flex-col gap-3 px-5 py-4 xl:flex-row xl:items-center">
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions..."
            className="h-11 flex-1 rounded-xl bg-[var(--background)]"
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
          <div className="shrink-0 text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            {from.toLocaleString()}-{to.toLocaleString()} of {total.toLocaleString()}
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
      </DashboardCard>
    </>
  );

  if (!showOverview) {
    return <div className="flex flex-col gap-5">{content}</div>;
  }

  return (
    <PageShell
      title="Sessions"
      description={`All agent sessions (${summary?.totalSessions ?? total} total)`}
    >
      {content}
    </PageShell>
  );
}
