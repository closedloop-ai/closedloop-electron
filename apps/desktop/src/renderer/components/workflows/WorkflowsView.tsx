import { useQueryCache } from "../../hooks/useQueryCache";
import { Card, CardContent, CardHeader, CardTitle } from "@closedloop-ai/design-system/components/ui/card";
import { WorkflowStatTile } from "@closedloop-ai/design-system/components/ui/primitives/workflow-stat-tile";
import { OrchestrationDag } from "@closedloop-ai/design-system/components/ui/composites/orchestration-dag";
import { SankeyGraph } from "@closedloop-ai/design-system/components/ui/primitives/sankey-graph";
import { AgentCollaborationNetwork } from "@closedloop-ai/design-system/components/ui/composites/agent-collaboration-network";
import { RankedBar } from "@closedloop-ai/design-system/components/ui/primitives/ranked-bar";
import { Badge } from "@closedloop-ai/design-system/components/ui/badge";
import { Monitor, Bot, GitFork, Target, Layers, Timer } from "lucide-react";
import type { WorkflowQueryData } from "../../../main/database/types";

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
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-[var(--muted-foreground)]">Loading workflows...</p>
      </div>
    );
  }

  const { stats, orchestration, toolFlow, effectiveness, cooccurrence } = data;

  const hasOrchestration = orchestration.subagentTypes.length > 0 || orchestration.edges.length > 0;
  const hasToolFlow = toolFlow.transitions.length > 0;
  const hasEffectiveness = effectiveness.length > 0;
  const hasCooccurrence = cooccurrence.length > 0;
  const maxToolCount = toolFlow.toolCounts.length > 0 ? toolFlow.toolCounts[0].count : 1;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--foreground)]">Workflows</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Agent orchestration patterns, tool flows, and effectiveness
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4 lg:grid-cols-6">
        <WorkflowStatTile label="Sessions" value={stats.totalSessions} icon={Monitor} />
        <WorkflowStatTile label="Agents" value={stats.totalAgents} description={`${stats.totalSubagents} subagents`} icon={Bot} />
        <WorkflowStatTile label="Avg Subagents" value={stats.avgSubagents.toFixed(1)} icon={GitFork} />
        <WorkflowStatTile label="Success Rate" value={`${stats.successRate.toFixed(0)}%`} icon={Target} />
        <WorkflowStatTile label="Avg Depth" value={stats.avgDepth.toFixed(1)} icon={Layers} />
        <WorkflowStatTile label="Avg Duration" value={formatDuration(stats.avgDurationSec)} icon={Timer} />
      </div>

      {stats.topFlow && (
        <Card>
          <CardContent className="py-3">
            <p className="text-sm text-[var(--muted-foreground)]">
              Top tool flow: <span className="font-mono text-[var(--foreground)]">{stats.topFlow.source}</span>
              {" → "}
              <span className="font-mono text-[var(--foreground)]">{stats.topFlow.target}</span>
              {" "}
              <Badge variant="secondary">{stats.topFlow.count}x</Badge>
            </p>
          </CardContent>
        </Card>
      )}

      {hasOrchestration && (
        <Card>
          <CardHeader><CardTitle>Orchestration DAG</CardTitle></CardHeader>
          <CardContent>
            <OrchestrationDag data={orchestration} />
          </CardContent>
        </Card>
      )}

      {hasToolFlow && (
        <Card>
          <CardHeader><CardTitle>Tool Execution Flow</CardTitle></CardHeader>
          <CardContent>
            <SankeyGraph
              flows={toolFlow.transitions}
              totals={toolFlow.toolCounts.map((t) => ({ id: t.toolName, value: t.count }))}
              ariaLabel="Tool execution flow"
              emptyMessage="No tool transitions recorded"
            />
          </CardContent>
        </Card>
      )}

      {hasCooccurrence && hasEffectiveness && (
        <Card>
          <CardHeader><CardTitle>Agent Collaboration Network</CardTitle></CardHeader>
          <CardContent>
            <AgentCollaborationNetwork data={effectiveness} edges={cooccurrence} />
          </CardContent>
        </Card>
      )}

      {hasEffectiveness && (
        <Card>
          <CardHeader><CardTitle>Subagent Effectiveness</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-[var(--muted-foreground)]">
                    <th className="py-2 text-left font-medium">Agent Type</th>
                    <th className="py-2 text-right font-medium">Total</th>
                    <th className="py-2 text-right font-medium">Completed</th>
                    <th className="py-2 text-right font-medium">Errors</th>
                    <th className="py-2 text-right font-medium">Success Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {effectiveness.map((e) => (
                    <tr key={e.subagentType} className="border-b border-[var(--border)]">
                      <td className="py-2 font-mono text-xs">{e.subagentType}</td>
                      <td className="py-2 text-right">{e.total}</td>
                      <td className="py-2 text-right text-[var(--success)]">{e.completed}</td>
                      <td className="py-2 text-right text-[var(--destructive)]">{e.errors}</td>
                      <td className="py-2 text-right">
                        <Badge variant={e.successRate >= 80 ? "default" : "secondary"}>
                          {e.successRate.toFixed(0)}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {toolFlow.toolCounts.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Tool Invocation Counts</CardTitle></CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      )}

      {!hasOrchestration && !hasToolFlow && !hasEffectiveness && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--muted-foreground)]">
            No workflow data yet. Agent orchestration patterns will appear here once sessions with subagents are recorded.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
