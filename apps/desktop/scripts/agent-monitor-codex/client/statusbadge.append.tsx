

/**
 * CLOSEDLOOP Codex support (Addition #6): which agent harness produced a
 * session. Legacy/empty values render as "Claude" to match the DB default.
 */
export function HarnessBadge({ harness }: { harness?: string | null }) {
  const isCodex = (harness || "claude").toLowerCase() === "codex";
  const cls = isCodex
    ? "bg-sky-500/10 text-sky-300 border border-sky-500/20"
    : "bg-violet-500/10 text-violet-300 border border-violet-500/20";
  return <span className={`badge ${cls}`}>{isCodex ? "Codex" : "Claude"}</span>;
}
