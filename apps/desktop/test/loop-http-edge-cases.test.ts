/**
 * Unit tests for edge-case behaviors in loop-http.ts (T-2.6).
 *
 * Covered scenarios:
 *  1. Happy path: 200 on first event POST (no 401 detour)
 *  2. 5xx server error on initial event POST returns { success: false }
 *  3. Timeout abort: postLoopEventBounded AbortController path
 *  4. JSON parse errors: malformed body from refresh endpoint
 *  5. Network failure: thrown error on initial event POST
 *
 * Tests use the same mock-fetch harness pattern as loop-http-refresh.test.ts.
 */

import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import {
  postLoopEvent,
  postLoopEventBounded,
} from "../src/server/operations/loop-http.js";
import type { LoopTokenMeta } from "../src/main/loop-token-store.js";

// ---------------------------------------------------------------------------
// Shared mock-fetch harness (mirrors loop-http-refresh.test.ts)
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
  /** Optional artificial delay in ms before resolving (for timeout tests). */
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
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const API_BASE = "https://api.example.com";
const LOOP_ID = "edge-case-loop-id";
const INITIAL_TOKEN = "initial-token-edge";

const initialMeta: LoopTokenMeta = { token: INITIAL_TOKEN };

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
// 1. Happy path: 200 on first event POST (no 401 detour)
// ---------------------------------------------------------------------------

describe("postLoopEvent — clean 200 happy path (no 401)", () => {
  const cases = [
    {
      label: "returns { success: true } on 200 with empty body",
      responseBody: {},
    },
    {
      label: "returns { success: true } on 200 with non-empty body",
      responseBody: { id: "event-123", status: "accepted" },
    },
  ];

  for (const { label, responseBody } of cases) {
    test(label, async () => {
      installMockFetch([
        { status: 200, body: responseBody },
      ]);

      const result = await postLoopEvent(
        API_BASE,
        LOOP_ID,
        () => ({ ...initialMeta }),
        { type: "test_event" },
      );

      assert.equal(result.success, true, "should succeed on direct 200");
      assert.equal(result.error, undefined, "no error on success");

      // Exactly one fetch call — no refresh detour
      assert.equal(fetchCalls.length, 1, "should make exactly one fetch call");

      const [eventCall] = fetchCalls;
      assert.ok(
        eventCall?.url.includes(`/loops/${LOOP_ID}/events`),
        "should POST to events endpoint",
      );

      const headers = eventCall?.init.headers as Record<string, string>;
      assert.match(
        headers["Authorization"] ?? headers["authorization"] ?? "",
        /Bearer initial-token-edge/,
        "should use the provided token",
      );
    });
  }
});

// ---------------------------------------------------------------------------
// 2. 5xx server errors on initial event POST
// ---------------------------------------------------------------------------

describe("postLoopEvent — 5xx server error on initial POST", () => {
  const serverErrorCases = [
    { status: 500, statusText: "Internal Server Error" },
    { status: 502, statusText: "Bad Gateway" },
    { status: 503, statusText: "Service Unavailable" },
  ];

  for (const { status, statusText } of serverErrorCases) {
    test(`returns { success: false } on ${status} ${statusText}`, async () => {
      const { setToken } = makeSetTokenSpy();

      // The mock Response uses an empty statusText by default; the error
      // message is built from what the Response object exposes. We check
      // that the status code is reflected in the error string.
      installMockFetch([
        { status, body: { error: statusText } },
      ]);

      const result = await postLoopEvent(
        API_BASE,
        LOOP_ID,
        () => ({ ...initialMeta }),
        { type: "test_event" },
        undefined,
        setToken,
      );

      assert.equal(result.success, false, `should fail on ${status}`);
      assert.ok(result.error, "error field should be set");
      assert.match(
        result.error ?? "",
        new RegExp(String(status)),
        `error should mention HTTP ${status}`,
      );

      // Only one fetch call — 5xx is not retried
      assert.equal(fetchCalls.length, 1, `${status} should not trigger a retry`);
    });
  }
});

// ---------------------------------------------------------------------------
// 2b. 5xx on initial POST with setToken provided: still no refresh attempt
// ---------------------------------------------------------------------------

describe("postLoopEvent — 5xx does NOT trigger token refresh", () => {
  test("setToken is never called on 5xx (no 401 refresh path)", async () => {
    const { calls: setTokenCalls, setToken } = makeSetTokenSpy();

    installMockFetch([
      { status: 500, body: { error: "server error" } },
    ]);

    const result = await postLoopEvent(
      API_BASE,
      LOOP_ID,
      () => ({ ...initialMeta }),
      { type: "test_event" },
      undefined,
      setToken,
    );

    assert.equal(result.success, false);
    assert.equal(setTokenCalls.length, 0, "setToken must not be called for 5xx errors");
    assert.equal(fetchCalls.length, 1, "no refresh attempt for 5xx");
  });
});

