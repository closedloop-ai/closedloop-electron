import { useQueryCache } from "../../hooks/useQueryCache";
import { WorkflowStatTile } from "@closedloop-ai/design-system/components/ui/primitives/workflow-stat-tile";
import { OrchestrationDag } from "@closedloop-ai/design-system/components/ui/composites/orchestration-dag";
import { SankeyGraph } from "@closedloop-ai/design-system/components/ui/primitives/sankey-graph";
import { AgentCollaborationNetwork } from "@closedloop-ai/design-system/components/ui/composites/agent-collaboration-network";
import { RankedBar } from "@closedloop-ai/design-system/components/ui/primitives/ranked-bar";
import { Badge } from "@closedloop-ai/design-system/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@closedloop-ai/design-system/components/ui/table";
import { Monitor, Bot, GitFork, Target, Layers, Timer } from "lucide-react";
import type { WorkflowQueryData } from "../../../shared/agent-db-contract";
import {
  DASHBOARD_TABLE_CLASS_NAME,
  DASHBOARD_WIDE_GRID_CLASS_NAME,
  DashboardCard,
  LoadingState,
  PageShell,
} from "../layout/page-shell";

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

export function WorkflowsView() {
  const { data, loading } = useQueryCache<WorkflowQueryData>(
    "db:workflows",
    () => window.desktopApi.db.getWorkflowData() as Promise<WorkflowQueryData>,
    10_000, 15_000,
  );

  if (loading || !data) {
    return <LoadingState label="workflows" />;
  }

  const { stats, orchestration, toolFlow, effectiveness, cooccurrence } = data;

  const hasOrchestration = orchestration.subagentTypes.length > 0 || orchestration.edges.length > 0;
  const hasToolFlow = toolFlow.transitions.length > 0;
  const hasEffectiveness = effectiveness.length > 0;
  const hasCooccurrence = cooccurrence.length > 0;
  const maxToolCount = toolFlow.toolCounts.length > 0 ? toolFlow.toolCounts[0].count : 1;

  return (
    <PageShell
      title="Workflows"
      description="Agent orchestration patterns, tool flows, and effectiveness"
    >
      <div className={DASHBOARD_WIDE_GRID_CLASS_NAME}>
        <WorkflowStatTile label="Sessions" value={stats.totalSessions} icon={Monitor} />
        <WorkflowStatTile label="Agents" value={stats.totalAgents} description={`${stats.totalSubagents} subagents`} icon={Bot} />
        <WorkflowStatTile label="Avg Subagents" value={stats.avgSubagents.toFixed(1)} icon={GitFork} />
        <WorkflowStatTile label="Success Rate" value={`${stats.successRate.toFixed(0)}%`} icon={Target} />
        <WorkflowStatTile label="Avg Depth" value={stats.avgDepth.toFixed(1)} icon={Layers} />
        <WorkflowStatTile label="Avg Duration" value={formatDuration(stats.avgDurationSec)} icon={Timer} />
      </div>

      {stats.topFlow && (
        <DashboardCard contentClassName="py-3">
            <p className="text-sm text-[var(--muted-foreground)]">
              Top tool flow: <span className="font-mono text-[var(--foreground)]">{stats.topFlow.source}</span>
              {" → "}
              <span className="font-mono text-[var(--foreground)]">{stats.topFlow.target}</span>
              {" "}
              <Badge variant="secondary">{stats.topFlow.count}x</Badge>
            </p>
        </DashboardCard>
      )}

      {hasOrchestration && (
        <DashboardCard title="Orchestration DAG">
          <OrchestrationDag data={orchestration} />
        </DashboardCard>
      )}

      {hasToolFlow && (
        <DashboardCard title="Tool Execution Flow">
          <SankeyGraph
            flows={toolFlow.transitions}
            totals={toolFlow.toolCounts.map((t) => ({ id: t.toolName, value: t.count }))}
            ariaLabel="Tool execution flow"
            emptyMessage="No tool transitions recorded"
          />
        </DashboardCard>
      )}

      {hasCooccurrence && hasEffectiveness && (
        <DashboardCard title="Agent Collaboration Network">
          <AgentCollaborationNetwork data={effectiveness} edges={cooccurrence} />
        </DashboardCard>
      )}

      {hasEffectiveness && (
        <DashboardCard title="Subagent Effectiveness" contentClassName="p-0">
            <div className="overflow-auto">
              <Table className={DASHBOARD_TABLE_CLASS_NAME}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-5">Agent Type</TableHead>
                    <TableHead className="px-5 text-right">Total</TableHead>
                    <TableHead className="px-5 text-right">Completed</TableHead>
                    <TableHead className="px-5 text-right">Errors</TableHead>
                    <TableHead className="px-5 text-right">Success Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {effectiveness.map((e) => (
                    <TableRow key={e.subagentType}>
                      <TableCell className="px-5 font-mono text-xs">{e.subagentType}</TableCell>
                      <TableCell className="px-5 text-right">{e.total}</TableCell>
                      <TableCell className="px-5 text-right text-[var(--success)]">{e.completed}</TableCell>
                      <TableCell className="px-5 text-right text-[var(--destructive)]">{e.errors}</TableCell>
                      <TableCell className="px-5 text-right">
                        <Badge variant={e.successRate >= 80 ? "default" : "secondary"}>
                          {e.successRate.toFixed(0)}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
        </DashboardCard>
      )}

      {toolFlow.toolCounts.length > 0 && (
        <DashboardCard title="Tool Invocation Counts">
            <div className="space-y-2">
              {toolFlow.toolCounts.slice(0, 15).map((t) => (
                <RankedBar
                  key={t.toolName}
                  label={<span className="font-mono text-xs">{t.toolName}</span>}
                  value={t.count}
                  percent={(t.count / maxToolCount) * 100}
                />
              ))}
            </div>
        </DashboardCard>
      )}

      {!hasOrchestration && !hasToolFlow && !hasEffectiveness && (
        <DashboardCard contentClassName="py-12 text-center text-sm text-[var(--muted-foreground)]">
            No workflow data yet. Agent orchestration patterns will appear here once sessions with subagents are recorded.
        </DashboardCard>
      )}
    </PageShell>
  );
}
