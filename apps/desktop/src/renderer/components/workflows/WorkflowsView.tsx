import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@closedloop-ai/design-system/components/ui/card";
import { Badge } from "@closedloop-ai/design-system/components/ui/badge";
import { MetricCard } from "@closedloop-ai/design-system/components/ui/primitives/metric-card";
import type { SessionWithAgents, AgentHierarchyNode } from "../../main/database/types";

function AgentTreeNode({ node, depth }: { node: AgentHierarchyNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className={`flex items-center gap-2 rounded-lg border border-zinc-800 p-2.5 text-sm hover:bg-zinc-800/50 cursor-pointer ${
          depth > 0 ? "ml-6" : ""
        }`}
        onClick={() => setExpanded((e) => !e)}
      >
        {hasChildren ? (
          expanded ? (
            <span className="shrink-0 text-[var(--muted-foreground)] text-xs">&#9660;</span>
          ) : (
            <span className="shrink-0 text-[var(--muted-foreground)] text-xs">&#9654;</span>
          )
        ) : (
          <span className="w-3.5" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-[var(--foreground)]">
            {node.name ?? node.subagentType ?? node.type ?? "Agent"}
          </p>
          {node.task && (
            <p className="truncate text-xs text-[var(--muted-foreground)]">{node.task}</p>
          )}
        </div>
        <Badge
          variant={
            node.status === "running"
              ? "default"
              : node.status === "completed"
                ? "secondary"
                : "outline"
          }
        >
          {node.status}
        </Badge>
        {node.currentTool && (
          <span className="text-xs font-mono text-[var(--muted-foreground)]">
            {node.currentTool}
          </span>
        )}
      </div>
      {expanded && hasChildren && (
        <div className="space-y-1 mt-1">
          {node.children.map((child) => (
            <AgentTreeNode key={child.agentId} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkflowsView() {
  const [sessions, setSessions] = useState<SessionWithAgents[]>([]);
  const [hierarchies, setHierarchies] = useState<Map<string, AgentHierarchyNode[]>>(new Map());
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.desktopApi.db
      .getSessionsWithDetails()
      .then(async (data) => {
        const allSessions = data as SessionWithAgents[];
        setSessions(allSessions);

        const hierarchyMap = new Map<string, AgentHierarchyNode[]>();
        for (const s of allSessions) {
          try {
            const tree = await window.desktopApi.db.getAgentHierarchy(s.id);
            hierarchyMap.set(s.id, tree as AgentHierarchyNode[]);
          } catch {
            hierarchyMap.set(s.id, []);
          }
        }
        setHierarchies(hierarchyMap);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-[var(--muted-foreground)]">Loading workflows...</p>
      </div>
    );
  }

  const sessionsWithAgents = sessions.filter((s) => s.agentCount > 0);
  const totalSubagents = [...hierarchies.values()].reduce(
    (sum, roots) => sum + roots.reduce((s, r) => s + countNodes(r), 0),
    0,
  );

  const metrics = [
    { label: "Sessions", value: sessionsWithAgents.length },
    { label: "Agent Trees", value: totalSubagents },
    { label: "Avg Depth", value: sessionsWithAgents.length > 0 ? "~3" : "0" },
    { label: "Active Flows", value: sessionsWithAgents.filter((s) => s.status === "running").length },
  ];

  const displaySession = selectedSessionId
    ? sessions.find((s) => s.id === selectedSessionId)
    : sessionsWithAgents[0];

  const tree = displaySession ? hierarchies.get(displaySession.id) ?? [] : [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--foreground)]">Workflows</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Agent pipeline and delegation trees
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {metrics.map((m) => (
          <MetricCard key={m.label} label={m.label} value={m.value} icon={m.icon} />
        ))}
      </div>

      {sessionsWithAgents.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {sessionsWithAgents.slice(0, 10).map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedSessionId(s.id)}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                displaySession?.id === s.id
                  ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                  : "bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700"
              }`}
            >
              {s.name ?? s.id.slice(0, 8)}
            </button>
          ))}
        </div>
      )}

      {displaySession && (
        <Card>
          <CardHeader>
            <CardTitle>
              {displaySession.name ?? "Session"} — Agent Tree
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tree.length > 0 ? (
              <div className="space-y-1">
                {tree.map((root) => (
                  <AgentTreeNode key={root.agentId} node={root} depth={0} />
                ))}
              </div>
            ) : (
              <p className="py-8 text-sm text-center text-[var(--muted-foreground)]">
                No agent hierarchy data for this session.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {sessionsWithAgents.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">
            No workflow data available yet. Start an agent session to see delegation trees.
          </p>
        </div>
      )}
    </div>
  );
}

function countNodes(node: AgentHierarchyNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}
