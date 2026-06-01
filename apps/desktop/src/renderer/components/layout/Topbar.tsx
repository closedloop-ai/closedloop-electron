import { useCallback } from "react";

interface TopbarProps {
  collapsed: boolean;
  onToggleSidebar: () => void;
  navId: string;
  runtimeStatus: Record<string, unknown> | null;
}

const NAV_LABELS: Record<string, string> = {
  dashboard: "Sessions",
  kanban: "My Tasks",
  agents: "Agents",
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
      <button
        type="button"
        onClick={onToggleSidebar}
        className="p-1 rounded hover:bg-[var(--accent)] text-[var(--muted-foreground)]"
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M9 3v18" />
        </svg>
      </button>

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
