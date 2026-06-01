import { useState, useEffect, useCallback } from "react";
import { Button } from "@closedloop-ai/design-system/components/ui/button";
import { Badge } from "@closedloop-ai/design-system/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@closedloop-ai/design-system/components/ui/card";

interface Approval {
  id: string;
  reason: string;
  request?: { path?: string; args?: Record<string, unknown> };
  tier?: string;
  createdAt?: string;
}

export function ApprovalsPanel() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.desktopApi.getPendingApprovals();
      setApprovals(data as Approval[]);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id: string) => {
    await window.desktopApi.approveApproval(id);
    await load();
  };
  const handleDeny = async (id: string) => {
    await window.desktopApi.denyApproval(id);
    await load();
  };
  const handleAlwaysAllow = async (id: string) => {
    await window.desktopApi.alwaysAllowApproval(id);
    await load();
  };
  const handleClear = async () => {
    await window.desktopApi.clearPendingApprovals();
    await load();
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Approvals</h2>
          <p className="text-sm text-[var(--muted-foreground)]">Pending requests that need approval</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>Refresh</Button>
          <Button variant="outline" size="sm" onClick={handleClear}>Clear Queue</Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-[var(--muted-foreground)]">Loading approvals...</p>
        </div>
      ) : approvals.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--muted-foreground)]">
            No pending approvals
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {approvals.map((a) => (
            <Card key={a.id}>
              <CardContent className="pt-4">
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-medium">{a.reason}</p>
                      {a.request?.path && (
                        <p className="text-xs font-mono text-[var(--muted-foreground)] break-all">{a.request.path}</p>
                      )}
                    </div>
                    <Badge variant="outline">{a.tier ?? "unknown"}</Badge>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={() => handleApprove(a.id)}>Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => handleDeny(a.id)}>Deny</Button>
                    <Button size="sm" variant="secondary" onClick={() => handleAlwaysAllow(a.id)}>Always Allow</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
