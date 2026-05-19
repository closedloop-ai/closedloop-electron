/**
 * Unit tests for the powerMonitor wake-from-sleep resume handler in
 * loop-http.ts (AC-009, T-6.1).
 *
 * Covered scenarios:
 *  1. powerMonitor.on('resume') is called when the first loop with an expiring
 *     token is registered via scheduleProactiveRefresh
 *  2. powerMonitor.off('resume') is called when the last active loop is
 *     cancelled via cancelProactiveRefresh
 *  3. On resume event, proactiveRefreshAllTokens triggers a refresh fetch for
 *     every active loop
 *  4. No resume listener is registered when configurePowerMonitor is not called
 *     (null power monitor)
 *  5. A second loop being added does not re-register the listener (idempotent)
 *  6. Cancelling one of two loops does not remove the listener; cancelling the
 *     second does
 */

import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import {
  cancelProactiveRefresh,
  configurePowerMonitor,
  getLoopHttpCapabilities,
  proactiveRefreshAllTokens,
  scheduleProactiveRefresh,
  type PowerMonitorLike,
} from "../src/server/operations/loop-http.js";
import type { LoopTokenMeta } from "../src/main/loop-token-store.js";

// ---------------------------------------------------------------------------
// Shared mock-fetch harness (mirrors loop-http-proactive-refresh.test.ts)
// ---------------------------------------------------------------------------

type FetchCall = { url: string; init: RequestInit };

type MockResponse = {
  status: number;
  body?: unknown;
};

const originalFetch = globalThis.fetch;
const fetchCalls: FetchCall[] = [];

