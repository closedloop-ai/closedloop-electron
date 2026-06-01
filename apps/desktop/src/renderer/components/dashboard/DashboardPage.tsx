import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@closedloop-ai/design-system/components/ui/card";
import { Badge } from "@closedloop-ai/design-system/components/ui/badge";
import type { DashboardSummary } from "../../main/database/types";

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  useEffect(() => {
    window.desktopApi.db
      .getDashboardSummary()
      .then((data) => setSummary(data as DashboardSummary))
      .catch(console.error);
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--foreground)]">Agent Dashboard</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          In-process agent session monitoring
        </p>
      </div>

      {summary ? (
        <>
          <div className="grid grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-[var(--muted-foreground)]">
                  Sessions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-[var(--foreground)]">{summary.totalSessions}</div>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {summary.activeSessions} active
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-[var(--muted-foreground)]">
                  Agents
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-[var(--foreground)]">{summary.totalAgents}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-[var(--muted-foreground)]">
                  Events
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-[var(--foreground)]">{summary.totalEvents}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-[var(--muted-foreground)]">
                  Token Usage
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-[var(--foreground)]">{summary.totalTokens}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent Sessions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {summary.recentSessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-sm">
                        {session.name || "Unnamed Session"}
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {session.model ?? "Unknown model"}
                        {session.cwd ? ` · ${session.cwd}` : ""}
                      </p>
                    </div>
                    <div className="ml-4 flex items-center gap-2">
                      <Badge
                        variant={
                          session.status === "running" ? "default" : "secondary"
                        }
                      >
                        {session.status}
                      </Badge>
                      <span className="text-xs text-[var(--muted-foreground)] whitespace-nowrap">
                        {session.startedAt
                          ? new Date(session.startedAt).toLocaleDateString()
                          : ""}
                      </span>
                    </div>
                  </div>
                ))}
                {summary.recentSessions.length === 0 && (
                  <p className="text-sm text-[var(--muted-foreground)] py-8 text-center">
                    No sessions recorded yet.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="flex items-center justify-center py-16">
          <p className="text-[var(--muted-foreground)]">Loading dashboard data...</p>
        </div>
      )}
    </div>
  );
}
