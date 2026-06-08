import { Badge } from "@closedloop-ai/design-system/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@closedloop-ai/design-system/components/ui/card";
import { MetricCard } from "@closedloop-ai/design-system/components/ui/primitives/metric-card";
import {
  Bot,
  ClipboardList,
  GitPullRequest,
  Package,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useMemo } from "react";
import type { ReactNode } from "react";
import type {
  DashboardPackSummary,
  DashboardPlanSummary,
  DashboardPullRequestSummary,
  DashboardSkillSummary,
  DashboardSubAgentSummary,
  DashboardToolSummary,
} from "../../../shared/agent-db-contract";
import { useQueryCache } from "../../hooks/useQueryCache";

type FeatureKind = "packs" | "skills" | "tools" | "subagents" | "plans" | "pull-requests";

const FEATURE_LABELS: Record<FeatureKind, { title: string; description: string }> = {
  packs: {
    title: "Packs",
    description: "Pack activity inferred from imported skill usage",
  },
  skills: {
    title: "Skills",
    description: "Skill invocations captured from agent sessions",
  },
  tools: {
    title: "Tools",
    description: "Tool calls grouped across all imported sessions",
  },
  subagents: {
    title: "SubAgents",
    description: "Subagent roles, outcomes, and session coverage",
  },
  plans: {
    title: "Plans",
    description: "Plans extracted from imported transcripts",
  },
  "pull-requests": {
    title: "Pull Requests",
    description: "Pull request artifacts associated with agent sessions",
  },
};

export function PacksView() {
  return <FeatureView kind="packs" />;
}

export function SkillsView() {
  return <FeatureView kind="skills" />;
}

export function ToolsView() {
  return <FeatureView kind="tools" />;
}

export function SubAgentsView() {
  return <FeatureView kind="subagents" />;
}

export function PlansView() {
  return <FeatureView kind="plans" />;
}

export function PullRequestsView() {
  return <FeatureView kind="pull-requests" />;
}

function FeatureView({ kind }: { kind: FeatureKind }) {
  const labels = FEATURE_LABELS[kind];
  const { data: packs, loading: packsLoading } = useQueryCache<DashboardPackSummary[]>(
    "db:packs",
    () => window.desktopApi.db.getPacks(),
    5_000,
    10_000,
  );
  const { data: skills, loading: skillsLoading } = useQueryCache<DashboardSkillSummary[]>(
    "db:skills",
    () => window.desktopApi.db.getSkills(),
    5_000,
    10_000,
  );
  const { data: tools, loading: toolsLoading } = useQueryCache<DashboardToolSummary[]>(
    "db:tools",
    () => window.desktopApi.db.getTools(),
    5_000,
    10_000,
  );
  const { data: subagents, loading: subagentsLoading } = useQueryCache<DashboardSubAgentSummary[]>(
    "db:subagents",
    () => window.desktopApi.db.getSubAgents(),
    5_000,
    10_000,
  );
  const { data: plans, loading: plansLoading } = useQueryCache<DashboardPlanSummary[]>(
    "db:plans",
    () => window.desktopApi.db.getPlans(),
    5_000,
    10_000,
  );
  const { data: pullRequests, loading: pullRequestsLoading } = useQueryCache<DashboardPullRequestSummary[]>(
    "db:pull-requests",
    () => window.desktopApi.db.getPullRequests(),
    5_000,
    10_000,
  );

  const loading = {
    packs: packsLoading,
    skills: skillsLoading,
    tools: toolsLoading,
    subagents: subagentsLoading,
    plans: plansLoading,
    "pull-requests": pullRequestsLoading,
  }[kind];

  const stats = useMemo(() => ({
    packCount: packs?.length ?? 0,
    skillCount: skills?.length ?? 0,
    toolCount: tools?.length ?? 0,
    subagentCount: subagents?.length ?? 0,
    planCount: plans?.length ?? 0,
    pullRequestCount: pullRequests?.length ?? 0,
  }), [packs, skills, tools, subagents, plans, pullRequests]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-[var(--muted-foreground)]">Loading {labels.title.toLowerCase()}...</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--foreground)]">{labels.title}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">{labels.description}</p>
      </div>

      <div className="grid grid-cols-3 gap-4 lg:grid-cols-6">
        <MetricCard label="Packs" value={stats.packCount} icon={Package} />
        <MetricCard label="Skills" value={stats.skillCount} icon={Sparkles} />
        <MetricCard label="Tools" value={stats.toolCount} icon={Wrench} />
        <MetricCard label="SubAgents" value={stats.subagentCount} icon={Bot} />
        <MetricCard label="Plans" value={stats.planCount} icon={ClipboardList} />
        <MetricCard label="PRs" value={stats.pullRequestCount} icon={GitPullRequest} />
      </div>

      {kind === "packs" && <PacksTable rows={packs ?? []} />}
      {kind === "skills" && <SkillsTable rows={skills ?? []} />}
      {kind === "tools" && <ToolsTable rows={tools ?? []} />}
      {kind === "subagents" && <SubAgentsTable rows={subagents ?? []} />}
      {kind === "plans" && <PlansTable rows={plans ?? []} />}
      {kind === "pull-requests" && <PullRequestsTable rows={pullRequests ?? []} />}
    </div>
  );
}

