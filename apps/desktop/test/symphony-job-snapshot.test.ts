import assert from "node:assert/strict";
import { test } from "node:test";
import { enrichJobSnapshot } from "../src/server/operations/symphony-job-snapshot.js";
import type { LocalJob, LocalJobStatus } from "../src/main/job-store.js";

function makeJob(overrides: Partial<LocalJob> = {}): LocalJob {
  const now = new Date().toISOString();
  return {
    id: "job-1",
    kind: "SYMPHONY_LOOP",
    loopId: "loop-1",
    command: "PLAN",
    status: "RUNNING" as LocalJobStatus,
    startedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// -- Ghost QUEUED/STARTING job expiry --

test("QUEUED job with no PID older than 60s becomes FAILED", async () => {
  const oldDate = new Date(Date.now() - 90_000).toISOString();
  const snapshot = await enrichJobSnapshot(
    makeJob({ status: "QUEUED", pid: undefined, startedAt: oldDate })
  );
  assert.equal(snapshot.status, "FAILED");
});

test("QUEUED job with no PID younger than 60s stays QUEUED", async () => {
  const recentDate = new Date(Date.now() - 10_000).toISOString();
  const snapshot = await enrichJobSnapshot(
    makeJob({ status: "QUEUED", pid: undefined, startedAt: recentDate })
  );
  assert.equal(snapshot.status, "QUEUED");
});

test("STARTING job with no PID older than 60s becomes FAILED", async () => {
  const oldDate = new Date(Date.now() - 90_000).toISOString();
  const snapshot = await enrichJobSnapshot(
    makeJob({ status: "STARTING", pid: undefined, startedAt: oldDate })
  );
  assert.equal(snapshot.status, "FAILED");
});

test("STARTING job with no PID younger than 60s stays STARTING", async () => {
  const recentDate = new Date(Date.now() - 5_000).toISOString();
  const snapshot = await enrichJobSnapshot(
    makeJob({ status: "STARTING", pid: undefined, startedAt: recentDate })
  );
  assert.equal(snapshot.status, "STARTING");
});

// -- Process liveness finalization --

test("CANCEL_PENDING job with dead process becomes CANCELLED", async () => {
  // Use PID 999999999 which should not exist
  const snapshot = await enrichJobSnapshot(
    makeJob({ status: "CANCEL_PENDING", pid: 999999999 })
  );
  assert.equal(snapshot.status, "CANCELLED");
  assert.equal(snapshot.processRunning, false);
});

test("RUNNING job with dead process becomes STOPPED", async () => {
  const snapshot = await enrichJobSnapshot(
    makeJob({ status: "RUNNING", pid: 999999999 })
  );
  assert.equal(snapshot.status, "STOPPED");
  assert.equal(snapshot.processRunning, false);
});

// -- Snapshot shape --

test("snapshot includes processRunning field", async () => {
  const snapshot = await enrichJobSnapshot(
    makeJob({ status: "QUEUED", pid: undefined })
  );
  assert.equal(snapshot.processRunning, false);
});

test("completed job status is not overridden", async () => {
  const snapshot = await enrichJobSnapshot(
    makeJob({ status: "COMPLETED", pid: undefined })
  );
  assert.equal(snapshot.status, "COMPLETED");
});
