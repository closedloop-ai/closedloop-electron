import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { JobStore, type LocalJob } from "../src/main/job-store.js";
import {
  emitFinalizationTelemetry,
  finalizeLoopFromRuntime,
  parseJobWarnings,
  persistFinalJobStatus,
  tryPostCompletedEvent,
  tryPostErrorEvent,
  tryUploadArtifacts,
} from "../src/main/loop-finalizer.js";
import { LoopTokenStore } from "../src/main/loop-token-store.js";
import type { TelemetryEventPayload } from "../src/main/telemetry-protocol.js";
import { createTestLoopTokenSafeStorage } from "./loop-token-test-utils.js";

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
  assert.ok(persisted.cloudFinalizedAt);
  assert.equal(fetchCalls.length, 2);
  assert.equal(telemetryEvents.length, 1);
});

test("finalizeLoopFromRuntime keeps loop token when cloud finalization fails retryably", async () => {
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push({
      url,
      body: typeof init?.body === "string" ? init.body : "",
    });
    if (url.includes("upload-artifacts")) {
      return new Response("nope", { status: 500 });
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ tasks: [] }));
  await fs.writeFile(path.join(claudeWorkDir, "open-questions.md"), "none");

  const jobStore = createStore("finalizer-upload-fail-token");
  const job = createBaseJob({ claudeWorkDir });
  jobStore.upsert(job);

  const loopTokenStore = new LoopTokenStore({
    cwd: tempRoot,
    name: "finalizer-upload-fail-lt",
    safeStorage: createTestLoopTokenSafeStorage(),
  });
  loopTokenStore.setLoopToken("loop-1", "runner-token");

  await finalizeLoopFromRuntime(job, "live-exit", {
    jobStore,
    telemetry: { emit: () => {} },
    apiAuthToken: "token",
    apiBaseUrl: "http://127.0.0.1:12345",
    isProcessRunning: () => false,
    loopTokenStore,
  });

  const persisted = jobStore.getByLoopId("loop-1");
  assert.equal(persisted?.status, "COMPLETED");
  assert.equal(persisted?.cloudFinalizedAt, undefined);
  assert.ok(persisted?.lastRecoveryError);
  assert.equal(loopTokenStore.getLoopToken("loop-1"), "runner-token");
});

test("finalizeLoopFromRuntime clears loop token for non-retryable cloud failure", async () => {
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push({
      url,
      body: typeof init?.body === "string" ? init.body : "",
    });
    return new Response("denied", { status: 401 });
  }) as typeof fetch;

  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ tasks: [] }));

  const jobStore = createStore("finalizer-non-retryable-token-clear");
  const job = createBaseJob({ claudeWorkDir });
  jobStore.upsert(job);

  const loopTokenStore = new LoopTokenStore({
    cwd: tempRoot,
    name: "finalizer-non-retryable-lt",
    safeStorage: createTestLoopTokenSafeStorage(),
  });
  loopTokenStore.setLoopToken("loop-1", "runner-token");

  await finalizeLoopFromRuntime(job, "live-exit", {
    jobStore,
    telemetry: { emit: () => {} },
    apiAuthToken: "token",
    apiBaseUrl: "http://127.0.0.1:12345",
    isProcessRunning: () => false,
    loopTokenStore,
  });

  assert.equal(loopTokenStore.getLoopToken("loop-1"), null);
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