function PacksTable({ rows }: { rows: DashboardPackSummary[] }) {
  return (
    <FeatureCard title="Pack Activity" empty={rows.length === 0 ? "No pack usage captured yet." : null}>
      <Table>
        <thead>
          <tr>
            <Header>Name</Header>
            <Header>Harness</Header>
            <Header align="right">Skills</Header>
            <Header align="right">Calls</Header>
            <Header>Last Used</Header>
          </tr>
        </thead>
        <tbody>{rows.map((row) => (
          <tr key={row.id} className="border-b border-[var(--border)]">
            <Cell className="font-medium">{row.name}</Cell>
            <Cell><Badge variant="outline">{row.harness}</Badge></Cell>
            <Cell align="right">{row.skillCount}</Cell>
            <Cell align="right">{row.toolCallCount}</Cell>
            <Cell>{formatDate(row.lastUsedAt)}</Cell>
          </tr>
        ))}</tbody>
      </Table>
    </FeatureCard>
  );
}

function SkillsTable({ rows }: { rows: DashboardSkillSummary[] }) {
  return (
    <FeatureCard title="Skill Invocations" empty={rows.length === 0 ? "No skill invocations captured yet." : null}>
      <Table>
        <thead>
          <tr>
            <Header>Name</Header>
            <Header>Pack</Header>
            <Header>Harness</Header>
            <Header align="right">Calls</Header>
            <Header>Last Used</Header>
          </tr>
        </thead>
        <tbody>{rows.map((row) => (
          <tr key={row.id} className="border-b border-[var(--border)]">
            <Cell className="font-medium">{row.name}</Cell>
            <Cell>{row.packId ?? "-"}</Cell>
            <Cell><Badge variant="outline">{row.harness}</Badge></Cell>
            <Cell align="right">{row.invocationCount}</Cell>
            <Cell>{formatDate(row.lastUsedAt)}</Cell>
          </tr>
        ))}</tbody>
      </Table>
    </FeatureCard>
  );
}

function ToolsTable({ rows }: { rows: DashboardToolSummary[] }) {
  return (
    <FeatureCard title="Tool Usage" empty={rows.length === 0 ? "No tool calls captured yet." : null}>
      <Table>
        <thead>
          <tr>
            <Header>Tool</Header>
            <Header align="right">Calls</Header>
            <Header align="right">Sessions</Header>
            <Header>Last Used</Header>
          </tr>
        </thead>
        <tbody>{rows.map((row) => (
          <tr key={row.toolName} className="border-b border-[var(--border)]">
            <Cell className="font-mono text-xs">{row.toolName}</Cell>
            <Cell align="right">{row.invocationCount}</Cell>
            <Cell align="right">{row.sessionCount}</Cell>
            <Cell>{formatDate(row.lastUsedAt)}</Cell>
          </tr>
        ))}</tbody>
      </Table>
    </FeatureCard>
  );
}

