import { Badge } from "@closedloop-ai/design-system/components/ui/badge";
import { Button } from "@closedloop-ai/design-system/components/ui/button";
import { EmptyState } from "@closedloop-ai/design-system/components/ui/empty-state";
import { MetricCard } from "@closedloop-ai/design-system/components/ui/primitives/metric-card";
import {
  Table as DsTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@closedloop-ai/design-system/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@closedloop-ai/design-system/components/ui/tabs";
import {
  ExternalLink,
  GitPullRequest,
  Layers,
  FolderGit2,
} from "lucide-react";
import { useCallback } from "react";
import type { PrRecord, PrSessionGroup, PrStats } from "../../../shared/agent-db-contract";
import { useQueryCache } from "../../hooks/useQueryCache";
import {
  DASHBOARD_METRIC_CARD_CLASS_NAME,
  DASHBOARD_TABLE_CLASS_NAME,
  DashboardCard,
  LoadingState,
  PageShell,
  cx,
} from "../layout/page-shell";
import { formatDate } from "./format";

export function PullRequestsView() {
  const { data: stats, loading: statsLoading } = useQueryCache<PrStats>(
    "db:pr-stats",
    () => window.desktopApi.db.getPrStats(),
    5_000,
    10_000,
  );

  const { data: sessions, loading: sessionsLoading } = useQueryCache<PrSessionGroup[]>(
    "db:pr-sessions",
    () => window.desktopApi.db.getPrSessions(),
    5_000,
    10_000,
  );

  const { data: allPrs, loading: prsLoading } = useQueryCache<PrRecord[]>(
    "db:pr-list",
    () => window.desktopApi.db.getPrList(),
    5_000,
    10_000,
  );

  const handleOpenPr = useCallback(async (id: string) => {
    try {
      await window.desktopApi.db.openPr(id);
    } catch (err) {
      console.error("Open PR failed:", err);
    }
  }, []);

  if (statsLoading && !stats) {
    return <LoadingState label="pull requests" />;
  }

  const prStats = stats ?? { totalPrs: 0, sessionsWithPrs: 0, repos: 0 };
  const sessionGroups = arrayOrEmpty(sessions);
  const prs = arrayOrEmpty(allPrs);

  return (
    <PageShell title="Pull Requests" description="Pull request artifacts across agent sessions">
      {/* Summary stat pills */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          className={DASHBOARD_METRIC_CARD_CLASS_NAME}
          label="Total PRs"
          value={prStats.totalPrs}
          icon={GitPullRequest}
        />
        <MetricCard
          className={DASHBOARD_METRIC_CARD_CLASS_NAME}
          label="Sessions with PRs"
          value={prStats.sessionsWithPrs}
          icon={Layers}
        />
        <MetricCard
          className={DASHBOARD_METRIC_CARD_CLASS_NAME}
          label="Repos"
          value={prStats.repos}
          icon={FolderGit2}
        />
      </div>

      {prStats.totalPrs === 0 ? (
        <EmptyState icon={GitPullRequest} title="No pull request artifacts captured yet" className="py-24" />
      ) : (
        <Tabs defaultValue="by-session" className="w-full">
          <TabsList>
            <TabsTrigger value="by-session">By Session</TabsTrigger>
            <TabsTrigger value="all-prs">All PRs</TabsTrigger>
          </TabsList>

          <TabsContent value="by-session" className="mt-4">
            {!sessionsLoading && sessionGroups.length > 0 ? (
              <div className="space-y-4">
                {sessionGroups.map((group) => (
                  <SessionGroupCard
                    key={group.sessionId}
                    group={group}
                    onOpenPr={handleOpenPr}
                  />
                ))}
              </div>
            ) : sessionsLoading ? (
              <LoadingState label="sessions" />
            ) : (
              <EmptyState icon={Layers} title="No session groups found" className="py-12" />
            )}
          </TabsContent>

          <TabsContent value="all-prs" className="mt-4">
            {!prsLoading && prs.length > 0 ? (
              <PrTable prs={prs} onOpenPr={handleOpenPr} />
            ) : prsLoading ? (
              <LoadingState label="pull requests" />
            ) : (
              <EmptyState icon={GitPullRequest} title="No pull requests found" className="py-12" />
            )}
          </TabsContent>
        </Tabs>
      )}
    </PageShell>
  );
}

// ---- Session group card ----

function SessionGroupCard({
  group,
  onOpenPr,
}: {
  group: PrSessionGroup;
  onOpenPr: (id: string) => void;
}) {
  const prs = prGroupRecords(group);
  return (
    <DashboardCard>
      <div className="space-y-3">
        {/* Session header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {group.sessionName ?? group.sessionId}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
              {group.harness && <Badge variant="outline" className="text-[10px]">{group.harness}</Badge>}
              {group.cwd && <span className="truncate font-mono">{group.cwd}</span>}
              {group.startedAt && <span>{formatDate(group.startedAt)}</span>}
            </div>
          </div>
          <Badge variant="outline" className="shrink-0">
            {prs.length} PR{prs.length !== 1 ? "s" : ""}
          </Badge>
        </div>

        {/* PR chips */}
        <div className="flex flex-wrap gap-2">
          {prs.map((pr) => (
            <PrChip key={pr.id} pr={pr} onOpen={onOpenPr} />
          ))}
        </div>
      </div>
    </DashboardCard>
  );
}

// ---- PR chip ----

function PrChip({
  pr,
  onOpen,
}: {
  pr: PrRecord;
  onOpen: (id: string) => void;
}) {
  const label = pr.repoFullName
    ? `${pr.repoFullName}#${pr.prNumber ?? "?"}`
    : `#${pr.prNumber ?? pr.id.slice(0, 8)}`;

  return (
    <button
      type="button"
      onClick={() => onOpen(pr.id)}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1 text-xs",
        "transition-colors hover:border-[var(--primary)] hover:bg-[var(--muted)]/50",
      )}
      title={pr.title ?? pr.prUrl}
    >
      <GitPullRequest className="h-3 w-3 text-[var(--primary)]" />
      <span className="font-medium">{label}</span>
      {pr.title && (
        <span className="max-w-[200px] truncate text-[var(--muted-foreground)]">{pr.title}</span>
      )}
      <ExternalLink className="h-3 w-3 text-[var(--muted-foreground)]" />
    </button>
  );
}