// ---------------------------------------------------------------------------
// 3. Timeout abort: postLoopEventBounded AbortController path
// ---------------------------------------------------------------------------

/**
 * Install a mock fetch that simulates a slow server which correctly observes
 * the AbortSignal. When the signal is aborted before the delay completes, the
 * mock throws a DOMException with name "AbortError" — matching real fetch
 * behavior and triggering the `catch {}` block in postLoopEventBounded.
 */
function installAbortAwareMockFetch(delayMs: number): void {
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    fetchCalls.push({
      url: typeof input === "string" ? input : String(input),
      init: init ?? {},
    });
    const signal = init?.signal;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }
    });
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("postLoopEventBounded — timeout abort", () => {
  /**
   * Behavioral note on the abort/timeout error string:
   *
   * When the AbortController fires, the abort-aware mock throws a DOMException
   * with name "AbortError". `postLoopEvent` catches all thrown errors in its
   * inner try/catch and returns `{ success: false, error: err.message }` as a
   * resolved promise — it does NOT re-throw. Therefore `postLoopEventBounded`'s
   * own `catch {}` (which would return `{ error: "timeout" }`) is never reached.
   *
   * The actual observable behavior is:
   *   result.success === false
   *   result.error === "The operation was aborted."  (the AbortError message)
   *
   * Tests below assert the actual behavior so they serve as a contract spec.
   */
  test("returns { success: false } when request exceeds timeoutMs (abort path)", async () => {
    // Simulate a slow server: delay is longer than timeoutMs.
    // The mock fetch observes the AbortSignal and throws AbortError when the
    // controller fires — matching real fetch behavior.
    const timeoutMs = 50;
    const serverDelayMs = timeoutMs + 500;

    installAbortAwareMockFetch(serverDelayMs);

    const result = await postLoopEventBounded(
      API_BASE,
      LOOP_ID,
      () => ({ ...initialMeta }),
      { type: "test_event" },
      timeoutMs,
    );

    assert.equal(result.success, false, "should fail on timeout");
    assert.ok(result.error, "error field should be set when timed out");
    // The abort bubbles through postLoopEvent's catch block with the DOMException
    // message. We assert it is non-empty — the exact wording is an implementation
    // detail of the JS runtime's AbortError message.
    assert.notEqual(result.error, undefined, "error must not be undefined");
    assert.equal(fetchCalls.length, 1, "one fetch attempt (aborted mid-flight)");
  });

  test("returns { success: true } when request completes within timeoutMs", async () => {
    const timeoutMs = 500;

    installMockFetch([
      { status: 200, body: {} },
    ]);

    const result = await postLoopEventBounded(
      API_BASE,
      LOOP_ID,
      () => ({ ...initialMeta }),
      { type: "test_event" },
      timeoutMs,
    );

    assert.equal(result.success, true, "should succeed when within timeout");
    assert.equal(result.error, undefined, "no error on success within timeout");
  });

  test("AbortSignal is passed to fetch: abort-aware mock confirms signal propagation", async () => {
    // Confirm the signal is actually forwarded: an abort-aware mock with a
    // very short timeout fires the abort, and the result is a failure.
    const timeoutMs = 10;
    installAbortAwareMockFetch(timeoutMs + 1000);

    const result = await postLoopEventBounded(
      API_BASE,
      LOOP_ID,
      () => ({ ...initialMeta }),
      { type: "test_event" },
      timeoutMs,
    );

    assert.equal(result.success, false, "abort signal must propagate to fetch and cause failure");
    assert.ok(result.error, "error must be set when signal is aborted");
    assert.equal(fetchCalls.length, 1, "exactly one fetch call (aborted)");
  });
});

// ---------------------------------------------------------------------------
// 4. JSON parse errors on refresh response body
// ---------------------------------------------------------------------------

