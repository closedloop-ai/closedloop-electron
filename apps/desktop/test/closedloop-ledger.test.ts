/**
 * @file closedloop-ledger.test.ts
 * @description Unit + drift tests for the client-side two-ledger helper
 * (FEA-1434 Slice 4b), scripts/agent-monitor-client/lib/closedloop-ledger.ts.
 *
 * The helper does NO cost math — every dollar figure is computed server-side by
 * the canonical billing-mode engine. Its only billing logic is a
 * presentation-only mirror (SUBSCRIPTION_BILLING_MODES) of the server's
 * SUBSCRIPTION_MODES set, used to decide whether to draw a "subscription-covered"
 * badge. The reviewed invariant is therefore: the client mirror's
 * isSubscriptionMode() must agree with the canonical engine's isSubscription()
 * across the ENTIRE BILLING_MODES domain. This test imports BOTH and asserts
 * exact agreement so a future change to the server set without the client mirror
 * (or vice versa) fails CI rather than silently mislabelling badges.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BILLING_MODES,
  isSubscription as isSubscriptionTwin,
} from "../src/shared/billing-mode.js";
import {
  LEDGER_PREFS_KEY,
  SUBSCRIPTION_BILLING_MODES,
  defaultLedgerPrefs,
  isSubscriptionMode,
  loadLedgerPrefs,
  saveLedgerPrefs,
  subscriptionBadgeLabel,
} from "../scripts/agent-monitor-client/lib/closedloop-ledger.js";

test("isSubscriptionMode mirrors the canonical engine across the full BILLING_MODES domain", () => {
  // Every canonical mode must classify identically on both sides. This is the
  // anti-drift guard: the badge mirror cannot disagree with the server ledger.
  for (const mode of BILLING_MODES) {
    assert.equal(
      isSubscriptionMode(mode),
      isSubscriptionTwin(mode),
      `client mirror disagrees with canonical engine for billing_mode="${mode}"`,
    );
  }

  // The mirror set must contain exactly the canonical subscription modes — no
  // extras (which would draw a badge for a metered/unknown session).
  const canonicalSubscription = BILLING_MODES.filter((m) => isSubscriptionTwin(m));
  assert.deepEqual(
    [...SUBSCRIPTION_BILLING_MODES].sort(),
    [...canonicalSubscription].sort(),
  );
});

test("isSubscriptionMode is false for nullish and unknown values", () => {
  assert.equal(isSubscriptionMode(null), false);
  assert.equal(isSubscriptionMode(undefined), false);
  assert.equal(isSubscriptionMode(""), false);
  assert.equal(isSubscriptionMode("api"), false);
  assert.equal(isSubscriptionMode("cursor_api"), false);
  assert.equal(isSubscriptionMode("opencode"), false);
  assert.equal(isSubscriptionMode("unknown"), false);
  assert.equal(isSubscriptionMode("not-a-real-mode"), false);
});

test("subscriptionBadgeLabel maps each subscription mode to a human label", () => {
  assert.equal(subscriptionBadgeLabel("pro"), "Pro");
  assert.equal(subscriptionBadgeLabel("max_5x"), "Max 5x");
  assert.equal(subscriptionBadgeLabel("max_20x"), "Max 20x");
  assert.equal(subscriptionBadgeLabel("codex_subscription"), "Codex");
  assert.equal(subscriptionBadgeLabel("cursor_pro"), "Cursor Pro");
  assert.equal(subscriptionBadgeLabel("copilot_seat"), "Copilot");
  assert.equal(subscriptionBadgeLabel("subscription_unknown"), "Subscription");
  // Unknown/nullish fall back to the generic label (the badge is only ever
  // drawn for subscription sessions, so this is a defensive default).
  assert.equal(subscriptionBadgeLabel("anything-else"), "Subscription");
  assert.equal(subscriptionBadgeLabel(null), "Subscription");
  assert.equal(subscriptionBadgeLabel(undefined), "Subscription");

  // Every subscription mode produces a non-empty label.
  for (const mode of SUBSCRIPTION_BILLING_MODES) {
    assert.ok(
      subscriptionBadgeLabel(mode).length > 0,
      `subscription mode "${mode}" must have a non-empty badge label`,
    );
  }
});

test("ledger prefs round-trip through localStorage and default off", () => {
  // Minimal localStorage stub: the helper reads the global at call time.
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;

  try {
    // Default when nothing is persisted: hypothetical cost is OFF (the headline
    // shows only billed spend unless the user opts in).
    assert.deepEqual(loadLedgerPrefs(), defaultLedgerPrefs);
    assert.equal(loadLedgerPrefs().showHypotheticalCost, false);

    // Round-trip.
    saveLedgerPrefs({ showHypotheticalCost: true });
    assert.equal(store.get(LEDGER_PREFS_KEY), '{"showHypotheticalCost":true}');
    assert.equal(loadLedgerPrefs().showHypotheticalCost, true);

    // Corrupt JSON falls back to defaults instead of throwing.
    store.set(LEDGER_PREFS_KEY, "{not json");
    assert.deepEqual(loadLedgerPrefs(), defaultLedgerPrefs);
  } finally {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});
