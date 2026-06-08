import { Badge } from "@closedloop-ai/design-system/components/ui/badge";
import { Button } from "@closedloop-ai/design-system/components/ui/button";
import { EmptyState } from "@closedloop-ai/design-system/components/ui/empty-state";
import {
  Check,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  History,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { PlanRecord, PlanVersionRecord } from "../../../shared/agent-db-contract";
import { useQueryCache, invalidateCache } from "../../hooks/useQueryCache";
import { DashboardCard, LoadingState, PageShell, cx } from "../layout/page-shell";

export function PlansView() {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState(false);

  const { data: plans, loading } = useQueryCache<PlanRecord[]>(
    "db:plans-list",
    () => window.desktopApi.db.getPlansList(),
    5_000,
    10_000,
  );

  const planList = arrayOrEmpty(plans);
  const selectedPlan = useMemo(
    () => planList.find((p) => p.id === selectedPlanId) ?? null,
    [planList, selectedPlanId],
  );

  const { data: versions } = useQueryCache<PlanVersionRecord[]>(
    `db:plan-versions:${selectedPlanId}`,
    () =>
      selectedPlanId
        ? window.desktopApi.db.getPlanVersions(selectedPlanId)
        : Promise.resolve([]),
    10_000,
    30_000,
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedPlanId(id);
    setShowVersions(false);
  }, []);

  const handleConfirm = useCallback(async (id: string) => {
    try {
      await window.desktopApi.db.confirmPlan(id);
      invalidateCache("db:plans-list");
    } catch (err) {
      console.error("Confirm plan failed:", err);
    }
  }, []);

  const handleReject = useCallback(async (id: string) => {
    try {
      await window.desktopApi.db.rejectPlan(id);
      invalidateCache("db:plans-list");
    } catch (err) {
      console.error("Reject plan failed:", err);
    }
  }, []);

  const handleOpenPlan = useCallback(async (id: string) => {
    try {
      await window.desktopApi.db.openPlan(id);
    } catch (err) {
      console.error("Open plan failed:", err);
    }
  }, []);

  if (loading && !plans) {
    return <LoadingState label="plans" />;
  }

  const versionList = arrayOrEmpty(versions);

  return (
    <PageShell title="Plans" description="Plans extracted from agent sessions -- review, confirm, or reject">
      {planList.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No plans captured yet" className="py-24" />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          {/* Left column: plan list */}
          <DashboardCard title={`Plans (${planList.length})`} contentClassName="p-0">
            <div className="max-h-[70vh] divide-y divide-[var(--border)] overflow-auto">
              {planList.map((plan) => (
                <PlanRow
                  key={plan.id}
                  plan={plan}
                  selected={plan.id === selectedPlanId}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          </DashboardCard>

          {/* Right column: detail pane */}
          <div className="space-y-4">
            {selectedPlan ? (
              <>
                <PlanDetail
                  plan={selectedPlan}
                  onConfirm={handleConfirm}
                  onReject={handleReject}
                  onOpen={handleOpenPlan}
                />

                {/* Version toggle */}
                {selectedPlan.versionCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowVersions((v) => !v)}
                    className="gap-1"
                  >
                    <History className="h-4 w-4" />
                    {showVersions ? "Hide" : "Show"} Versions ({selectedPlan.versionCount})
                  </Button>
                )}

                {/* Version history */}
                {showVersions && versionList.length > 0 && (
                  <DashboardCard title="Version History">
                    <div className="space-y-4">
                      {versionList.map((v) => (
                        <VersionEntry key={v.id} version={v} />
                      ))}
                    </div>
                  </DashboardCard>
                )}
              </>
            ) : (
              <DashboardCard>
                <div className="flex items-center justify-center py-16 text-sm text-[var(--muted-foreground)]">
                  Select a plan to view details
                </div>
              </DashboardCard>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}

// ---- Plan row in the list ----

function PlanRow({
  plan,
  selected,
  onSelect,
}: {
  plan: PlanRecord;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(plan.id)}
      className={cx(
        "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--muted)]/50",
        selected && "bg-[var(--muted)]",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{plan.title ?? "Untitled Plan"}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
          <StatusBadge status={plan.status} needsConfirmation={plan.needsConfirmation} />
          {plan.confidence > 0 && (
            <span className="font-mono">{Math.round(plan.confidence * 100)}%</span>
          )}
          {plan.captureMethod && (
            <Badge variant="outline" className="text-[10px]">{plan.captureMethod}</Badge>
          )}
          {plan.harness && (
            <Badge variant="outline" className="text-[10px]">{plan.harness}</Badge>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-xs text-[var(--muted-foreground)]">{formatDate(plan.createdAt)}</span>
        <ChevronRight className="h-4 w-4 text-[var(--muted-foreground)]" />
      </div>
    </button>
  );
}

// ---- Detail pane ----

function PlanDetail({
  plan,
  onConfirm,
  onReject,
  onOpen,
}: {
  plan: PlanRecord;
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <DashboardCard>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{plan.title ?? "Untitled Plan"}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
              <StatusBadge status={plan.status} needsConfirmation={plan.needsConfirmation} />
              {plan.confidence > 0 && (
                <span>Confidence: {Math.round(plan.confidence * 100)}%</span>
              )}
              {plan.captureMethod && <span>Capture: {plan.captureMethod}</span>}
              {plan.harness && <Badge variant="outline" className="text-[10px]">{plan.harness}</Badge>}
              {plan.source && <span className="truncate font-mono">{plan.source}</span>}
            </div>
          </div>
        </div>

        {/* Metadata */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--muted-foreground)]">
          {plan.createdAt && <span>Created: {formatDate(plan.createdAt)}</span>}
          {plan.updatedAt && <span>Updated: {formatDate(plan.updatedAt)}</span>}
          {plan.filePath && <span className="truncate font-mono">File: {plan.filePath}</span>}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {plan.needsConfirmation && plan.status !== "confirmed" && plan.status !== "rejected" && (
            <>
              <Button variant="default" size="sm" onClick={() => onConfirm(plan.id)} className="gap-1">
                <Check className="h-4 w-4" /> Confirm
              </Button>
              <Button variant="outline" size="sm" onClick={() => onReject(plan.id)} className="gap-1">
                <X className="h-4 w-4" /> Reject
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpen(plan.id)} className="gap-1">
            <ExternalLink className="h-4 w-4" /> Open
          </Button>
        </div>

        {/* Content preview */}
        {plan.latestContent && (
          <div className="rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-4">
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{plan.latestContent}</div>
          </div>
        )}
      </div>
    </DashboardCard>
  );
}

// ---- Version entry ----

function VersionEntry({ version }: { version: PlanVersionRecord }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">v{version.versionNumber}</span>
          {version.authorType && (
            <Badge variant="outline" className="text-[10px]">{version.authorType}</Badge>
          )}
          {version.captureMethod && (
            <Badge variant="outline" className="text-[10px]">{version.captureMethod}</Badge>
          )}
        </div>
        <span className="text-xs text-[var(--muted-foreground)]">{formatDate(version.createdAt)}</span>
      </button>

      {expanded && version.contentMarkdown && (
        <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-3">
          <div className="whitespace-pre-wrap text-xs leading-relaxed">{version.contentMarkdown}</div>
        </div>
      )}
    </div>
  );
}

// ---- Helpers ----

function StatusBadge({
  status,
  needsConfirmation,
}: {
  status: string;
  needsConfirmation: boolean;
}) {
  if (needsConfirmation && status !== "confirmed" && status !== "rejected") {
    return (
      <Badge variant="default" className="bg-[var(--warning)] text-[var(--warning-foreground)] text-[10px]">
        Needs Confirmation
      </Badge>
    );
  }

  const variant = status === "confirmed"
    ? "default"
    : status === "rejected"
      ? "destructive"
      : "outline";

  return <Badge variant={variant} className="text-[10px]">{status}</Badge>;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function arrayOrEmpty<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}
