import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { JobStore, type LocalJob } from "../src/main/job-store.js";
import { finalizeLoopFromRuntime } from "../src/main/loop-finalizer.js";
import type { TelemetryEventPayload } from "../src/main/telemetry-protocol.js";

let tempRoot = "";
let fetchCalls: Array<{ url: string; body: string }> = [];
let telemetryEvents: TelemetryEventPayload[] = [];
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "loop-finalizer-test-"));
  fetchCalls = [];
  telemetryEvents = [];
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    fetchCalls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : "",
    });
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

function createStore(name: string): JobStore {
  return new JobStore({ cwd: tempRoot, name });
}

function createBaseJob(overrides?: Partial<LocalJob>): LocalJob {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  return {
    id: "loop-1",
    kind: "SYMPHONY_LOOP",
    loopId: "loop-1",
    command: "PLAN",
    localRepoPath: path.join(tempRoot, "repo"),
    claudeWorkDir,
    status: "RUNNING",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("finalizeLoopFromRuntime uploads, posts completion, and persists terminal state", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ tasks: [] }));
  await fs.writeFile(path.join(claudeWorkDir, "open-questions.md"), "none");

  const jobStore = createStore("finalizer-success");
  const job = createBaseJob({ claudeWorkDir });
  jobStore.upsert(job);

  await finalizeLoopFromRuntime(job, "live-exit", {
    jobStore,
    telemetry: { emit: (event) => telemetryEvents.push(event) },
    apiAuthToken: "token",
    apiBaseUrl: "http://127.0.0.1:12345",
    isProcessRunning: () => false,
  });

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.status, "COMPLETED");
  assert.ok(persisted.artifactsUploadedAt);
  assert.ok(persisted.completedEventPostedAt);
  assert.ok(persisted.finalStatusPersistedAt);
  assert.equal(fetchCalls.length, 2);
  assert.equal(telemetryEvents.length, 1);
});

test("finalizeLoopFromRuntime is idempotent after timestamps are set", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ tasks: [] }));

  const jobStore = createStore("finalizer-idempotent");
  const job = createBaseJob({ claudeWorkDir });
  jobStore.upsert(job);

  await finalizeLoopFromRuntime(job, "live-exit", {
    jobStore,
    telemetry: { emit: () => {} },
    apiAuthToken: "token",
    apiBaseUrl: "http://127.0.0.1:12345",
    isProcessRunning: () => false,
  });
  const fetchCountAfterFirstRun = fetchCalls.length;
  const finalized = jobStore.getByLoopId("loop-1");
  assert.ok(finalized);

  await finalizeLoopFromRuntime(finalized, "boot-recovery", {
    jobStore,
    telemetry: { emit: () => {} },
    apiAuthToken: "token",
    apiBaseUrl: "http://127.0.0.1:12345",
    isProcessRunning: () => false,
  });

  assert.equal(fetchCalls.length, fetchCountAfterFirstRun);
});

test("finalizeLoopFromRuntime skips CANCEL_PENDING while PID remains alive", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  const jobStore = createStore("finalizer-cancel-pending");
  const job = createBaseJob({
    claudeWorkDir,
    status: "CANCEL_PENDING",
    pid: process.pid,
  });
  jobStore.upsert(job);

  await finalizeLoopFromRuntime(job, "boot-recovery", {
    jobStore,
    telemetry: { emit: () => {} },
    apiAuthToken: "token",
    apiBaseUrl: "http://127.0.0.1:12345",
    isProcessRunning: () => true,
  });

  assert.equal(fetchCalls.length, 0);
  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.status, "CANCEL_PENDING");
});

test("finalizeLoopFromRuntime preserves FAILED jobs and posts an error event", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  const jobStore = createStore("finalizer-failed");
  const job = createBaseJob({
    claudeWorkDir,
    status: "FAILED",
    exitCode: 42,
  });
  jobStore.upsert(job);

  await finalizeLoopFromRuntime(job, "boot-recovery", {
    jobStore,
    telemetry: { emit: (event) => telemetryEvents.push(event) },
    apiAuthToken: "token",
    apiBaseUrl: "http://127.0.0.1:12345",
    isProcessRunning: () => false,
  });

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.status, "FAILED");
  assert.equal(persisted.artifactsUploadedAt, undefined);
  assert.ok(persisted.completedEventPostedAt);
  assert.ok(persisted.finalStatusPersistedAt);
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0]?.body ?? "", /"type":"error"/);
  assert.match(fetchCalls[0]?.body ?? "", /"code":"PROCESS_FAILED"/);
  assert.equal(telemetryEvents[0]?.category, "job.recovery.finalize_replayed");
  assert.equal(telemetryEvents[0]?.severity, "error");
});

test("finalizeLoopFromRuntime preserves CANCELLED jobs without posting loop events", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  const jobStore = createStore("finalizer-cancelled");
  const job = createBaseJob({
    claudeWorkDir,
    status: "CANCELLED",
    exitCode: 130,
  });
  jobStore.upsert(job);

  await finalizeLoopFromRuntime(job, "boot-recovery", {
    jobStore,
    telemetry: { emit: (event) => telemetryEvents.push(event) },
    apiAuthToken: "token",
    apiBaseUrl: "http://127.0.0.1:12345",
    isProcessRunning: () => false,
  });

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.status, "CANCELLED");
  assert.equal(persisted.artifactsUploadedAt, undefined);
  assert.equal(persisted.completedEventPostedAt, undefined);
  assert.ok(persisted.finalStatusPersistedAt);
  assert.equal(fetchCalls.length, 0);
  assert.equal(telemetryEvents[0]?.category, "job.recovery.finalize_replayed");
  assert.equal(telemetryEvents[0]?.severity, "info");
});

test("finalizeLoopFromRuntime preserves STOPPED jobs and posts a stopped error event", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  const jobStore = createStore("finalizer-stopped");
  const job = createBaseJob({
    claudeWorkDir,
    status: "STOPPED",
    exitCode: 137,
  });
  jobStore.upsert(job);

  await finalizeLoopFromRuntime(job, "boot-recovery", {
    jobStore,
    telemetry: { emit: (event) => telemetryEvents.push(event) },
    apiAuthToken: "token",
    apiBaseUrl: "http://127.0.0.1:12345",
    isProcessRunning: () => false,
  });

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.status, "STOPPED");
  assert.equal(persisted.artifactsUploadedAt, undefined);
  assert.ok(persisted.completedEventPostedAt);
  assert.ok(persisted.finalStatusPersistedAt);
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0]?.body ?? "", /"type":"error"/);
  assert.match(fetchCalls[0]?.body ?? "", /"code":"PROCESS_STOPPED"/);
  assert.equal(telemetryEvents[0]?.category, "job.recovery.finalize_replayed");
  assert.equal(telemetryEvents[0]?.severity, "error");
});
