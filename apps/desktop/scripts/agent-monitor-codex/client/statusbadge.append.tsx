

/**
 * CLOSEDLOOP multi-harness support: which agent harness produced a session.
 * Legacy/empty values render as "Claude" to match the DB default.
 */
export function HarnessBadge({ harness }: { harness?: string | null }) {
  const h = (harness || "claude").toLowerCase();
  const config: Record<string, { label: string; cls: string }> = {
    codex:    { label: "Codex",    cls: "bg-sky-500/10 text-sky-300 border border-sky-500/20" },
    cursor:   { label: "Cursor",   cls: "bg-amber-500/10 text-amber-300 border border-amber-500/20" },
    copilot:  { label: "Copilot",  cls: "bg-green-500/10 text-green-300 border border-green-500/20" },
    opencode: { label: "OpenCode", cls: "bg-rose-500/10 text-rose-300 border border-rose-500/20" },
  };
  const { label, cls } = config[h] || { label: "Claude", cls: "bg-violet-500/10 text-violet-300 border border-violet-500/20" };
  return <span className={`badge ${cls}`}>{label}</span>;
}
