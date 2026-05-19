/**
 * Integration tests for loop-http.ts against a real mock HTTP server.
 *
 * Unlike the unit tests (loop-http-refresh.test.ts, loop-http-heartbeat.test.ts)
 * which intercept globalThis.fetch, these tests spin up a real node:http server
 * and let loop-http.ts issue genuine HTTP requests against it. This validates
 * the full serialization/deserialization path and real network I/O.
 *
 * Covered lifecycle:
 *  1. Post an event successfully (server returns 200)
 *  2. Post an event that gets 401 → server returns new token on /refresh-token
 *     → event is retried with new token and succeeds
 *  3. Schedule heartbeat → heartbeat request arrives at real server
 *     → cancel heartbeat → no more requests arrive
 *
 * Server setup/teardown uses callbacks-to-Promises to remain compatible with
 * node:test's async test runner. Mock timers are enabled inside individual
 * tests only after the server is already listening (so server startup uses real
 * timers and is unaffected by mock.timers.enable).
 */

import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, describe, mock, test } from "node:test";
import {
  cancelHeartbeat,
  oldServersWithoutFeature,
  postLoopEvent,
  scheduleHeartbeat,
} from "../src/server/operations/loop-http.js";
import type { LoopTokenMeta } from "../src/main/loop-token-store.js";

// ---------------------------------------------------------------------------
// Mock server helpers
// ---------------------------------------------------------------------------

type RecordedRequest = {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
};

type ServerScenario = {
  /** Path prefix to match (e.g. "/loops/", "/refresh-token", "/heartbeat") */
  pathMatch: string;
  /** HTTP status to respond with */
  status: number;
  /** Optional response body (JSON-serialized) */
  responseBody?: unknown;
};

/**
 * Start a real node:http server on a random OS-assigned port.
 *
 * The server handles requests in order against the provided scenario list.
 * Each incoming request is matched against the next unmatched scenario by
 * path prefix. Unmatched or excess requests respond with 500.
 *
 * Returns the base URL and a function to close the server.
 */
async function startMockServer(scenarios: ServerScenario[]): Promise<{
  baseUrl: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}> {
  const requests: RecordedRequest[] = [];
  let scenarioIndex = 0;

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      const recorded: RecordedRequest = {
        method: req.method ?? "GET",
        path: req.url ?? "/",
        headers: req.headers,
        body,
      };
      requests.push(recorded);

      const scenario = scenarios[scenarioIndex++];
      if (scenario === undefined) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "no scenario configured for this request" }));
        return;
      }

      const responseBody =
        scenario.responseBody === undefined
          ? ""
          : JSON.stringify(scenario.responseBody);
      res.writeHead(scenario.status, { "Content-Type": "application/json" });
      res.end(responseBody);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // Port 0 lets the OS assign a free port automatically.
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(
    address !== null && typeof address === "object",
    "server address must be an object after listen()",
  );
  const { port } = address as { port: number };
  const baseUrl = `http://127.0.0.1:${port}`;

  const close = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

  return { baseUrl, requests, close };
}

/**
 * Flush the microtask / promise queue. Used after mock.timers.tick() to drain
 * async chains kicked off by timer callbacks before making assertions.
 */
