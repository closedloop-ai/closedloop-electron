import { lazy, Suspense, useEffect, useState } from "react";
import { MetricCard } from "@closedloop-ai/design-system/components/ui/primitives/metric-card";
import { Coins, ArrowDownToLine, ArrowUpFromLine, DatabaseZap } from "lucide-react";
import { useQueryCache } from "../../hooks/useQueryCache";
import type { AnalyticsData } from "../../../main/database/types";

const AnalyticsDetails = lazy(() =>
  import("./AnalyticsDetails").then((module) => ({
    default: module.AnalyticsDetails,
  })),
);

function AnalyticsDetailsFallback() {
  return (
    <div className="rounded-xl border border-border/70 bg-card/90 p-6 text-sm text-[var(--muted-foreground)] shadow-sm">
      Loading charts and breakdowns...
    </div>
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
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-[var(--muted-foreground)]">Loading analytics...</p>
      </div>
    );
  }

  const { tokens } = data;
  const totalTokens = tokens.totalInputTokens + tokens.totalOutputTokens;
  const cacheTokens = tokens.totalCacheReadTokens + tokens.totalCacheWriteTokens;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--foreground)]">Analytics</h1>
        <p className="text-sm text-[var(--muted-foreground)]">Token usage, event metrics, and activity trends</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <MetricCard label="Total Tokens" value={totalTokens.toLocaleString()} detail={`${data.totalSessions} sessions`} icon={Coins} />
        <MetricCard label="Input Tokens" value={tokens.totalInputTokens.toLocaleString()} icon={ArrowDownToLine} />
        <MetricCard label="Output Tokens" value={tokens.totalOutputTokens.toLocaleString()} icon={ArrowUpFromLine} />
        <MetricCard label="Cache Saved" value={cacheTokens.toLocaleString()} detail={totalTokens > 0 ? `${Math.round((cacheTokens / (totalTokens + cacheTokens)) * 100)}% cache rate` : undefined} icon={DatabaseZap} />
      </div>

      {showDetails ? (
        <Suspense fallback={<AnalyticsDetailsFallback />}>
          <AnalyticsDetails data={data} />
        </Suspense>
      ) : (
        <AnalyticsDetailsFallback />
      )}
    </div>
  );
}