test("finalizeLoopFromRuntime maps dead CANCEL_PENDING to CANCELLED without posting loop events", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  const jobStore = createStore("finalizer-cancel-pending-dead-pid");
  const job = createBaseJob({
    claudeWorkDir,
    status: "CANCEL_PENDING",
    exitCode: 130,
    pid: 9_999_999,
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
  assert.equal(telemetryEvents[0]?.severity, "info");
  assert.match(String(telemetryEvents[0]?.message ?? ""), /cancellation finalized/);
});

test("finalizeLoopFromRuntime maps PID-less CANCEL_PENDING to CANCELLED without posting loop events", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  const jobStore = createStore("finalizer-cancel-pending-null-pid");
  const job = createBaseJob({
    claudeWorkDir,
    status: "CANCEL_PENDING",
    exitCode: 130,
    pid: undefined,
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
  assert.ok(persisted.finalStatusPersistedAt);
  assert.equal(fetchCalls.length, 0);
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

test("finalizeLoopFromRuntime boot-recovery RUNNING without snapshot resolves to FAILED", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });

  const jobStore = createStore("finalizer-boot-running-no-snapshot");
  // No statePath, no state.json file
  const loopId = "loop-1";
  const job = createBaseJob({ claudeWorkDir, status: "RUNNING" });
  jobStore.upsert(job);

  await finalizeLoopFromRuntime(job, "boot-recovery", {
    jobStore,
    telemetry: { emit: () => {} },
    apiAuthToken: "token",
    apiBaseUrl: "http://127.0.0.1:12345",
    isProcessRunning: () => false,
  });

  const persisted = jobStore.getByLoopId(loopId);
  assert.ok(persisted);
  assert.equal(persisted.status, "FAILED");
  // Job moved out of active (listRunning should not contain it)
  assert.equal(jobStore.listRunning().find((j) => j.loopId === loopId), undefined);
  // Non-zero exit code
  assert.ok((persisted.exitCode ?? 0) !== 0);
  // No upload-artifacts call
  assert.equal(fetchCalls.filter((c) => c.url.includes("/upload-artifacts")).length, 0);
  // Error event with PROCESS_FAILED (not PROCESS_STOPPED)
  assert.ok(fetchCalls.some((c) => c.body.includes('"type":"error"')));
  assert.ok(fetchCalls.some((c) => c.body.includes('"code":"PROCESS_FAILED"')));
});

test("finalizeLoopFromRuntime boot-recovery error event includes diagnostics payload", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });

  await fs.writeFile(
    path.join(claudeWorkDir, "symphony-loop.log"),
    "Loop started\nProcess running\nProcess exiting\n",
  );

  await fs.writeFile(
    path.join(claudeWorkDir, "claude-output.jsonl"),
    JSON.stringify({ type: "assistant", message: { content: [], usage: { input_tokens: 100, output_tokens: 50 } } }) + "\n",
  );

  const jobStore = createStore("finalizer-boot-error-diagnostics");
  // No statePath, so RUNNING resolves to FAILED via boot-recovery
  const job = createBaseJob({ claudeWorkDir, status: "RUNNING" });
  jobStore.upsert(job);

  await finalizeLoopFromRuntime(job, "boot-recovery", {
    jobStore,
    telemetry: { emit: () => {} },
    apiAuthToken: "token",
    apiBaseUrl: "http://127.0.0.1:12345",
    isProcessRunning: () => false,
  });

  const errorCall = fetchCalls.find((c) => c.body.includes('"type":"error"'));
  assert.ok(errorCall, "error event must be posted");
  const parsed = JSON.parse(errorCall.body) as Record<string, unknown>;
  // logTail should be present and non-empty
  assert.ok(parsed.logTail, "logTail must be present");
  assert.ok(
    typeof parsed.logTail === "string" && parsed.logTail.length > 0,
    "logTail must be non-empty string",
  );
  // tokenUsage should be present and non-null
  assert.ok(parsed.tokenUsage, "tokenUsage must be present");
  const tokenUsage = parsed.tokenUsage as { inputTokens: number; outputTokens: number };
  assert.ok(
    tokenUsage.inputTokens > 0 || tokenUsage.outputTokens > 0,
    "tokenUsage must have non-zero values",
  );
});

test("finalizeLoopFromRuntime boot-recovery RUNNING is idempotent on second call", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });

  const jobStore = createStore("finalizer-boot-running-idempotent");
  const loopId = "loop-1";
  const job = createBaseJob({ claudeWorkDir, status: "RUNNING" });
  jobStore.upsert(job);

  // First call: RUNNING -> FAILED
  await finalizeLoopFromRuntime(job, "boot-recovery", {
    jobStore,
    telemetry: { emit: () => {} },
    apiAuthToken: "token",
    apiBaseUrl: "http://127.0.0.1:12345",
    isProcessRunning: () => false,
  });

  const fetchCountAfterFirst = fetchCalls.length;
  const persistedJob = jobStore.getByLoopId(loopId);
  assert.ok(persistedJob);

  // Second call with the already-finalized job: completedEventPostedAt guard prevents re-posting
  await finalizeLoopFromRuntime(persistedJob, "boot-recovery", {
    jobStore,
    telemetry: { emit: () => {} },
    apiAuthToken: "token",
    apiBaseUrl: "http://127.0.0.1:12345",
    isProcessRunning: () => false,
  });

  assert.equal(fetchCalls.length, fetchCountAfterFirst);
});

