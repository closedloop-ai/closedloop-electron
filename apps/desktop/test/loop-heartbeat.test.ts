/**
 * Unit tests for apps/desktop/src/main/loop-heartbeat.ts
 *
 * Covers:
 *   - periodic heartbeat firing at the configured interval
 *   - fire-and-forget error handling (fetch throws — must not propagate)
 *   - fire-and-forget error handling (non-200 HTTP response — must not propagate)
 *   - job finalization on terminal signals: 404 triggers finalizeFn(job, "UNKNOWN") and stops the heartbeat
 *   - job finalization on terminal signals: 410 triggers finalizeFn(job, "UNKNOWN") and stops the heartbeat
 *   - job finalization on terminal signals: 401 triggers finalizeFn(job, "UNKNOWN") and stops the heartbeat (no token refresh)
 *   - 404 gate integration: 404 response disables the endpoint and stops the loop's scheduler
 *   - 410 stop behavior: 410 response stops the heartbeat scheduler (loop is terminal)
 *   - token adoption on revival: revived:true response persists new token via loopTokenStore.setLoopToken
 *   - CLOSEDLOOP_HEARTBEAT_INTERVAL_MS env var override
 *   - stop() cancels a running heartbeat scheduler cleanly
 *   - stopAll() cancels all active heartbeat schedulers
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { LoopSchedulerContext } from "../src/main/loop-scheduler-context.js";
import {
  isEndpointDisabled,
  resetAllGates,
} from "../src/main/loop-404-gate.js";
import {
  createTestLoopTokenStore,
  flushAsync,
} from "./loop-token-test-utils.js";
import { createLocalJob, makeStubJobStore } from "./job-store-test-utils.js";
import type { LocalJob } from "../src/main/job-store.js";

// Per-test scheduler context. Cleared in afterEach via Symbol.dispose so
// timers never leak across tests.
let ctx: LoopSchedulerContext;

// Minimal no-op HeartbeatDeps extras used by tests that do not need
// finalization behaviour. Tests that exercise terminal-signal paths should
// supply their own jobStore / finalizeFn stubs.
const noopJobStore = {
  getByLoopId: (_loopId: string) => undefined,
} as unknown as import("../src/main/job-store.js").JobStore;
const noopFinalizeFn = async () => {};

// `start` defaults the (now required) jobStore / finalizeFn to no-ops so tests
// that only care about heartbeat firing stay terse, while still accepting the
// optional revival fields (loopTokenStore / getSessionToken) that the token
// adoption tests pass through. Tests exercising finalization call
// ctx.startHeartbeat directly with their own jobStore / finalizeFn stubs.
type StartDeps = Parameters<LoopSchedulerContext["startHeartbeat"]>[1];
const start = (
  loopId: string,
  deps: Omit<StartDeps, "jobStore" | "finalizeFn"> &
    Partial<Pick<StartDeps, "jobStore" | "finalizeFn">>,
) =>
  ctx.startHeartbeat(loopId, {
    jobStore: noopJobStore,
    finalizeFn: noopFinalizeFn,
    ...deps,
  });
const stop = (loopId: string) => ctx.stopHeartbeat(loopId);
const stopAll = () => ctx[Symbol.dispose]();

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
const originalIntervalEnv = process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS;

interface CapturedHeartbeat {
  url: string;
  method: string;
  authorization: string | undefined;
  sessionToken: string | undefined;
}

let capturedHeartbeats: CapturedHeartbeat[] = [];
let tempRoot = "";

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
      sessionToken: headers.get("x-session-token") ?? undefined,
    });
    return new Response(body, { status });
  }) as typeof fetch;
}

/**
 * Installs a fetch stub that throws a network error on every call.
 */
