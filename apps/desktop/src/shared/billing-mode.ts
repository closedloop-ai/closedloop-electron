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

// FEA-1434 (round-3 review follow-up): `claude_pro` has no detector or
// importer today — `detectClaudeBillingMode` always returns `claude_max` for
// any OAuth-authenticated Claude session because the credentials file on disk
// does not distinguish Pro from Max. The value is kept in the union because:
//
//   1. It is reserved for a future detection signal (e.g. a response header
//      captured at runtime, or a Claude-side endpoint exposing tier info)
//      that would let us split Pro and Max for finer-grained UI labels.
//   2. The synced agent-session payload schema includes `billingMode`, so
//      removing this variant would be a breaking contract change for the
//      cloud relay (see CLAUDE.md "Breaking Changes" → cloud relay messages).
//      Coordinated removal would need a migration + a follow-up FEA to
//      strip legacy support after consumers upgrade.
//   3. The importer-clobber guard in `build-agent-monitor.mjs` already
//      protects `claude_pro` alongside `api` and `claude_max`, so a future
//      detector that emits it will land safely without further plumbing.
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
