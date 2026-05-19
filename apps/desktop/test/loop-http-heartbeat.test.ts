/**
 * Unit tests for heartbeat scheduling in loop-http.ts (AC-010, AC-012, T-5.3).
 *
 * Covered scenarios:
 *  1. setInterval-based heartbeat fires at the configured interval
 *  2. cancelHeartbeat stops the heartbeat (clearInterval / no further ticks)
 *  3. 404 from /heartbeat disables heartbeat for that server (oldServersWithoutFeature
 *     populated; subsequent ticks skip the request)
 *  4. Heartbeat POST carries the correct token from the getToken callback
 *     (Authorization: Bearer <token>)
 *  5. Network errors during heartbeat don't crash the loop (fire-and-forget)
 *
 * Timer mechanics use mock.timers from node:test to control setInterval and Date.
 * The heartbeat fetch is intercepted via a shared mock-fetch harness (same pattern
 * as loop-http-proactive-refresh.test.ts).
 */

import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import {
  cancelHeartbeat,
  oldServersWithoutFeature,
  scheduleHeartbeat,
} from "../src/server/operations/loop-http.js";
import type { LoopTokenMeta } from "../src/main/loop-token-store.js";

// ---------------------------------------------------------------------------
// Shared mock-fetch harness (mirrors loop-http-proactive-refresh.test.ts)
// ---------------------------------------------------------------------------

type FetchCall = { url: string; init: RequestInit };

