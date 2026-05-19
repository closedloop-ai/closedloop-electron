/**
 * Unit tests for the proactive refresh scheduler in loop-http.ts (AC-004, T-4.3).
 *
 * Covered scenarios:
 *  1. Timer fires at the correct threshold (expiresAt - refreshSkew)
 *  2. Successful refresh updates stored metadata and reschedules using new expiresAt
 *  3. Opaque tokens (no expiresAt) skip scheduling entirely
 *  4. cancelProactiveRefresh cancels an active timer (loop termination)
 *
 * Timer mechanics use mock.timers from node:test to control setTimeout and Date.
 * The refresh fetch is intercepted via a shared mock-fetch harness (same pattern
 * as loop-http-refresh.test.ts).
 */

import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import {
  cancelProactiveRefresh,
  scheduleProactiveRefresh,
} from "../src/server/operations/loop-http.js";
import type { LoopTokenMeta } from "../src/main/loop-token-store.js";

// ---------------------------------------------------------------------------
// Shared mock-fetch harness (mirrors loop-http-refresh.test.ts)
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
 * Flush the microtask / promise queue. After mock.timers.tick() synchronously
 * fires timer callbacks that kick off async work (void promise chains), we need
 * to drain the queue before asserting on side-effects of that async work.
 *
 * Each `await flushMicrotasks()` call yields to the event loop once, allowing
 * pending microtasks (resolved promises) to run. Multiple awaits are needed
 * when the async chain has several `.then()` hops.
 */
async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  fetchCalls.length = 0;
  mock.timers.reset();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const API_BASE = "https://api.example.com";
const LOOP_ID = "proactive-test-loop";
const INITIAL_TOKEN = "initial-token-proactive";
const REFRESHED_TOKEN = "refreshed-token-proactive";

/** Default refreshSkew used by loop-http.ts when no env var is set (30 min). */
const DEFAULT_REFRESH_SKEW_MS = 1800000;

/** How far in the future (beyond refreshSkew) to place expiresAt for tests. */
const TIMER_DELAY_MS = 5000;

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

// ---------------------------------------------------------------------------
// 1. Timer fires at the correct threshold (expiresAt - refreshSkew)
// ---------------------------------------------------------------------------

describe("scheduleProactiveRefresh — timer threshold", () => {
  test("timer fires at expiresAt - refreshSkew (not before, fires after)", async () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });

    // With Date mocked, Date.now() returns a frozen value starting at 0.
    const frozenNow = Date.now();

    // Place expiresAt so that: delay = expiresAt - refreshSkew - frozenNow = TIMER_DELAY_MS
    const expiresAt = frozenNow + DEFAULT_REFRESH_SKEW_MS + TIMER_DELAY_MS;
    const meta: LoopTokenMeta = { token: INITIAL_TOKEN, expiresAt };

    const { setToken } = makeSetTokenSpy();

    // Refresh succeeds with a new token
    installMockFetch([
      {
        status: 200,
        body: {
          token: REFRESHED_TOKEN,
          expiresAt: expiresAt + DEFAULT_REFRESH_SKEW_MS + TIMER_DELAY_MS,
          jti: "jti-proactive-1",
        },
      },
      // Second timer after reschedule may also fire if we tick further, but
      // we don't tick that far in this test.
    ]);

    scheduleProactiveRefresh(LOOP_ID, API_BASE, () => ({ ...meta }), setToken);

    // One millisecond before the threshold — timer must NOT have fired
    mock.timers.tick(TIMER_DELAY_MS - 1);
    assert.equal(
      fetchCalls.length,
      0,
      "refresh fetch must not fire before the threshold",
    );

    // Tick the final millisecond — timer fires now
    mock.timers.tick(1);

    // Drain the async chain (void refreshToken(...).then(...))
    await flushMicrotasks();

    assert.equal(
      fetchCalls.length,
      1,
      "exactly one refresh fetch after timer fires",
    );
    assert.match(
      fetchCalls[0]!.url,
      /\/refresh-token$/,
      "fetch URL must be the refresh endpoint",
    );

    // Cleanup: cancel so the rescheduled timer does not leak into other tests
    cancelProactiveRefresh(LOOP_ID);
  });
});

// ---------------------------------------------------------------------------
// 2. Refresh updates stored metadata and reschedules using the new expiresAt
// ---------------------------------------------------------------------------

describe("scheduleProactiveRefresh — reschedule on success", () => {
  test("successful refresh calls setToken with new meta and reschedules timer", async () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });

    const frozenNow = Date.now();
    const firstExpiresAt = frozenNow + DEFAULT_REFRESH_SKEW_MS + TIMER_DELAY_MS;
    // The refreshed token's expiresAt pushes the next timer TIMER_DELAY_MS later
    const secondExpiresAt = frozenNow + DEFAULT_REFRESH_SKEW_MS * 2 + TIMER_DELAY_MS * 2;

    let currentMeta: LoopTokenMeta = {
      token: INITIAL_TOKEN,
      expiresAt: firstExpiresAt,
    };

    const { calls: setTokenCalls, setToken } = makeSetTokenSpy();

    // The getToken provider always returns the latest currentMeta (updated by setToken)
    const getToken = (): LoopTokenMeta => ({ ...currentMeta });

    // Wrap setToken so we also update currentMeta (simulates store update)
    const wrappedSetToken = (meta: LoopTokenMeta): void => {
      currentMeta = meta;
      setToken(meta);
    };

    // First refresh returns a new token with secondExpiresAt
    installMockFetch([
      {
        status: 200,
        body: {
          token: REFRESHED_TOKEN,
          expiresAt: secondExpiresAt,
          jti: "jti-reschedule-1",
        },
      },
    ]);

    scheduleProactiveRefresh(LOOP_ID, API_BASE, getToken, wrappedSetToken);

    // Tick to fire the first timer
    mock.timers.tick(TIMER_DELAY_MS);
    await flushMicrotasks();

    // setToken must have been called with the refreshed metadata
    assert.ok(
      setTokenCalls.length >= 1,
      "setToken must be called after successful refresh",
    );
    const lastCall = setTokenCalls[setTokenCalls.length - 1]!;
    assert.equal(
      lastCall.token,
      REFRESHED_TOKEN,
      "setToken must carry the new token",
    );
    assert.equal(
      lastCall.expiresAt,
      secondExpiresAt,
      "setToken must carry the new expiresAt",
    );
    assert.equal(
      lastCall.jti,
      "jti-reschedule-1",
      "setToken must carry the new jti",
    );

    // A second timer should have been scheduled (reschedule on success).
    // The new delay = secondExpiresAt - refreshSkew - frozenNow
    //               = (frozenNow + 2*refreshSkew + 2*TIMER_DELAY_MS) - refreshSkew - frozenNow
    //               = refreshSkew + 2*TIMER_DELAY_MS
    // That is larger than TIMER_DELAY_MS, so ticking TIMER_DELAY_MS more should NOT fire it.
    assert.equal(
      fetchCalls.length,
      1,
      "only one fetch so far (reschedule timer has not fired)",
    );

    // Cleanup
    cancelProactiveRefresh(LOOP_ID);
  });
});

