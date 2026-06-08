import { useState, useEffect, useCallback } from "react";
import { Button } from "@closedloop-ai/design-system/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@closedloop-ai/design-system/components/ui/card";
import { Badge } from "@closedloop-ai/design-system/components/ui/badge";
import { Checkbox } from "@closedloop-ai/design-system/components/ui/checkbox";

interface ActivityEvent {
  id: string;
  type?: string;
  summary?: string;
  timestamp?: string;
}

interface Job {
  id: string;
  description?: string;
  status?: string;
  startedAt?: string;
}

export function ActivityPanel() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [runningJobs, setRunningJobs] = useState<Job[]>([]);
  const [completedJobs, setCompletedJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRegular, setShowRegular] = useState(true);
  const [showSecurity, setShowSecurity] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [evts, running, completed] = await Promise.all([
        window.desktopApi.getActivityEvents(),
        window.desktopApi.listRunningJobs(),
        window.desktopApi.listCompletedJobs(),
      ]);
      setEvents((evts as ActivityEvent[]) ?? []);
      setRunningJobs((running as Job[]) ?? []);
      setCompletedJobs((completed as Job[]) ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleClear = async () => {
    await window.desktopApi.clearActivityEvents();
    await load();
  };

  const filtered = events.filter((e) => {
    const type = e.type ?? "";
    if (type.includes("security") || type.includes("auth")) return showSecurity;
    return showRegular;
  });

  const jobStatusVariant = (status?: string) => {
    if (status === "running" || status === "active") return "default";
    if (status === "completed" || status === "success") return "secondary";
    return "outline";
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Activity</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>Refresh</Button>
          <Button variant="outline" size="sm" onClick={handleClear}>Clear Activity</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Running Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {runningJobs.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)] text-center py-4">No running jobs</p>
          ) : (
            <div className="space-y-2">
              {runningJobs.map((j) => (
                <div key={j.id} className="flex items-center justify-between border rounded p-3 text-sm">
                  <span className="truncate">{j.description ?? j.id}</span>
                  <Badge variant={jobStatusVariant(j.status)}>{j.status ?? "running"}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <details className="group">
        <summary className="text-sm font-medium cursor-pointer text-[var(--foreground)] mb-2">Completed Jobs ({completedJobs.length})</summary>
        <Card className="mt-2">
          <CardContent>
            {completedJobs.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)] text-center py-4">No completed jobs</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {completedJobs.map((j) => (
                  <div key={j.id} className="flex items-center justify-between border rounded p-3 text-sm">
                    <span className="truncate">{j.description ?? j.id}</span>
                    <Badge variant={jobStatusVariant(j.status)}>{j.status ?? "completed"}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </details>

      <Card>
        <CardHeader>
          <CardTitle>Gateway Request Log</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer" htmlFor="show-regular-events">
              <Checkbox
                id="show-regular-events"
                checked={showRegular}
                onCheckedChange={(checked) => setShowRegular(checked === true)}
              />
              Show Regular Events
            </label>
            <label className="flex items-center gap-2 cursor-pointer" htmlFor="show-security-events">
              <Checkbox
                id="show-security-events"
                checked={showSecurity}
                onCheckedChange={(checked) => setShowSecurity(checked === true)}
              />
              Show Security Events
            </label>
          </div>
          {loading ? (
            <p className="text-sm text-[var(--muted-foreground)] text-center py-4">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)] text-center py-4">No events</p>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-1">
              {filtered.map((e) => (
                <div key={e.id} className="flex items-start gap-2 text-xs p-1.5 border-b last:border-0">
                  <span className="shrink-0 text-[var(--muted-foreground)] w-16">
                    {e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : ""}
                  </span>
                  <span className="font-medium">{e.type}</span>
                  <span className="text-[var(--muted-foreground)] truncate">{e.summary}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
