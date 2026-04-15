import assert from "node:assert/strict";
import { mock, afterEach, describe, test } from "node:test";
import { Observability } from "../src/main/observability.js";

// Exercises the debounce closure from app.ts without constructing DesktopApplication.

type Stats = { activeCommands: number; queueDepth: number };

function makeHandler(
  sendPresence: (stats: Stats) => void,
  queueStatsChanged: (activeCommands: number, queueDepth: number) => void,
): { handler: (stats: Stats) => void; cleanup: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function handler(stats: Stats): void {
    sendPresence(stats);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      queueStatsChanged(stats.activeCommands, stats.queueDepth);
    }, 1000);
  }

  function cleanup(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { handler, cleanup };
}

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
  Observability.reset();
});

describe("onQueueStatsChange debounce behaviour", () => {
  test("rate limit: 10 rapid calls emit 0 telemetry before 1000ms, exactly 1 after", () => {
    mock.timers.enable({ apis: ["setTimeout"] });

    const queueStatsChangedMock = mock.method(Observability, "queueStatsChanged", () => {});

    const { handler, cleanup } = makeHandler(
      () => {},
      (active, depth) => Observability.queueStatsChanged(active, depth),
    );

    for (let i = 0; i < 10; i++) {
      handler({ activeCommands: i, queueDepth: i });
    }

    // Advance 999ms — debounce window not yet elapsed
    mock.timers.tick(999);
    assert.strictEqual(queueStatsChangedMock.mock.calls.length, 0, "no telemetry at 999ms");

    // Advance 1ms more — debounce fires
    mock.timers.tick(1);
    assert.strictEqual(queueStatsChangedMock.mock.calls.length, 1, "exactly 1 telemetry call at 1000ms");

    cleanup();
  });

  test("trailing edge: only the last value is emitted after burst", () => {
    mock.timers.enable({ apis: ["setTimeout"] });

    const queueStatsChangedMock = mock.method(Observability, "queueStatsChanged", () => {});

    const { handler, cleanup } = makeHandler(
      () => {},
      (active, depth) => Observability.queueStatsChanged(active, depth),
    );

    handler({ activeCommands: 1, queueDepth: 1 });
    handler({ activeCommands: 2, queueDepth: 2 });
    handler({ activeCommands: 9, queueDepth: 9 });

    mock.timers.tick(1000);

    assert.strictEqual(queueStatsChangedMock.mock.calls.length, 1, "exactly 1 call");
    const [active, depth] = queueStatsChangedMock.mock.calls[0].arguments as [number, number];
    assert.strictEqual(active, 9, "trailing-edge activeCommands should be 9");
    assert.strictEqual(depth, 9, "trailing-edge queueDepth should be 9");

    cleanup();
  });

  test("presence parity: sendPresence fires once per invocation, un-throttled", () => {
    mock.timers.enable({ apis: ["setTimeout"] });

    const sendPresenceMock = mock.fn((_stats: Stats) => {});

    const { handler, cleanup } = makeHandler(
      (stats) => sendPresenceMock(stats),
      () => {},
    );

    for (let i = 0; i < 10; i++) {
      handler({ activeCommands: i, queueDepth: i });
    }

    assert.strictEqual(sendPresenceMock.mock.calls.length, 10, "sendPresence called once per invocation");

    cleanup();
  });
});