// ---------------------------------------------------------------------------
// 3. Opaque tokens (no expiresAt) skip scheduling entirely
// ---------------------------------------------------------------------------

describe("scheduleProactiveRefresh — opaque token skips scheduling", () => {
  const opaqueCases: Array<{ label: string; meta: LoopTokenMeta | null }> = [
    {
      label: "token without expiresAt",
      meta: { token: "opaque-token-no-exp" },
    },
    {
      label: "null token (getToken returns null)",
      meta: null,
    },
  ];

  for (const { label, meta } of opaqueCases) {
    test(`no timer is set when ${label}`, () => {
      mock.timers.enable({ apis: ["setTimeout", "Date"] });

      const { setToken } = makeSetTokenSpy();

      // The fetch mock should never be called
      installMockFetch([]);

      scheduleProactiveRefresh(
        LOOP_ID,
        API_BASE,
        () => (meta !== null ? { ...meta } : null),
        setToken,
      );

      // Tick a very long time — if a timer had been set it would fire
      mock.timers.tick(DEFAULT_REFRESH_SKEW_MS * 10);

      assert.equal(
        fetchCalls.length,
        0,
        `no fetch should be issued for ${label}`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// 4. cancelProactiveRefresh cancels active timer (loop termination)
// ---------------------------------------------------------------------------

describe("cancelProactiveRefresh — timer cancellation", () => {
  test("timer does not fire after cancelProactiveRefresh is called", async () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });

    const frozenNow = Date.now();
    const expiresAt = frozenNow + DEFAULT_REFRESH_SKEW_MS + TIMER_DELAY_MS;
    const meta: LoopTokenMeta = { token: INITIAL_TOKEN, expiresAt };

    const { setToken } = makeSetTokenSpy();

    installMockFetch([]);

    scheduleProactiveRefresh(LOOP_ID, API_BASE, () => ({ ...meta }), setToken);

    // Cancel before the timer fires
    cancelProactiveRefresh(LOOP_ID);

    // Tick past the threshold — the cancelled timer must NOT fire
    mock.timers.tick(TIMER_DELAY_MS * 2);
    await flushMicrotasks();

    assert.equal(
      fetchCalls.length,
      0,
      "no fetch should be issued after cancellation",
    );
  });

  test("cancelProactiveRefresh is idempotent — no-op when no timer is active", () => {
    // Should not throw when called with no scheduled timer
    assert.doesNotThrow(() => {
      cancelProactiveRefresh("loop-with-no-timer");
    });
  });

  test("cancelling one loop does not affect timers for other loops", async () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });

    const frozenNow = Date.now();
    const expiresAt = frozenNow + DEFAULT_REFRESH_SKEW_MS + TIMER_DELAY_MS;

    const loopA = "proactive-loop-A";
    const loopB = "proactive-loop-B";

    const { setToken: setTokenA } = makeSetTokenSpy();
    const { setToken: setTokenB } = makeSetTokenSpy();

    installMockFetch([
      // Only loop B's timer fires; loop A is cancelled
      {
        status: 200,
        body: { token: "token-B-refreshed", expiresAt: expiresAt + DEFAULT_REFRESH_SKEW_MS + TIMER_DELAY_MS, jti: "jti-B" },
      },
    ]);

    const metaA: LoopTokenMeta = { token: "token-A", expiresAt };
    const metaB: LoopTokenMeta = { token: "token-B", expiresAt };

    scheduleProactiveRefresh(loopA, API_BASE, () => ({ ...metaA }), setTokenA);
    scheduleProactiveRefresh(loopB, API_BASE, () => ({ ...metaB }), setTokenB);

    // Cancel loop A's timer
    cancelProactiveRefresh(loopA);

    // Tick to fire the threshold
    mock.timers.tick(TIMER_DELAY_MS);
    await flushMicrotasks();

    // Only loop B should have issued a refresh fetch
    const refreshFetches = fetchCalls.filter((c) => c.url.includes("/refresh-token"));
    assert.equal(refreshFetches.length, 1, "exactly one fetch from loop B");

    // Verify it was loop B's token in the Authorization header
    const authHeader = (refreshFetches[0]!.init.headers as Record<string, string>)["Authorization"] ?? "";
    assert.match(authHeader, /Bearer token-B/, "loop B's token must be used");

    // Cleanup
    cancelProactiveRefresh(loopB);
  });
});