function SubAgentsTable({ rows }: { rows: DashboardSubAgentSummary[] }) {
  return (
    <FeatureCard title="SubAgent Outcomes" empty={rows.length === 0 ? "No subagent activity captured yet." : null}>
      <Table>
        <thead>
          <tr>
            <Header>Role</Header>
            <Header align="right">Total</Header>
            <Header align="right">Completed</Header>
            <Header align="right">Errors</Header>
            <Header align="right">Sessions</Header>
            <Header>Last Used</Header>
          </tr>
        </thead>
        <tbody>{rows.map((row) => (
          <tr key={row.subagentType} className="border-b border-[var(--border)]">
            <Cell className="font-mono text-xs">{row.subagentType}</Cell>
            <Cell align="right">{row.total}</Cell>
            <Cell align="right" className="text-[var(--success)]">{row.completed}</Cell>
            <Cell align="right" className="text-[var(--destructive)]">{row.errors}</Cell>
            <Cell align="right">{row.sessions}</Cell>
            <Cell>{formatDate(row.lastUsedAt)}</Cell>
          </tr>
        ))}</tbody>
      </Table>
    </FeatureCard>
  );
}

function PlansTable({ rows }: { rows: DashboardPlanSummary[] }) {
  return (
    <FeatureCard title="Extracted Plans" empty={rows.length === 0 ? "No plans captured yet." : null}>
      <div className="divide-y divide-[var(--border)]">
        {rows.map((row) => (
          <div key={row.id} className="py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-medium">{row.title}</p>
              <span className="shrink-0 text-xs text-[var(--muted-foreground)]">{formatDate(row.timestamp)}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted-foreground)]">
              {row.harness && <Badge variant="outline">{row.harness}</Badge>}
              {row.source && <span>{row.source}</span>}
              {row.cwd && <span className="truncate font-mono">{row.cwd}</span>}
            </div>
          </div>
        ))}
      </div>
    </FeatureCard>
  );
}

function PullRequestsTable({ rows }: { rows: DashboardPullRequestSummary[] }) {
  return (
    <FeatureCard title="Pull Request Artifacts" empty={rows.length === 0 ? "No pull request artifacts captured yet." : null}>
      <Table>
        <thead>
          <tr>
            <Header>Pull Request</Header>
            <Header>Repo</Header>
            <Header>Harness</Header>
            <Header>Observed</Header>
          </tr>
        </thead>
        <tbody>{rows.map((row) => (
          <tr key={row.id} className="border-b border-[var(--border)]">
            <Cell>
              <a className="font-medium text-[var(--primary)] hover:underline" href={row.prUrl} target="_blank" rel="noreferrer">
                #{row.prNumber}{row.title ? ` ${row.title}` : ""}
              </a>
            </Cell>
            <Cell className="font-mono text-xs">{row.repoFullName}</Cell>
            <Cell>{row.harness ? <Badge variant="outline">{row.harness}</Badge> : "-"}</Cell>
            <Cell>{formatDate(row.observedAt)}</Cell>
          </tr>
        ))}</tbody>
      </Table>
    </FeatureCard>
  );
}

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
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        {empty ? (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">{empty}</div>
        ) : children}
      </CardContent>
    </Card>
  );
}

function Table({ children }: { children: ReactNode }) {
  return <table className="w-full text-sm">{children}</table>;
}

function Header({
  align = "left",
  children,
}: {
  align?: "left" | "right";
  children: ReactNode;
}) {
  return (
    <th className={`border-b py-2 font-medium text-[var(--muted-foreground)] ${align === "right" ? "text-right" : "text-left"}`}>
      {children}
    </th>
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
    <td className={`py-2 ${align === "right" ? "text-right" : "text-left"} ${className}`}>
      {children}
    </td>
  );
}

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}
