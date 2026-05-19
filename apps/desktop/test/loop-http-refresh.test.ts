/**
 * Unit tests for the 401 refresh flow and 409 stale_idempotency_key handling
 * in loop-http.ts (AC-005, AC-006, AC-008, AC-010, AC-011).
 *
 * Tests are driven via a shared mock-fetch harness that records every outbound
 * request and returns pre-programmed responses in sequence. This lets us
 * verify request counts, header values, and response propagation without
 * spinning up a real HTTP server.
 *
 * Covered scenarios:
 *  1. Happy path: 401 on event POST → refresh succeeds → retry succeeds
 *  2. Refresh itself returns 401 → non-retryable error surfaced to caller
 *  3. Singleflight: two concurrent 401s share a single refresh request
 *  4. 409 stale_idempotency_key → fresh key generated, retry refresh succeeds
 *  5. 409 retry also returns 409 → non-retryable error (no infinite loop)
 *  6. Sequential 401 idempotency: same stale token reuses the persisted idempotency key (AC-011)
 *  7. Old-server 404 detection: 404 from /refresh-token populates oldServersWithoutFeature and
 *     subsequent calls skip the refresh endpoint (AC-010)
 */

import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import {
  oldServersWithoutFeature,
  postLoopEvent,
} from "../src/server/operations/loop-http.js";
import type { LoopTokenMeta } from "../src/main/loop-token-store.js";

// ---------------------------------------------------------------------------
// Shared mock-fetch harness
// ---------------------------------------------------------------------------

type FetchCall = {
  url: string;
  init: RequestInit;
};

type MockResponse = {
  status: number;
  body?: unknown;
  /** When set, the fetch mock throws this error instead of returning a response. */
  throw?: Error;
  /** Optional artificial delay in ms before resolving (for singleflight tests). */
  delayMs?: number;
};

const originalFetch = globalThis.fetch;
const fetchCalls: FetchCall[] = [];

/**
 * Install a mock fetch that returns the given responses in order.
 * Each call consumes one response from the queue. Extra calls throw.
 */