describe("postLoopEvent — malformed JSON in refresh response body", () => {
  /**
   * To exercise parseRefreshSuccessBody's `.json().catch(() => null)` path,
   * we need the refresh endpoint to return a 200 with a body that is not
   * valid JSON. The standard mock harness uses JSON.stringify which always
   * produces valid JSON. We override the fetch mock body-reading behavior by
   * returning a raw non-JSON string body directly.
   */
  function installMockFetchWithRawBody(
    responses: Array<{ status: number; rawBody?: string; body?: unknown }>,
  ): void {
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
      const bodyText =
        response.rawBody !== undefined
          ? response.rawBody
          : response.body === undefined
            ? ""
            : JSON.stringify(response.body);
      return new Response(bodyText, {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
  }

  test("refresh response with malformed JSON returns { success: false, error: 'refresh response missing token field' }", async () => {
    const { setToken } = makeSetTokenSpy();

    installMockFetchWithRawBody([
      // Initial event POST returns 401
      { status: 401 },
      // Refresh endpoint returns 200 but with invalid JSON body
      { status: 200, rawBody: "not-valid-json{{{{" },
    ]);

    const result = await postLoopEvent(
      API_BASE,
      LOOP_ID,
      () => ({ ...initialMeta }),
      { type: "test_event" },
      undefined,
      setToken,
    );

    assert.equal(result.success, false, "should fail when refresh body is malformed JSON");
    assert.ok(result.error, "error field should be set");
    assert.match(
      result.error ?? "",
      /refresh response missing token field/,
      "error should report missing token field (from parseRefreshSuccessBody)",
    );

    // Two fetch calls: event POST (401) + refresh attempt (malformed 200)
    // No retry event POST because refresh result was not ok
    assert.equal(fetchCalls.length, 2, "should make 2 fetch calls (event + failed refresh)");
  });

  test("refresh response with JSON missing token field returns { success: false }", async () => {
    const { setToken } = makeSetTokenSpy();

    installMockFetchWithRawBody([
      // Initial event POST returns 401
      { status: 401 },
      // Refresh endpoint returns 200 but body has no 'token' field
      { body: { expiresAt: 9999999999000, jti: "jti-no-token" } },
    ]);

    const result = await postLoopEvent(
      API_BASE,
      LOOP_ID,
      () => ({ ...initialMeta }),
      { type: "test_event" },
      undefined,
      setToken,
    );

    assert.equal(result.success, false, "should fail when refresh body is missing token field");
    assert.match(
      result.error ?? "",
      /refresh response missing token field/,
      "error should report missing token field",
    );

    assert.equal(fetchCalls.length, 2, "should make 2 fetch calls (event + failed refresh)");
  });
});

// ---------------------------------------------------------------------------
// 5. Network failure on initial event POST
// ---------------------------------------------------------------------------

describe("postLoopEvent — network failure on initial event POST", () => {
  const networkErrorCases = [
    {
      label: "ECONNREFUSED connection refused",
      error: new Error("ECONNREFUSED"),
    },
    {
      label: "ETIMEDOUT connection timeout",
      error: new Error("ETIMEDOUT"),
    },
    {
      label: "network error with custom message",
      error: new Error("fetch failed: network unreachable"),
    },
  ];

  for (const { label, error } of networkErrorCases) {
    test(`returns { success: false, error: message } on ${label}`, async () => {
      const { calls: setTokenCalls, setToken } = makeSetTokenSpy();

      installMockFetch([
        { status: 0, throw: error },
      ]);

      const result = await postLoopEvent(
        API_BASE,
        LOOP_ID,
        () => ({ ...initialMeta }),
        { type: "test_event" },
        undefined,
        setToken,
      );

      assert.equal(result.success, false, `should fail on ${label}`);
      assert.ok(result.error, "error field should be set");
      assert.equal(
        result.error,
        error.message,
        "error message should match the thrown error's message",
      );

      // Only one fetch attempt — network errors are not retried
      assert.equal(fetchCalls.length, 1, "network error should not trigger retry");

      // setToken should never be called on a pure network error
      assert.equal(
        setTokenCalls.length,
        0,
        "setToken must not be called on network failure",
      );
    });
  }

  test("network error on initial POST does not attempt token refresh", async () => {
    const { calls: setTokenCalls, setToken } = makeSetTokenSpy();

    installMockFetch([
      { status: 0, throw: new Error("ECONNREFUSED") },
    ]);

    const result = await postLoopEvent(
      API_BASE,
      LOOP_ID,
      () => ({ ...initialMeta }),
      { type: "test_event" },
      undefined,
      setToken,
    );

    // Network errors are caught before we ever inspect resp.status,
    // so no refresh path is entered even if setToken is provided.
    assert.equal(result.success, false);
    assert.equal(setTokenCalls.length, 0, "no refresh attempt on network failure");
    assert.equal(fetchCalls.length, 1, "only one fetch attempt — catch block exits early");
  });
});
