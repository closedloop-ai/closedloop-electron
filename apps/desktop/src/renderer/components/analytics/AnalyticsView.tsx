import { lazy, Suspense, useEffect, useState } from "react";
import { MetricCard } from "@closedloop-ai/design-system/components/ui/primitives/metric-card";
import { Coins, ArrowDownToLine, ArrowUpFromLine, DatabaseZap } from "lucide-react";
import { useQueryCache } from "../../hooks/useQueryCache";
import type { AnalyticsData } from "../../../shared/agent-db-contract";
import {
  DASHBOARD_GRID_CLASS_NAME,
  DASHBOARD_METRIC_CARD_CLASS_NAME,
  DashboardCard,
  LoadingState,
  PageShell,
} from "../layout/page-shell";

const AnalyticsDetails = lazy(() =>
  import("./AnalyticsDetails").then((module) => ({
    default: module.AnalyticsDetails,
  })),
);

function AnalyticsDetailsFallback() {
  return (
    <DashboardCard contentClassName="text-sm text-[var(--muted-foreground)]">
      Loading charts and breakdowns...
    </DashboardCard>
  );
}

export function AnalyticsView() {
  const { data, loading } = useQueryCache<AnalyticsData>(
    "db:analytics",
    () => window.desktopApi.db.getAnalytics() as Promise<AnalyticsData>,
    10_000, 15_000,
  );
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (!data) {
      setShowDetails(false);
      return;
    }

    let cancelled = false;
    const schedule = typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : (callback: FrameRequestCallback) => window.setTimeout(callback, 16);
    const firstFrame = schedule(() => {
      const secondFrame = schedule(() => {
        if (!cancelled) {
          setShowDetails(true);
        }
      });
      if (cancelled && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(secondFrame);
      }
    });

    return () => {
      cancelled = true;
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(firstFrame);
      }
    };
  }, [data]);

  if (loading || !data) {
    return <LoadingState label="analytics" />;
  }

  const { tokens } = data;
  const totalTokens = tokens.totalInputTokens + tokens.totalOutputTokens;
  const cacheTokens = tokens.totalCacheReadTokens + tokens.totalCacheWriteTokens;

  return (
    <PageShell title="Analytics" description="Token usage, event metrics, and activity trends">
      <div className={DASHBOARD_GRID_CLASS_NAME}>
        <MetricCard className={DASHBOARD_METRIC_CARD_CLASS_NAME} label="Total Tokens" value={totalTokens.toLocaleString()} detail={`${data.totalSessions} sessions`} icon={Coins} />
        <MetricCard className={DASHBOARD_METRIC_CARD_CLASS_NAME} label="Input Tokens" value={tokens.totalInputTokens.toLocaleString()} icon={ArrowDownToLine} />
        <MetricCard className={DASHBOARD_METRIC_CARD_CLASS_NAME} label="Output Tokens" value={tokens.totalOutputTokens.toLocaleString()} icon={ArrowUpFromLine} />
        <MetricCard className={DASHBOARD_METRIC_CARD_CLASS_NAME} label="Cache Saved" value={cacheTokens.toLocaleString()} detail={totalTokens > 0 ? `${Math.round((cacheTokens / (totalTokens + cacheTokens)) * 100)}% cache rate` : undefined} icon={DatabaseZap} />
      </div>

      {showDetails ? (
        <Suspense fallback={<AnalyticsDetailsFallback />}>
          <AnalyticsDetails data={data} />
        </Suspense>
      ) : (
        <AnalyticsDetailsFallback />
      )}
    </PageShell>
  );
}