test("finalizeLoopFromRuntime boot-recovery RUNNING with CANCELLED snapshot resolves to CANCELLED", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });

  // Write a state.json with CANCELLED status
  const statePath = path.join(tempRoot, "state.json");
  await fs.writeFile(statePath, JSON.stringify({ status: "CANCELLED" }), "utf-8");

  const jobStore = createStore("finalizer-boot-running-cancelled-snapshot");
  const loopId = "loop-1";
  const job = createBaseJob({ claudeWorkDir, status: "RUNNING", statePath });
  jobStore.upsert(job);

  await finalizeLoopFromRuntime(job, "boot-recovery", {
    jobStore,
    telemetry: { emit: () => {} },
    apiAuthToken: "token",
    apiBaseUrl: "http://127.0.0.1:12345",
    isProcessRunning: () => false,
  });

  const persisted = jobStore.getByLoopId(loopId);
  assert.ok(persisted);
  assert.equal(persisted.status, "CANCELLED");
  // CANCELLED routes to no-cloud-event branch: no error event, no upload
  assert.equal(fetchCalls.length, 0);
  // finalStatusPersistedAt is set
  assert.ok(persisted.finalStatusPersistedAt);
});

// --- Step functions (minimal scenarios per step)

test("parseJobWarnings returns empty array when missing or blank", () => {
  assert.deepEqual(parseJobWarnings({}), []);
  assert.deepEqual(parseJobWarnings({ warning: "" }), []);
});

test("parseJobWarnings splits on semicolon, trims, and drops empty segments", () => {
  assert.deepEqual(parseJobWarnings({ warning: "a; b;  ;c" }), ["a", "b", "c"]);
});

const artifactDeps = (jobStore: JobStore) => ({
  jobStore,
  apiAuthToken: "token",
  apiBaseUrl: "http://127.0.0.1:12345",
});

/** Minimal git repo for branchName fallback tests (requires git on PATH). */
function initGitRepoAt(dir: string, branchName: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@example.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
  execSync("git config commit.gpgsign false", { cwd: dir, stdio: "pipe" });
  writeFileSync(path.join(dir, "README.md"), "init\n", "utf-8");
  execSync("git add README.md", { cwd: dir, stdio: "pipe" });
  execSync("git commit -m init", { cwd: dir, stdio: "pipe" });
  execSync(`git branch -M ${branchName}`, { cwd: dir, stdio: "pipe" });
}

test("tryUploadArtifacts POSTs artifacts and sets artifactsUploadedAt on success", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ tasks: [] }));

  const jobStore = createStore("step-upload-ok");
  const job = createBaseJob({ claudeWorkDir });
  jobStore.upsert(job);

  const warnings: string[] = [];
  const { failed } = await tryUploadArtifacts(
    job,
    "PLAN",
    claudeWorkDir,
    undefined,
    warnings,
    artifactDeps(jobStore),
  );

  assert.equal(failed, false);
  assert.equal(warnings.length, 0);
  assert.equal(fetchCalls.filter((c) => c.url.includes("/upload-artifacts")).length, 1);
  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted?.artifactsUploadedAt);
});

test("tryUploadArtifacts skips upload when artifactsUploadedAt already set", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ tasks: [] }));

  const jobStore = createStore("step-upload-skip");
  const uploadedAt = new Date().toISOString();
  const job = createBaseJob({ claudeWorkDir, artifactsUploadedAt: uploadedAt });
  jobStore.upsert(job);

  const warnings: string[] = [];
  await tryUploadArtifacts(job, "PLAN", claudeWorkDir, undefined, warnings, artifactDeps(jobStore));

  assert.equal(fetchCalls.length, 0);
  assert.equal(warnings.length, 0);
});

test("tryUploadArtifacts records ARTIFACT_UPLOAD_FAILED when HTTP fails", async () => {
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url = String(input);
    fetchCalls.push({ url, body: "" });
    if (url.includes("upload-artifacts")) {
      return new Response("nope", { status: 500 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ tasks: [] }));

  const jobStore = createStore("step-upload-fail");
  const job = createBaseJob({ claudeWorkDir });
  jobStore.upsert(job);

  const warnings: string[] = [];
  const { failed } = await tryUploadArtifacts(
    job,
    "PLAN",
    claudeWorkDir,
    undefined,
    warnings,
    artifactDeps(jobStore),
  );

  assert.equal(failed, true);
  assert.ok(warnings.includes("ARTIFACT_UPLOAD_FAILED"));
  assert.equal(jobStore.getByLoopId("loop-1")?.artifactsUploadedAt, undefined);
});

