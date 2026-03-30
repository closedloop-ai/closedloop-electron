/**
 * Unit tests for LoopFinalizer (finalizeLoopFromRuntime).
 *
 * Covers:
 * - Happy path: all three steps run and idempotency timestamps are written
 * - Idempotency: re-run skips steps already gated by timestamp
 * - CANCEL_PENDING guard: skips finalization when PID is still alive
 * - CANCEL_PENDING with dead PID: continues normally
 * - Missing claudeWorkDir: returns immediately
 * - Artifact upload failure: warning added, steps 2+3 still run
 * - Event POST failure: warning added, step 3 still runs
 * - boot-recovery reason emits job.recovery.finalize_replayed telemetry category
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import type { LocalJob } from "../src/main/job-store.js";
import {
    finalizeLoopFromRuntime,
    type LoopFinalizerDeps
} from "../src/main/loop-finalizer.js";
import type { TelemetryEventPayload } from "../src/main/telemetry-protocol.js";
import { startMockApiServer } from "./symphony-test-utils.js";

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
const openServers: Server[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const srv of openServers.splice(0)) {
    srv.close();
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `loop-finalizer-${label}-`));
  tempDirs.push(dir);
  return dir;
}

function makeJob(overrides: Partial<LocalJob> = {}): LocalJob {
  return {
    id: "job-1",
    kind: "SYMPHONY_LOOP",
    loopId: "loop-abc123",
    command: "PLAN",
    status: "RUNNING",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeJobStore(initial?: LocalJob): {
  jobs: Map<string, LocalJob>;
  upsert: (j: LocalJob) => LocalJob;
  getByLoopId: (id: string) => LocalJob | undefined;
} {
  const jobs = new Map<string, LocalJob>();
  if (initial) {
    jobs.set(initial.loopId, initial);
  }
  return {
    jobs,
    upsert(j: LocalJob) {
      jobs.set(j.loopId, j);
      return j;
    },
    getByLoopId(id: string) {
      return jobs.get(id);
    },
  };
}

function makeTelemetry(): {
  events: TelemetryEventPayload[];
  emit: (e: TelemetryEventPayload) => void;
} {
  const events: TelemetryEventPayload[] = [];
  return { events, emit: (e) => events.push(e) };
}

async function makeDeps(
  job: LocalJob,
  apiPort: number,
  overrides: Partial<LoopFinalizerDeps> = {},
): Promise<LoopFinalizerDeps> {
  const store = makeJobStore(job);
  const telemetry = makeTelemetry();
  return {
    jobStore: store as unknown as import("../src/main/job-store.js").JobStore,
    telemetry,
    assertPathAllowed: () => {},
    apiAuthToken: "test-token",
    apiBaseUrl: `http://127.0.0.1:${apiPort}`,
    isProcessRunning: () => false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("finalizeLoopFromRuntime()", () => {
  test("happy path — all three steps run, timestamps written, API called", async () => {
    const workDir = makeTempDir("happy");
    // Write a minimal plan.json so readArtifacts finds something
    fs.writeFileSync(
      path.join(workDir, "plan.json"),
      JSON.stringify({ tasks: [] }),
    );

    const mock = await startMockApiServer();
    openServers.push(mock.server);

    const job = makeJob({ claudeWorkDir: workDir });
    const deps = await makeDeps(job, mock.port);
    const store = deps.jobStore as unknown as ReturnType<typeof makeJobStore>;

    await finalizeLoopFromRuntime(job, "live-exit", deps);

    // API calls made
    await mock.waitForRequest(`/loops/loop-abc123/upload-artifacts`);
    await mock.waitForRequest(`/loops/loop-abc123/events`);

    // Idempotency timestamps written to JobStore
    const saved = (store as unknown as ReturnType<typeof makeJobStore>).jobs.get("loop-abc123");
    assert.ok(saved?.artifactsUploadedAt, "artifactsUploadedAt should be set");
    assert.ok(saved?.completedEventPostedAt, "completedEventPostedAt should be set");
    assert.ok(saved?.finalStatusPersistedAt, "finalStatusPersistedAt should be set");
    assert.equal(saved?.status, "COMPLETED");
  });

  test("idempotency — re-run with all timestamps set skips all API calls", async () => {
    const workDir = makeTempDir("idempotent");
    const mock = await startMockApiServer();
    openServers.push(mock.server);

    const now = new Date().toISOString();
    const job = makeJob({
      claudeWorkDir: workDir,
      artifactsUploadedAt: now,
      completedEventPostedAt: now,
      finalStatusPersistedAt: now,
      status: "COMPLETED",
    });
    const deps = await makeDeps(job, mock.port);

    await finalizeLoopFromRuntime(job, "live-exit", deps);

    // No API requests should have been made
    assert.equal(mock.requests.length, 0, "no API calls expected when all steps already done");
  });

  test("idempotency — step 1 already done, steps 2+3 run", async () => {
    const workDir = makeTempDir("partial-idempotent");
    const mock = await startMockApiServer();
    openServers.push(mock.server);

    const now = new Date().toISOString();
    const job = makeJob({
      claudeWorkDir: workDir,
      artifactsUploadedAt: now, // step 1 already done
    });
    const deps = await makeDeps(job, mock.port);

    await finalizeLoopFromRuntime(job, "live-exit", deps);

    // Only event POST made (no upload)
    assert.equal(
      mock.requests.filter((r) => r.url.includes("upload-artifacts")).length,
      0,
      "upload should be skipped",
    );
    await mock.waitForRequest(`/loops/loop-abc123/events`);

    const store = deps.jobStore as unknown as ReturnType<typeof makeJobStore>;
    const saved = store.jobs.get("loop-abc123");
    assert.ok(saved?.completedEventPostedAt);
    assert.ok(saved?.finalStatusPersistedAt);
  });

  test("CANCEL_PENDING + PID alive — returns immediately, no API calls", async () => {
    const workDir = makeTempDir("cancel-alive");
    const mock = await startMockApiServer();
    openServers.push(mock.server);

    const job = makeJob({
      claudeWorkDir: workDir,
      status: "CANCEL_PENDING",
      pid: 99999,
    });
    const deps = await makeDeps(job, mock.port, {
      isProcessRunning: () => true,
    });

    await finalizeLoopFromRuntime(job, "live-exit", deps);

    assert.equal(mock.requests.length, 0, "no API calls expected when CANCEL_PENDING and PID alive");
  });

  test("CANCEL_PENDING + PID dead — proceeds with finalization", async () => {
    const workDir = makeTempDir("cancel-dead");
    const mock = await startMockApiServer();
    openServers.push(mock.server);

    const job = makeJob({
      claudeWorkDir: workDir,
      status: "CANCEL_PENDING",
      pid: 99999,
    });
    const deps = await makeDeps(job, mock.port, {
      isProcessRunning: () => false,
    });

    await finalizeLoopFromRuntime(job, "live-exit", deps);

    await mock.waitForRequest(`/loops/loop-abc123/upload-artifacts`);
    await mock.waitForRequest(`/loops/loop-abc123/events`);

    const store = deps.jobStore as unknown as ReturnType<typeof makeJobStore>;
    const saved = store.jobs.get("loop-abc123");
    assert.equal(saved?.status, "COMPLETED");
  });

  test("missing claudeWorkDir — returns without making any API calls", async () => {
    const mock = await startMockApiServer();
    openServers.push(mock.server);

    const job = makeJob({ claudeWorkDir: undefined });
    const deps = await makeDeps(job, mock.port);

    await finalizeLoopFromRuntime(job, "live-exit", deps);

    assert.equal(mock.requests.length, 0);
  });

  test("artifact upload fails — warning included in final status, steps 2+3 still run", async () => {
    const workDir = makeTempDir("upload-fail");
    const mock = await startMockApiServer(
      new Map([["/upload-artifacts", 500]]),
    );
    openServers.push(mock.server);

    const job = makeJob({ claudeWorkDir: workDir });
    const deps = await makeDeps(job, mock.port);

    await finalizeLoopFromRuntime(job, "live-exit", deps);

    // Event POST still called despite upload failure
    await mock.waitForRequest(`/loops/loop-abc123/events`);

    const store = deps.jobStore as unknown as ReturnType<typeof makeJobStore>;
    const saved = store.jobs.get("loop-abc123");
    assert.equal(saved?.status, "COMPLETED");
    assert.ok(saved?.warning?.includes("ARTIFACT_UPLOAD_FAILED"), "warning should note upload failure");
    // artifactsUploadedAt NOT set (so boot-recovery can retry)
    assert.equal(saved?.artifactsUploadedAt, undefined, "upload timestamp should not be set on failure");
  });

  test("event POST fails — warning included in final status, step 3 still runs", async () => {
    const workDir = makeTempDir("event-fail");
    const mock = await startMockApiServer(
      new Map([["/events", 500]]),
    );
    openServers.push(mock.server);

    const job = makeJob({ claudeWorkDir: workDir });
    const deps = await makeDeps(job, mock.port);

    await finalizeLoopFromRuntime(job, "live-exit", deps);

    await mock.waitForRequest(`/loops/loop-abc123/upload-artifacts`);
    await mock.waitForRequest(`/loops/loop-abc123/events`);

    const store = deps.jobStore as unknown as ReturnType<typeof makeJobStore>;
    const saved = store.jobs.get("loop-abc123");
    assert.equal(saved?.status, "COMPLETED");
    assert.ok(saved?.warning?.includes("EVENT_POST_FAILED"), "warning should note event POST failure");
    // completedEventPostedAt NOT set (so boot-recovery can retry)
    assert.equal(saved?.completedEventPostedAt, undefined);
  });

  test("boot-recovery reason emits job.recovery.finalize_replayed telemetry category", async () => {
    const workDir = makeTempDir("boot-recovery");
    const mock = await startMockApiServer();
    openServers.push(mock.server);

    const job = makeJob({ claudeWorkDir: workDir });
    const store = makeJobStore(job);
    const telemetry = makeTelemetry();
    const deps: LoopFinalizerDeps = {
      jobStore: store as unknown as import("../src/main/job-store.js").JobStore,
      telemetry,
      assertPathAllowed: () => {},
      apiAuthToken: "test-token",
      apiBaseUrl: `http://127.0.0.1:${mock.port}`,
      isProcessRunning: () => false,
    };

    await finalizeLoopFromRuntime(job, "boot-recovery", deps);

    assert.equal(telemetry.events.length, 1);
    assert.equal(telemetry.events[0].category, "job.recovery.finalize_replayed");
  });
});
