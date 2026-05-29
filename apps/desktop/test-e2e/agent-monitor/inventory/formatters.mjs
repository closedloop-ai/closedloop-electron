// Mirrors the agent-dashboard client's value formatters so the audit runner
// can predict the rendered text from an oracle value. If the upstream
// formatter changes, this file must change with it — the build hard-gates
// would catch a divergent shape, but a silent locale/precision shift is
// exactly the kind of bug the audit is meant to surface.
//
// Source of truth: agent-dashboard-client/src/lib/format.ts (`fmt`, `fmtCost`).

/** fmt(n) — large-number short form. Mirrors client `fmt`. */
export function fmt(n) {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** fmtCost(n) — short dollar form. Mirrors client `fmtCost`. */
export function fmtCost(n) {
  if (!Number.isFinite(n) || n < 0) return "$0.00";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

/** Raw integer — just `String(n)`. Used for tiles that render the number
 *  directly without short-form (e.g., Active Agents tile renders
 *  `stats.active_agents` not `fmt(stats.active_agents)`). */
export function raw_int(n) {
  return String(Math.trunc(Number(n)));
}

export const formatters = { fmt, fmtCost, raw_int };

/**
 * Apply the named formatter from a manifest row. Returns a string.
 * Throws if the formatter name is unknown — fail loudly rather than
 * silently miscompare.
 */
export function applyFormatter(name, value) {
  const fn = formatters[name];
  if (!fn) {
    throw new Error(
      `Unknown formatter "${name}" — add it to inventory/formatters.mjs ` +
        `or fix the manifest row.`,
    );
  }
  return fn(value);
}