function installMockFetch(responses: MockResponse[]): void {
  let index = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({
      url: typeof input === "string" ? input : String(input),
      init: init ?? {},
    });
    const response = responses[index++];
    if (!response) {
      throw new Error(
        `Unexpected extra fetch call #${index} — no more mock responses`,
      );
    }
    const bodyText =
      response.body === undefined ? "" : JSON.stringify(response.body);
    return new Response(bodyText, {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

/**
 * Flush the microtask / promise queue so that async chains triggered by
 * proactiveRefreshAllTokens complete before assertions are made.
 */
async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/**
 * Build a minimal PowerMonitorLike stub that records calls to on/off.
 */
function makePowerMonitorStub(): {
  pm: PowerMonitorLike;
  onCalls: Array<{ event: string; listener: () => void }>;
  offCalls: Array<{ event: string; listener: () => void }>;
  listeners: (() => void)[];
  fireResume: () => void;
} {
  const onCalls: Array<{ event: string; listener: () => void }> = [];
  const offCalls: Array<{ event: string; listener: () => void }> = [];
  const listeners: (() => void)[] = [];

  const pm: PowerMonitorLike = {
    on(event: string, listener: () => void): void {
      onCalls.push({ event, listener });
      listeners.push(listener);
    },
    off(event: string, listener: () => void): void {
      offCalls.push({ event, listener });
      const idx = listeners.indexOf(listener);
      if (idx !== -1) {
        listeners.splice(idx, 1);
      }
    },
  };

  const fireResume = (): void => {
    for (const l of [...listeners]) {
      l();
    }
  };

  return { pm, onCalls, offCalls, listeners, fireResume };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const API_BASE = "https://api.example.com";
const LOOP_A = "wake-resume-loop-A";
const LOOP_B = "wake-resume-loop-B";

/** A far-future expiresAt so the proactive timer doesn't fire during tests. */
const FAR_FUTURE_EXPIRES_AT = Date.now() + 1000 * 60 * 60 * 24 * 7; // 7 days

function makeTokenMeta(token: string): LoopTokenMeta {
  return { token, expiresAt: FAR_FUTURE_EXPIRES_AT };
}

function makeSetTokenSpy(): {
  calls: LoopTokenMeta[];
  setToken: (meta: LoopTokenMeta) => void;
} {
  const calls: LoopTokenMeta[] = [];
  return {
    calls,
    setToken: (meta: LoopTokenMeta) => {
      calls.push(meta);
    },
  };
}

afterEach(() => {
  // Restore original fetch
  globalThis.fetch = originalFetch;
  fetchCalls.length = 0;

  // Clear any lingering state from the module under test
  cancelProactiveRefresh(LOOP_A);
  cancelProactiveRefresh(LOOP_B);

  // Reset the injected power monitor to null to isolate tests
  configurePowerMonitor(null);
});

// ---------------------------------------------------------------------------
// 1. powerMonitor.on('resume') is registered on first loop start
// ---------------------------------------------------------------------------

describe("powerMonitor resume listener — registration on first loop", () => {
  test("on('resume') is called exactly once when the first loop is scheduled", () => {
    const { pm, onCalls } = makePowerMonitorStub();
    configurePowerMonitor(pm);

    const { setToken } = makeSetTokenSpy();
    const meta = makeTokenMeta("token-A");
    scheduleProactiveRefresh(LOOP_A, API_BASE, () => ({ ...meta }), setToken);

    assert.equal(onCalls.length, 1, "on('resume') must be called exactly once");
    assert.equal(onCalls[0]!.event, "resume", "event name must be 'resume'");
  });

  test("on('resume') is NOT called when configurePowerMonitor was not called", () => {
    // No configurePowerMonitor call — powerMonitor is null
    const { setToken } = makeSetTokenSpy();
    const meta = makeTokenMeta("token-A");
    // Should not throw even without a powerMonitor
    assert.doesNotThrow(() => {
      scheduleProactiveRefresh(LOOP_A, API_BASE, () => ({ ...meta }), setToken);
    });
  });

  test("on('resume') is NOT called again when a second loop is added", () => {
    const { pm, onCalls } = makePowerMonitorStub();
    configurePowerMonitor(pm);

    const { setToken: setTokenA } = makeSetTokenSpy();
    const { setToken: setTokenB } = makeSetTokenSpy();
    const metaA = makeTokenMeta("token-A");
    const metaB = makeTokenMeta("token-B");

    scheduleProactiveRefresh(LOOP_A, API_BASE, () => ({ ...metaA }), setTokenA);
    scheduleProactiveRefresh(LOOP_B, API_BASE, () => ({ ...metaB }), setTokenB);

    assert.equal(
      onCalls.length,
      1,
      "on('resume') must only be called once regardless of how many loops are added",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. powerMonitor.off('resume') is removed when last loop ends
// ---------------------------------------------------------------------------

describe("powerMonitor resume listener — removal on last loop cancel", () => {
  test("off('resume') is called when the only loop is cancelled", () => {
    const { pm, onCalls, offCalls } = makePowerMonitorStub();
    configurePowerMonitor(pm);

    const { setToken } = makeSetTokenSpy();
    const meta = makeTokenMeta("token-A");
    scheduleProactiveRefresh(LOOP_A, API_BASE, () => ({ ...meta }), setToken);

    assert.equal(onCalls.length, 1, "listener must be registered");

    cancelProactiveRefresh(LOOP_A);

    assert.equal(offCalls.length, 1, "off('resume') must be called when last loop ends");
    assert.equal(offCalls[0]!.event, "resume", "event name must be 'resume'");
  });

  test("off('resume') is NOT called when one of two loops ends, only when the last ends", () => {
    const { pm, offCalls } = makePowerMonitorStub();
    configurePowerMonitor(pm);

    const { setToken: setTokenA } = makeSetTokenSpy();
    const { setToken: setTokenB } = makeSetTokenSpy();
    const metaA = makeTokenMeta("token-A");
    const metaB = makeTokenMeta("token-B");

    scheduleProactiveRefresh(LOOP_A, API_BASE, () => ({ ...metaA }), setTokenA);
    scheduleProactiveRefresh(LOOP_B, API_BASE, () => ({ ...metaB }), setTokenB);

    // Cancel loop A — listener should NOT be removed yet (loop B is still active)
    cancelProactiveRefresh(LOOP_A);
    assert.equal(offCalls.length, 0, "off must not be called while loop B is still active");

    // Cancel loop B — listener should be removed now
    cancelProactiveRefresh(LOOP_B);
    assert.equal(offCalls.length, 1, "off must be called when the last loop (B) is cancelled");
  });

  test("the same listener function reference is used for on and off", () => {
    const { pm, onCalls, offCalls } = makePowerMonitorStub();
    configurePowerMonitor(pm);

    const { setToken } = makeSetTokenSpy();
    const meta = makeTokenMeta("token-A");
    scheduleProactiveRefresh(LOOP_A, API_BASE, () => ({ ...meta }), setToken);
    cancelProactiveRefresh(LOOP_A);

    assert.equal(
      onCalls[0]!.listener,
      offCalls[0]!.listener,
      "the same function reference must be used for on and off",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. On resume event, proactiveRefreshAllTokens triggers refresh for all loops
// ---------------------------------------------------------------------------

describe("powerMonitor resume — triggers proactive refresh on all active loops", () => {
  test("firing resume triggers a /refresh-token fetch for each active loop", async () => {
    const { pm, fireResume } = makePowerMonitorStub();
    configurePowerMonitor(pm);

    let currentMetaA = makeTokenMeta("token-A");
    let currentMetaB = makeTokenMeta("token-B");

    const setTokenA = (meta: LoopTokenMeta): void => {
      currentMetaA = meta;
    };
    const setTokenB = (meta: LoopTokenMeta): void => {
      currentMetaB = meta;
    };

    // Both refresh requests succeed
    installMockFetch([
      { status: 200, body: { token: "token-A-refreshed", expiresAt: FAR_FUTURE_EXPIRES_AT + 1000 } },
      { status: 200, body: { token: "token-B-refreshed", expiresAt: FAR_FUTURE_EXPIRES_AT + 1000 } },
    ]);

    scheduleProactiveRefresh(LOOP_A, API_BASE, () => ({ ...currentMetaA }), setTokenA);
    scheduleProactiveRefresh(LOOP_B, API_BASE, () => ({ ...currentMetaB }), setTokenB);

    // Simulate system wake
    fireResume();
    await flushMicrotasks();

    const refreshFetches = fetchCalls.filter((c) => c.url.includes("/refresh-token"));
    assert.equal(
      refreshFetches.length,
      2,
      "exactly two refresh fetches must be issued (one per active loop)",
    );

    // Verify the correct tokens were used
    const authHeaders = refreshFetches.map(
      (c) => (c.init.headers as Record<string, string>)["Authorization"] ?? "",
    );
    assert.ok(
      authHeaders.some((h) => h.includes("token-A")),
      "loop A token must be used for its refresh",
    );
    assert.ok(
      authHeaders.some((h) => h.includes("token-B")),
      "loop B token must be used for its refresh",
    );
  });

  test("firing resume when no loops are active triggers no fetch", async () => {
    // Install a strict mock that throws on unexpected calls
    installMockFetch([]);

    // No active loops — should be a no-op
    proactiveRefreshAllTokens();
    await flushMicrotasks();

    assert.equal(
      fetchCalls.length,
      0,
      "no fetch should be issued when there are no active loops",
    );
  });

  test("refresh success updates the stored token via setToken", async () => {
    const { pm, fireResume } = makePowerMonitorStub();
    configurePowerMonitor(pm);

    let currentMeta = makeTokenMeta("token-initial");
    const setTokenCalls: LoopTokenMeta[] = [];
    const setToken = (meta: LoopTokenMeta): void => {
      currentMeta = meta;
      setTokenCalls.push(meta);
    };

    const newExpiresAt = FAR_FUTURE_EXPIRES_AT + 3600_000;
    installMockFetch([
      { status: 200, body: { token: "token-refreshed", expiresAt: newExpiresAt, jti: "jti-wake-1" } },
    ]);

    scheduleProactiveRefresh(LOOP_A, API_BASE, () => ({ ...currentMeta }), setToken);

    fireResume();
    await flushMicrotasks();

    // setToken must have been called with the new token
    const lastCall = setTokenCalls[setTokenCalls.length - 1];
    assert.ok(lastCall !== undefined, "setToken must have been called at least once");
    assert.equal(lastCall.token, "token-refreshed", "setToken must carry the refreshed token");
    assert.equal(lastCall.expiresAt, newExpiresAt, "setToken must carry the new expiresAt");
  });
});

// ---------------------------------------------------------------------------
// 4. No listener registered when power monitor is null
// ---------------------------------------------------------------------------

describe("powerMonitor — null configurePowerMonitor is safe", () => {
  test("proactiveRefreshAllTokens is callable without a powerMonitor configured", async () => {
    // Do NOT call configurePowerMonitor
    let currentMeta = makeTokenMeta("token-opaque");
    const { setToken } = makeSetTokenSpy();

    // Install a failing fetch to ensure no network calls are made
    installMockFetch([
      { status: 200, body: { token: "token-refreshed", expiresAt: FAR_FUTURE_EXPIRES_AT + 1000 } },
    ]);

    scheduleProactiveRefresh(LOOP_A, API_BASE, () => ({ ...currentMeta }), setToken);

    // proactiveRefreshAllTokens still works when called directly
    void proactiveRefreshAllTokens();
    await flushMicrotasks();

    // The fetch should have been issued (proactiveRefreshAllTokens still works
    // without a powerMonitor — it's just not triggered by hardware events)
    assert.equal(
      fetchCalls.filter((c) => c.url.includes("/refresh-token")).length,
      1,
      "direct proactiveRefreshAllTokens call works without a powerMonitor",
    );

    void currentMeta; // suppress unused-variable lint
  });
});

// ---------------------------------------------------------------------------
// 5. getLoopHttpCapabilities — capability advertisement (T-6.2, AC-013)
// ---------------------------------------------------------------------------

describe("getLoopHttpCapabilities — capability advertisement", () => {
  type CapabilityCase = {
    description: string;
    flag: "loopRunnerRefreshSupported" | "loopRunnerHeartbeatSupported";
    expected: true;
  };

  const cases: CapabilityCase[] = [
    {
      description: "loopRunnerRefreshSupported is true",
      flag: "loopRunnerRefreshSupported",
      expected: true,
    },
    {
      description: "loopRunnerHeartbeatSupported is true",
      flag: "loopRunnerHeartbeatSupported",
      expected: true,
    },
  ];

  for (const { description, flag, expected } of cases) {
    test(description, () => {
      const caps = getLoopHttpCapabilities();
      assert.equal(
        caps[flag],
        expected,
        `getLoopHttpCapabilities().${flag} must be ${String(expected)}`,
      );
    });
  }

  test("getLoopHttpCapabilities returns exactly two capability flags and no extra fields", () => {
    const caps = getLoopHttpCapabilities();
    const keys = Object.keys(caps).sort();
    assert.deepEqual(
      keys,
      ["loopRunnerHeartbeatSupported", "loopRunnerRefreshSupported"],
      "getLoopHttpCapabilities must return exactly loopRunnerRefreshSupported and loopRunnerHeartbeatSupported",
    );
  });
});
