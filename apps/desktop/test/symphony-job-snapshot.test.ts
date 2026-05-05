import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { LoopCommand } from "@closedloop-ai/loops-api/commands";
import { enrichJobSnapshot, shouldApplyStateStatus } from "../src/server/operations/symphony-job-snapshot.js";
import type { LocalJob, LocalJobStatus } from "../src/main/job-store.js";

function makeJob(overrides: Partial<LocalJob> = {}): LocalJob {
  const now = new Date().toISOString();
  return {
    id: "job-1",
    kind: "SYMPHONY_LOOP",
    loopId: "loop-1",
    command: LoopCommand.Plan,
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

// -- Terminal status guard (shouldApplyStateStatus) --

test("shouldApplyStateStatus: COMPLETED + processRunning=true is suppressed", () => {
  assert.equal(shouldApplyStateStatus("COMPLETED", true), false);
});

test("shouldApplyStateStatus: COMPLETED + processRunning=false is applied", () => {
  assert.equal(shouldApplyStateStatus("COMPLETED", false), true);
});

test("shouldApplyStateStatus: AWAITING_USER + processRunning=true passes through", () => {
  assert.equal(shouldApplyStateStatus("AWAITING_USER", true), true);
});

test("shouldApplyStateStatus: FAILED + processRunning=true is suppressed", () => {
  assert.equal(shouldApplyStateStatus("FAILED", true), false);
});

test("shouldApplyStateStatus: RUNNING + processRunning=true passes through", () => {
  assert.equal(shouldApplyStateStatus("RUNNING", true), true);
});

// -- enrichJobSnapshot integration: state.json status/phase suppression --

test("enrichJobSnapshot: RUNNING job stays RUNNING when state.json says COMPLETED and process is alive", async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "snap-test-"));
  try {
    const statePath = path.join(tmpDir, "state.json");
    writeFileSync(statePath, JSON.stringify({ status: "COMPLETED", phase: "Completed" }));
    const snapshot = await enrichJobSnapshot(
      makeJob({ status: "RUNNING", pid: process.pid, statePath })
    );
    assert.equal(snapshot.status, "RUNNING");
    assert.notEqual(snapshot.phase, "Completed");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("enrichJobSnapshot: RUNNING job becomes COMPLETED when state.json says COMPLETED and process is dead", async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "snap-test-"));
  try {
    const statePath = path.join(tmpDir, "state.json");
    writeFileSync(statePath, JSON.stringify({ status: "COMPLETED", phase: "Completed" }));
    const snapshot = await enrichJobSnapshot(
      makeJob({ status: "RUNNING", pid: 999999999, statePath })
    );
    assert.equal(snapshot.status, "COMPLETED");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("enrichJobSnapshot: RUNNING job gets AWAITING_USER from state.json when process is alive", async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "snap-test-"));
  try {
    const statePath = path.join(tmpDir, "state.json");
    writeFileSync(statePath, JSON.stringify({ status: "AWAITING_USER", phase: "Waiting for input" }));
    const snapshot = await enrichJobSnapshot(
      makeJob({ status: "RUNNING", pid: process.pid, statePath })
    );
    assert.equal(snapshot.status, "AWAITING_USER");
    assert.equal(snapshot.phase, "Waiting for input");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("enrichJobSnapshot: phase text suppressed when state.json says terminal but process is alive", async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "snap-test-"));
  try {
    const statePath = path.join(tmpDir, "state.json");
    writeFileSync(statePath, JSON.stringify({ status: "FAILED", phase: "Failed" }));
    const snapshot = await enrichJobSnapshot(
      makeJob({ status: "RUNNING", pid: process.pid, statePath, phase: "Building" })
    );
    assert.equal(snapshot.status, "RUNNING");
    assert.equal(snapshot.phase, "Building");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("enrichJobSnapshot preserves execute finalization diagnostics", async () => {
  const snapshot = await enrichJobSnapshot(
    makeJob({
      command: LoopCommand.Execute,
      status: "COMPLETED",
      finalizationSource: "boot-recovery",
      executeFinalizationStatus: "success",
      executeFinalizationPath: "artifact-existing",
      executeFinalizationReason: "existing execution-result.json reused",
      executeFinalizationPreExecutionResultPresent: true,
      executeFinalizationPrePrBodyPresent: false,
      executeFinalizationPostExecutionResultPresent: true,
      executeFinalizationPostPrBodyPresent: false,
    }),
  );
  assert.equal(snapshot.finalizationSource, "boot-recovery");
  assert.equal(snapshot.executeFinalizationStatus, "success");
  assert.equal(snapshot.executeFinalizationPath, "artifact-existing");
  assert.equal(
    snapshot.executeFinalizationReason,
    "existing execution-result.json reused",
  );
  assert.equal(snapshot.executeFinalizationPreExecutionResultPresent, true);
  assert.equal(snapshot.executeFinalizationPrePrBodyPresent, false);
  assert.equal(snapshot.executeFinalizationPostExecutionResultPresent, true);
  assert.equal(snapshot.executeFinalizationPostPrBodyPresent, false);
});
