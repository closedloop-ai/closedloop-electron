/**
 * @file billing-mode.test.ts
 * @description Parity + correctness tests for the canonical billing-mode engine.
 *
 * There are TWO copies of the engine that must never diverge:
 *   • the desktop-main ESM twin  — src/shared/billing-mode.ts
 *   • the sidecar CJS engine     — scripts/agent-monitor-billing/billing-mode.js
 * They live in different module systems (the sidecar runs in a generated
 * CommonJS tree; desktop-main is ESM and must work with the sidecar disabled),
 * so the code is duplicated. This test imports BOTH and asserts identical
 * classification and detection output across a fixture matrix so a change to one
 * without the other fails CI.
 *
 * It also pins the exact ledger mapping (the reviewed invariant: which modes are
 * metered vs subscription vs unknown) and the existence-only detection rules,
 * and asserts detection never surfaces a secret value.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import {
  BILLING_MODES,
  billingLedger as billingLedgerTwin,
  detectBillingModeForHarness as detectTwin,
  isMeteredApi as isMeteredApiTwin,
  isSubscription as isSubscriptionTwin,
  normalizeBillingMode as normalizeTwin,
  type BillingMode,
  type BillingModeDetectionDeps,
} from "../src/shared/billing-mode.js";

// The sidecar engine is CommonJS (its dir is scoped type:commonjs). Load it via
// createRequire so it resolves the same way it does inside the generated tree.
const require = createRequire(import.meta.url);
const engine = require("../scripts/agent-monitor-billing/billing-mode.js") as {
  BILLING_MODES: string[];
  billingLedger: (mode: string) => string;
  isMeteredApi: (mode: string) => boolean;
  isSubscription: (mode: string) => boolean;
  normalizeBillingMode: (value: unknown) => string;
  detectBillingModeForHarness: (
    harness: string,
    deps: BillingModeDetectionDeps,
  ) => string;
};

const HOME = "/fake/home";

/** Build detection deps with an injected env + a Set of "existing" file paths. */
function makeDeps(opts: {
  env?: Record<string, string | undefined>;
  existingFiles?: string[];
  homeDir?: string;
}): BillingModeDetectionDeps {
  const set = new Set(opts.existingFiles ?? []);
  return {
    env: opts.env ?? {},
    fileExists: (p: string): boolean => set.has(p),
    homeDir: opts.homeDir ?? HOME,
  };
}

const ANTHROPIC_CRED = join(HOME, ".claude", ".credentials.json");
const CODEX_AUTH = join(HOME, ".codex", "auth.json");

test("twin and sidecar engine declare the same BILLING_MODES domain", () => {
  assert.deepEqual([...BILLING_MODES].sort(), [...engine.BILLING_MODES].sort());
});

test("ledger classification is byte-equal between twin and engine for every mode", () => {
  for (const mode of BILLING_MODES) {
    assert.equal(
      billingLedgerTwin(mode),
      engine.billingLedger(mode),
      `billingLedger drift for ${mode}`,
    );
    assert.equal(isMeteredApiTwin(mode), engine.isMeteredApi(mode));
    assert.equal(isSubscriptionTwin(mode), engine.isSubscription(mode));
  }
});

test("ledger mapping pins the exact reviewed invariant", () => {
  const expected: Record<BillingMode, "metered" | "subscription" | "unknown"> = {
    api: "metered",
    cursor_api: "metered",
    subscription_unknown: "subscription",
    pro: "subscription",
    max_5x: "subscription",
    max_20x: "subscription",
    codex_subscription: "subscription",
    cursor_pro: "subscription",
    copilot_seat: "subscription",
    opencode: "unknown",
    unknown: "unknown",
  };
  // Every declared mode is covered above (compile-time totality via Record),
  // and every mapping is exactly as reviewed.
  for (const mode of BILLING_MODES) {
    assert.equal(billingLedgerTwin(mode), expected[mode], `ledger for ${mode}`);
  }
  // A subscription mode must NEVER be classified as metered (the headline-spend
  // safety invariant: hypothetical cost can't leak into real spend).
  for (const mode of BILLING_MODES) {
    if (billingLedgerTwin(mode) === "subscription") {
      assert.equal(isMeteredApiTwin(mode), false, `${mode} must not be metered`);
    }
  }
});