async function flushMicrotasks(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LOOP_ID = "integration-test-loop";
const DEFAULT_HEARTBEAT_INTERVAL_MS = 1800000;

afterEach(() => {
  // Reset mock timers if any test enabled them
  mock.timers.reset();
  // Clear old-server detection state between tests (AC-010)
  oldServersWithoutFeature.clear();
  // Cancel any lingering heartbeat timers
  cancelHeartbeat(LOOP_ID);
});

// ---------------------------------------------------------------------------
// 1. Full lifecycle: successful event POST
// ---------------------------------------------------------------------------

describe("loop-http integration — successful event POST", () => {
  test("postLoopEvent sends correct headers and body; server receives them", async () => {
    const token = "integration-token-abc";
    const meta: LoopTokenMeta = { token };

    const { baseUrl, requests, close } = await startMockServer([
      {
        pathMatch: `/loops/${LOOP_ID}/events`,
        status: 200,
        responseBody: { ok: true },
      },
    ]);

    try {
      const result = await postLoopEvent(
        baseUrl,
        LOOP_ID,
        () => ({ ...meta }),
        { type: "integration_test_event", payload: "hello" },
      );

      assert.equal(result.success, true, "postLoopEvent must succeed on 200 response");
      assert.equal(requests.length, 1, "server must have received exactly one request");

      const req = requests[0];
      assert.ok(req, "request must be recorded");
      assert.equal(req.method, "POST", "request method must be POST");
      assert.ok(
        req.path.includes(`/loops/${LOOP_ID}/events`),
        "request path must target the events endpoint",
      );

      // Authorization header must carry the token
      const authHeader = req.headers["authorization"] ?? "";
      assert.match(
        authHeader,
        new RegExp(`Bearer ${token}`),
        "Authorization header must carry the token",
      );

      // Idempotency nonce header must be present
      assert.ok(
        req.headers["x-loop-event-nonce"],
        "x-loop-event-nonce header must be present on event POST",
      );

      // Body must include the event type and auto-injected timestamp
      const parsedBody: unknown = JSON.parse(req.body);
      assert.ok(
        parsedBody !== null && typeof parsedBody === "object",
        "request body must be valid JSON object",
      );
      const body = parsedBody as Record<string, unknown>;
      assert.equal(body["type"], "integration_test_event", "body must include event type");
      assert.ok(body["timestamp"], "body must include auto-injected timestamp");
      assert.equal(body["payload"], "hello", "body must include original payload fields");
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Full 401 refresh lifecycle: 401 → /refresh-token → retry with new token
// ---------------------------------------------------------------------------

describe("loop-http integration — 401 refresh lifecycle", () => {
  test("401 on event POST triggers real HTTP refresh call, retry uses new token", async () => {
    const initialToken = "stale-token-integration";
    const newToken = "refreshed-token-integration";
    const newExpiresAt = Date.now() + 3600000;

    const tokenHolder: { meta: LoopTokenMeta } = {
      meta: { token: initialToken },
    };

    const setTokenCalls: LoopTokenMeta[] = [];

    const { baseUrl, requests, close } = await startMockServer([
      // Step 1: event POST with stale token → 401
      {
        pathMatch: `/loops/${LOOP_ID}/events`,
        status: 401,
        responseBody: { error: "token expired" },
      },
      // Step 2: refresh-token request → success with new token
      {
        pathMatch: "/refresh-token",
        status: 200,
        responseBody: {
          token: newToken,
          expiresAt: newExpiresAt,
          jti: "jti-integration-1",
        },
      },
      // Step 3: retry event POST with new token → success
      {
        pathMatch: `/loops/${LOOP_ID}/events`,
        status: 200,
        responseBody: { ok: true },
      },
    ]);

    try {
      const result = await postLoopEvent(
        baseUrl,
        LOOP_ID,
        () => ({ ...tokenHolder.meta }),
        { type: "refresh_lifecycle_event" },
        undefined,
        (meta) => {
          setTokenCalls.push(meta);
          tokenHolder.meta = meta;
        },
      );

      assert.equal(result.success, true, "postLoopEvent must succeed after 401 refresh");

      // Three real HTTP requests must have arrived at the mock server
      assert.equal(
        requests.length,
        3,
        "server must have received 3 requests: event POST, refresh, retry event POST",
      );

      const [eventReq, refreshReq, retryReq] = requests;

      // First request: event POST with stale token
      assert.ok(eventReq, "first request must be recorded");
      assert.ok(
        eventReq.path.includes(`/loops/${LOOP_ID}/events`),
        "first request must be the event endpoint",
      );
      assert.match(
        eventReq.headers["authorization"] ?? "",
        new RegExp(`Bearer ${initialToken}`),
        "first event POST must use the stale token",
      );

      // Second request: /refresh-token
      assert.ok(refreshReq, "second request must be recorded");
      assert.ok(
        refreshReq.path.includes("/refresh-token"),
        "second request must be the refresh endpoint",
      );
      assert.match(
        refreshReq.headers["authorization"] ?? "",
        new RegExp(`Bearer ${initialToken}`),
        "refresh request must use the stale token",
      );
      assert.ok(
        refreshReq.headers["idempotency-key"],
        "refresh request must include Idempotency-Key header",
      );

      // Refresh body must include loopId
      const refreshBody: unknown = JSON.parse(refreshReq.body);
      assert.ok(
        refreshBody !== null && typeof refreshBody === "object",
        "refresh body must be valid JSON",
      );
      assert.equal(
        (refreshBody as Record<string, unknown>)["loopId"],
        LOOP_ID,
        "refresh body must include loopId",
      );

      // Third request: retry event POST with new token
      assert.ok(retryReq, "third request must be recorded");
      assert.ok(
        retryReq.path.includes(`/loops/${LOOP_ID}/events`),
        "third request must be the event endpoint (retry)",
      );
      assert.match(
        retryReq.headers["authorization"] ?? "",
        new RegExp(`Bearer ${newToken}`),
        "retry event POST must use the refreshed token",
      );

      // setToken must have been called to persist the new token
      assert.ok(setTokenCalls.length >= 1, "setToken must have been called at least once");
      const lastSetToken = setTokenCalls[setTokenCalls.length - 1];
      assert.equal(
        lastSetToken?.token,
        newToken,
        "final setToken call must carry the new token",
      );
      assert.equal(
        lastSetToken?.lastIdempotencyKey,
        undefined,
        "refreshed token must not include a stale idempotency key",
      );
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Heartbeat lifecycle: schedule → ticks arrive at server → cancel → stops
// ---------------------------------------------------------------------------

describe("loop-http integration — heartbeat lifecycle", () => {
  test("heartbeat ticks arrive at mock server; cancel stops subsequent ticks", async () => {
    const token = "heartbeat-integration-token";
    const meta: LoopTokenMeta = { token };

    // We expect 2 heartbeat ticks to fire before cancellation
    const { baseUrl, requests, close } = await startMockServer([
      { pathMatch: "/heartbeat", status: 200, responseBody: { ok: true } },
      { pathMatch: "/heartbeat", status: 200, responseBody: { ok: true } },
    ]);

    try {
      // Enable mock timers AFTER the server is already listening so that server
      // startup (which uses real timers internally) is unaffected.
      mock.timers.enable({ apis: ["setInterval", "Date"] });

      scheduleHeartbeat(LOOP_ID, baseUrl, () => ({ ...meta }));

      // Tick one full interval — first heartbeat should fire
      mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
      // Flush async chains: the fetch promise resolves asynchronously
      await flushMicrotasks();

      assert.equal(
        requests.length,
        1,
        "one heartbeat request must arrive at the mock server after first tick",
      );

      // Verify the first heartbeat request structure
      const hbReq1 = requests[0];
      assert.ok(hbReq1, "first heartbeat request must be recorded");
      assert.equal(hbReq1.method, "POST", "heartbeat must use POST");
      assert.ok(
        hbReq1.path.includes("/heartbeat"),
        "heartbeat must target /heartbeat endpoint",
      );
      assert.match(
        hbReq1.headers["authorization"] ?? "",
        new RegExp(`Bearer ${token}`),
        "heartbeat must carry the token in the Authorization header",
      );

      // Heartbeat body must include loopId
      const hbBody1: unknown = JSON.parse(hbReq1.body);
      assert.ok(
        hbBody1 !== null && typeof hbBody1 === "object",
        "heartbeat body must be valid JSON",
      );
      assert.equal(
        (hbBody1 as Record<string, unknown>)["loopId"],
        LOOP_ID,
        "heartbeat body must include loopId",
      );

      // Tick a second interval — second heartbeat fires
      mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS);
      await flushMicrotasks();

      assert.equal(
        requests.length,
        2,
        "two heartbeat requests must arrive after second tick",
      );

      // Cancel the heartbeat — no more ticks must arrive at the server
      cancelHeartbeat(LOOP_ID);

      // Tick past two more intervals; the server has no more scenarios configured
      // (any request would trigger a 500 response from the mock server)
      mock.timers.tick(DEFAULT_HEARTBEAT_INTERVAL_MS * 2);
      await flushMicrotasks();

      // requests.length must still be 2 — no additional requests after cancellation
      assert.equal(
        requests.length,
        2,
        "no heartbeat requests must arrive after cancelHeartbeat is called",
      );
    } finally {
      mock.timers.reset();
      await close();
    }
  });
});
