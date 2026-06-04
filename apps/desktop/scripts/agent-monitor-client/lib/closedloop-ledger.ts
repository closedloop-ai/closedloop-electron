/**
 * @file closedloop-ledger.ts
 * @description ClosedLoop-authored client helper (FEA-1434) for the two-ledger
 * cost UI. Copied to `src/lib/closedloop-ledger.ts` at build time by
 * scripts/build-agent-monitor.mjs via CLIENT_FULL_FILE_OVERRIDES, then bundled
 * by Vite. It centralises, in ONE place shared by every overlay:
 *   1. the localStorage-backed "show hypothetical API cost for subscription
 *      sessions" preference (Settings writes it, the Dashboard reads it);
 *   2. the `CostByLedger` shape the /api/pricing/cost and /api/analytics
 *      endpoints attach as `cost_by_ledger`; and
 *   3. presentation-only billing-mode classification + labels for the
 *      per-session "subscription-covered" badge.
 *
 * IMPORTANT — no cost math happens here. The canonical token-cost engine
 * (genai-prices) and the server's ledger split
 * (apps/desktop/scripts/agent-monitor-billing/billing-mode.js → billingLedger)
 * own every dollar figure. SUBSCRIPTION_BILLING_MODES below is a presentation
 * mirror of the SUBSCRIPTION_MODES set in that server module, used only to
 * decide whether to draw a badge and what to label it. A drift here can only
 * mislabel a cosmetic badge — it can never change a headline or ledger total,
 * which are computed server-side and never recomputed on the client.
 */

// ─── "Show hypothetical API cost" preference (localStorage) ───

export const LEDGER_PREFS_KEY = "agent-monitor-ledger";

export interface LedgerPrefs {
  /**
   * When true the Dashboard surfaces the hypothetical API cost of
   * subscription-covered usage (the "would have cost"). Off by default so the
   * headline shows only really-billed spend (metered + unknown); the
   * subscription bucket is a hypothetical and is never summed into the
   * headline regardless of this flag.
   */
  showHypotheticalCost: boolean;
}

export const defaultLedgerPrefs: LedgerPrefs = {
  showHypotheticalCost: false,
};

export function loadLedgerPrefs(): LedgerPrefs {
  try {
    const raw = localStorage.getItem(LEDGER_PREFS_KEY);
    if (!raw) return { ...defaultLedgerPrefs };
    return { ...defaultLedgerPrefs, ...JSON.parse(raw) };
  } catch {
    return { ...defaultLedgerPrefs };
  }
}

export function saveLedgerPrefs(prefs: LedgerPrefs): void {
  localStorage.setItem(LEDGER_PREFS_KEY, JSON.stringify(prefs));
}

// ─── Two-ledger totals shape ───

/**
 * The three-bucket totals the cost + analytics endpoints attach as
 * `cost_by_ledger`. Headline cost = metered + unknown; `subscription` is the
 * hypothetical "would have cost" and is never summed into the headline. The
 * upstream CostResult/Analytics types predate this field, so consumers read it
 * through this locally-declared shape.
 */
export interface CostByLedger {
  metered: number;
  subscription: number;
  unknown: number;
}

// ─── Billing-mode presentation (mirror of server SSOT, badge-only) ───

/**
 * Presentation mirror of SUBSCRIPTION_MODES in the server billing-mode engine
 * (apps/desktop/scripts/agent-monitor-billing/billing-mode.js). Used ONLY to
 * decide whether a session is subscription-covered for the badge — never for
 * cost math. Keep in sync with the server set; a mismatch only affects a badge.
 */
export const SUBSCRIPTION_BILLING_MODES: ReadonlySet<string> = new Set([
  "subscription_unknown",
  "pro",
  "max_5x",
  "max_20x",
  "codex_subscription",
  "cursor_pro",
  "copilot_seat",
]);

/** True when a stored billing_mode represents subscription-covered usage. */
export function isSubscriptionMode(mode: string | null | undefined): boolean {
  return mode != null && SUBSCRIPTION_BILLING_MODES.has(mode);
}

/**
 * Human-friendly label for a subscription billing_mode shown on the badge.
 * Existence-only detection can't resolve Anthropic tiers yet (subscription_unknown
 * → "Subscription"); finer tiers (Pro / Max 5x / Max 20x) arrive once `/status`
 * parsing lands (out of scope for this slice, PRD-414). Non-subscription modes
 * never reach this function (the badge is drawn only for subscription sessions).
 */
export function subscriptionBadgeLabel(mode: string | null | undefined): string {
  switch (mode) {
    case "pro":
      return "Pro";
    case "max_5x":
      return "Max 5x";
    case "max_20x":
      return "Max 20x";
    case "codex_subscription":
      return "Codex";
    case "cursor_pro":
      return "Cursor Pro";
    case "copilot_seat":
      return "Copilot";
    case "subscription_unknown":
    default:
      return "Subscription";
  }
}
