import { Button } from "@closedloop-ai/design-system/components/ui/button";
import type { NavId } from "../../App";

interface NavItem {
  id: NavId;
  label: string;
  icon: string;
  section: "agent" | "gateway";
}

const NAV_ITEMS: NavItem[] = [
  { id: "kanban", label: "My Tasks", icon: "kanban", section: "agent" },
  { id: "dashboard", label: "Sessions", icon: "dashboard", section: "agent" },
  { id: "activity", label: "Activity", icon: "activity", section: "agent" },
  { id: "analytics", label: "Analytics", icon: "analytics", section: "agent" },
  { id: "workflows", label: "Workflows", icon: "workflows", section: "agent" },
  { id: "packs", label: "Packs", icon: "package", section: "agent" },
  { id: "skills", label: "Skills", icon: "sparkles", section: "agent" },
  { id: "tools", label: "Tools", icon: "wrench", section: "agent" },
  { id: "subagents", label: "SubAgents", icon: "bot", section: "agent" },
  { id: "plans", label: "Plans", icon: "clipboard", section: "agent" },
  { id: "pull-requests", label: "Pull Requests", icon: "git-pull-request", section: "agent" },
  { id: "approvals", label: "Approvals", icon: "shield", section: "gateway" },
  { id: "requests", label: "Requests", icon: "inbox", section: "gateway" },
  { id: "diagnostics", label: "Diagnostics", icon: "stethoscope", section: "gateway" },
  { id: "settings", label: "Settings", icon: "settings", section: "gateway" },
];

const SVG_ICONS: Record<string, string> = {
  dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  kanban: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  sessions: '<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  analytics: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  workflows: '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
  package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  sparkles: '<path d="M9.94 14.56a1.31 1.31 0 0 0 0-2.12L7.7 10.2a1.31 1.31 0 0 0-2.12 0L3.34 12.44a1.31 1.31 0 0 0 0 2.12l2.24 2.24a1.31 1.31 0 0 0 2.12 0Z"/><path d="M17 2v4"/><path d="M19 4h-4"/><path d="M18 13v6"/><path d="M21 16h-6"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  clipboard: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M8 12h8"/><path d="M8 16h6"/>',
  "git-pull-request": '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  stethoscope: '<path d="M11 2v2"/><path d="M5 2v2"/><path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"/><path d="M8 15a6 6 0 0 0 12 0v-3"/><circle cx="20" cy="10" r="2"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
};

function NavIcon({ name }: { name: string }) {
  const paths = SVG_ICONS[name] || "";
  return (
    <span className="shrink-0 size-[18px] text-current opacity-70">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-full">
        <g dangerouslySetInnerHTML={{ __html: paths }} />
      </svg>
    </span>
  );
}

interface SidebarProps {
  collapsed: boolean;
  activeNav: NavId;
  onNavigate: (id: NavId) => void;
  runtimeHealthy: boolean;
}

export function Sidebar({ collapsed, activeNav, onNavigate, runtimeHealthy }: SidebarProps) {
  const agentItems = NAV_ITEMS.filter((i) => i.section === "agent");
  const gatewayItems = NAV_ITEMS.filter((i) => i.section === "gateway");

  const navWidth = collapsed ? "w-[52px]" : "w-[200px]";

  return (
    <aside className={`${navWidth} flex flex-col border-r bg-[var(--sidebar)] text-[var(--sidebar-foreground)] transition-all duration-200`}>
      <div className="flex items-center gap-2 h-12 px-3 border-b shrink-0">
        <svg viewBox="0 0 100 100" fill="none" className="size-5 shrink-0 text-[var(--primary)]">
          <path d="M0.424623 49.6765C0.339767 56.2176 1.55939 62.7103 4.01272 68.7779C6.46604 74.8455 10.1042 80.3673 14.7161 85.0227C19.3281 89.6781 24.8219 93.3744 30.8788 95.8973C36.9358 98.4202 43.4352 99.7193 50 99.7193C56.5648 99.7193 63.0643 98.4202 69.1212 95.8973C75.1782 93.3744 80.672 89.6781 85.2839 85.0227C89.8958 80.3673 93.534 74.8455 95.9873 68.7779C98.4406 62.7103 99.6603 56.2176 99.5754 49.6765C99.5754 49.5115 99.5754 49.3546 99.5754 49.1895H71.7496C71.7496 49.3546 71.7496 49.5115 71.7496 49.6765C71.7496 53.9658 70.473 58.1587 68.0814 61.7249C65.6898 65.2912 62.2906 68.0706 58.3136 69.7117C54.3367 71.3527 49.9606 71.7817 45.739 70.9443C41.5174 70.1069 37.6398 68.0408 34.5966 65.0072C31.5535 61.9737 29.4815 58.109 28.6428 53.902C27.804 49.695 28.2361 45.3346 29.8845 41.3723C31.5329 37.4101 34.3235 34.0239 37.9033 31.6421C41.4831 29.2603 45.6914 27.9899 49.9959 27.9915H50.0704L50.0373 0.280626C43.524 0.275203 37.0735 1.54886 31.0545 4.02881C25.0354 6.50876 19.5659 10.1464 14.9583 14.7338C10.3508 19.3211 6.69575 24.7683 4.20197 30.764C1.70819 36.7597 0.424621 43.1863 0.424623 49.6765Z" fill="currentColor" />
          <path d="M57.1534 0.801147V29.2137C60.1811 30.2616 62.939 31.9629 65.2303 34.1961C67.5215 36.4293 69.2895 39.1392 70.4077 42.1323H99.004C97.3792 31.6897 92.4381 22.0411 84.906 14.6024C77.3738 7.16375 67.6471 2.32669 57.1534 0.801147Z" fill="#41A3FF" />
        </svg>
        {!collapsed && <span className="text-sm font-semibold truncate">ClosedLoop Gateway</span>}
      </div>

      <nav className="flex-1 overflow-y-auto py-2 px-1.5 space-y-1">
        {collapsed ? null : (
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] px-2 pb-1">Agents</div>
        )}
        {agentItems.map((item) => (
          <Button
            key={item.id}
            type="button"
            variant="ghost"
            onClick={() => onNavigate(item.id)}
            className={`h-auto w-full justify-start gap-2.5 px-2 py-1.5 text-sm transition-colors ${
              activeNav === item.id
                ? "bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)] font-medium"
                : "text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)]/60"
            }`}
            title={item.label}
          >
            <NavIcon name={item.icon} />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Button>
        ))}

        {collapsed ? (
          <div className="border-t my-2" />
        ) : (
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] px-2 pt-3 pb-1">Gateway</div>
        )}
        {gatewayItems.map((item) => (
          <Button
            key={item.id}
            type="button"
            variant="ghost"
            onClick={() => onNavigate(item.id)}
            className={`h-auto w-full justify-start gap-2.5 px-2 py-1.5 text-sm transition-colors ${
              activeNav === item.id
                ? "bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)] font-medium"
                : "text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)]/60"
            }`}
            title={item.label}
          >
            <NavIcon name={item.icon} />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Button>
        ))}
      </nav>

      <div className="border-t px-2 py-2 shrink-0">
        <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
          <span className={`size-2 rounded-full ${runtimeHealthy ? "bg-[var(--success)]" : "bg-[var(--destructive)]"}`} />
          {!collapsed && <span className="truncate">{runtimeHealthy ? "Healthy" : "Unhealthy"}</span>}
        </div>
      </div>
    </aside>
  );
}
