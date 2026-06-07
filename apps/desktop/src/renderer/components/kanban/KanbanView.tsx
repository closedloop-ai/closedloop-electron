import { useState } from "react";
import { KanbanBoardLayout, KanbanColumn, KanbanCardFrame } from "@closedloop-ai/design-system/components/ui/layout/kanban-board";
import { useQueryCache } from "../../hooks/useQueryCache";
import type { KanbanPages, SessionWithAgents } from "../../../shared/agent-db-contract";

function PlayIcon() { return <span className="text-blue-400 text-xs">&#9654;</span>; }
function ClockIcon() { return <span className="text-yellow-400 text-xs">&#9201;</span>; }
function CheckIcon() { return <span className="text-green-400 text-xs">&#10003;</span>; }
function XIcon() { return <span className="text-red-400 text-xs">&#10007;</span>; }
function StopIcon() { return <span className="text-zinc-400 text-xs">&#9632;</span>; }

const COLUMNS = [
  { key: "running", label: "Running", status: "running", icon: PlayIcon(), color: "text-blue-400" },
  { key: "waiting", label: "Waiting", status: "waiting", icon: ClockIcon(), color: "text-yellow-400" },
  { key: "completed", label: "Completed", status: "completed", icon: CheckIcon(), color: "text-green-400" },
  { key: "failed", label: "Failed", status: "error", icon: XIcon(), color: "text-red-400" },
  { key: "stopped", label: "Stopped", status: "abandoned", icon: StopIcon(), color: "text-zinc-400" },
];
const KANBAN_COLUMN_LIMIT = 25;

const KANBAN_STATUSES = COLUMNS.map((c) => c.status);

export function KanbanView() {
  const { data: pages, loading } = useQueryCache<KanbanPages>(
    "db:kanban-session-pages",
    () => window.desktopApi.db.getKanbanPages(KANBAN_STATUSES, KANBAN_COLUMN_LIMIT),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (loading || !pages) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-[var(--muted-foreground)]">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-[var(--foreground)]">My Tasks</h1>

        <p className="text-sm text-[var(--muted-foreground)]">
          Recent sessions grouped by status
        </p>
      </div>

      <div className="flex-1 overflow-auto">
        <KanbanBoardLayout>
          {COLUMNS.map((col) => {
            const page = pages[col.key];
            const items: SessionWithAgents[] = page?.sessions ?? [];
            return (
              <KanbanColumn
                key={col.key}
                title={col.label}
                count={page?.total ?? items.length}
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
                {(page?.total ?? 0) > items.length ? (
                  <div className="px-2 py-3 text-center text-xs text-[var(--muted-foreground)]">
                    Showing latest {items.length} of {page?.total}
                  </div>
                ) : null}
              </KanbanColumn>
            );
          })}
        </KanbanBoardLayout>
      </div>
    </div>
  );
}