test("tryPostCompletedEvent posts completed event and sets completedEventPostedAt", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });

  const jobStore = createStore("step-complete-ok");
  const job = createBaseJob({ claudeWorkDir });
  jobStore.upsert(job);

  const warnings: string[] = [];
  const result = await tryPostCompletedEvent(
    job,
    "PLAN",
    claudeWorkDir,
    { plan: {} },
    warnings,
    artifactDeps(jobStore),
  );

  assert.equal(result.failed, false);
  assert.equal(
    fetchCalls.filter((c) => c.url.includes("/loops/loop-1/events")).length,
    1,
  );
  assert.match(fetchCalls[0]?.body ?? "", /"type":"completed"/);
  assert.ok(jobStore.getByLoopId("loop-1")?.completedEventPostedAt);
});

test("tryPostCompletedEvent skips when completedEventPostedAt is set", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });

  const jobStore = createStore("step-complete-skip");
  const postedAt = new Date().toISOString();
  const job = createBaseJob({ claudeWorkDir, completedEventPostedAt: postedAt });
  jobStore.upsert(job);

  const result = await tryPostCompletedEvent(
    job,
    "PLAN",
    claudeWorkDir,
    {},
    [],
    artifactDeps(jobStore),
  );

  assert.equal(result.failed, false);
  assert.equal(fetchCalls.length, 0);
});

test("tryPostCompletedEvent adds EXECUTE PR fields from artifacts", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });

  const jobStore = createStore("step-complete-execute");
  const job = createBaseJob({
    claudeWorkDir,
    command: "EXECUTE",
  });
  jobStore.upsert(job);

  const artifacts = {
    executionResult: {
      pr_url: "https://example.com/pr/1",
      pr_number: 1,
      branch_name: "feat/x",
      has_changes: true,
    },
  };

  await tryPostCompletedEvent(
    job,
    "EXECUTE",
    claudeWorkDir,
    artifacts,
    [],
    artifactDeps(jobStore),
  );

  const body = fetchCalls[0]?.body ?? "";
  assert.match(body, /"prUrl":"https:\/\/example.com\/pr\/1"/);
  assert.match(body, /"prNumber":1/);
  assert.match(body, /"branchName":"feat\/x"/);
  assert.match(body, /"has_changes":true/);
});

test("tryPostCompletedEvent includes sessionId from session-id.txt", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "session-id.txt"), "claude-sess-abc\n", "utf-8");

  const jobStore = createStore("step-complete-session");
  const job = createBaseJob({ claudeWorkDir });
  jobStore.upsert(job);

  await tryPostCompletedEvent(job, "PLAN", claudeWorkDir, { plan: {} }, [], artifactDeps(jobStore));

  const body = fetchCalls[0]?.body ?? "";
  assert.match(body, /"sessionId":"claude-sess-abc"/);
});

test("tryPostCompletedEvent adds branchName from worktree git for non-EXECUTE", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  const worktreeDir = path.join(tempRoot, "repo", "wt-plan");
  await fs.mkdir(worktreeDir, { recursive: true });
  initGitRepoAt(worktreeDir, "plan-worktree-branch");

  const jobStore = createStore("step-complete-branch-plan");
  const job = createBaseJob({ claudeWorkDir, worktreeDir });
  jobStore.upsert(job);

  await tryPostCompletedEvent(job, "PLAN", claudeWorkDir, { plan: {} }, [], artifactDeps(jobStore));

  const body = fetchCalls[0]?.body ?? "";
  assert.match(body, /"branchName":"plan-worktree-branch"/);
});

test("tryPostCompletedEvent EXECUTE uses git branch when executionResult omits branch_name", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  const worktreeDir = path.join(tempRoot, "repo", "wt-exec");
  await fs.mkdir(worktreeDir, { recursive: true });
  initGitRepoAt(worktreeDir, "execute-git-fallback");

  const jobStore = createStore("step-complete-exec-fallback");
  const job = createBaseJob({
    claudeWorkDir,
    worktreeDir,
    command: "EXECUTE",
  });
  jobStore.upsert(job);

  const artifacts = {
    executionResult: {
      pr_url: "https://example.com/pr/2",
      pr_number: 2,
      has_changes: true,
    },
  };

  await tryPostCompletedEvent(job, "EXECUTE", claudeWorkDir, artifacts, [], artifactDeps(jobStore));

  const body = fetchCalls[0]?.body ?? "";
  assert.match(body, /"branchName":"execute-git-fallback"/);
});

