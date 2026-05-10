import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMMAND_KEY_RECONCILIATION_INTERVAL_MS,
  CommandKeyReconciler,
} from "../src/main/command-key-reconciler.js";
import type { OrganizationCommandPublicKey } from "../src/main/authorized-public-keys-client.js";

test("CommandKeyReconciler prunes from fetched public-key fingerprints and notifies on mutation", async () => {
  const logs: string[] = [];
  let changedCount = 0;
  const reconciledFingerprints: string[][] = [];
  const reconciler = new CommandKeyReconciler({
    hasApiKey: () => true,
    fetchOrganizationKeys: async () => [makeOrgKey("cl:keptfingerprint1234")],
    reconcileOrganizationKeys: (registeredKeys) => {
      reconciledFingerprints.push(
        [...registeredKeys].map((key) =>
          typeof key === "string" ? key : String(key.fingerprint),
        ),
      );
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
  assert.equal(changedCount, 1);
  assert.match(logs.join("\n"), /removed 1 stale org key/);
});

test("CommandKeyReconciler promotes legacy org keys and notifies on mutation", async () => {
  let changedCount = 0;
  const reconciler = new CommandKeyReconciler({
    hasApiKey: () => true,
    fetchOrganizationKeys: async () => [makeOrgKey("cl:legacyfingerpr123")],
    reconcileOrganizationKeys: () => ({
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
    }),
    onChanged: () => {
      changedCount += 1;
    },
    log: () => {},
  });

  await reconciler.reconcileNow("hello_ack");

  assert.equal(changedCount, 1);
});

test("CommandKeyReconciler notifies pending keys from successful fetch without refetching", async () => {
  let fetchCount = 0;
  let reconcileCount = 0;
  const notifiedFingerprints: string[][] = [];
  const reconciler = new CommandKeyReconciler({
    hasApiKey: () => true,
    fetchOrganizationKeys: async () => {
      fetchCount += 1;
      return [makeOrgKey("cl:pendingfingerpr1")];
    },
    reconcileOrganizationKeys: () => {
      reconcileCount += 1;
      return { removed: [], promoted: [] };
    },
    notifyPendingKeys: (keys) => {
      notifiedFingerprints.push(keys.map((key) => key.fingerprint));
    },
    onChanged: () => {},
    log: () => {},
  });

  await reconciler.reconcileNow("periodic");

  assert.equal(fetchCount, 1);
  assert.equal(reconcileCount, 1);
  assert.deepEqual(notifiedFingerprints, [["cl:pendingfingerpr1"]]);
});

test("CommandKeyReconciler skips destructive mutation when API key is missing", async () => {
  const logs: string[] = [];
  let fetchCount = 0;
  let reconcileCount = 0;
  const reconciler = new CommandKeyReconciler({
    hasApiKey: () => false,
    fetchOrganizationKeys: async () => {
      fetchCount += 1;
      return [];
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

test("CommandKeyReconciler skips destructive mutation when public-key fetch fails", async () => {
  const logs: string[] = [];
  let reconcileCount = 0;
  const reconciler = new CommandKeyReconciler({
    hasApiKey: () => true,
    fetchOrganizationKeys: async () => {
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
    | ((value: OrganizationCommandPublicKey[]) => void)
    | undefined;
  const firstFetch = new Promise<OrganizationCommandPublicKey[]>((resolve) => {
    resolveFetch = resolve;
  });
  const reconciler = new CommandKeyReconciler({
    hasApiKey: () => true,
    fetchOrganizationKeys: () => firstFetch,
    reconcileOrganizationKeys: () => ({ removed: [], promoted: [] }),
    onChanged: () => {},
    log: (_level, message) => logs.push(message),
  });

  const first = reconciler.reconcileNow("hello_ack");
  await reconciler.reconcileNow("periodic");
  resolveFetch?.([]);
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
    fetchOrganizationKeys: async () => [],
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
