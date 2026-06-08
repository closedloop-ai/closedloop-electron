import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@closedloop-ai/design-system/components/ui/button";

interface TopbarProps {
  collapsed: boolean;
  onToggleSidebar: () => void;
  navId: string;
  runtimeStatus: Record<string, unknown> | null;
}

const NAV_LABELS: Record<string, string> = {
  dashboard: "Sessions",
  kanban: "My Tasks",
  activity: "Activity",
  analytics: "Analytics",
  workflows: "Workflows",
  packs: "Packs",
  skills: "Skills",
  tools: "Tools",
  subagents: "SubAgents",
  plans: "Plans",
  "pull-requests": "Pull Requests",
  approvals: "Approvals",
  requests: "Requests",
  diagnostics: "Diagnostics",
  settings: "Settings",
};

export function Topbar({ collapsed, onToggleSidebar, navId, runtimeStatus }: TopbarProps) {
  const section = ["approvals", "requests", "diagnostics", "settings"].includes(navId)
    ? "Gateway"
    : "Agents";
  const label = NAV_LABELS[navId] ?? navId;

  return (
    <header className="flex items-center gap-3 h-12 px-3 border-b shrink-0 bg-[var(--card)]">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onToggleSidebar}
        className="text-[var(--muted-foreground)]"
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
      </Button>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-[var(--muted-foreground)]">{section}</span>
        <span className="text-[var(--muted-foreground)]">/</span>
        <span className="font-medium">{label}</span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-3 text-xs">
        {runtimeStatus && (
          <span className="text-[var(--muted-foreground)]">
            Port: {(runtimeStatus as Record<string, unknown>).port as string ?? "..."}
          </span>
        )}
      </div>
    </header>
  );
}
