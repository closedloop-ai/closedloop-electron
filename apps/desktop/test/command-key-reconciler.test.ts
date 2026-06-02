import assert from "node:assert/strict";
import { test } from "node:test";
import type { OrganizationCommandPublicKey } from "../src/main/authorized-public-keys-client.js";
import {
  COMMAND_KEY_RECONCILIATION_INTERVAL_MS,
  CommandKeyReconciler,
} from "../src/main/command-key-reconciler.js";
import type { OrganizationCommandKeyClassification } from "../src/main/command-key-target-context.js";

test("CommandKeyReconciler full mode prunes from relevant public-key fingerprints", async () => {
  const logs: string[] = [];
  let changedCount = 0;
  const reconciledFingerprints: string[][] = [];
  const removeStaleOptions: Array<boolean | undefined> = [];
  const reconciler = new CommandKeyReconciler({
    hasApiKey: () => true,
    fetchOrganizationKeyClassification: async (reason) =>
      makeClassification({
        reason,
        kind: "all_scoped",
        reconciliationMode: "full",
        relevantKeys: [makeOrgKey("cl:keptfingerprint1234")],
      }),
    reconcileOrganizationKeys: (registeredKeys, options) => {
      reconciledFingerprints.push(
        [...registeredKeys].map((key) =>
          typeof key === "string" ? key : String(key.fingerprint),
        ),
      );
      removeStaleOptions.push(options?.removeStale);
      return {
        removed: [
          {
            fingerprint: "cl:removedfingerpr1234",
            publicKeyBase64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            ownerName: "Removed User",
            authorizedAt: "2026-05-09T00:00:00.000Z",
            source: "org",
          },
        ],
        promoted: [],
      };
    },
    onChanged: () => {
      changedCount += 1;
    },
    log: (_level, message) => logs.push(message),
  });

  await reconciler.reconcileNow("hello_ack");

  assert.deepEqual(reconciledFingerprints, [["cl:keptfingerprint1234"]]);
  assert.deepEqual(removeStaleOptions, [true]);
  assert.equal(changedCount, 1);
  assert.match(logs.join("\n"), /kind=all_scoped, mode=full/);
  assert.match(logs.join("\n"), /removed 1 stale org key/);
});

test("CommandKeyReconciler promote_only mode promotes without destructive removal", async () => {
  let changedCount = 0;
  const removeStaleOptions: Array<boolean | undefined> = [];
  const notifiedFingerprints: string[][] = [];
  const reconciler = new CommandKeyReconciler({
    hasApiKey: () => true,
    fetchOrganizationKeyClassification: async (reason) =>
      makeClassification({
        reason,
        kind: "mixed_scoped",
        reconciliationMode: "promote_only",
        relevantKeys: [makeOrgKey("cl:legacyfingerpr123")],
        notificationKeys: [makeOrgKey("cl:legacyfingerpr123")],
      }),
    reconcileOrganizationKeys: (_registeredKeys, options) => {
      removeStaleOptions.push(options?.removeStale);
      return {
        removed: [],
        promoted: [
          {
            fingerprint: "cl:legacyfingerpr123",
            publicKeyBase64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            ownerName: "Legacy User",
            authorizedAt: "2026-05-09T00:00:00.000Z",
            source: "org",
          },
        ],
      };
    },
    notifyPendingKeys: (keys) => {
      notifiedFingerprints.push(keys.map((key) => key.fingerprint));
    },
    onChanged: () => {
      changedCount += 1;
    },
    log: () => {},
  });

  await reconciler.reconcileNow("hello_ack");

  assert.deepEqual(removeStaleOptions, [false]);
  assert.equal(changedCount, 1);
  assert.deepEqual(notifiedFingerprints, [["cl:legacyfingerpr123"]]);
});

test("CommandKeyReconciler skip mode avoids mutation and notification", async () => {
  let reconcileCount = 0;
  let notifyCount = 0;
  const reconciler = new CommandKeyReconciler({
    hasApiKey: () => true,
    fetchOrganizationKeyClassification: async (reason) =>
      makeClassification({
        reason,
        kind: "legacy_broad",
        reconciliationMode: "skip",
        relevantKeys: [],
        notificationKeys: [],
      }),
    reconcileOrganizationKeys: () => {
      reconcileCount += 1;
      return { removed: [], promoted: [] };
    },
    notifyPendingKeys: () => {
      notifyCount += 1;
    },
    onChanged: () => {},
    log: () => {},
  });

  await reconciler.reconcileNow("periodic");

  assert.equal(reconcileCount, 0);
  assert.equal(notifyCount, 0);
});

test("CommandKeyReconciler skips destructive mutation when API key is missing", async () => {
  const logs: string[] = [];
  let fetchCount = 0;
  let reconcileCount = 0;
  const reconciler = new CommandKeyReconciler({
    hasApiKey: () => false,
    fetchOrganizationKeyClassification: async (reason) => {
      fetchCount += 1;
      return makeClassification({ reason });
    },
    reconcileOrganizationKeys: () => {
      reconcileCount += 1;
      return { removed: [], promoted: [] };
    },
    onChanged: () => {},
    log: (_level, message) => logs.push(message),
  });

  await reconciler.reconcileNow("hello_ack");

  assert.equal(fetchCount, 0);
  assert.equal(reconcileCount, 0);
  assert.match(logs.join("\n"), /missing API key/);
});