type MockResponse = {
  status: number;
  body?: unknown;
  /** When set, the fetch mock throws this error instead of returning a response. */
  throw?: Error;
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
    if (response.throw) {
      throw response.throw;
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
 * fires interval callbacks that kick off async work (void promise chains), we
 * need to drain the queue before asserting on side-effects of that async work.
 */
async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  fetchCalls.length = 0;
  // Reset mock timers to avoid leaking interval handles across tests.
  mock.timers.reset();
  // Clear old-server detection state so tests are fully isolated (AC-010).
  oldServersWithoutFeature.clear();
  // Cancel any lingering heartbeat timer for the test loop IDs.
  cancelHeartbeat(LOOP_ID);
  cancelHeartbeat("heartbeat-loop-A");
  cancelHeartbeat("heartbeat-loop-B");
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const API_BASE = "https://api.example.com";
const LOOP_ID = "heartbeat-test-loop";
const TOKEN = "heartbeat-token-abc";
const HEARTBEAT_URL = `${API_BASE}/heartbeat`;

/** Default heartbeat interval when no env var is set (30 min). */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 1800000;

const meta: LoopTokenMeta = { token: TOKEN };

// ---------------------------------------------------------------------------
// 1. setInterval-based heartbeat fires at the configured interval
// ---------------------------------------------------------------------------

describe("scheduleHeartbeat — interval fires correctly", () => {
  test("heartbeat does not fire before the interval elapses", () => {
    mock.timers.enable({ apis: ["setInterval", "Date"] });

    installMockFetch([]);

    scheduleHeartbeat(LOOP_ID, API_BASE, () => ({ ...meta }));

    // One millisecond before the interval — no fetch must have fired
    mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS - 1);

    assert.equal(
      fetchCalls.length,
      0,
      "heartbeat must not fire before the full interval elapses",
    );
  });

  test("heartbeat fires exactly once after one full interval", async () => {
    mock.timers.enable({ apis: ["setInterval", "Date"] });

    installMockFetch([{ status: 200 }]);

    scheduleHeartbeat(LOOP_ID, API_BASE, () => ({ ...meta }));

    // Tick one full interval — the heartbeat callback fires
    mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
    await flushMicrotasks();

    assert.equal(fetchCalls.length, 1, "exactly one heartbeat after one interval");
    assert.equal(fetchCalls[0]?.url, HEARTBEAT_URL, "heartbeat must POST to /heartbeat");
    assert.equal(
      (fetchCalls[0]?.init as RequestInit).method,
      "POST",
      "heartbeat must use POST method",
    );
  });

  test("heartbeat fires again after a second interval (repeating)", async () => {
    mock.timers.enable({ apis: ["setInterval", "Date"] });

    installMockFetch([{ status: 200 }, { status: 200 }]);

    scheduleHeartbeat(LOOP_ID, API_BASE, () => ({ ...meta }));

    // First tick
    mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
    await flushMicrotasks();

    assert.equal(fetchCalls.length, 1, "one heartbeat after first interval");

    // Second tick
    mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
    await flushMicrotasks();

    assert.equal(fetchCalls.length, 2, "two heartbeats after second interval");
  });

  test("re-scheduling cancels the previous timer and does not leak handles", async () => {
    mock.timers.enable({ apis: ["setInterval", "Date"] });

    // Only one heartbeat response — if both timers fired we'd get two calls
    installMockFetch([{ status: 200 }]);

    // Schedule, then immediately re-schedule (simulates a re-entry call).
    // The first timer must be cancelled before the second is set.
    scheduleHeartbeat(LOOP_ID, API_BASE, () => ({ ...meta }));
    scheduleHeartbeat(LOOP_ID, API_BASE, () => ({ ...meta }));

    mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
    await flushMicrotasks();

    // Only one heartbeat should fire — the first timer was cancelled
    assert.equal(
      fetchCalls.length,
      1,
      "re-scheduling must cancel the prior timer; only one heartbeat must fire",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. cancelHeartbeat stops the heartbeat
// ---------------------------------------------------------------------------

describe("cancelHeartbeat — timer cancellation", () => {
  test("no heartbeat fires after cancelHeartbeat is called", async () => {
    mock.timers.enable({ apis: ["setInterval", "Date"] });

    installMockFetch([]);

    scheduleHeartbeat(LOOP_ID, API_BASE, () => ({ ...meta }));

    // Cancel before the interval fires
    cancelHeartbeat(LOOP_ID);

    // Tick past the interval — the cancelled timer must NOT fire
    mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS * 2);
    await flushMicrotasks();

    assert.equal(
      fetchCalls.length,
      0,
      "no heartbeat fetch must be issued after cancellation",
    );
  });

  test("cancelHeartbeat is idempotent — no-op when no timer is active", () => {
    assert.doesNotThrow(() => {
      cancelHeartbeat("loop-with-no-heartbeat-timer");
    });
  });

  test("cancelling one loop does not affect heartbeat timers for other loops", async () => {
    mock.timers.enable({ apis: ["setInterval", "Date"] });

    const loopA = "heartbeat-loop-A";
    const loopB = "heartbeat-loop-B";
    const tokenA = "token-loop-A";
    const tokenB = "token-loop-B";

    // Only loop B's heartbeat must fire; loop A is cancelled
    installMockFetch([{ status: 200 }]);

    scheduleHeartbeat(loopA, API_BASE, () => ({ token: tokenA }));
    scheduleHeartbeat(loopB, API_BASE, () => ({ token: tokenB }));

    // Cancel loop A
    cancelHeartbeat(loopA);

    // Tick the full interval
    mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
    await flushMicrotasks();

    // Only loop B's heartbeat should have fired
    assert.equal(
      fetchCalls.length,
      1,
      "exactly one heartbeat (loop B only); loop A was cancelled",
    );

    // The heartbeat that fired must carry loop B's token
    const authHeader =
      (fetchCalls[0]?.init.headers as Record<string, string>)["Authorization"] ?? "";
    assert.match(
      authHeader,
      /Bearer token-loop-B/,
      "heartbeat must use loop B's token",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. 404 from /heartbeat disables heartbeat for that server (AC-010)
// ---------------------------------------------------------------------------

describe("scheduleHeartbeat — 404 disables heartbeat for server (AC-010)", () => {
  test("404 response populates oldServersWithoutFeature with the heartbeat URL", async () => {
    mock.timers.enable({ apis: ["setInterval", "Date"] });

    // Pre-condition: set is empty
    assert.equal(
      oldServersWithoutFeature.has(HEARTBEAT_URL),
      false,
      "oldServersWithoutFeature must be empty before the call",
    );

    installMockFetch([{ status: 404 }]);

    scheduleHeartbeat(LOOP_ID, API_BASE, () => ({ ...meta }));

    // Fire the first tick — heartbeat goes out, server returns 404
    mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
    await flushMicrotasks();

    assert.equal(fetchCalls.length, 1, "one heartbeat fetch on first tick");

    // The 404 must have been recorded
    assert.equal(
      oldServersWithoutFeature.has(HEARTBEAT_URL),
      true,
      "404 from /heartbeat must add heartbeat URL to oldServersWithoutFeature",
    );
  });

  test("subsequent ticks skip the heartbeat request after a 404 (no network call)", async () => {
    mock.timers.enable({ apis: ["setInterval", "Date"] });

    // Pre-populate the set (simulates a prior 404 during this process lifetime)
    oldServersWithoutFeature.add(HEARTBEAT_URL);

    // The fetch mock has no responses — any network call would throw
    installMockFetch([]);

    scheduleHeartbeat(LOOP_ID, API_BASE, () => ({ ...meta }));

    // Tick the full interval multiple times — all ticks must be skipped
    mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
    await flushMicrotasks();
    mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
    await flushMicrotasks();

    assert.equal(
      fetchCalls.length,
      0,
      "no heartbeat fetch must be issued when the URL is in oldServersWithoutFeature",
    );
  });

  test("404 on first tick, subsequent ticks are also skipped (end-to-end flow)", async () => {
    mock.timers.enable({ apis: ["setInterval", "Date"] });

    // First tick returns 404; subsequent ticks must be skipped without hitting the network
    installMockFetch([{ status: 404 }]);

    scheduleHeartbeat(LOOP_ID, API_BASE, () => ({ ...meta }));

    // First tick → 404 → populates oldServersWithoutFeature
    mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
    await flushMicrotasks();

    assert.equal(fetchCalls.length, 1, "one fetch on first tick (returns 404)");
    assert.equal(
      oldServersWithoutFeature.has(HEARTBEAT_URL),
      true,
      "URL must be in set after 404",
    );

    // Second tick → must be skipped entirely (no extra fetch)
    mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
    await flushMicrotasks();

    assert.equal(
      fetchCalls.length,
      1,
      "no additional fetch on second tick — heartbeat skipped for old server",
    );
  });

  test("404 detection is per base URL — different base URLs are tracked independently", async () => {
    mock.timers.enable({ apis: ["setInterval", "Date"] });

    const OTHER_BASE = "https://other-api.example.com";
    const otherHeartbeatUrl = `${OTHER_BASE}/heartbeat`;

    // Mark only the first server as old
    oldServersWithoutFeature.add(HEARTBEAT_URL);

    // The other server's heartbeat endpoint should still be called
    installMockFetch([{ status: 200 }]);

    scheduleHeartbeat(LOOP_ID, OTHER_BASE, () => ({ ...meta }));

    mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
    await flushMicrotasks();

    assert.equal(
      fetchCalls.length,
      1,
      "heartbeat to the other (non-blocked) server must be issued",
    );
    assert.equal(
      fetchCalls[0]?.url,
      otherHeartbeatUrl,
      "fetch must target the other server's heartbeat URL",
    );

    // The other URL must NOT have been added to oldServersWithoutFeature (200 response)
    assert.equal(
      oldServersWithoutFeature.has(otherHeartbeatUrl),
      false,
      "successful heartbeat must not pollute oldServersWithoutFeature",
    );
    // The first URL remains blocked
    assert.equal(
      oldServersWithoutFeature.has(HEARTBEAT_URL),
      true,
      "first (old) server URL must remain in oldServersWithoutFeature",
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Heartbeat POST carries the correct token from getToken callback
// ---------------------------------------------------------------------------

describe("scheduleHeartbeat — correct token in Authorization header", () => {
  const tokenCases: Array<{ label: string; token: string }> = [
    { label: "static token", token: "static-bearer-token" },
    { label: "token with special characters", token: "tok.en-with_chars+ABC==/" },
  ];

  for (const { label, token: tokenValue } of tokenCases) {
    test(`heartbeat Authorization header carries token: ${label}`, async () => {
      mock.timers.enable({ apis: ["setInterval", "Date"] });

      installMockFetch([{ status: 200 }]);

      scheduleHeartbeat(LOOP_ID, API_BASE, () => ({ token: tokenValue }));

      mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
      await flushMicrotasks();

      assert.equal(fetchCalls.length, 1, "one heartbeat must fire");

      const headers = fetchCalls[0]?.init.headers as Record<string, string>;
      const authHeader =
        headers["Authorization"] ?? headers["authorization"] ?? "";
      assert.equal(
        authHeader,
        `Bearer ${tokenValue}`,
        `heartbeat Authorization header must be 'Bearer ${tokenValue}'`,
      );
    });
  }

  test("heartbeat uses the current token from getToken on each tick (live provider)", async () => {
    mock.timers.enable({ apis: ["setInterval", "Date"] });

    // Tokens rotate between ticks — the heartbeat must pick up the latest value
    const tokens = ["first-token", "second-token"];
    let callCount = 0;

    installMockFetch([{ status: 200 }, { status: 200 }]);

    scheduleHeartbeat(LOOP_ID, API_BASE, () => {
      const token = tokens[callCount % tokens.length] ?? tokens[0]!;
      callCount += 1;
      return { token };
    });

    // First tick — uses first-token
    mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
    await flushMicrotasks();

    // Second tick — uses second-token (provider called again)
    mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
    await flushMicrotasks();

    assert.equal(fetchCalls.length, 2, "two heartbeats must fire");

    const firstAuth =
      (fetchCalls[0]?.init.headers as Record<string, string>)["Authorization"] ?? "";
    const secondAuth =
      (fetchCalls[1]?.init.headers as Record<string, string>)["Authorization"] ?? "";

    assert.match(firstAuth, /Bearer first-token/, "first tick must use first-token");
    assert.match(secondAuth, /Bearer second-token/, "second tick must use second-token");
  });

  test("heartbeat skips tick when getToken returns null (no token available)", async () => {
    mock.timers.enable({ apis: ["setInterval", "Date"] });

    // The fetch mock has no responses — if a heartbeat were sent it would throw
    installMockFetch([]);

    scheduleHeartbeat(LOOP_ID, API_BASE, () => null);

    mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
    await flushMicrotasks();

    assert.equal(
      fetchCalls.length,
      0,
      "heartbeat must be skipped when getToken returns null",
    );
  });

  test("heartbeat request body includes loopId", async () => {
    mock.timers.enable({ apis: ["setInterval", "Date"] });

    installMockFetch([{ status: 200 }]);

    scheduleHeartbeat(LOOP_ID, API_BASE, () => ({ ...meta }));

    mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
    await flushMicrotasks();

    assert.equal(fetchCalls.length, 1);

    const body = fetchCalls[0]?.init.body;
    assert.ok(body !== undefined, "heartbeat request must have a body");

    const parsed: unknown = JSON.parse(String(body));
    assert.ok(
      parsed !== null && typeof parsed === "object" && "loopId" in parsed,
      "heartbeat body must include loopId field",
    );
    assert.equal(
      (parsed as Record<string, unknown>)["loopId"],
      LOOP_ID,
      "heartbeat body loopId must match the scheduled loop",
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Network errors during heartbeat don't crash the loop (fire-and-forget)
// ---------------------------------------------------------------------------

describe("scheduleHeartbeat — network errors are fire-and-forget", () => {
  const networkErrorCases: Array<{ label: string; error: Error }> = [
    { label: "ECONNREFUSED", error: new Error("ECONNREFUSED") },
    { label: "ETIMEDOUT", error: new Error("ETIMEDOUT") },
    { label: "fetch failed: network unreachable", error: new Error("fetch failed: network unreachable") },
  ];

  for (const { label, error } of networkErrorCases) {
    test(`network error (${label}) does not crash the loop or prevent subsequent ticks`, async () => {
      mock.timers.enable({ apis: ["setInterval", "Date"] });

      // First tick throws a network error; second tick succeeds
      installMockFetch([
        { status: 0, throw: error },
        { status: 200 },
      ]);

      // Schedule heartbeat — errors must not propagate or kill the interval
      scheduleHeartbeat(LOOP_ID, API_BASE, () => ({ ...meta }));

      // First tick — network error, must be swallowed
      mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
      await flushMicrotasks();

      // The interval must still be alive — second tick fires normally
      mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
      await flushMicrotasks();

      assert.equal(
        fetchCalls.length,
        2,
        `both ticks must fire: first with ${label} error (swallowed), second succeeds`,
      );
    });
  }

  test("non-200 non-404 error response is logged but does not crash the loop", async () => {
    mock.timers.enable({ apis: ["setInterval", "Date"] });

    // First tick returns 500 (server error); second tick succeeds
    installMockFetch([
      { status: 500 },
      { status: 200 },
    ]);

    scheduleHeartbeat(LOOP_ID, API_BASE, () => ({ ...meta }));

    // First tick — 500 error response, must not crash the interval
    mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
    await flushMicrotasks();

    // Second tick — succeeds normally
    mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
    await flushMicrotasks();

    assert.equal(
      fetchCalls.length,
      2,
      "both ticks must fire despite a 500 on the first tick",
    );

    // 500 must NOT have populated oldServersWithoutFeature (only 404 does that)
    assert.equal(
      oldServersWithoutFeature.has(HEARTBEAT_URL),
      false,
      "500 error must not add URL to oldServersWithoutFeature (only 404 does)",
    );
  });

  test("network error on heartbeat must not add URL to oldServersWithoutFeature", async () => {
    mock.timers.enable({ apis: ["setInterval", "Date"] });

    installMockFetch([
      { status: 0, throw: new Error("ECONNREFUSED") },
    ]);

    scheduleHeartbeat(LOOP_ID, API_BASE, () => ({ ...meta }));

    mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
    await flushMicrotasks();

    assert.equal(
      oldServersWithoutFeature.has(HEARTBEAT_URL),
      false,
      "network error must not populate oldServersWithoutFeature (only 404 responses do)",
    );
  });
});
