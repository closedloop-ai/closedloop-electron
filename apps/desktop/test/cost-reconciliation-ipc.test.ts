/**
 * FEA-1436: tests for the three new diagnostic IPC channels added to
 * `cost-reconciliation-ipc.ts`. Each channel must Zod-validate its payload
 * before reaching the worker.
 *
 * We stub `ipcMain` with a minimal in-memory dispatcher that records each
 * handler and lets the test invoke it the same way Electron's IPC would.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { registerCostReconciliationIpc } from "../src/main/cost-reconciliation-ipc.js";

type Handler = (event: unknown, payload: unknown) => unknown | Promise<unknown>;

interface StubIpcMain {
  handle(channel: string, handler: Handler): void;
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

function createStubIpcMain(): StubIpcMain {
  const handlers = new Map<string, Handler>();
  return {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    async invoke(channel, payload) {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`No handler registered for ${channel}`);
      }
      return handler({}, payload);
    },
  };
}

interface StubWorker {
  getDriftRows: (daysBack: number) => unknown;
  getDriftRollup: () => unknown;
  exportDay: (input: { day: string; vendor: string; model: string }) => unknown;
  getClaudeCodeAnalytics: () => unknown;
  resetClaudeCodeAnalyticsState: () => void;
  // Unused by the diagnostic channels but required by the deps interface.
  runNow: () => Promise<{ queued: boolean }>;
  getStatus: () => unknown;
}

function makeDeps(workerOverrides: Partial<StubWorker> = {}) {
  const stubKeyStore = {
    getStatus: () => ({ set: false }),
    validateAndPersist: async () => ({ ok: true as const, status: { set: true } }),
    clear: () => {},
    get: () => null,
  } as unknown;
  const stubWorker: StubWorker = {
    getDriftRows: () => [{ day: "2025-09-08" }],
    getDriftRollup: () => ({
      avgDriftPct: 5,
      totalDriftDollars: 0.01,
      rowCount: 1,
      daysCovered: 1,
      sparklineDaily: [],
    }),
    exportDay: () => null,
    getClaudeCodeAnalytics: () => ({ users: [] }),
    resetClaudeCodeAnalyticsState: () => {},
    runNow: async () => ({ queued: true }),
    getStatus: () => ({}),
    ...workerOverrides,
  };
  const stubSettings = {
    getReconciliationEnabled: () => true,
    getReconciliationIntervalHours: () => 24,
    setReconciliationEnabled: () => {},
  } as unknown;
  return {
    deps: {
      anthropicKeyStore: stubKeyStore,
      openaiKeyStore: stubKeyStore,
      worker: stubWorker,
      settingsStore: stubSettings,
      reinitWorker: () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    stubWorker,
  };
}

describe("cost-reconciliation-ipc: FEA-1436 diagnostic channels", () => {
  let ipcMain: StubIpcMain;

  beforeEach(() => {
    ipcMain = createStubIpcMain();
  });

  afterEach(() => {
    /* no-op */
  });

  describe("get-drift-rows", () => {
    test("invokes worker.getDriftRows with default 30 when payload is empty", async () => {
      const calls: number[] = [];
      const { deps } = makeDeps({
        getDriftRows: (n) => {
          calls.push(n);
          return [];
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerCostReconciliationIpc(ipcMain as any, deps);
      const result = await ipcMain.invoke("cost-reconciliation:get-drift-rows", {});
      assert.deepEqual(result, { rows: [] });
      assert.deepEqual(calls, [30]);
    });

    test("invokes worker.getDriftRows with daysBack value when provided", async () => {
      const calls: number[] = [];
      const { deps } = makeDeps({
        getDriftRows: (n) => {
          calls.push(n);
          return [{ day: "2025-09-08", vendor: "anthropic", model: "x" }];
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerCostReconciliationIpc(ipcMain as any, deps);
      const result = await ipcMain.invoke("cost-reconciliation:get-drift-rows", {
        daysBack: 7,
      });
      assert.deepEqual(calls, [7]);
      assert.deepEqual(result, {
        rows: [{ day: "2025-09-08", vendor: "anthropic", model: "x" }],
      });
    });

    test("rejects invalid daysBack with empty rows (does NOT crash)", async () => {
      const calls: number[] = [];
      const { deps } = makeDeps({
        getDriftRows: (n) => {
          calls.push(n);
          return [{ day: "2025-09-08" }];
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerCostReconciliationIpc(ipcMain as any, deps);
      const result = await ipcMain.invoke("cost-reconciliation:get-drift-rows", {
        daysBack: -1,
      });
      assert.deepEqual(result, { rows: [] });
      assert.equal(calls.length, 0);
    });

    test("rejects daysBack > 365 with empty rows", async () => {
      const calls: number[] = [];
      const { deps } = makeDeps({
        getDriftRows: (n) => {
          calls.push(n);
          return [];
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerCostReconciliationIpc(ipcMain as any, deps);
      const result = await ipcMain.invoke("cost-reconciliation:get-drift-rows", {
        daysBack: 1000,
      });
      assert.deepEqual(result, { rows: [] });
      assert.equal(calls.length, 0);
    });
  });

  describe("get-drift-rollup", () => {
    test("returns the worker rollup payload", async () => {
      const { deps } = makeDeps({
        getDriftRollup: () => ({
          avgDriftPct: 7.5,
          totalDriftDollars: 0.5,
          rowCount: 3,
          daysCovered: 2,
          sparklineDaily: [{ day: "2025-09-08", driftPct: 5 }],
        }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerCostReconciliationIpc(ipcMain as any, deps);
      const result = (await ipcMain.invoke(
        "cost-reconciliation:get-drift-rollup",
      )) as { avgDriftPct: number; rowCount: number };
      assert.equal(result.avgDriftPct, 7.5);
      assert.equal(result.rowCount, 3);
    });
  });

  describe("export-day", () => {
    test("invokes worker.exportDay with valid payload", async () => {
      const captured: { day: string; vendor: string; model: string }[] = [];
      const { deps } = makeDeps({
        exportDay: (input) => {
          captured.push(input);
          return {
            schemaVersion: 1,
            generatedAt: "2025-09-09T00:00:00Z",
            reconciliation: {},
            tokenUsage: [],
          };
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerCostReconciliationIpc(ipcMain as any, deps);
      const result = (await ipcMain.invoke("cost-reconciliation:export-day", {
        day: "2025-09-08",
        vendor: "anthropic",
        model: "claude-x",
      })) as { ok: true; blob: unknown };
      assert.equal(result.ok, true);
      assert.ok(result.blob);
      assert.deepEqual(captured, [
        { day: "2025-09-08", vendor: "anthropic", model: "claude-x" },
      ]);
    });

    test("returns not_found when worker returns null", async () => {
      const { deps } = makeDeps({ exportDay: () => null });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerCostReconciliationIpc(ipcMain as any, deps);
      const result = await ipcMain.invoke("cost-reconciliation:export-day", {
        day: "2025-09-08",
        vendor: "anthropic",
        model: "claude-x",
      });
      assert.deepEqual(result, { ok: false, error: "not_found" });
    });

    test("rejects malformed day (not YYYY-MM-DD) with invalid_payload", async () => {
      const calls: unknown[] = [];
      const { deps } = makeDeps({
        exportDay: (input) => {
          calls.push(input);
          return null;
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerCostReconciliationIpc(ipcMain as any, deps);
      const result = await ipcMain.invoke("cost-reconciliation:export-day", {
        day: "not-a-date",
        vendor: "anthropic",
        model: "claude-x",
      });
      assert.deepEqual(result, { ok: false, error: "invalid_payload" });
      assert.equal(calls.length, 0);
    });

    test("rejects unknown vendor with invalid_payload", async () => {
      const calls: unknown[] = [];
      const { deps } = makeDeps({
        exportDay: (input) => {
          calls.push(input);
          return null;
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerCostReconciliationIpc(ipcMain as any, deps);
      const result = await ipcMain.invoke("cost-reconciliation:export-day", {
        day: "2025-09-08",
        vendor: "google",
        model: "gemini",
      });
      assert.deepEqual(result, { ok: false, error: "invalid_payload" });
      assert.equal(calls.length, 0);
    });

    test("rejects empty model with invalid_payload", async () => {
      const calls: unknown[] = [];
      const { deps } = makeDeps({
        exportDay: (input) => {
          calls.push(input);
          return null;
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerCostReconciliationIpc(ipcMain as any, deps);
      const result = await ipcMain.invoke("cost-reconciliation:export-day", {
        day: "2025-09-08",
        vendor: "anthropic",
        model: "",
      });
      assert.deepEqual(result, { ok: false, error: "invalid_payload" });
      assert.equal(calls.length, 0);
    });
  });

  describe("key rotation triggers analytics reset", () => {
    test("clear-anthropic-key invokes resetClaudeCodeAnalyticsState", async () => {
      let resetCalls = 0;
      const { deps } = makeDeps({
        resetClaudeCodeAnalyticsState: () => {
          resetCalls += 1;
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerCostReconciliationIpc(ipcMain as any, deps);
      await ipcMain.invoke("cost-reconciliation:clear-anthropic-key");
      assert.equal(
        resetCalls,
        1,
        "clearing the Anthropic Admin Key must wipe cached analytics + capability",
      );
    });
  });

  describe("get-claude-code-analytics", () => {
    test("returns the worker view payload as-is", async () => {
      const { deps } = makeDeps({
        getClaudeCodeAnalytics: () => ({
          users: [
            {
              userId: "email:a@x.com",
              daysActive: 1,
              sessions: 5,
              tokens: 1000,
              anthropicEstimateUsd: 0.1,
              localEstimateUsd: null,
              gapUsd: null,
            },
          ],
        }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerCostReconciliationIpc(ipcMain as any, deps);
      const result = (await ipcMain.invoke(
        "cost-reconciliation:get-claude-code-analytics",
      )) as { users: { userId: string }[] };
      assert.equal(result.users.length, 1);
      assert.equal(result.users[0].userId, "email:a@x.com");
    });

    test("returns empty users when worker returns empty", async () => {
      const { deps } = makeDeps({ getClaudeCodeAnalytics: () => ({ users: [] }) });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerCostReconciliationIpc(ipcMain as any, deps);
      const result = await ipcMain.invoke(
        "cost-reconciliation:get-claude-code-analytics",
      );
      assert.deepEqual(result, { users: [] });
    });
  });
});