test("CommandKeyReconciler skips destructive mutation when classification fetch fails", async () => {
  const logs: string[] = [];
  let reconcileCount = 0;
  const reconciler = new CommandKeyReconciler({
    hasApiKey: () => true,
    fetchOrganizationKeyClassification: async () => {
      throw new Error("public keys unavailable");
    },
    reconcileOrganizationKeys: () => {
      reconcileCount += 1;
      return { removed: [], promoted: [] };
    },
    onChanged: () => {},
    log: (_level, message) => logs.push(message),
  });

  await reconciler.reconcileNow("periodic");

  assert.equal(reconcileCount, 0);
  assert.match(logs.join("\n"), /public keys unavailable/);
});

test("CommandKeyReconciler coalesces overlapping reconciliation attempts", async () => {
  const logs: string[] = [];
  let resolveFetch:
    | ((value: OrganizationCommandKeyClassification) => void)
    | undefined;
  const firstFetch = new Promise<OrganizationCommandKeyClassification>(
    (resolve) => {
      resolveFetch = resolve;
    },
  );
  const reconciler = new CommandKeyReconciler({
    hasApiKey: () => true,
    fetchOrganizationKeyClassification: () => firstFetch,
    reconcileOrganizationKeys: () => ({ removed: [], promoted: [] }),
    onChanged: () => {},
    log: (_level, message) => logs.push(message),
  });

  const first = reconciler.reconcileNow("hello_ack");
  await reconciler.reconcileNow("periodic");
  resolveFetch?.(makeClassification({ reason: "hello_ack" }));
  await first;

  assert.match(logs.join("\n"), /already running/);
});

test("CommandKeyReconciler starts periodic reconciliation and clears timer", async () => {
  let intervalMs = 0;
  let intervalCallback: (() => void) | null = null;
  let cleared = false;
  const timer = setTimeout(() => {}, 60_000) as ReturnType<typeof setInterval>;
  let reconcileCount = 0;
  const reconciler = new CommandKeyReconciler({
    hasApiKey: () => true,
    fetchOrganizationKeyClassification: async (reason) =>
      makeClassification({ reason }),
    reconcileOrganizationKeys: () => {
      reconcileCount += 1;
      return { removed: [], promoted: [] };
    },
    onChanged: () => {},
    log: () => {},
    setIntervalFn: (callback, ms) => {
      intervalCallback = callback as () => void;
      intervalMs = ms ?? 0;
      return timer;
    },
    clearIntervalFn: (handle) => {
      cleared = handle === timer;
      clearTimeout(timer);
    },
  });

  reconciler.start();
  intervalCallback?.();
  await new Promise((resolve) => setImmediate(resolve));
  reconciler.stop();

  assert.equal(intervalMs, COMMAND_KEY_RECONCILIATION_INTERVAL_MS);
  assert.equal(reconcileCount, 1);
  assert.equal(cleared, true);
});

function makeClassification(
  overrides: Partial<OrganizationCommandKeyClassification> & {
    reason: OrganizationCommandKeyClassification["diagnostics"]["reason"];
  },
): OrganizationCommandKeyClassification {
  const relevantKeys = overrides.relevantKeys ?? [
    makeOrgKey("cl:keptfingerprint1234"),
  ];
  return {
    kind: overrides.kind ?? "all_scoped",
    reconciliationMode: overrides.reconciliationMode ?? "full",
    relevantKeys,
    notificationKeys: overrides.notificationKeys ?? relevantKeys,
    ignoredKeys: overrides.ignoredKeys ?? [],
    diagnostics: {
      reason: overrides.reason,
      fetchedCount: overrides.diagnostics?.fetchedCount ?? relevantKeys.length,
      relevantCount:
        overrides.diagnostics?.relevantCount ?? relevantKeys.length,
      ignoredCount: overrides.diagnostics?.ignoredCount ?? 0,
      legacyCount: overrides.diagnostics?.legacyCount ?? 0,
      invalidContextCount: overrides.diagnostics?.invalidContextCount ?? 0,
      mismatchedContextCount:
        overrides.diagnostics?.mismatchedContextCount ?? 0,
      activeComputeTargetId:
        overrides.diagnostics?.activeComputeTargetId ??
        "11111111-1111-4111-8111-111111111111",
      activeGatewayPresent:
        overrides.diagnostics?.activeGatewayPresent ?? true,
    },
  };
}

function makeOrgKey(fingerprint: string): OrganizationCommandPublicKey {
  return {
    id: fingerprint,
    userId: "user-1",
    organizationId: "org-1",
    publicKeyBase64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    fingerprint,
    createdAt: "2026-05-09T00:00:00.000Z",
    ownerName: "Org User",
  };
}
