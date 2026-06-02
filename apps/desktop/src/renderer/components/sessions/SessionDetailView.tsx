import { Card, CardContent, CardHeader, CardTitle } from "@closedloop-ai/design-system/components/ui/card";
import { Badge } from "@closedloop-ai/design-system/components/ui/badge";
import { Button } from "@closedloop-ai/design-system/components/ui/button";
import { ArrowLeft, Bot, Coins, Clock, Cpu, FolderGit2 } from "lucide-react";
import { useQueryCache } from "../../hooks/useQueryCache";
import type {
  SessionWithAgents,
  AgentHierarchyNode,
  EventRow,
} from "../../../main/database/types";

const EVENT_TIMELINE_CAP = 200;

function statusTone(status: string): string {
  switch (status) {
    case "active":
    case "working":
      return "bg-blue-500/10 text-blue-600";
    case "waiting":
      return "bg-yellow-500/10 text-yellow-700";
    case "completed":
      return "bg-green-500/10 text-green-600";
    case "error":
      return "bg-red-500/10 text-red-600";
    case "abandoned":
      return "bg-zinc-500/10 text-zinc-600";
    default:
      return "bg-zinc-500/10 text-zinc-600";
  }
}

function formatDuration(startedAt: string | null, endedAt: string | null, updatedAt: string | null): string {
  if (!startedAt) return "—";
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt ?? updatedAt ?? startedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "—";
  const sec = Math.round((end - start) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

function AgentNode({ node, depth }: { node: AgentHierarchyNode; depth: number }) {
  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 text-sm border-b border-[var(--border)]/40"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <Bot className="size-3.5 text-[var(--muted-foreground)] shrink-0" />
        <span className="font-medium truncate">{node.name ?? node.agentId}</span>
        {node.subagentType && (
          <span className="text-xs text-[var(--muted-foreground)]">({node.subagentType})</span>
        )}
        <Badge className={`ml-auto text-[10px] ${statusTone(node.status)}`}>{node.status}</Badge>
        {node.currentTool && (
          <span className="text-xs text-[var(--muted-foreground)]">{node.currentTool}</span>
        )}
      </div>
      {node.children.map((child) => (
        <AgentNode key={child.agentId} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export function SessionDetailView({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  // Reuses the shared db:sessions-details cache (also feeding the list/kanban),
  // so opening a detail view issues no extra round-trip for header data.
  const { data: sessions } = useQueryCache<SessionWithAgents[]>(
    "db:sessions-details",
    () => window.desktopApi.db.getSessionsWithDetails(),
  );
  const { data: hierarchy } = useQueryCache<AgentHierarchyNode[]>(
    `db:agent-hierarchy:${sessionId}`,
    () => window.desktopApi.db.getAgentHierarchy(sessionId),
  );
  const { data: events } = useQueryCache<EventRow[]>(
    `db:events:${sessionId}`,
    () => window.desktopApi.db.getEvents(sessionId),
  );

  const session = (sessions ?? []).find((s) => s.id === sessionId);
  const timeline = (events ?? []).slice(-EVENT_TIMELINE_CAP).reverse();
  const truncated = (events?.length ?? 0) > EVENT_TIMELINE_CAP;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        <h1 className="text-xl font-bold truncate">{session?.name ?? sessionId}</h1>
        {session && <Badge className={statusTone(session.status)}>{session.status}</Badge>}
        {session?.harness && (
          <Badge className="bg-[var(--muted)] text-[var(--muted-foreground)]">{session.harness}</Badge>
        )}
      </div>

      {!session ? (
        <p className="text-sm text-[var(--muted-foreground)]">Session not found.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Meta icon={Cpu} label="Model" value={session.model ?? "—"} />
            <Meta icon={FolderGit2} label="Directory" value={session.cwd ?? "—"} />
            <Meta icon={Clock} label="Duration" value={formatDuration(session.startedAt, session.endedAt, session.updatedAt)} />
            <Meta icon={Coins} label="Tokens" value={session.totalTokens.toLocaleString()} />
            <Meta icon={Bot} label="Agents" value={String(session.agentCount)} />
            <Meta icon={Coins} label="Events" value={String(session.eventCount)} />
            {session.billingMode && <Meta icon={Coins} label="Billing" value={session.billingMode} />}
            {session.awaitingInputSince && <Meta icon={Clock} label="Awaiting input since" value={session.awaitingInputSince} />}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Agent hierarchy</CardTitle>
            </CardHeader>
            <CardContent>
              {hierarchy && hierarchy.length > 0 ? (
                hierarchy.map((node) => <AgentNode key={node.agentId} node={node} depth={0} />)
              ) : (
                <p className="text-sm text-[var(--muted-foreground)]">No agents recorded.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                Event timeline
                {truncated && (
                  <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">
                    (most recent {EVENT_TIMELINE_CAP} of {events?.length})
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {timeline.length > 0 ? (
                <div className="space-y-1">
                  {timeline.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 py-1 text-sm border-b border-[var(--border)]/30">
                      <Badge className="text-[10px] bg-[var(--muted)] text-[var(--muted-foreground)]">{e.eventType}</Badge>
                      {e.toolName && <span className="text-xs font-mono">{e.toolName}</span>}
                      {e.summary && <span className="truncate text-[var(--muted-foreground)]">{e.summary}</span>}
                      <span className="ml-auto text-xs text-[var(--muted-foreground)] shrink-0">{e.createdAt}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--muted-foreground)]">No events recorded.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Meta({ icon: Icon, label, value }: { icon: typeof Bot; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="size-4 text-[var(--muted-foreground)] mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
        <p className="font-medium truncate" title={value}>{value}</p>
      </div>
    </div>
  );
}
