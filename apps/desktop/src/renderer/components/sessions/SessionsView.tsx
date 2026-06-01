import { useState, useEffect } from "react";
import { MetricCard } from "@closedloop-ai/design-system/components/ui/primitives/metric-card";
import { SessionTable } from "@closedloop-ai/design-system/components/ui/composites/session-table";
import type { SessionRow } from "@closedloop-ai/design-system/components/ui/types";
import type { SessionWithAgents } from "../../main/database/types";

function adaptSession(raw: SessionWithAgents): SessionRow {
  return {
    id: raw.id,
    name: raw.name ?? "Unnamed Session",
    repo: raw.cwd ?? "",
    model: raw.model ?? "",
    harness: raw.harness ?? "claude",
    status: raw.status,
    startedAt: raw.startedAt ?? "",
    lastActivity: raw.updatedAt ?? raw.startedAt ?? "",
    cost: 0,
    agents: raw.agentCount,
    totalTokens: raw.totalTokens,
    awaitingInputSince: raw.awaitingInputSince,
  };
}

export function SessionsView() {
  const [sessions, setSessions] = useState<SessionWithAgents[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.desktopApi.db
      .getSessionsWithDetails()
      .then((data) => {
        setSessions(data as SessionWithAgents[]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const totalAgents = sessions.reduce((a, s) => a + s.agentCount, 0);
  const totalEvents = sessions.reduce((a, s) => a + s.eventCount, 0);
  const totalTokens = sessions.reduce((a, s) => a + s.totalTokens, 0);
  const activeSessions = sessions.filter(
    (s) => !["completed", "failed", "stopped"].includes(s.status),
  ).length;

  const metrics = [
    { label: "Total Sessions", value: sessions.length },
    { label: "Active", value: activeSessions },
    { label: "Agents", value: totalAgents },
    { label: "Tokens", value: totalTokens.toLocaleString() },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-[var(--muted-foreground)]">Loading sessions...</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--foreground)]">Sessions</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          All agent sessions ({sessions.length} total)
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {metrics.map((m) => (
          <MetricCard key={m.label} label={m.label} value={m.value} icon={m.icon} />
        ))}
      </div>

      <SessionTable
        rows={sessions.map(adaptSession)}
        emptyState={
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">
            No sessions recorded yet.
          </div>
        }
      />
    </div>
  );
}
