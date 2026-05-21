/**
 * Unit tests for apps/desktop/src/main/loop-heartbeat.ts
 *
 * Covers:
 *   - periodic heartbeat firing at the configured interval
 *   - fire-and-forget error handling (fetch throws — must not propagate)
 *   - fire-and-forget error handling (non-200 HTTP response — must not propagate)
 *   - 404 gate integration: 404 response disables the endpoint and stops the loop's scheduler
 *   - CLOSEDLOOP_HEARTBEAT_INTERVAL_MS env var override
 *   - stop() cancels a running heartbeat scheduler cleanly
 *   - stopAll() cancels all active heartbeat schedulers
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { LoopSchedulerContext } from "../src/main/loop-scheduler-context.js";
import {
  isEndpointDisabled,
  resetAllGates,
} from "../src/main/loop-404-gate.js";
import { flushAsync } from "./loop-token-test-utils.js";

// Per-test scheduler context. Cleared in afterEach via Symbol.dispose so
// timers never leak across tests.
let ctx: LoopSchedulerContext;
// Token store stub satisfies the LoopSchedulerDeps contract used by sleep
// recovery; heartbeat tests never invoke its methods.
const dummyLoopTokenStore = {} as never;
const start = (loopId: string, deps: { apiBaseUrl: string; getToken: () => string | null }) =>
  ctx.startHeartbeat(loopId, deps);
const stop = (loopId: string) => ctx.stopHeartbeat(loopId);
const stopAll = () => ctx[Symbol.dispose]();
void dummyLoopTokenStore;

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
const originalIntervalEnv = process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS;

interface CapturedHeartbeat {
  url: string;
  method: string;
  authorization: string | undefined;
}

let capturedHeartbeats: CapturedHeartbeat[] = [];

// ---------------------------------------------------------------------------
// Fetch stub helpers
// ---------------------------------------------------------------------------

function installHeartbeatFetchStub(status: number, body = ""): void {
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    capturedHeartbeats.push({
      url: String(input),
      method: init?.method ?? "GET",
      authorization: headers.get("authorization") ?? undefined,
    });
    return new Response(body, { status });
  }) as typeof fetch;
}

/**
 * Installs a fetch stub that throws a network error on every call.
 */
function installThrowingFetchStub(): void {
  globalThis.fetch = (async () => {
    capturedHeartbeats.push({ url: "throw", method: "POST", authorization: undefined });
    throw new Error("ECONNREFUSED simulated network error");
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  capturedHeartbeats = [];
  resetAllGates();
  ctx = new LoopSchedulerContext();
});

afterEach(() => {
  // Cancel all heartbeat timers left by the test.
  stopAll();

  // Reset fake timers.
  mock.timers.reset();

  // Restore global fetch.
  globalThis.fetch = originalFetch;

  // Restore env var.
  if (originalIntervalEnv === undefined) {
    delete process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS;
  } else {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = originalIntervalEnv;
  }

  // Reset 404 gate state.
  resetAllGates();
});

// ---------------------------------------------------------------------------
// Periodic heartbeat firing
// ---------------------------------------------------------------------------

describe("loop-heartbeat: periodic firing", () => {
  test("heartbeat fires at each interval tick", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "1000";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    installHeartbeatFetchStub(200);

    start("loop-hb", { apiBaseUrl: "https://api.example.com", getToken: () => "bearer-token" });

    // First interval.
    mock.timers.tick(1000);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 1, "expected one heartbeat after first interval");

    // Second interval.
    mock.timers.tick(1000);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 2, "expected two heartbeats after second interval");

    // Third interval.
    mock.timers.tick(1000);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 3, "expected three heartbeats after third interval");
  });

  test("heartbeat POSTs to the correct URL with Authorization header", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "500";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    installHeartbeatFetchStub(200);

    start("loop-123", { apiBaseUrl: "https://api.example.com", getToken: () => "my-bearer-token" });

    mock.timers.tick(500);
    await flushAsync();

    assert.equal(capturedHeartbeats.length, 1);
    const hb = capturedHeartbeats[0];
    assert.ok(hb, "expected at least one captured heartbeat");
    assert.equal(hb.url, "https://api.example.com/loops/loop-123/heartbeat");
    assert.equal(hb.method, "POST");
    assert.equal(hb.authorization, "Bearer my-bearer-token");
  });

  test("heartbeat does not fire before the first interval elapses", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "2000";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    installHeartbeatFetchStub(200);

    start("loop-early", { apiBaseUrl: "https://api.example.com", getToken: () => "tok" });

    mock.timers.tick(1999);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 0, "no heartbeat must fire before the interval");
  });

  test("skips heartbeat when getToken() returns null", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "1000";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    installHeartbeatFetchStub(200);

    start("loop-no-token", { apiBaseUrl: "https://api.example.com", getToken: () => null });

    mock.timers.tick(1000);
    await flushAsync();
    // Fetch must not be called because getToken returned null.
    assert.equal(capturedHeartbeats.length, 0, "no heartbeat must be issued when token is null");
  });
});

// ---------------------------------------------------------------------------
// Fire-and-forget error handling
// ---------------------------------------------------------------------------

