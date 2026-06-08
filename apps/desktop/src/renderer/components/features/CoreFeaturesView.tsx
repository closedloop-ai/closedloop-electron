import { Badge } from "@closedloop-ai/design-system/components/ui/badge";
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
  Bot,
  Package,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  DashboardSubAgentSummary,
  DashboardToolSummary,
  SkillWithInvocations,
} from "../../../shared/agent-db-contract";
import { useQueryCache } from "../../hooks/useQueryCache";
import {
  DASHBOARD_METRIC_CARD_CLASS_NAME,
  DASHBOARD_TABLE_CLASS_NAME,
  DashboardCard,
  LoadingState,
  PageShell,
  cx,
} from "../layout/page-shell";
import { PacksCatalog } from "./PacksCatalog";
import { PlansView as PlansViewFull } from "./PlansView";
import { PullRequestsView as PullRequestsViewFull } from "./PullRequestsView";

// ---- Full-featured views (delegate to dedicated components) ----

export function PacksView() {
  return <PacksCatalog />;
}

export function PlansView() {
  return <PlansViewFull />;
}

export function PullRequestsView() {
  return <PullRequestsViewFull />;
}

// ---- Stub views kept for Skills, Tools, SubAgents ----

export function SkillsView() {
  const { data: skills, loading } = useQueryCache<SkillWithInvocations[]>(
    "db:all-skills",
    () => window.desktopApi.db.getAllSkills(),
    5_000,
    10_000,
  );

  if (loading && !skills) {
    return <LoadingState label="skills" />;
  }

  const rows = arrayOrEmpty(skills);

  return (
    <PageShell title="Skills" description="Skill invocations captured from agent sessions">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard className={DASHBOARD_METRIC_CARD_CLASS_NAME} label="Skills" value={rows.length} icon={Sparkles} />
        <MetricCard
          className={DASHBOARD_METRIC_CARD_CLASS_NAME}
          label="Total Invocations"
          value={rows.reduce((sum, r) => sum + r.invocationCount, 0)}
          icon={Sparkles}
        />
        <MetricCard
          className={DASHBOARD_METRIC_CARD_CLASS_NAME}
          label="Packs"
          value={new Set(rows.map((r) => r.packId).filter(Boolean)).size}
          icon={Package}
        />
      </div>

      <FeatureCard title="Skill Invocations" empty={rows.length === 0 ? "No skill invocations captured yet." : null}>
        <Table>
          <TableHeader>
            <TableRow>
              <Header>Name</Header>
              <Header>Pack</Header>
              <Header>Harness</Header>
              <Header align="right">Calls</Header>
              <Header>Last Used</Header>
            </TableRow>
          </TableHeader>
          <TableBody>{rows.map((row) => (
            <TableRow key={row.skillId}>
              <Cell className="font-medium">{row.name}</Cell>
              <Cell>{row.packId ?? "-"}</Cell>
              <Cell>{row.harness ? <Badge variant="outline">{row.harness}</Badge> : "-"}</Cell>
              <Cell align="right">{row.invocationCount}</Cell>
              <Cell>{formatDate(row.lastUsedAt)}</Cell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </FeatureCard>
    </PageShell>
  );
}

export function ToolsView() {
  const { data: tools, loading } = useQueryCache<DashboardToolSummary[]>(
    "db:tools",
    () => window.desktopApi.db.getTools(),
    5_000,
    10_000,
  );

  if (loading && !tools) {
    return <LoadingState label="tools" />;
  }

  const rows = arrayOrEmpty(tools);

  return (
    <PageShell title="Tools" description="Tool calls grouped across all imported sessions">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard className={DASHBOARD_METRIC_CARD_CLASS_NAME} label="Tools" value={rows.length} icon={Wrench} />
        <MetricCard
          className={DASHBOARD_METRIC_CARD_CLASS_NAME}
          label="Total Calls"
          value={rows.reduce((sum, r) => sum + r.invocationCount, 0)}
          icon={Wrench}
        />
        <MetricCard
          className={DASHBOARD_METRIC_CARD_CLASS_NAME}
          label="Sessions"
          value={rows.reduce((sum, r) => sum + r.sessionCount, 0)}
          icon={Wrench}
        />
      </div>

      <FeatureCard title="Tool Usage" empty={rows.length === 0 ? "No tool calls captured yet." : null}>
        <Table>
          <TableHeader>
            <TableRow>
              <Header>Tool</Header>
              <Header align="right">Calls</Header>
              <Header align="right">Sessions</Header>
              <Header>Last Used</Header>
            </TableRow>
          </TableHeader>
          <TableBody>{rows.map((row) => (
            <TableRow key={row.toolName}>
              <Cell className="font-mono text-xs">{row.toolName}</Cell>
              <Cell align="right">{row.invocationCount}</Cell>
              <Cell align="right">{row.sessionCount}</Cell>
              <Cell>{formatDate(row.lastUsedAt)}</Cell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </FeatureCard>
    </PageShell>
  );
}

export function SubAgentsView() {
  const { data: subagents, loading } = useQueryCache<DashboardSubAgentSummary[]>(
    "db:subagents",
    () => window.desktopApi.db.getSubAgents(),
    5_000,
    10_000,
  );

  if (loading && !subagents) {
    return <LoadingState label="subagents" />;
  }

  const rows = arrayOrEmpty(subagents);

  return (
    <PageShell title="SubAgents" description="Subagent roles, outcomes, and session coverage">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard className={DASHBOARD_METRIC_CARD_CLASS_NAME} label="SubAgent Types" value={rows.length} icon={Bot} />
        <MetricCard
          className={DASHBOARD_METRIC_CARD_CLASS_NAME}
          label="Total"
          value={rows.reduce((sum, r) => sum + r.total, 0)}
          icon={Bot}
        />
        <MetricCard
          className={DASHBOARD_METRIC_CARD_CLASS_NAME}
          label="Sessions"
          value={rows.reduce((sum, r) => sum + r.sessions, 0)}
          icon={Bot}
        />
      </div>

      <FeatureCard title="SubAgent Outcomes" empty={rows.length === 0 ? "No subagent activity captured yet." : null}>
        <Table>
          <TableHeader>
            <TableRow>
              <Header>Role</Header>
              <Header align="right">Total</Header>
              <Header align="right">Completed</Header>
              <Header align="right">Errors</Header>
              <Header align="right">Sessions</Header>
              <Header>Last Used</Header>
            </TableRow>
          </TableHeader>
          <TableBody>{rows.map((row) => (
            <TableRow key={row.subagentType}>
              <Cell className="font-mono text-xs">{row.subagentType}</Cell>
              <Cell align="right">{row.total}</Cell>
              <Cell align="right" className="text-[var(--success)]">{row.completed}</Cell>
              <Cell align="right" className="text-[var(--destructive)]">{row.errors}</Cell>
              <Cell align="right">{row.sessions}</Cell>
              <Cell>{formatDate(row.lastUsedAt)}</Cell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </FeatureCard>
    </PageShell>
  );
}

// ---- Shared primitives (kept for the stub views) ----

function FeatureCard({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string | null;
  children: ReactNode;
}) {
  return (
    <DashboardCard title={title} contentClassName="p-0">
      {empty ? (
        <EmptyState icon={Package} title={empty} className="py-12" />
      ) : children}
    </DashboardCard>
  );
}

function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-auto">
      <DsTable className={DASHBOARD_TABLE_CLASS_NAME}>{children}</DsTable>
    </div>
  );
}

function Header({
  align = "left",
  children,
}: {
  align?: "left" | "right";
  children: ReactNode;
}) {
  return (
    <TableHead className={cx("px-5", align === "right" ? "text-right" : "text-left")}>
      {children}
    </TableHead>
  );
}

function Cell({
  align = "left",
  className = "",
  children,
}: {
  align?: "left" | "right";
  className?: string;
  children: ReactNode;
}) {
  return (
    <TableCell className={cx("px-5", align === "right" ? "text-right" : "text-left", className)}>
      {children}
    </TableCell>
  );
}

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function arrayOrEmpty<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}
