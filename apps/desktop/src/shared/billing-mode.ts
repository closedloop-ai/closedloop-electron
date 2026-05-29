/**
 * @file billing-mode.ts
 * @description Canonical billing-mode taxonomy for agent sessions (FEA-1434).
 *
 * A session's `billingMode` distinguishes API-metered cost from
 * subscription-covered usage. The UI uses this to split sessions into two
 * ledgers so the headline cost number only sums the API-metered side.
 *
 * Detection happens on the desktop main process at spawn time (Claude / Codex)
 * or in the importer for tools that do not flow through a desktop spawn
 * (Cursor / Copilot / OpenCode). See `src/main/billing-mode-detector.ts`.
 */

export type BillingMode =
  | "api"
  | "claude_pro"
  | "claude_max"
  | "codex_chatgpt_pro"
  | "cursor_pro"
  | "copilot_seat"
  | "opencode"
  | "unknown";

/**
 * Subscription-covered billing modes. Sessions tagged with these modes are
 * paid for by a flat-rate subscription, so their token cost is an *equivalent*
 * — not an out-of-pocket dollar amount — and must never sum into the headline
 * API spend.
 */
export const SUBSCRIPTION_MODES: ReadonlySet<BillingMode> = new Set<BillingMode>([
  "claude_pro",
  "claude_max",
  "codex_chatgpt_pro",
  "cursor_pro",
  "copilot_seat",
  "opencode",
]);

/**
 * Returns true when the billing mode is a subscription (i.e. NOT metered API
 * usage). `unknown` and `api` both return false — only confirmed subscription
 * modes count as subscription-covered.
 */
export function isSubscriptionMode(
  mode: BillingMode | null | undefined,
): boolean {
  if (!mode) {
    return false;
  }
  return SUBSCRIPTION_MODES.has(mode);
}
