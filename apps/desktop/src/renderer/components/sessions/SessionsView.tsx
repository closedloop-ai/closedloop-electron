import { useState, useMemo } from "react";
import { Button } from "@closedloop-ai/design-system/components/ui/button";
import { MetricCard } from "@closedloop-ai/design-system/components/ui/primitives/metric-card";
import { SessionTable } from "@closedloop-ai/design-system/components/ui/composites/session-table";
import { MonitorDot, Activity, Bot, Coins } from "lucide-react";
import { useQueryCache } from "../../hooks/useQueryCache";
import { useSessionNav } from "./session-nav";
import type { SessionRow } from "@closedloop-ai/design-system/components/ui/types";
import type { SessionWithAgents } from "../../../main/database/types";

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

const STATUS_OPTIONS = ["all", "active", "waiting", "completed", "abandoned", "error"] as const;
const TERMINAL_STATUSES = ["completed", "abandoned", "error"];

export function SessionsView() {
  const { openSession } = useSessionNav();
  const { data: sessions, loading } = useQueryCache<SessionWithAgents[]>(
    "db:sessions-details",
    () => window.desktopApi.db.getSessionsWithDetails(),
  );
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const allSessions = sessions ?? [];

  const filtered = useMemo(() => {
    let result = allSessions;
    if (statusFilter !== "all") {
      result = result.filter((s) => s.status === statusFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          (s.name ?? "").toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          (s.cwd ?? "").toLowerCase().includes(q) ||
          (s.model ?? "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [allSessions, statusFilter, search]);

  const totalAgents = allSessions.reduce((a, s) => a + s.agentCount, 0);
  const totalTokens = allSessions.reduce((a, s) => a + s.totalTokens, 0);
  const activeSessions = allSessions.filter(
    (s) => !TERMINAL_STATUSES.includes(s.status),
  ).length;

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
          All agent sessions ({allSessions.length} total)
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <MetricCard label="Total Sessions" value={allSessions.length} icon={MonitorDot} />
        <MetricCard label="Active" value={activeSessions} icon={Activity} />
        <MetricCard label="Agents" value={totalAgents} icon={Bot} />
        <MetricCard label="Tokens" value={totalTokens.toLocaleString()} icon={Coins} />
      </div>

      <div className="flex items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sessions..."
          className="flex-1 bg-[var(--input)] border border-[var(--input-border)] rounded-md px-3 py-1.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
        />
        <div className="flex gap-1">
          {STATUS_OPTIONS.map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      <SessionTable
        rows={filtered.map(adaptSession)}
        renderSessionLink={(row) => (
          <button
            type="button"
            onClick={() => openSession(row.id)}
            className="text-left font-medium text-[var(--primary)] hover:underline"
          >
            {row.name}
          </button>
        )}
        emptyState={
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">
            {search || statusFilter !== "all"
              ? "No sessions match the current filters."
              : "No sessions recorded yet."}
          </div>
        }
      />
    </div>
  );
}