test("normalizeBillingMode coerces legacy/garbage to unknown, passes valid through", () => {
  for (const mode of BILLING_MODES) {
    assert.equal(normalizeTwin(mode), mode);
    assert.equal(engine.normalizeBillingMode(mode), mode);
  }
  for (const junk of [null, undefined, "", "API", "max", 42, {}, []]) {
    assert.equal(normalizeTwin(junk), "unknown");
    assert.equal(engine.normalizeBillingMode(junk), "unknown");
  }
});

// Detection fixture matrix: (harness, env, existing credential files) → mode.
const DETECTION_FIXTURES: Array<{
  name: string;
  harness: string;
  env?: Record<string, string | undefined>;
  existingFiles?: string[];
  expected: BillingMode;
}> = [
  {
    name: "claude + ANTHROPIC_API_KEY → api (metered)",
    harness: "claude",
    env: { ANTHROPIC_API_KEY: "sk-ant-secret-should-never-surface" },
    expected: "api",
  },
  {
    name: "claude + OAuth credentials file → subscription_unknown",
    harness: "claude",
    existingFiles: [ANTHROPIC_CRED],
    expected: "subscription_unknown",
  },
  {
    name: "claude + API key wins over OAuth file",
    harness: "claude",
    env: { ANTHROPIC_API_KEY: "sk-ant-x" },
    existingFiles: [ANTHROPIC_CRED],
    expected: "api",
  },
  {
    name: "claude + nothing → unknown",
    harness: "claude",
    expected: "unknown",
  },
  {
    name: "claude + empty/whitespace env is not presence",
    harness: "claude",
    env: { ANTHROPIC_API_KEY: "   " },
    expected: "unknown",
  },
  {
    name: "codex + OPENAI_API_KEY → api (metered)",
    harness: "codex",
    env: { OPENAI_API_KEY: "sk-openai-secret" },
    expected: "api",
  },
  {
    name: "codex + auth.json → codex_subscription",
    harness: "codex",
    existingFiles: [CODEX_AUTH],
    expected: "codex_subscription",
  },
  {
    name: "codex + CODEX_HOME override → checks relocated auth.json",
    harness: "codex",
    env: { CODEX_HOME: "/relocated/codex" },
    existingFiles: ["/relocated/codex/auth.json"],
    expected: "codex_subscription",
  },
  {
    name: "codex + CODEX_HOME set but default auth.json present → unknown (override respected)",
    harness: "codex",
    env: { CODEX_HOME: "/relocated/codex" },
    existingFiles: [CODEX_AUTH],
    expected: "unknown",
  },
  {
    name: "codex + nothing → unknown",
    harness: "codex",
    expected: "unknown",
  },
  {
    name: "cursor + CURSOR_API_KEY → cursor_api (metered)",
    harness: "cursor",
    env: { CURSOR_API_KEY: "cur-secret" },
    expected: "cursor_api",
  },
  {
    name: "cursor + nothing → cursor_pro (subscription, best-effort)",
    harness: "cursor",
    expected: "cursor_pro",
  },
  {
    name: "copilot → copilot_seat (always seat-based)",
    harness: "copilot",
    expected: "copilot_seat",
  },
  {
    name: "opencode → opencode (BYOK, ledger unknown)",
    harness: "opencode",
    expected: "opencode",
  },
  {
    name: "unrecognized harness → unknown",
    harness: "totally-made-up-harness",
    expected: "unknown",
  },
];

test("detection is byte-equal between twin and engine and matches expected mode", () => {
  for (const fx of DETECTION_FIXTURES) {
    const twinDeps = makeDeps({
      env: fx.env,
      existingFiles: fx.existingFiles,
    });
    const engineDeps = makeDeps({
      env: fx.env,
      existingFiles: fx.existingFiles,
    });
    const twinMode = detectTwin(fx.harness, twinDeps);
    const engineMode = engine.detectBillingModeForHarness(fx.harness, engineDeps);
    assert.equal(twinMode, fx.expected, `twin: ${fx.name}`);
    assert.equal(engineMode, fx.expected, `engine: ${fx.name}`);
    assert.equal(twinMode, engineMode, `twin/engine drift: ${fx.name}`);
  }
});

test("detection never surfaces a secret value (existence-only)", () => {
  const secret = "sk-ant-this-is-a-secret-token-value";
  const deps = makeDeps({ env: { ANTHROPIC_API_KEY: secret } });
  const mode = detectTwin("claude", deps);
  // The output is an opaque mode, not the key; and never contains the secret.
  assert.equal(mode, "api");
  assert.ok(!String(mode).includes(secret));
});
