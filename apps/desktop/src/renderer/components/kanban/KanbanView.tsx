import { useState } from "react";
import { KanbanBoardLayout, KanbanColumn, KanbanCardFrame } from "@closedloop-ai/design-system/components/ui/layout/kanban-board";
import { Badge } from "@closedloop-ai/design-system/components/ui/badge";
import { useQueryCache } from "../../hooks/useQueryCache";
import type { SessionWithAgents } from "../../main/database/types";

function PlayIcon() { return <span className="text-blue-400 text-xs">&#9654;</span>; }
function ClockIcon() { return <span className="text-yellow-400 text-xs">&#9201;</span>; }
function CheckIcon() { return <span className="text-green-400 text-xs">&#10003;</span>; }
function XIcon() { return <span className="text-red-400 text-xs">&#10007;</span>; }
function StopIcon() { return <span className="text-zinc-400 text-xs">&#9632;</span>; }

const COLUMNS = [
  { key: "running", label: "Running", icon: PlayIcon(), color: "text-blue-400" },
  { key: "waiting", label: "Waiting", icon: ClockIcon(), color: "text-yellow-400" },
  { key: "completed", label: "Completed", icon: CheckIcon(), color: "text-green-400" },
  { key: "failed", label: "Failed", icon: XIcon(), color: "text-red-400" },
  { key: "stopped", label: "Stopped", icon: StopIcon(), color: "text-zinc-400" },
];

export function KanbanView() {
  const { data: sessions, loading } = useQueryCache<SessionWithAgents[]>(
    "db:sessions-details",
    () => window.desktopApi.db.getSessionsWithDetails() as Promise<SessionWithAgents[]>,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (loading || !sessions) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-[var(--muted-foreground)]">Loading...</p>
      </div>
    );
  }

  const grouped: Record<string, SessionWithAgents[]> = {};
  for (const col of COLUMNS) {
    grouped[col.key] = sessions.filter((s) => s.status === col.key);
  }

  const uncategorized = sessions.filter(
    (s) => !COLUMNS.some((c) => c.key === s.status),
  );

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-[var(--foreground)]">My Tasks</h1>

        <p className="text-sm text-[var(--muted-foreground)]">
          Sessions grouped by status
        </p>
      </div>

      <div className="flex-1 overflow-auto">
        <KanbanBoardLayout>
          {COLUMNS.map((col) => {
            const items = grouped[col.key] ?? [];
            return (
              <KanbanColumn
                key={col.key}
                title={col.label}
                count={items.length}
                icon={col.icon}
                emptyState={
                  <div className="py-6 text-center text-xs text-[var(--muted-foreground)]">
                    No {col.label.toLowerCase()} sessions
                  </div>
                }
              >
                {items.map((session) => (
                  <KanbanCardFrame
                    key={session.id}
                    active={session.id === selectedId}
                  >
                    <button
                      className="w-full text-left"
                      onClick={() => setSelectedId(selectedId === session.id ? null : session.id)}
                    >
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">
                        {session.name ?? "Unnamed"}
                      </p>
                      {session.model && (
                        <p className="truncate text-xs text-[var(--muted-foreground)] mt-0.5">
                          {session.model}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[11px] text-[var(--muted-foreground)]">
                          {session.agentCount} agents
                        </span>
                        <span className="text-[11px] text-[var(--muted-foreground)]">
                          {session.totalTokens.toLocaleString()} tokens
                        </span>
                      </div>
                    </button>
                  </KanbanCardFrame>
                ))}
              </KanbanColumn>
            );
          })}

          {uncategorized.length > 0 && (
            <KanbanColumn
              title="Other"
              count={uncategorized.length}
              emptyState={null}
            >
              {uncategorized.map((session) => (
                <KanbanCardFrame key={session.id}>
                  <p className="truncate text-sm font-medium">{session.name ?? "Unnamed"}</p>
                  <Badge variant="secondary">{session.status}</Badge>
                </KanbanCardFrame>
              ))}
            </KanbanColumn>
          )}
        </KanbanBoardLayout>
      </div>
    </div>
  );
}