describe("loop-heartbeat: fire-and-forget error handling", () => {
  test("a thrown network error in fetch does not propagate and heartbeat continues", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "1000";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    installThrowingFetchStub();

    // Should not throw during start.
    assert.doesNotThrow(() => {
      start("loop-throw", { apiBaseUrl: "https://api.example.com", getToken: () => "tok" });
    });

    // Firing the interval must not cause an unhandled rejection or throw.
    await assert.doesNotReject(async () => {
      mock.timers.tick(1000);
      await flushAsync();
    });

    // The error was swallowed — heartbeat tried once.
    assert.equal(capturedHeartbeats.length, 1, "expected one attempted heartbeat despite the thrown error");

    // Subsequent intervals must still fire (scheduler is not stopped on error).
    mock.timers.tick(1000);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 2, "subsequent heartbeats must still fire after network error");
  });

  test("a non-2xx HTTP response (500) is swallowed and does not stop the heartbeat", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "1000";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    installHeartbeatFetchStub(500, "Internal Server Error");

    start("loop-500", { apiBaseUrl: "https://api.example.com", getToken: () => "tok" });

    mock.timers.tick(1000);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 1, "heartbeat must have fired once");

    // Should still fire on next interval.
    mock.timers.tick(1000);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 2, "heartbeat must fire again after a 500 response");
  });
});

// ---------------------------------------------------------------------------
// 404 gate integration
// ---------------------------------------------------------------------------

describe("loop-heartbeat: 404 gate integration", () => {
  test("a 404 response marks the endpoint disabled and stops the heartbeat scheduler", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "1000";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    installHeartbeatFetchStub(404);

    start("loop-404", { apiBaseUrl: "https://api.example.com", getToken: () => "tok" });

    // First interval fires and receives 404.
    mock.timers.tick(1000);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 1, "heartbeat must have fired once (received 404)");

    // The endpoint must now be marked disabled.
    assert.equal(
      isEndpointDisabled("https://api.example.com", "/loops/loop-404/heartbeat"),
      true,
      "endpoint must be marked disabled after 404",
    );

    // Subsequent interval ticks must not call fetch again (scheduler stopped).
    mock.timers.tick(1000);
    await flushAsync();
    assert.equal(
      capturedHeartbeats.length,
      1,
      "heartbeat must not fire again after 404 stops the scheduler",
    );
  });

  test("heartbeat is skipped when endpoint is already marked disabled before start()", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "1000";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    // Pre-disable the endpoint.
    const { markEndpointDisabled } = await import("../src/main/loop-404-gate.js");
    markEndpointDisabled("https://api.example.com", "/loops/loop-pre-disabled/heartbeat");

    installHeartbeatFetchStub(200);

    start("loop-pre-disabled", { apiBaseUrl: "https://api.example.com", getToken: () => "tok" });

    mock.timers.tick(1000);
    await flushAsync();
    // fetch must not be called because the endpoint was already disabled.
    assert.equal(
      capturedHeartbeats.length,
      0,
      "heartbeat must be skipped when endpoint is already disabled by 404 gate",
    );
  });
});

// ---------------------------------------------------------------------------
// Env var override
// ---------------------------------------------------------------------------

describe("loop-heartbeat: CLOSEDLOOP_HEARTBEAT_INTERVAL_MS override", () => {
  test("uses the env var interval instead of the default 30-minute interval", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "3000";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    installHeartbeatFetchStub(200);

    start("loop-env-interval", { apiBaseUrl: "https://api.example.com", getToken: () => "tok" });

    // Just before the env-var interval — must not fire.
    mock.timers.tick(2999);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 0, "must not fire before env-var interval");

    // Exactly at the env-var interval — must fire.
    mock.timers.tick(1);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 1, "must fire at the env-var interval");
  });

  test("ignores an invalid CLOSEDLOOP_HEARTBEAT_INTERVAL_MS and uses the default", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "not-a-number";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    installHeartbeatFetchStub(200);

    start("loop-env-invalid", { apiBaseUrl: "https://api.example.com", getToken: () => "tok" });

    // Default interval is 30 minutes = 1_800_000 ms.
    // Tick just before default — must not fire.
    mock.timers.tick(1_799_999);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 0, "must not fire before default interval");

    // Tick 1 more ms — must fire.
    mock.timers.tick(1);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 1, "must fire at the default 30-minute interval");
  });
});

// ---------------------------------------------------------------------------
// Clean stop
// ---------------------------------------------------------------------------

describe("loop-heartbeat: clean stop", () => {
  test("stop() cancels a running heartbeat and prevents further firing", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "1000";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    installHeartbeatFetchStub(200);

    start("loop-cleanstop", { apiBaseUrl: "https://api.example.com", getToken: () => "tok" });

    // Let one heartbeat fire.
    mock.timers.tick(1000);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 1, "first heartbeat must fire");

    stop("loop-cleanstop");

    // After stop, no further heartbeats should fire.
    mock.timers.tick(1000);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 1, "stop() must prevent further heartbeats");
  });

  test("stop() is a no-op for a loop with no active timer", () => {
    assert.doesNotThrow(() => stop("loop-no-timer-hb"));
  });

  test("stopAll() cancels all active heartbeat schedulers", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "1000";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    installHeartbeatFetchStub(200);

    start("loop-all-a", { apiBaseUrl: "https://api.example.com", getToken: () => "tok" });
    start("loop-all-b", { apiBaseUrl: "https://api.example.com", getToken: () => "tok" });

    stopAll();

    mock.timers.tick(1000);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 0, "stopAll() must prevent all heartbeats from firing");
  });

  test("replacing an existing heartbeat via start() cancels the old interval", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "1000";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    installHeartbeatFetchStub(200);

    // Start and immediately replace.
    start("loop-replace-hb", { apiBaseUrl: "https://api.example.com", getToken: () => "tok" });
    start("loop-replace-hb", { apiBaseUrl: "https://api.example.com", getToken: () => "tok" });

    // The second start replaces the first. There should be only one active interval.
    // If both were active, ticking once would fire twice.
    mock.timers.tick(1000);
    await flushAsync();
    assert.equal(
      capturedHeartbeats.length,
      1,
      "only one heartbeat must fire when start() is called twice (second replaces first)",
    );
  });
});
