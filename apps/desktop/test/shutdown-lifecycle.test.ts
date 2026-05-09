import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  assertPackagedUpdateReadyToInstall,
  createInitialPackagedUpdateState,
  mergePackagedUpdateState,
} from "../src/main/packaged-update-state.js";
import {
  createBeforeQuitHandler,
  type BeforeQuitEvent,
  type ShutdownLifecycleApplication,
} from "../src/main/shutdown-lifecycle.js";
import type { DesktopShutdownDiagnostics } from "../src/main/telemetry-protocol.js";
import type { ShutdownResult } from "../src/main/shutdown.js";

type TestTimer = ReturnType<typeof setTimeout>;

function makePreventableEvent() {
  let prevented = false;
  const event: BeforeQuitEvent = {
    preventDefault: () => {
      prevented = true;
    },
  };
  return { event, wasPrevented: () => prevented };
}

function deferredShutdown() {
  let resolve!: (result: ShutdownResult) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<ShutdownResult>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function makeHarness(shutdownPromise: Promise<ShutdownResult>) {
  const logs: Array<{ level: "info" | "error"; message: string }> = [];
  const exits: number[] = [];
  const failures: Array<Omit<DesktopShutdownDiagnostics, "duringUpdate">> = [];
  const clearedTimers: TestTimer[] = [];
  let shutdownCalls = 0;
  let setQuittingCalls = 0;
  let hardExitCallback: (() => void) | null = null;
  let unrefCalls = 0;
  const timer = {
    unref: () => {
      unrefCalls += 1;
    },
  } as TestTimer;
  const application: ShutdownLifecycleApplication = {
    setQuitting: () => {
      setQuittingCalls += 1;
    },
    shutdown: () => {
      shutdownCalls += 1;
      return shutdownPromise;
    },
    reportShutdownFailure: (failure) => {
      failures.push(failure);
    },
  };
  const handler = createBeforeQuitHandler({
    application,
    exit: (code) => exits.push(code),
    logInfo: (message) => logs.push({ level: "info", message }),
    logError: (message) => logs.push({ level: "error", message }),
    now: () => 10_000,
    setTimeoutFn: ((callback: () => void) => {
      hardExitCallback = callback;
      return timer;
    }) as typeof setTimeout,
    clearTimeoutFn: ((id: TestTimer) => {
      clearedTimers.push(id);
    }) as typeof clearTimeout,
  });

  return {
    handler,
    logs,
    exits,
    failures,
    clearedTimers,
    getShutdownCalls: () => shutdownCalls,
    getSetQuittingCalls: () => setQuittingCalls,
    getHardExitCallback: () => hardExitCallback,
    getUnrefCalls: () => unrefCalls,
    timer,
  };
}

describe("before-quit shutdown lifecycle", () => {
  test("downloaded update quitAndInstall re-entry keeps a single shutdown owner", async () => {
    const shutdown = deferredShutdown();
    const harness = makeHarness(shutdown.promise);
    const firstEvent = makePreventableEvent();
    const secondEvent = makePreventableEvent();
    const downloaded = mergePackagedUpdateState(
      createInitialPackagedUpdateState(),
      {
        status: "downloaded",
        available: true,
        downloaded: true,
        version: "0.14.29",
      },
    );
    let quitAndInstallArgs: [boolean, boolean] | null = null;

    assert.doesNotThrow(() => assertPackagedUpdateReadyToInstall(downloaded));
    const quitAndInstall = (isSilent: boolean, isForceRunAfter: boolean) => {
      quitAndInstallArgs = [isSilent, isForceRunAfter];
      harness.handler(firstEvent.event);
      harness.handler(secondEvent.event);
    };

    quitAndInstall(true, true);
    assert.deepEqual(quitAndInstallArgs, [true, true]);
    assert.equal(firstEvent.wasPrevented(), true);
    assert.equal(secondEvent.wasPrevented(), true);
    assert.equal(harness.getSetQuittingCalls(), 1);
    assert.equal(harness.getShutdownCalls(), 1);
    assert.equal(harness.getUnrefCalls(), 1);
    assert.equal(harness.exits.length, 0);
    assert.ok(
      harness.logs.some((entry) =>
        entry.message.includes("shutdown already in progress"),
      ),
    );

    shutdown.resolve("clean");
    await shutdown.promise;
    await Promise.resolve();

    assert.deepEqual(harness.exits, [0]);
    assert.deepEqual(harness.clearedTimers, [harness.timer]);
  });

  test("outer hard-exit preserves the existing log and reports failure telemetry", () => {
    const shutdown = deferredShutdown();
    const harness = makeHarness(shutdown.promise);
    const firstEvent = makePreventableEvent();

    harness.handler(firstEvent.event);
    harness.getHardExitCallback()?.();

    assert.equal(firstEvent.wasPrevented(), true);
    assert.deepEqual(harness.exits, [1]);
    assert.ok(
      harness.logs.some(
        (entry) =>
          entry.level === "error" &&
          entry.message === "hard-exit timeout reached; forcing app.exit(1)",
      ),
    );
    assert.deepEqual(harness.failures, [
      {
        trigger: "outer-hard-exit",
        outerHardExit: true,
        elapsedMs: 0,
      },
    ]);
  });

  test("shutdown rejection reports the defensive failure path before exiting", async () => {
    const shutdown = deferredShutdown();
    const harness = makeHarness(shutdown.promise);
    const firstEvent = makePreventableEvent();

    harness.handler(firstEvent.event);
    shutdown.reject(new Error("cleanup exploded"));
    await assert.rejects(shutdown.promise, /cleanup exploded/);
    await Promise.resolve();

    assert.deepEqual(harness.exits, [1]);
    assert.deepEqual(harness.clearedTimers, [harness.timer]);
    assert.deepEqual(harness.failures, [
      {
        trigger: "shutdown-rejected",
        result: "failed",
        phase: "desktopApplication.shutdown",
        elapsedMs: 0,
        error: "cleanup exploded",
      },
    ]);
  });
});