function installMockFetch(responses: MockResponse[]): void {
  let index = 0;
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
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
    if (response.throw) {
      throw response.throw;
    }
    if (response.delayMs) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, response.delayMs);
      });
    }
    const bodyText =
      response.body === undefined ? "" : JSON.stringify(response.body);
    return new Response(bodyText, {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  fetchCalls.length = 0;
  // Clear old-server detection state so tests are isolated (AC-010).
  oldServersWithoutFeature.clear();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const API_BASE = "https://api.example.com";
const LOOP_ID = "test-loop-id";
const INITIAL_TOKEN = "initial-token-abc";
const NEW_TOKEN = "refreshed-token-xyz";

const initialMeta: LoopTokenMeta = { token: INITIAL_TOKEN };
const refreshSuccessBody = { token: NEW_TOKEN, expiresAt: 9999999999000, jti: "jti-1" };

/** A minimal setToken stub that records each call. */
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
// 1. Happy path: 401 on event POST → refresh succeeds → retry succeeds
// ---------------------------------------------------------------------------

describe("postLoopEvent — 401 refresh happy path", () => {
  test("401 triggers refresh, refresh succeeds, retry returns 200", async () => {
    const { calls: setTokenCalls, setToken } = makeSetTokenSpy();

    installMockFetch([
      // Initial event POST returns 401
      { status: 401 },
      // Refresh request succeeds
      { status: 200, body: refreshSuccessBody },
      // Retry event POST with new token succeeds
      { status: 200, body: {} },
    ]);

    const result = await postLoopEvent(
      API_BASE,
      LOOP_ID,
      () => ({ ...initialMeta }),
      { type: "test_event" },
      undefined,
      setToken,
    );

    assert.equal(result.success, true, "postLoopEvent should succeed after refresh");

    // Three total fetch calls: event POST, refresh POST, retry event POST
    assert.equal(fetchCalls.length, 3, "Expected 3 fetch calls");

    const [eventCall, refreshCall, retryCall] = fetchCalls;

    assert.ok(eventCall?.url.includes("/loops/"), "First call should be event POST");
    assert.match(refreshCall?.url ?? "", /\/refresh-token$/, "Second call should be refresh POST");
    assert.ok(retryCall?.url.includes("/loops/"), "Third call should be retry event POST");

    // Refresh request must include the initial token
    const refreshHeaders = refreshCall?.init.headers as Record<string, string>;
    assert.match(
      refreshHeaders["Authorization"] ?? refreshHeaders["authorization"] ?? "",
      /Bearer initial-token-abc/,
      "Refresh request must use the original token",
    );
    assert.ok(
      refreshHeaders["Idempotency-Key"] ?? refreshHeaders["idempotency-key"],
      "Refresh request must include Idempotency-Key header",
    );

    // Retry must use the new token
    const retryHeaders = retryCall?.init.headers as Record<string, string>;
    assert.match(
      retryHeaders["Authorization"] ?? retryHeaders["authorization"] ?? "",
      /Bearer refreshed-token-xyz/,
      "Retry event POST must use the refreshed token",
    );

    // setToken must have been called at least once (to persist the new meta)
    assert.ok(setTokenCalls.length >= 1, "setToken must be called at least once");
    // The last setToken call should carry the new token
    const lastSetToken = setTokenCalls[setTokenCalls.length - 1];
    assert.equal(
      lastSetToken?.token,
      NEW_TOKEN,
      "Final setToken call must carry the refreshed token",
    );
    // The refreshed meta must NOT include lastIdempotencyKey
    assert.equal(
      lastSetToken?.lastIdempotencyKey,
      undefined,
      "Refreshed token meta must not include a stale idempotency key",
    );
  });

  test("postLoopEvent without setToken: 401 is not retried", async () => {
    installMockFetch([
      // Initial event POST returns 401
      { status: 401 },
    ]);

    const result = await postLoopEvent(
      API_BASE,
      LOOP_ID,
      () => ({ ...initialMeta }),
      { type: "test_event" },
      undefined,
      undefined, // no setToken → refresh disabled
    );

    assert.equal(result.success, false, "Should fail without refresh");
    assert.equal(fetchCalls.length, 1, "Only one fetch call (no refresh)");
  });
});

// ---------------------------------------------------------------------------
// 2. Refresh itself returns 401 → non-retryable error
// ---------------------------------------------------------------------------

describe("postLoopEvent — refresh returns 401", () => {
  test("refresh returning 401 surfaces non-retryable failure", async () => {
    const { calls: setTokenCalls, setToken } = makeSetTokenSpy();

    installMockFetch([
      // Initial event POST returns 401
      { status: 401 },
      // Refresh request also returns 401
      { status: 401 },
    ]);

    const result = await postLoopEvent(
      API_BASE,
      LOOP_ID,
      () => ({ ...initialMeta }),
      { type: "test_event" },
      undefined,
      setToken,
    );

    assert.equal(result.success, false, "Should fail when refresh returns 401");
    assert.ok(result.error, "Error message should be set");
    assert.match(result.error ?? "", /401/, "Error should mention 401");

    // Only two fetch calls: event POST + refresh attempt (no retry)
    assert.equal(fetchCalls.length, 2, "Expected 2 fetch calls (event + refresh)");

    // setToken should have been called to persist idempotency key before refresh,
    // and then called again to clear it after non-retryable 401.
    assert.ok(setTokenCalls.length >= 1, "setToken must be called at least once");
    // Final call should clear the lastIdempotencyKey
    const lastSetToken = setTokenCalls[setTokenCalls.length - 1];
    assert.equal(
      lastSetToken?.lastIdempotencyKey,
      undefined,
      "After non-retryable 401, lastIdempotencyKey must be cleared",
    );
    // Token should still be the original (not overwritten with a new one)
    assert.equal(
      lastSetToken?.token,
      INITIAL_TOKEN,
      "Non-retryable failure clears key but keeps original token",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Singleflight: concurrent 401s produce exactly one refresh request
// ---------------------------------------------------------------------------

describe("postLoopEvent — singleflight for concurrent 401s", () => {
  test("two concurrent 401s produce exactly one refresh request", async () => {
    const { setToken } = makeSetTokenSpy();

    // The fetch mock needs to handle:
    //   - Two concurrent event POSTs that both return 401
    //   - Exactly one refresh request (singleflight deduplates)
    //   - Two retry event POSTs (each original request retries)
    //
    // We program 5 responses: 401, 401 (both event POSTs),
    // then 1 refresh success, then 2 retry successes.
    // But the order of the two initial 401s may interleave with the refresh,
    // so we use a delay on the refresh to let both 401s arrive first.
    let refreshCount = 0;
    let index = 0;
    const responses: MockResponse[] = [
      { status: 401 },                               // event POST #1 → 401
      { status: 401 },                               // event POST #2 → 401
      { status: 200, body: refreshSuccessBody, delayMs: 10 }, // refresh (shared)
      { status: 200, body: {} },                     // retry event #1
      { status: 200, body: {} },                     // retry event #2
    ];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      fetchCalls.push({ url, init: init ?? {} });

      if (url.includes("/refresh-token")) {
        refreshCount += 1;
      }

      const response = responses[index++];
      if (!response) {
        throw new Error(`Unexpected extra fetch call — no more mock responses`);
      }
      if (response.delayMs) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, response.delayMs);
        });
      }
      const bodyText =
        response.body === undefined ? "" : JSON.stringify(response.body);
      return new Response(bodyText, {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    // Launch two concurrent event POSTs — both will hit 401 simultaneously
    const [result1, result2] = await Promise.all([
      postLoopEvent(
        API_BASE,
        LOOP_ID,
        () => ({ ...initialMeta }),
        { type: "event_a" },
        undefined,
        setToken,
      ),
      postLoopEvent(
        API_BASE,
        LOOP_ID,
        () => ({ ...initialMeta }),
        { type: "event_b" },
        undefined,
        setToken,
      ),
    ]);

    assert.equal(result1.success, true, "First concurrent event should succeed");
    assert.equal(result2.success, true, "Second concurrent event should succeed");

    // Exactly one refresh must have been issued despite two 401s
    assert.equal(
      refreshCount,
      1,
      `Singleflight must produce exactly 1 refresh request, got ${refreshCount}`,
    );

    // Total: 2 event POSTs + 1 refresh + 2 retries = 5 fetch calls
    assert.equal(
      fetchCalls.length,
      5,
      `Expected 5 fetch calls total, got ${fetchCalls.length}`,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. 409 stale_idempotency_key → fresh key, retry refresh succeeds
// ---------------------------------------------------------------------------

describe("postLoopEvent — 409 stale_idempotency_key handling", () => {
  test("409 stale_idempotency_key causes fresh key to be generated, retry refresh succeeds", async () => {
    const { calls: setTokenCalls, setToken } = makeSetTokenSpy();

    installMockFetch([
      // Initial event POST returns 401 (triggers refresh)
      { status: 401 },
      // First refresh attempt returns 409 stale_idempotency_key
      {
        status: 409,
        body: { error: "stale_idempotency_key" },
      },
      // Second refresh attempt (with fresh key) succeeds
      { status: 200, body: refreshSuccessBody },
      // Retry event POST succeeds
      { status: 200, body: {} },
    ]);

    const result = await postLoopEvent(
      API_BASE,
      LOOP_ID,
      () => ({ ...initialMeta }),
      { type: "test_event" },
      undefined,
      setToken,
    );

    assert.equal(result.success, true, "Should succeed after 409 stale key retry");

    // 4 fetch calls: event POST, refresh (409), refresh retry (200), event retry
    assert.equal(fetchCalls.length, 4, `Expected 4 fetch calls, got ${fetchCalls.length}`);

    const [eventCall, firstRefresh, secondRefresh, retryEvent] = fetchCalls;

    assert.ok(eventCall?.url.includes("/loops/"), "First call: event POST");
    assert.match(firstRefresh?.url ?? "", /\/refresh-token$/, "Second call: first refresh");
    assert.match(secondRefresh?.url ?? "", /\/refresh-token$/, "Third call: retry refresh");
    assert.ok(retryEvent?.url.includes("/loops/"), "Fourth call: retry event POST");

    // The two refresh requests must use different idempotency keys
    const firstRefreshHeaders = firstRefresh?.init.headers as Record<string, string>;
    const secondRefreshHeaders = secondRefresh?.init.headers as Record<string, string>;

    const firstKey =
      firstRefreshHeaders["Idempotency-Key"] ??
      firstRefreshHeaders["idempotency-key"];
    const secondKey =
      secondRefreshHeaders["Idempotency-Key"] ??
      secondRefreshHeaders["idempotency-key"];

    assert.ok(firstKey, "First refresh must include Idempotency-Key");
    assert.ok(secondKey, "Second refresh must include Idempotency-Key");
    assert.notEqual(
      firstKey,
      secondKey,
      "Fresh key must differ from stale key after 409",
    );

    // setToken must be called to persist the fresh key before the retry refresh
    const freshKeySetTokenCall = setTokenCalls.find(
      (call) => call.lastIdempotencyKey === secondKey,
    );
    assert.ok(
      freshKeySetTokenCall !== undefined,
      "setToken must be called with the fresh idempotency key before retrying refresh",
    );

    // Final setToken call should carry the new token (key cleared on success)
    const lastSetToken = setTokenCalls[setTokenCalls.length - 1];
    assert.equal(lastSetToken?.token, NEW_TOKEN, "Last setToken must carry the new token");
    assert.equal(
      lastSetToken?.lastIdempotencyKey,
      undefined,
      "idempotency key must be cleared after successful refresh",
    );
  });

  test("409 stale_idempotency_key with pre-existing cached key: discards cached key", async () => {
    const { calls: setTokenCalls, setToken } = makeSetTokenSpy();

    // Token already has a cached idempotency key from a prior interrupted refresh
    const metaWithCachedKey: LoopTokenMeta = {
      token: INITIAL_TOKEN,
      lastIdempotencyKey: "cached-stale-key-uuid",
    };

    installMockFetch([
      // Initial event POST returns 401
      { status: 401 },
      // Refresh with cached key returns 409
      { status: 409, body: { error: "stale_idempotency_key" } },
      // Retry with fresh key succeeds
      { status: 200, body: refreshSuccessBody },
      // Event retry succeeds
      { status: 200, body: {} },
    ]);

    const result = await postLoopEvent(
      API_BASE,
      LOOP_ID,
      () => ({ ...metaWithCachedKey }),
      { type: "test_event" },
      undefined,
      setToken,
    );

    assert.equal(result.success, true);

    // The first refresh must have used the cached stale key
    const firstRefreshHeaders = fetchCalls[1]?.init.headers as Record<string, string>;
    const usedKey =
      firstRefreshHeaders["Idempotency-Key"] ??
      firstRefreshHeaders["idempotency-key"];
    assert.equal(
      usedKey,
      "cached-stale-key-uuid",
      "First refresh must reuse the pre-existing cached idempotency key (AC-011)",
    );

    // After 409, a different key must be used for the retry
    const retryRefreshHeaders = fetchCalls[2]?.init.headers as Record<string, string>;
    const retryKey =
      retryRefreshHeaders["Idempotency-Key"] ??
      retryRefreshHeaders["idempotency-key"];
    assert.notEqual(retryKey, "cached-stale-key-uuid", "Retry must use a fresh key");

    // setToken must have been called with the fresh key before the retry
    const freshKeyCall = setTokenCalls.find(
      (call) => call.lastIdempotencyKey === retryKey,
    );
    assert.ok(
      freshKeyCall !== undefined,
      "setToken must persist the fresh key before the retry refresh",
    );

    // Last setToken must have cleared the key
    const lastSetToken = setTokenCalls[setTokenCalls.length - 1];
    assert.equal(lastSetToken?.lastIdempotencyKey, undefined);
  });
});

// ---------------------------------------------------------------------------
// 5. Second consecutive 409 → non-retryable failure
// ---------------------------------------------------------------------------

describe("postLoopEvent — second consecutive 409 is non-retryable", () => {
  test("409 retry also returns 409 → non-retryable auth failure, no further retry", async () => {
    const { calls: setTokenCalls, setToken } = makeSetTokenSpy();

    installMockFetch([
      // Initial event POST returns 401
      { status: 401 },
      // First refresh attempt returns 409 stale_idempotency_key
      { status: 409, body: { error: "stale_idempotency_key" } },
      // Retry refresh also returns 409
      { status: 409, body: { error: "stale_idempotency_key" } },
      // No more responses — if any extra fetch is attempted the mock will throw
    ]);

    const result = await postLoopEvent(
      API_BASE,
      LOOP_ID,
      () => ({ ...initialMeta }),
      { type: "test_event" },
      undefined,
      setToken,
    );

    assert.equal(result.success, false, "Should fail after two consecutive 409s");
    assert.ok(result.error, "Error message should be set");
    assert.match(result.error ?? "", /409/, "Error should mention 409");

    // 3 fetch calls: event POST + refresh (409) + retry refresh (409)
    // The event POST must NOT be retried because refresh failed non-retryably
    assert.equal(fetchCalls.length, 3, `Expected exactly 3 fetch calls, got ${fetchCalls.length}`);

    const refreshCallUrls = fetchCalls.filter((c) => c.url.includes("/refresh-token"));
    assert.equal(refreshCallUrls.length, 2, "Exactly 2 refresh calls (initial + one retry)");

    // setToken must be called to clear the key on non-retryable failure
    assert.ok(setTokenCalls.length >= 1, "setToken must be called at least once");
    const lastSetToken = setTokenCalls[setTokenCalls.length - 1];
    assert.equal(
      lastSetToken?.lastIdempotencyKey,
      undefined,
      "lastIdempotencyKey must be cleared after non-retryable double-409",
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Sequential 401 idempotency: same stale token reuses persisted key (AC-011)
// ---------------------------------------------------------------------------

describe("postLoopEvent — sequential 401 idempotency (AC-011)", () => {
  /**
   * Scenario: a refresh call persists `lastIdempotencyKey` to the store before
   * sending the request (for crash recovery). If the same stale token meta is
   * presented again in a subsequent sequential call (e.g. the caller's
   * getToken provider was not yet updated, or the app rebooted mid-refresh),
   * refreshToken must reuse the existing `lastIdempotencyKey` rather than
   * generating a new UUID. This guarantees server-side idempotency: the same
   * physical request will not be double-applied (AC-011).
   *
   * This is distinct from the singleflight concurrent case (scenario 3 above),
   * which deduplicates *in-flight* concurrent refreshes for the same loopId.
   * Here we verify that *sequential* calls with a pre-persisted key also reuse it.
   */
  test("stale token with pre-persisted lastIdempotencyKey: key is reused, not replaced", async () => {
    const { calls: setTokenCalls, setToken } = makeSetTokenSpy();

    // The stale token already has a lastIdempotencyKey (set by a prior refresh
    // that persisted the key before the request, then crashed/restarted).
    const PRE_PERSISTED_KEY = "pre-persisted-idem-key-uuid";
    const metaWithPersistedKey: LoopTokenMeta = {
      token: INITIAL_TOKEN,
      lastIdempotencyKey: PRE_PERSISTED_KEY,
    };

    installMockFetch([
      // Event POST returns 401 (stale token)
      { status: 401 },
      // Refresh with the pre-persisted idempotency key succeeds
      { status: 200, body: refreshSuccessBody },
      // Retry event POST with the new token succeeds
      { status: 200, body: {} },
    ]);

    const result = await postLoopEvent(
      API_BASE,
      LOOP_ID,
      () => ({ ...metaWithPersistedKey }),
      { type: "test_event" },
      undefined,
      setToken,
    );

    assert.equal(result.success, true, "should succeed after refresh with pre-persisted key");
    assert.equal(fetchCalls.length, 3, "3 calls: event POST, refresh, retry");

    const refreshCall = fetchCalls[1];
    assert.ok(refreshCall, "refresh call must exist");
    assert.match(refreshCall.url, /\/refresh-token$/, "second call must be refresh endpoint");

    // The refresh request MUST use the pre-persisted key — not a newly generated UUID.
    const refreshHeaders = refreshCall.init.headers as Record<string, string>;
    const usedKey =
      refreshHeaders["Idempotency-Key"] ?? refreshHeaders["idempotency-key"];
    assert.equal(
      usedKey,
      PRE_PERSISTED_KEY,
      "refresh must reuse the pre-persisted idempotency key (AC-011 crash recovery)",
    );

    // setToken must NOT be called with a new idempotency key for the persist-before-send
    // step, because the key already exists in currentMeta — no re-persist is needed.
    const persistBeforeSendCall = setTokenCalls.find(
      (call) => call.lastIdempotencyKey !== undefined && call.lastIdempotencyKey !== PRE_PERSISTED_KEY,
    );
    assert.equal(
      persistBeforeSendCall,
      undefined,
      "setToken must not be called with a different idempotency key — existing key reused without re-persist",
    );

    // Final setToken call carries the new token with no idempotency key (cleared on success).
    const lastSetToken = setTokenCalls[setTokenCalls.length - 1];
    assert.equal(lastSetToken?.token, NEW_TOKEN, "last setToken must carry the refreshed token");
    assert.equal(
      lastSetToken?.lastIdempotencyKey,
      undefined,
      "lastIdempotencyKey must be cleared on successful refresh",
    );
  });

  test("two sequential 401s with same stale token each trigger a separate refresh attempt", async () => {
    /**
     * This test documents the *sequential* behavior (not concurrent singleflight).
     * After the first refresh completes and the singleflight map is cleared, a
     * second sequential 401 with the same stale token (e.g. if getToken was not
     * updated between calls) triggers a second independent refresh attempt.
     * This is expected: the singleflight guard only collapses *concurrent* calls.
     */
    const { setToken } = makeSetTokenSpy();

    installMockFetch([
      // First event POST → 401
      { status: 401 },
      // First refresh → success
      { status: 200, body: refreshSuccessBody },
      // First retry event POST → success
      { status: 200, body: {} },
      // Second event POST (with same stale token) → 401
      { status: 401 },
      // Second refresh (new attempt, singleflight map was cleared) → success
      { status: 200, body: refreshSuccessBody },
      // Second retry event POST → success
      { status: 200, body: {} },
    ]);

    // getToken always returns the same stale meta (simulates caller not updating)
    const getToken = (): LoopTokenMeta => ({ ...initialMeta });

    const result1 = await postLoopEvent(
      API_BASE,
      LOOP_ID,
      getToken,
      { type: "event_one" },
      undefined,
      setToken,
    );
    const result2 = await postLoopEvent(
      API_BASE,
      LOOP_ID,
      getToken,
      { type: "event_two" },
      undefined,
      setToken,
    );

    assert.equal(result1.success, true, "first sequential call should succeed");
    assert.equal(result2.success, true, "second sequential call should succeed");

    // Total: 2 event POSTs + 2 refreshes + 2 retries = 6 fetch calls
    assert.equal(
      fetchCalls.length,
      6,
      "each sequential 401 triggers its own refresh (singleflight only covers concurrent calls)",
    );

    const refreshCalls = fetchCalls.filter((c) => c.url.includes("/refresh-token"));
    assert.equal(
      refreshCalls.length,
      2,
      "two separate refresh calls for two sequential 401s",
    );
  });
});

// ---------------------------------------------------------------------------
// 7. Old-server 404 detection: 404 from /refresh-token disables refresh (AC-010)
// ---------------------------------------------------------------------------

describe("postLoopEvent — old-server 404 detection for /refresh-token (AC-010)", () => {
  /**
   * When /refresh-token returns 404, `oldServersWithoutFeature` is populated
   * with the refresh URL. All subsequent calls for that base URL must skip
   * the refresh endpoint entirely without issuing a network request.
   */

  const oldServerCases = [
    {
      label: "first call receives 404 from /refresh-token → populates oldServersWithoutFeature",
      expectSetInSet: true,
    },
  ];

  for (const { label } of oldServerCases) {
    test(label, async () => {
      const { setToken } = makeSetTokenSpy();
      const refreshUrl = `${API_BASE}/refresh-token`;

      // Pre-condition: the URL is not yet in the set
      assert.equal(
        oldServersWithoutFeature.has(refreshUrl),
        false,
        "oldServersWithoutFeature must be empty before the call",
      );

      installMockFetch([
        // Event POST → 401
        { status: 401 },
        // Refresh attempt → 404 (old server without feature)
        { status: 404 },
        // No more responses — the event POST must NOT be retried after a 404 refresh
      ]);

      const result = await postLoopEvent(
        API_BASE,
        LOOP_ID,
        () => ({ ...initialMeta }),
        { type: "test_event" },
        undefined,
        setToken,
      );

      // The refresh failed (non-successful), so the event POST was not retried
      assert.equal(result.success, false, "should fail when refresh endpoint returns 404");
      assert.ok(result.error, "error must be set");
      assert.match(result.error ?? "", /404/, "error must mention 404");

      // 2 fetch calls: event POST + refresh (404)
      assert.equal(fetchCalls.length, 2, "2 calls: event POST and refresh attempt");

      // The 404 must have been recorded in oldServersWithoutFeature
      assert.equal(
        oldServersWithoutFeature.has(refreshUrl),
        true,
        "404 from /refresh-token must populate oldServersWithoutFeature",
      );
    });
  }

  test("subsequent call after 404: refresh endpoint is skipped entirely (no network request)", async () => {
    const { setToken } = makeSetTokenSpy();
    const refreshUrl = `${API_BASE}/refresh-token`;

    // Pre-populate the set as if a prior call already received a 404
    oldServersWithoutFeature.add(refreshUrl);

    installMockFetch([
      // Event POST → 401
      { status: 401 },
      // No refresh request expected — old-server check must skip it
      // If a refresh request were made, the mock would throw (no more responses)
    ]);

    const result = await postLoopEvent(
      API_BASE,
      LOOP_ID,
      () => ({ ...initialMeta }),
      { type: "test_event" },
      undefined,
      setToken,
    );

    // Refresh was skipped, so the 401 is surfaced directly as failure
    assert.equal(result.success, false, "should fail when refresh is skipped (old server)");

    // Only 1 fetch call: the event POST — NO refresh call was issued
    assert.equal(
      fetchCalls.length,
      1,
      "only the initial event POST must be issued — refresh must be skipped for old server",
    );
    assert.ok(
      fetchCalls[0]?.url.includes("/loops/"),
      "the only fetch call must be the event POST, not the refresh endpoint",
    );
    assert.ok(
      !fetchCalls.some((c) => c.url.includes("/refresh-token")),
      "no request must be sent to /refresh-token for a known old server",
    );
  });

  test("404 detection is per base URL: different base URLs are tracked independently", async () => {
    const OTHER_BASE = "https://other-api.example.com";
    const { setToken } = makeSetTokenSpy();

    const firstRefreshUrl = `${API_BASE}/refresh-token`;
    const otherRefreshUrl = `${OTHER_BASE}/refresh-token`;

    // Mark the first base URL as an old server
    oldServersWithoutFeature.add(firstRefreshUrl);

    // The other base URL should still allow a refresh attempt
    installMockFetch([
      // Event POST to the other server → 401
      { status: 401 },
      // Refresh to the other server → success (endpoint IS supported)
      { status: 200, body: refreshSuccessBody },
      // Retry event POST → success
      { status: 200, body: {} },
    ]);

    const result = await postLoopEvent(
      OTHER_BASE,
      LOOP_ID,
      () => ({ ...initialMeta }),
      { type: "test_event" },
      undefined,
      setToken,
    );

    assert.equal(result.success, true, "other base URL must still attempt refresh");
    assert.equal(fetchCalls.length, 3, "3 fetch calls: event POST, refresh, retry");

    const refreshCalls = fetchCalls.filter((c) => c.url.includes("/refresh-token"));
    assert.equal(
      refreshCalls.length,
      1,
      "exactly one refresh call must be issued to the other (non-old) server",
    );
    assert.ok(
      refreshCalls[0]?.url.startsWith(OTHER_BASE),
      "refresh call must go to the other base URL, not the blocked one",
    );

    // The other URL must NOT have been added to oldServersWithoutFeature
    assert.equal(
      oldServersWithoutFeature.has(otherRefreshUrl),
      false,
      "successful refresh must not pollute oldServersWithoutFeature",
    );
    // The first URL remains blocked
    assert.equal(
      oldServersWithoutFeature.has(firstRefreshUrl),
      true,
      "first (old) server URL must still be in oldServersWithoutFeature",
    );
  });
});