// ---- Flat PR table ----

function PrTable({
  prs,
  onOpenPr,
}: {
  prs: PrRecord[];
  onOpenPr: (id: string) => void;
}) {
  return (
    <DashboardCard contentClassName="p-0">
      <div className="overflow-auto">
        <DsTable className={DASHBOARD_TABLE_CLASS_NAME}>
          <TableHeader>
            <TableRow>
              <TableHead className="px-5 text-left">Pull Request</TableHead>
              <TableHead className="px-5 text-left">Repo</TableHead>
              <TableHead className="px-5 text-left">Branch</TableHead>
              <TableHead className="px-5 text-left">Harness</TableHead>
              <TableHead className="px-5 text-left">Observed</TableHead>
              <TableHead className="px-5 text-left" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {prs.map((pr) => (
              <TableRow key={pr.id}>
                <TableCell className="px-5">
                  <span className="font-medium text-[var(--primary)]">
                    #{pr.prNumber ?? "?"}
                    {pr.title ? ` ${pr.title}` : ""}
                  </span>
                </TableCell>
                <TableCell className="px-5 font-mono text-xs">
                  {pr.repoFullName ?? "-"}
                </TableCell>
                <TableCell className="px-5 font-mono text-xs">
                  {pr.branchName ?? "-"}
                </TableCell>
                <TableCell className="px-5">
                  {pr.harness ? <Badge variant="outline" className="text-[10px]">{pr.harness}</Badge> : "-"}
                </TableCell>
                <TableCell className="px-5 text-xs text-[var(--muted-foreground)]">
                  {formatDate(pr.observedAt)}
                </TableCell>
                <TableCell className="px-5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onOpenPr(pr.id)}
                    className="h-7 gap-1 text-xs"
                  >
                    <ExternalLink className="h-3 w-3" /> Open
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </DsTable>
      </div>
    </DashboardCard>
  );
}

// ---- Helpers ----

function arrayOrEmpty<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function prGroupRecords(group: PrSessionGroup): PrRecord[] {
  return Array.isArray(group.prs) ? group.prs : [];
}