test("tryPostCompletedEvent EXECUTE prefers executionResult branch_name over git HEAD", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  const worktreeDir = path.join(tempRoot, "repo", "wt-exec-pref");
  await fs.mkdir(worktreeDir, { recursive: true });
  initGitRepoAt(worktreeDir, "git-head-branch");

  const jobStore = createStore("step-complete-exec-prefer-artifact");
  const job = createBaseJob({
    claudeWorkDir,
    worktreeDir,
    command: "EXECUTE",
  });
  jobStore.upsert(job);

  const artifacts = {
    executionResult: {
      pr_url: "https://example.com/pr/3",
      pr_number: 3,
      branch_name: "feat/from-artifact",
      has_changes: true,
    },
  };

  await tryPostCompletedEvent(job, "EXECUTE", claudeWorkDir, artifacts, [], artifactDeps(jobStore));

  const body = fetchCalls[0]?.body ?? "";
  assert.match(body, /"branchName":"feat\/from-artifact"/);
  assert.ok(!body.includes('"branchName":"git-head-branch"'));
});

test("tryUploadArtifacts sends sessionId and branchName in metadata", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ tasks: [] }));
  await fs.writeFile(path.join(claudeWorkDir, "session-id.txt"), "upload-sess-xyz\n", "utf-8");

  const worktreeDir = path.join(tempRoot, "repo", "wt-upload");
  await fs.mkdir(worktreeDir, { recursive: true });
  initGitRepoAt(worktreeDir, "upload-md-branch");

  const jobStore = createStore("step-upload-metadata");
  const job = createBaseJob({ claudeWorkDir, worktreeDir });
  jobStore.upsert(job);

  const warnings: string[] = [];
  const { failed } = await tryUploadArtifacts(
    job,
    "PLAN",
    claudeWorkDir,
    worktreeDir,
    warnings,
    artifactDeps(jobStore),
  );

  assert.equal(failed, false);
  const uploadCall = fetchCalls.find((c) => c.url.includes("/upload-artifacts"));
  assert.ok(uploadCall);
  const parsed = JSON.parse(uploadCall.body) as { metadata?: Record<string, unknown> };
  assert.equal(parsed.metadata?.sessionId, "upload-sess-xyz");
  assert.equal(parsed.metadata?.branchName, "upload-md-branch");
});

test("tryPostCompletedEvent records EVENT_POST_FAILED when HTTP fails", async () => {
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push({
      url,
      body: typeof init?.body === "string" ? init.body : "",
    });
    if (url.includes("/events")) {
      return new Response("err", { status: 502 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });

  const jobStore = createStore("step-complete-http-fail");
  const job = createBaseJob({ claudeWorkDir });
  jobStore.upsert(job);

  const warnings: string[] = [];
  const result = await tryPostCompletedEvent(
    job,
    "PLAN",
    claudeWorkDir,
    {},
    warnings,
    artifactDeps(jobStore),
  );

  assert.equal(result.failed, true);
  assert.ok(warnings.includes("EVENT_POST_FAILED"));
  assert.equal(jobStore.getByLoopId("loop-1")?.completedEventPostedAt, undefined);
});

test("tryPostErrorEvent uses PROCESS_FAILED for FAILED status", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });

  const jobStore = createStore("step-error-failed");
  const job = createBaseJob({
    claudeWorkDir,
    status: "FAILED",
    exitCode: 7,
  });
  jobStore.upsert(job);

  const warnings: string[] = [];
  const result = await tryPostErrorEvent(job, claudeWorkDir, warnings, artifactDeps(jobStore));

  assert.equal(result.failed, false);
  assert.match(fetchCalls[0]?.body ?? "", /"code":"PROCESS_FAILED"/);
  assert.match(fetchCalls[0]?.body ?? "", /"message":"Process exited with code 7"/);
});

test("tryPostErrorEvent uses PROCESS_STOPPED for STOPPED status", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });

  const jobStore = createStore("step-error-stopped");
  const job = createBaseJob({
    claudeWorkDir,
    status: "STOPPED",
  });
  jobStore.upsert(job);

  await tryPostErrorEvent(job, claudeWorkDir, [], artifactDeps(jobStore));

  assert.match(fetchCalls[0]?.body ?? "", /"code":"PROCESS_STOPPED"/);
  assert.match(fetchCalls[0]?.body ?? "", /STOPPED/);
});

test("tryPostErrorEvent skips when completedEventPostedAt is set", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });

  const jobStore = createStore("step-error-skip");
  const job = createBaseJob({
    claudeWorkDir,
    status: "FAILED",
    completedEventPostedAt: new Date().toISOString(),
  });
  jobStore.upsert(job);

  const result = await tryPostErrorEvent(job, claudeWorkDir, [], artifactDeps(jobStore));

  assert.equal(result.failed, false);
  assert.equal(fetchCalls.length, 0);
});

