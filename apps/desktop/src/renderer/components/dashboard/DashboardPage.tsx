import { MetricCard } from "@closedloop-ai/design-system/components/ui/primitives/metric-card";
import { MonitorDot, Bot, Zap, Layers } from "lucide-react";
import { useQueryCache } from "../../hooks/useQueryCache";
import { SessionsView } from "../sessions/SessionsView";
import type { DashboardSummary } from "../../../shared/agent-db-contract";

const SUMMARY_CARD_CLASS_NAME =
  "min-h-0 rounded-xl border-border/70 bg-card shadow-sm [&>div:first-child]:px-5 [&>div:first-child]:pt-4 [&>div:first-child]:pb-2 [&_[data-slot='card-description']]:text-[10px] [&_[data-slot='card-title']]:text-[1.7rem] [&>div:last-child]:px-5 [&>div:last-child]:pb-4 [&>div:last-child]:text-xs";

export function DashboardPage() {
  const { data: summary, error } = useQueryCache<DashboardSummary>(
    "db:summary",
    () => window.desktopApi.db.getDashboardSummary(),
    3_000, 5_000,
  );

  if (error) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-[var(--destructive)]">Failed to load data.</p>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-[var(--muted-foreground)]">Loading...</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 p-6">
        <section className="space-y-1">
          <h1 className="text-[1.8rem] font-semibold tracking-tight text-[var(--foreground)]">Sessions</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            High-level loop volume and direct access to the session explorer.
          </p>
        </section>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard className={SUMMARY_CARD_CLASS_NAME} label="Sessions" value={summary.totalSessions} detail={`${summary.activeSessions} active`} icon={MonitorDot} />
          <MetricCard className={SUMMARY_CARD_CLASS_NAME} label="Agents" value={summary.totalAgents} icon={Bot} />
          <MetricCard className={SUMMARY_CARD_CLASS_NAME} label="Events" value={summary.totalEvents} icon={Zap} />
          <MetricCard className={SUMMARY_CARD_CLASS_NAME} label="Event Types" value={summary.eventTypeCount} icon={Layers} />
        </div>

        <SessionsView showOverview={false} />
      </div>
    </div>
  );
}