function installThrowingFetchStub(): void {
  globalThis.fetch = (async () => {
    capturedHeartbeats.push({ url: "throw", method: "POST", authorization: undefined, sessionToken: undefined });
    throw new Error("ECONNREFUSED simulated network error");
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

beforeEach(async () => {
  capturedHeartbeats = [];
  resetAllGates();
  ctx = new LoopSchedulerContext();
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "loop-heartbeat-test-"));
});

afterEach(async () => {
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

  // Clean up temp directory.
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
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
// Job finalization on terminal signals (404 / 410 / 401)
// ---------------------------------------------------------------------------

describe("loop-heartbeat: job finalization on terminal heartbeat signals", () => {
  /**
   * Table-driven cases for status codes that must trigger finalization.
   *
   * Per loop-heartbeat.ts classifyLoopStatus mapping:
   *  - 404 → terminal reason "not_found"  → targetStatus "UNKNOWN"
   *  - 410 → terminal reason "gone"       → targetStatus "UNKNOWN"
   *  - 401 → terminal reason "unauthorized" → targetStatus "UNKNOWN"
   *  (Only "timed_out" reason maps to "TIMED_OUT"; all others map to "UNKNOWN")
   */
  // The status→reason→targetStatus mapping is proven exhaustively in
  // loop-status-classifier.test.ts; at the heartbeat layer every terminal HTTP
  // code maps to UNKNOWN (the TIMED_OUT branch is unreachable here because the
  // heartbeat always classifies with cloudKind=null). So we cover only the two
  // behaviorally-distinct codes: 404 (also trips the endpoint-disable gate) and
  // a non-404 (401, which the heartbeat must NOT token-refresh, unlike boot
  // recovery). 410 is omitted as it is identical to the 404 case minus the gate.
  const terminalSignalCases: {
    label: string;
    httpStatus: number;
    loopId: string;
    description: string;
  }[] = [
    {
      label: "404",
      httpStatus: 404,
      loopId: "loop-finalize-404",
      description: "404 response triggers finalizeFn with UNKNOWN and stops the heartbeat",
    },
    {
      label: "401",
      httpStatus: 401,
      loopId: "loop-finalize-401",
      description: "401 response triggers finalizeFn with UNKNOWN and stops the heartbeat (no token refresh)",
    },
  ];

  for (const { label, httpStatus, loopId, description } of terminalSignalCases) {
    test(description, async () => {
      process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "1000";

      mock.timers.enable({ apis: ["Date", "setInterval"] });

      installHeartbeatFetchStub(httpStatus);

      const testJob = createLocalJob({ id: `job-${label}`, loopId });
      const stubJobStore = makeStubJobStore({ [loopId]: testJob });

      // Mock finalizeFn that records every call.
      const finalizeCalls: Array<{
        job: LocalJob;
        targetStatus: "TIMED_OUT" | "UNKNOWN";
      }> = [];
      const mockFinalizeFn = async (
        job: LocalJob,
        targetStatus: "TIMED_OUT" | "UNKNOWN",
      ) => {
        finalizeCalls.push({ job, targetStatus });
      };

      // Start the heartbeat with the real jobStore stub and mock finalizeFn.
      ctx.startHeartbeat(loopId, {
        apiBaseUrl: "https://api.example.com",
        getToken: () => "tok",
        jobStore: stubJobStore,
        finalizeFn: mockFinalizeFn,
      });

      // First tick receives the terminal HTTP response.
      mock.timers.tick(1000);
      await flushAsync();
      assert.equal(capturedHeartbeats.length, 1, `heartbeat must have fired once (received ${label})`);

      // finalizeFn must have been called exactly once with the correct job and status.
      assert.equal(finalizeCalls.length, 1, `finalizeFn must be called once on ${label}`);
      const call = finalizeCalls[0];
      assert.ok(call, "finalizeCalls[0] must exist");
      assert.equal(call.job, testJob, `finalizeFn must receive the job returned by jobStore.getByLoopId`);
      assert.equal(
        call.targetStatus,
        "UNKNOWN",
        `finalizeFn must be called with targetStatus=UNKNOWN on ${label}`,
      );

      // Heartbeat scheduler must have stopped — no further fetch calls after the terminal tick.
      mock.timers.tick(1000);
      await flushAsync();
      assert.equal(
        capturedHeartbeats.length,
        1,
        `heartbeat must not fire again after ${label} stops the scheduler`,
      );
    });
  }

  test("404 response: finalizeFn is NOT called when jobStore returns undefined (no matching job)", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "1000";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    installHeartbeatFetchStub(404);

    const stubJobStore = makeStubJobStore();

    const finalizeCalls: unknown[] = [];
    const mockFinalizeFn = async (
      job: LocalJob,
      targetStatus: "TIMED_OUT" | "UNKNOWN",
    ) => {
      finalizeCalls.push({ job, targetStatus });
    };

    ctx.startHeartbeat("loop-finalize-404-nojob", {
      apiBaseUrl: "https://api.example.com",
      getToken: () => "tok",
      jobStore: stubJobStore,
      finalizeFn: mockFinalizeFn,
    });

    mock.timers.tick(1000);
    await flushAsync();

    assert.equal(finalizeCalls.length, 0, "finalizeFn must not be called when no job is found in store");

    // Scheduler must still stop even without a job to finalize.
    mock.timers.tick(1000);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 1, "heartbeat must not fire again after 404 even with no job found");
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

// ---------------------------------------------------------------------------
// 410 stop behavior (AC-003)
// ---------------------------------------------------------------------------

describe("loop-heartbeat: 410 stop behavior", () => {
  test("a 410 response stops the heartbeat scheduler (loop is terminal)", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "1000";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    installHeartbeatFetchStub(410);

    start("loop-410", { apiBaseUrl: "https://api.example.com", getToken: () => "tok" });

    // First interval fires and receives 410.
    mock.timers.tick(1000);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 1, "heartbeat must have fired once (received 410)");

    // Subsequent interval ticks must not call fetch again (scheduler stopped).
    mock.timers.tick(1000);
    await flushAsync();
    assert.equal(
      capturedHeartbeats.length,
      1,
      "heartbeat must not fire again after 410 stops the scheduler",
    );
  });
});

// ---------------------------------------------------------------------------
// Token adoption on revival (AC-001, AC-002)
// ---------------------------------------------------------------------------

describe("loop-heartbeat: token adoption on revival", () => {
  test("revived:true response persists the new runner token via loopTokenStore.setLoopToken", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "1000";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    const revivedBody = JSON.stringify({
      revived: true,
      token: "new-runner-token",
      jti: "new-jti-abc",
      expiresAt: new Date("2099-01-01T00:00:00.000Z").toISOString(),
    });
    installHeartbeatFetchStub(200, revivedBody);

    const store = createTestLoopTokenStore(tempRoot, "store-revival");
    // Pre-seed a token so the runner token is not null.
    store.setLoopToken("loop-revival", { token: "old-runner-token" });

    start("loop-revival", {
      apiBaseUrl: "https://api.example.com",
      getToken: () => "old-runner-token",
      loopTokenStore: store,
    });

    mock.timers.tick(1000);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 1, "heartbeat must have fired once");

    // The store must now hold the new token.
    const stored = store.getLoopToken("loop-revival");
    assert.ok(stored !== null, "token must be stored after revival");
    assert.equal(stored.token, "new-runner-token", "stored token must match revived token");
    assert.equal(stored.jti, "new-jti-abc", "stored jti must match revived jti");

    // Heartbeat scheduler must remain running (revival does not stop it).
    mock.timers.tick(1000);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 2, "scheduler must continue running after revival");
  });

  test("revived:true without token fields does not update the store", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "1000";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    // Malformed revival response: revived is true but no token field.
    installHeartbeatFetchStub(200, JSON.stringify({ revived: true }));

    const store = createTestLoopTokenStore(tempRoot, "store-revival-no-token");
    store.setLoopToken("loop-revival-nt", { token: "original-token" });

    start("loop-revival-nt", {
      apiBaseUrl: "https://api.example.com",
      getToken: () => "original-token",
      loopTokenStore: store,
    });

    mock.timers.tick(1000);
    await flushAsync();

    // The store must still have the original token unchanged (no token field to adopt).
    const stored = store.getLoopToken("loop-revival-nt");
    assert.ok(stored !== null, "token must still be in store");
    assert.equal(stored.token, "original-token", "original token must be unchanged when revival has no token field");
  });

  test("heartbeat request includes X-Session-Token header when getSessionToken is provided", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "1000";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    installHeartbeatFetchStub(200);

    const knownSessionToken = "session-tok-abc123";
    const getSessionToken = async (): Promise<string | null> => knownSessionToken;

    start("loop-session-token", {
      apiBaseUrl: "https://api.example.com",
      getToken: () => "runner-token",
      getSessionToken,
    });

    mock.timers.tick(1000);
    await flushAsync();

    assert.equal(capturedHeartbeats.length, 1, "heartbeat must have fired once");
    const hb = capturedHeartbeats[0];
    assert.ok(hb, "expected at least one captured heartbeat");
    assert.equal(
      hb.sessionToken,
      knownSessionToken,
      "X-Session-Token header must equal the token returned by getSessionToken",
    );
  });

  test("heartbeat proceeds normally and omits X-Session-Token when getSessionToken returns null", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "1000";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    installHeartbeatFetchStub(200);

    const getSessionToken = async (): Promise<string | null> => null;

    start("loop-session-token-null", {
      apiBaseUrl: "https://api.example.com",
      getToken: () => "runner-token",
      getSessionToken,
    });

    mock.timers.tick(1000);
    await flushAsync();

    assert.equal(capturedHeartbeats.length, 1, "heartbeat must have fired once");
    const hb = capturedHeartbeats[0];
    assert.ok(hb, "expected at least one captured heartbeat");
    assert.equal(
      hb.sessionToken,
      undefined,
      "X-Session-Token header must not be present when getSessionToken returns null",
    );
  });

  test("heartbeat proceeds and omits X-Session-Token when getSessionToken throws (graceful degradation)", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "1000";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    installHeartbeatFetchStub(200);

    const getSessionToken = async (): Promise<string | null> => {
      throw new Error("session-token-retrieval-failed");
    };

    // Should not throw during start.
    assert.doesNotThrow(() => {
      start("loop-session-token-throws", {
        apiBaseUrl: "https://api.example.com",
        getToken: () => "runner-token",
        getSessionToken,
      });
    });

    // Firing the interval must not cause an unhandled rejection or throw.
    await assert.doesNotReject(async () => {
      mock.timers.tick(1000);
      await flushAsync();
    });

    // The heartbeat must have fired despite getSessionToken throwing.
    assert.equal(capturedHeartbeats.length, 1, "heartbeat must fire even when getSessionToken throws");

    // X-Session-Token must be absent because the token retrieval failed.
    const hb = capturedHeartbeats[0];
    assert.ok(hb, "expected at least one captured heartbeat");
    assert.equal(
      hb.sessionToken,
      undefined,
      "X-Session-Token must not be present when getSessionToken throws",
    );

    // Subsequent intervals must still fire (scheduler is not stopped on error).
    mock.timers.tick(1000);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 2, "subsequent heartbeats must still fire after getSessionToken throws");
  });

  test("end-to-end revival: getSessionToken sends X-Session-Token, revived:true response persists new runner token", async () => {
    process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "1000";

    mock.timers.enable({ apis: ["Date", "setInterval"] });

    const knownSessionToken = "session-tok-e2e-revival";
    const revivedBody = JSON.stringify({
      revived: true,
      token: "new-runner-token-e2e",
      jti: "new-jti-e2e-xyz",
      expiresAt: new Date("2099-06-01T00:00:00.000Z").toISOString(),
    });
    installHeartbeatFetchStub(200, revivedBody);

    const store = createTestLoopTokenStore(tempRoot, "store-e2e-revival");
    store.setLoopToken("loop-e2e-revival", { token: "old-runner-token-e2e" });

    const getSessionToken = async (): Promise<string | null> => knownSessionToken;

    // (a) Start with both getSessionToken and loopTokenStore so all four
    // assertions can be verified in a single heartbeat tick.
    start("loop-e2e-revival", {
      apiBaseUrl: "https://api.example.com",
      getToken: () => "old-runner-token-e2e",
      getSessionToken,
      loopTokenStore: store,
    });

    mock.timers.tick(1000);
    await flushAsync();

    // (a) Heartbeat fires.
    assert.equal(capturedHeartbeats.length, 1, "heartbeat must have fired once");

    // (b) X-Session-Token header is present and matches the value returned by getSessionToken.
    const hb = capturedHeartbeats[0];
    assert.ok(hb, "expected at least one captured heartbeat");
    assert.equal(
      hb.sessionToken,
      knownSessionToken,
      "X-Session-Token header must equal the token returned by getSessionToken",
    );

    // (c) revived:true response is processed — the store reflects the new token.
    // (d) New runner token is persisted via loopTokenStore.setLoopToken.
    const stored = store.getLoopToken("loop-e2e-revival");
    assert.ok(stored !== null, "token must be stored after e2e revival");
    assert.equal(stored.token, "new-runner-token-e2e", "stored token must match the revived runner token");
    assert.equal(stored.jti, "new-jti-e2e-xyz", "stored jti must match the revived jti");

    // Scheduler must remain running after revival.
    mock.timers.tick(1000);
    await flushAsync();
    assert.equal(capturedHeartbeats.length, 2, "scheduler must continue running after e2e revival");
  });
});