test("persistFinalJobStatus sets COMPLETED when isSuccessStatus", () => {
  const jobStore = createStore("step-persist-success");
  const job = createBaseJob({ status: "RUNNING" });
  jobStore.upsert(job);

  persistFinalJobStatus(job, true, [], jobStore);

  const persisted = jobStore.getByLoopId("loop-1");
  assert.equal(persisted?.status, "COMPLETED");
  assert.ok(persisted?.finalStatusPersistedAt);
});

test("persistFinalJobStatus preserves FAILED when not success", () => {
  const jobStore = createStore("step-persist-failed");
  const job = createBaseJob({ status: "FAILED", exitCode: 2 });
  jobStore.upsert(job);

  persistFinalJobStatus(job, false, [], jobStore);

  assert.equal(jobStore.getByLoopId("loop-1")?.status, "FAILED");
});

test("persistFinalJobStatus maps CANCEL_PENDING to CANCELLED when not success", () => {
  const jobStore = createStore("step-persist-cancel-pending");
  const job = createBaseJob({ status: "CANCEL_PENDING", exitCode: 130 });
  jobStore.upsert(job);

  persistFinalJobStatus(job, false, [], jobStore);

  const persisted = jobStore.getByLoopId("loop-1");
  assert.equal(persisted?.status, "CANCELLED");
  assert.ok(persisted?.finalStatusPersistedAt);
});

test("persistFinalJobStatus is a no-op when finalStatusPersistedAt already set", () => {
  const jobStore = createStore("step-persist-idem");
  const firstFinalized = new Date().toISOString();
  const job = createBaseJob({
    status: "RUNNING",
    finalStatusPersistedAt: firstFinalized,
  });
  jobStore.upsert(job);

  persistFinalJobStatus(job, true, ["X"], jobStore);

  const persisted = jobStore.getByLoopId("loop-1");
  assert.equal(persisted?.finalStatusPersistedAt, firstFinalized);
  assert.notEqual(persisted?.status, "COMPLETED");
});

test("persistFinalJobStatus serializes warnings with sanitization", () => {
  const jobStore = createStore("step-persist-warn");
  const job = createBaseJob({ status: "RUNNING" });
  jobStore.upsert(job);

  const longToken = "a".repeat(50);
  persistFinalJobStatus(job, true, [`https://user:${longToken}@host`], jobStore);

  const w = jobStore.getByLoopId("loop-1")?.warning ?? "";
  assert.match(w, /^\S*:\/\/\*\*\*@/);
  assert.ok(w.length <= 600);
});

test("emitFinalizationTelemetry uses job.completed on live-exit", () => {
  const jobStore = createStore("step-tel-live");
  const job = createBaseJob();
  jobStore.upsert(job);

  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  emitFinalizationTelemetry(job, "live-exit", claudeWorkDir, true, {
    emit: (e) => telemetryEvents.push(e),
  }, jobStore);

  assert.equal(telemetryEvents[0]?.category, "job.completed");
  assert.equal(telemetryEvents[0]?.severity, "info");
  assert.equal(telemetryEvents[0]?.message, "Job completed successfully");
});

test("emitFinalizationTelemetry uses recovery category on boot-recovery", () => {
  const jobStore = createStore("step-tel-recovery");
  const job = createBaseJob({ status: "RUNNING" });
  jobStore.upsert(job);

  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  emitFinalizationTelemetry(
    job,
    "boot-recovery",
    claudeWorkDir,
    true,
    { emit: (e) => telemetryEvents.push(e) },
    jobStore,
  );

  assert.equal(telemetryEvents[0]?.category, "job.recovery.finalize_replayed");
  assert.equal(telemetryEvents[0]?.severity, "info");
});

test("emitFinalizationTelemetry emits error severity for failed recovery finalization", () => {
  const jobStore = createStore("step-tel-err");
  const job = createBaseJob({ status: "FAILED" });
  jobStore.upsert(job);

  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  emitFinalizationTelemetry(
    job,
    "manual-repair",
    claudeWorkDir,
    false,
    { emit: (e) => telemetryEvents.push(e) },
    jobStore,
  );

  assert.equal(telemetryEvents[0]?.category, "job.recovery.finalize_replayed");
  assert.equal(telemetryEvents[0]?.severity, "error");
});
