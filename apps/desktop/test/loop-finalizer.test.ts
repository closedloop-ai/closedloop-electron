import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { JobStore, type LocalJob } from "../src/main/job-store.js";
import {
  EXECUTE_NO_WORK_LIVE_ACTIVITY,
  emitFinalizationTelemetry,
  finalizeLoopFromRuntime,
  parseJobWarnings,
  persistFinalJobStatus,
  tryPostCompletedEvent,
  tryPostErrorEvent,
  tryUploadArtifacts,
} from "../src/main/loop-finalizer.js";
import { LoopTokenStore } from "../src/main/loop-token-store.js";
import { resetResolvedClaudePath } from "../src/server/operations/symphony-loop.js";
import {
  resetShellPathCache,
  setShellPathForTest,
} from "../src/server/shell-path.js";
import type { TelemetryEventPayload } from "../src/main/telemetry-protocol.js";
import { createTestLoopTokenSafeStorage } from "./loop-token-test-utils.js";

let tempRoot = "";
let fetchCalls: Array<{ url: string; body: string }> = [];
let telemetryEvents: TelemetryEventPayload[] = [];
const originalFetch = globalThis.fetch;
const originalPath = process.env.PATH;

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
  process.env.PATH = originalPath;
  resetResolvedClaudePath();
  resetShellPathCache();
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
  await fs.writeFile(
    path.join(claudeWorkDir, "plan.json"),
    JSON.stringify({ content: "Plan content", tasks: [] }),
  );
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
  const uploadBody = JSON.parse(fetchCalls[0]?.body ?? "{}") as {
    artifacts?: { plan?: Record<string, unknown> };
  };
  assert.deepEqual(uploadBody.artifacts?.plan, {
    content: "Plan content",
    raw: { content: "Plan content", tasks: [] },
  });
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

test("finalizeLoopFromRuntime boot-recovery RUNNING with COMPLETED snapshot preserves success exitCode", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ tasks: [] }));

  const statePath = path.join(tempRoot, "state.json");
  await fs.writeFile(statePath, JSON.stringify({ status: "COMPLETED" }), "utf-8");

  const jobStore = createStore("finalizer-boot-running-completed-snapshot");
  const job = createBaseJob({ claudeWorkDir, status: "RUNNING", statePath });
  jobStore.upsert(job);

  await finalizeLoopFromRuntime(job, "boot-recovery", {
    jobStore,
    telemetry: { emit: () => {} },
    apiAuthToken: "token",
    apiBaseUrl: "http://127.0.0.1:12345",
    isProcessRunning: () => false,
  });

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.status, "COMPLETED");
  assert.equal(persisted.exitCode ?? 0, 0);

  const completedCall = fetchCalls.find((c) => c.body.includes('"type":"completed"'));
  assert.ok(completedCall, "completed event must be posted");
  const completedPayload = JSON.parse(completedCall.body) as {
    result?: { exitCode?: number };
  };
  assert.equal(completedPayload.result?.exitCode, 0);

  assert.equal(fetchCalls.filter((c) => c.body.includes('"type":"error"')).length, 0);
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

const artifactDeps = (
  jobStore: JobStore,
  getAllowedDirectories?: () => string[],
) => ({
  jobStore,
  apiAuthToken: "token",
  apiBaseUrl: "http://127.0.0.1:12345",
  getAllowedDirectories,
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
  await fs.writeFile(
    path.join(claudeWorkDir, "plan.json"),
    JSON.stringify({ content: "Plan content", tasks: [] }),
  );

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
  const uploadBody = JSON.parse(fetchCalls[0]?.body ?? "{}") as {
    artifacts?: { plan?: Record<string, unknown> };
  };
  assert.deepEqual(uploadBody.artifacts?.plan, {
    content: "Plan content",
    raw: { content: "Plan content", tasks: [] },
  });
});

test("tryUploadArtifacts includes current plan state on EXECUTE uploads", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeWorkDir, "plan.json"),
    JSON.stringify({
      content: "Plan content",
      pendingTasks: ["task-1"],
      completedTasks: ["task-0"],
    }),
  );
  await fs.writeFile(
    path.join(claudeWorkDir, "execution-result.json"),
    JSON.stringify({ has_changes: false }),
  );
  await fs.writeFile(
    path.join(claudeWorkDir, "code-judges.json"),
    JSON.stringify({ score: 0.9 }),
  );

  const jobStore = createStore("step-upload-execute-plan");
  const job = createBaseJob({
    claudeWorkDir,
    command: "EXECUTE",
  });
  jobStore.upsert(job);

  const warnings: string[] = [];
  const { failed } = await tryUploadArtifacts(
    job,
    "EXECUTE",
    claudeWorkDir,
    undefined,
    warnings,
    artifactDeps(jobStore),
  );

  assert.equal(failed, false);
  const uploadBody = JSON.parse(fetchCalls[0]?.body ?? "{}") as {
    artifacts?: {
      plan?: Record<string, unknown>;
      executionResult?: Record<string, unknown>;
      codeJudges?: Record<string, unknown>;
    };
  };
  assert.deepEqual(uploadBody.artifacts?.plan, {
    content: "Plan content",
    raw: {
      content: "Plan content",
      pendingTasks: ["task-1"],
      completedTasks: ["task-0"],
    },
  });
  assert.deepEqual(uploadBody.artifacts?.executionResult, {
    has_changes: false,
  });
  assert.deepEqual(uploadBody.artifacts?.codeJudges, { score: 0.9 });
});

test("tryUploadArtifacts falls back to imported-plan markdown for EXECUTE uploads", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeWorkDir, "imported-plan.md"),
    "# Imported fallback plan\n\n- preserve staged markdown",
  );
  await fs.writeFile(
    path.join(claudeWorkDir, "execution-result.json"),
    JSON.stringify({ has_changes: false }),
  );
  await fs.writeFile(
    path.join(claudeWorkDir, "code-judges.json"),
    JSON.stringify({ score: 0.9 }),
  );

  const jobStore = createStore("step-upload-execute-imported-plan");
  const job = createBaseJob({
    claudeWorkDir,
    command: "EXECUTE",
  });
  jobStore.upsert(job);

  const warnings: string[] = [];
  const { failed } = await tryUploadArtifacts(
    job,
    "EXECUTE",
    claudeWorkDir,
    undefined,
    warnings,
    artifactDeps(jobStore),
  );

  assert.equal(failed, false);
  const uploadBody = JSON.parse(fetchCalls[0]?.body ?? "{}") as {
    artifacts?: {
      plan?: Record<string, unknown>;
      executionResult?: Record<string, unknown>;
      codeJudges?: Record<string, unknown>;
    };
  };
  assert.deepEqual(uploadBody.artifacts?.plan, {
    content: "# Imported fallback plan\n\n- preserve staged markdown",
  });
  assert.deepEqual(uploadBody.artifacts?.executionResult, {
    has_changes: false,
  });
  assert.deepEqual(uploadBody.artifacts?.codeJudges, { score: 0.9 });
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

  // Write JSONL with cache tokens and multiple turns
  const jsonlLines = [
    JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-4",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 300,
        },
      },
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-4",
        usage: {
          input_tokens: 20,
          output_tokens: 8,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 150,
        },
      },
    }),
  ].join("\n") + "\n";
  await fs.writeFile(path.join(claudeWorkDir, "claude-output.jsonl"), jsonlLines, "utf-8");

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

  const parsed = JSON.parse(fetchCalls[0]?.body ?? "{}") as Record<string, unknown>;
  const tokensUsed = parsed.tokensUsed as Record<string, unknown>;
  assert.ok(tokensUsed !== null && typeof tokensUsed === "object", "tokensUsed must be present");
  assert.equal(tokensUsed.input, 30, "input must be sum of input_tokens only");
  assert.equal(tokensUsed.output, 13);
  assert.equal(tokensUsed.cacheCreationInputTokens, 200);
  assert.equal(tokensUsed.cacheReadInputTokens, 450);
  assert.equal(tokensUsed.turns, 2);
  assert.deepEqual(tokensUsed.models, ["claude-opus-4"]);
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

test("tryPostCompletedEvent includes execute finalization metadata for EXECUTE jobs", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });

  const jobStore = createStore("step-complete-exec-finalization-metadata");
  const job = createBaseJob({
    claudeWorkDir,
    command: "EXECUTE",
    finalizationSource: "boot-recovery",
    executeFinalizationStatus: "success",
    executeFinalizationPath: "artifact-existing",
    executeFinalizationReason: "existing execution-result.json reused",
  });
  jobStore.upsert(job);

  const artifacts = {
    executionResult: {
      pr_url: "https://example.com/pr/4",
      pr_number: 4,
      branch_name: "feat/recovered-complete",
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

  const parsed = JSON.parse(fetchCalls[0]?.body ?? "{}") as {
    result?: Record<string, unknown>;
  };
  assert.equal(parsed.result?.finalizationSource, "boot-recovery");
  assert.equal(parsed.result?.executeFinalizationStatus, "success");
  assert.equal(parsed.result?.executeFinalizationPath, "artifact-existing");
  assert.equal(
    parsed.result?.executeFinalizationReason,
    "existing execution-result.json reused",
  );
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

test("tryUploadArtifacts includes execute finalization metadata for EXECUTE jobs", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeWorkDir, "execution-result.json"),
    JSON.stringify({
      has_changes: true,
      pr_url: "https://example.com/pr/11",
      pr_number: 11,
      branch_name: "feat/recovered-upload",
      base_ref: "main",
      base_branch: "main",
      commit_sha: "abc123",
    }),
  );

  const jobStore = createStore("step-upload-exec-finalization-metadata");
  const job = createBaseJob({
    claudeWorkDir,
    command: "EXECUTE",
    finalizationSource: "boot-recovery",
    executeFinalizationStatus: "success",
    executeFinalizationPath: "artifact-existing",
    executeFinalizationReason: "existing execution-result.json reused",
  });
  jobStore.upsert(job);

  const warnings: string[] = [];
  const { failed } = await tryUploadArtifacts(
    job,
    "EXECUTE",
    claudeWorkDir,
    undefined,
    warnings,
    artifactDeps(jobStore),
  );

  assert.equal(failed, false);
  const uploadCall = fetchCalls.find((c) => c.url.includes("/upload-artifacts"));
  assert.ok(uploadCall);
  const parsed = JSON.parse(uploadCall.body) as { metadata?: Record<string, unknown> };
  assert.equal(parsed.metadata?.finalizationSource, "boot-recovery");
  assert.equal(parsed.metadata?.executeFinalizationStatus, "success");
  assert.equal(parsed.metadata?.executeFinalizationPath, "artifact-existing");
  assert.equal(
    parsed.metadata?.executeFinalizationReason,
    "existing execution-result.json reused",
  );
});

test("tryUploadArtifacts omits branchName fallback when worktree is outside allowed directories", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ tasks: [] }));
  await fs.writeFile(path.join(claudeWorkDir, "session-id.txt"), "upload-sess-xyz\n", "utf-8");

  const worktreeDir = path.join(tempRoot, "blocked", "wt-upload");
  await fs.mkdir(worktreeDir, { recursive: true });

  const allowedDir = path.join(tempRoot, "allowed");
  await fs.mkdir(allowedDir, { recursive: true });

  const fakeBin = path.join(tempRoot, "fake-bin");
  const gitCapture = path.join(tempRoot, "git-capture.txt");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(
    path.join(fakeBin, "git"),
    [
      "#!/bin/sh",
      `printf '%s\\n' \"$@\" >> ${JSON.stringify(gitCapture)}`,
      'if [ "$1" = "rev-parse" ] && [ "$2" = "--abbrev-ref" ]; then',
      '  echo "blocked-branch"',
      "  exit 0",
      "fi",
      "exit 0",
    ].join("\n"),
    { mode: 0o755 },
  );
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const jobStore = createStore("step-upload-disallowed-worktree");
  const job = createBaseJob({ claudeWorkDir, worktreeDir });
  jobStore.upsert(job);

  const warnings: string[] = [];
  const { failed } = await tryUploadArtifacts(
    job,
    "PLAN",
    claudeWorkDir,
    worktreeDir,
    warnings,
    artifactDeps(jobStore, () => [allowedDir]),
  );

  assert.equal(failed, false);
  const uploadCall = fetchCalls.find((c) => c.url.includes("/upload-artifacts"));
  assert.ok(uploadCall);
  const parsed = JSON.parse(uploadCall.body) as { metadata?: Record<string, unknown> };
  assert.equal(parsed.metadata?.sessionId, "upload-sess-xyz");
  assert.equal(parsed.metadata?.branchName, undefined);
  assert.equal(await fs.readFile(gitCapture, "utf-8").catch(() => ""), "");
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
  await fs.writeFile(path.join(claudeWorkDir, "session-id.txt"), "session-123\n");
  const repoDir = path.join(tempRoot, "repo", "git-root");
  await fs.mkdir(repoDir, { recursive: true });
  initGitRepoAt(repoDir, "resume-branch");

  // Write JSONL with cache tokens
  const jsonlLine = JSON.stringify({
    type: "assistant",
    message: {
      model: "claude-opus-4",
      usage: {
        input_tokens: 5,
        output_tokens: 3,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 200,
      },
    },
  });
  await fs.writeFile(path.join(claudeWorkDir, "claude-output.jsonl"), jsonlLine + "\n", "utf-8");

  const jobStore = createStore("step-error-failed");
  const job = createBaseJob({
    claudeWorkDir,
    worktreeDir: repoDir,
    status: "FAILED",
    exitCode: 7,
  });
  jobStore.upsert(job);

  const warnings: string[] = [];
  const result = await tryPostErrorEvent(job, claudeWorkDir, warnings, artifactDeps(jobStore));

  assert.equal(result.failed, false);
  assert.match(fetchCalls[0]?.body ?? "", /"code":"PROCESS_FAILED"/);
  assert.match(fetchCalls[0]?.body ?? "", /"message":"Process exited with code 7"/);

  const parsed = JSON.parse(fetchCalls[0]?.body ?? "{}") as Record<string, unknown>;
  const tokenUsage = parsed.tokenUsage as Record<string, unknown>;
  assert.ok(tokenUsage !== null && typeof tokenUsage === "object", "tokenUsage must be present");
  assert.equal(tokenUsage.inputTokens, 5);
  assert.equal(tokenUsage.outputTokens, 3);
  assert.equal(tokenUsage.cacheCreationInputTokens, 100);
  assert.equal(tokenUsage.cacheReadInputTokens, 200);
  assert.equal(tokenUsage.turns, undefined, "turns must NOT be present in error event");
  assert.equal(tokenUsage.models, undefined, "models must NOT be present in error event");
  assert.equal(parsed.sessionId, "session-123");
  assert.equal(parsed.branchName, "resume-branch");
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

test("tryPostErrorEvent uses NO_WORK_PRODUCED for shared EXECUTE no-work failures", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeWorkDir, "claude-output.jsonl"),
    JSON.stringify({
      type: "assistant",
      message: {
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    }) + "\n",
    "utf-8",
  );

  const jobStore = createStore("step-error-no-work-produced");
  const job = createBaseJob({
    claudeWorkDir,
    command: "EXECUTE",
    status: "FAILED",
    exitCode: 0,
    liveActivity: EXECUTE_NO_WORK_LIVE_ACTIVITY,
  });
  jobStore.upsert(job);

  await tryPostErrorEvent(job, claudeWorkDir, [], artifactDeps(jobStore));

  assert.match(fetchCalls[0]?.body ?? "", /"code":"NO_WORK_PRODUCED"/);
  assert.match(
    fetchCalls[0]?.body ?? "",
    /"message":"EXECUTE loop completed with 0 tokens -- no work was done"/,
  );
  const parsed = JSON.parse(fetchCalls[0]?.body ?? "{}") as {
    tokenUsage?: Record<string, unknown>;
  };
  assert.equal(parsed.tokenUsage, undefined);
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

test("tryPostErrorEvent includes tokenUsage when only cache tokens are non-zero", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });

  // Write JSONL with zero input/output but non-zero cache tokens
  const jsonlLine = JSON.stringify({
    type: "assistant",
    message: {
      model: "claude-opus-4",
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 500,
      },
    },
  });
  await fs.writeFile(path.join(claudeWorkDir, "claude-output.jsonl"), jsonlLine + "\n", "utf-8");

  const jobStore = createStore("step-error-cache-only");
  const job = createBaseJob({
    claudeWorkDir,
    status: "FAILED",
    exitCode: 1,
  });
  jobStore.upsert(job);

  const result = await tryPostErrorEvent(job, claudeWorkDir, [], artifactDeps(jobStore));

  assert.equal(result.failed, false);
  const parsed = JSON.parse(fetchCalls[0]?.body ?? "{}") as Record<string, unknown>;
  const tokenUsage = parsed.tokenUsage as Record<string, unknown> | undefined;
  assert.ok(
    tokenUsage !== null && typeof tokenUsage === "object",
    "tokenUsage must be present when cache-only activity exists",
  );
  assert.equal(tokenUsage.cacheReadInputTokens, 500);
  assert.equal(tokenUsage.inputTokens, 0);
  assert.equal(tokenUsage.outputTokens, 0);
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

test("finalizeLoopFromRuntime cleans up persisted additionalWorktreeDirs on boot-recovery and clears the field", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeWorkDir, "plan.json"),
    JSON.stringify({ tasks: [] }),
  );
  await fs.writeFile(path.join(claudeWorkDir, "open-questions.md"), "none");

  const jobStore = createStore("finalizer-additional-cleanup");
  const additional = [
    { dir: path.join(tempRoot, "wt-a"), repoPath: path.join(tempRoot, "repo-a") },
    { dir: path.join(tempRoot, "wt-b"), repoPath: path.join(tempRoot, "repo-b") },
  ];
  const job = createBaseJob({
    claudeWorkDir,
    status: "COMPLETED",
    additionalWorktreeDirs: additional,
  });
  jobStore.upsert(job);

  const cleanupCalls: Array<{
    entries: readonly { dir: string; repoPath: string }[];
    loopId: string;
  }> = [];

  await finalizeLoopFromRuntime(job, "boot-recovery", {
    jobStore,
    telemetry: { emit: () => {} },
    apiAuthToken: "token",
    apiBaseUrl: "http://127.0.0.1:12345",
    isProcessRunning: () => false,
    cleanupAdditionalWorktrees: async (entries, loopId) => {
      cleanupCalls.push({ entries: [...entries], loopId });
    },
  });

  assert.equal(cleanupCalls.length, 1);
  assert.equal(cleanupCalls[0]?.loopId, "loop-1");
  assert.deepEqual(cleanupCalls[0]?.entries, additional);

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(
    persisted.additionalWorktreeDirs,
    undefined,
    "additionalWorktreeDirs should be cleared after cleanup so retries do not re-run it",
  );
});

test("finalizeLoopFromRuntime skips additional worktree cleanup on live-exit (in-process path owns it)", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeWorkDir, "plan.json"),
    JSON.stringify({ tasks: [] }),
  );
  await fs.writeFile(path.join(claudeWorkDir, "open-questions.md"), "none");

  const jobStore = createStore("finalizer-live-exit-skip-cleanup");
  const additional = [
    { dir: path.join(tempRoot, "wt-a"), repoPath: path.join(tempRoot, "repo-a") },
  ];
  const job = createBaseJob({
    claudeWorkDir,
    additionalWorktreeDirs: additional,
  });
  jobStore.upsert(job);

  let cleanupInvocations = 0;
  await finalizeLoopFromRuntime(job, "live-exit", {
    jobStore,
    telemetry: { emit: () => {} },
    apiAuthToken: "token",
    apiBaseUrl: "http://127.0.0.1:12345",
    isProcessRunning: () => false,
    cleanupAdditionalWorktrees: async () => {
      cleanupInvocations++;
    },
  });

  assert.equal(cleanupInvocations, 0);
  const persisted = jobStore.getByLoopId("loop-1");
  assert.deepEqual(persisted?.additionalWorktreeDirs, additional);
});

test("finalizeLoopFromRuntime tolerates a throwing cleanup callback and still clears the field", async () => {
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeWorkDir, "plan.json"),
    JSON.stringify({ tasks: [] }),
  );

  const jobStore = createStore("finalizer-cleanup-throws");
  const job = createBaseJob({
    claudeWorkDir,
    status: "FAILED",
    exitCode: 1,
    additionalWorktreeDirs: [
      { dir: path.join(tempRoot, "wt-x"), repoPath: path.join(tempRoot, "repo-x") },
    ],
  });
  jobStore.upsert(job);

  await finalizeLoopFromRuntime(job, "boot-recovery", {
    jobStore,
    telemetry: { emit: () => {} },
    apiAuthToken: "token",
    apiBaseUrl: "http://127.0.0.1:12345",
    isProcessRunning: () => false,
    cleanupAdditionalWorktrees: async () => {
      throw new Error("boom");
    },
  });

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.additionalWorktreeDirs, undefined);
});

test("finalizeLoopFromRuntime retries EXECUTE finalization after a prior error on boot-recovery", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  const worktreeDir = path.join(repoDir, "worktree");
  const remoteDir = path.join(tempRoot, "remote.git");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.mkdir(worktreeDir, { recursive: true });
  await fs.mkdir(remoteDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeWorkDir, "claude-output.jsonl"),
    JSON.stringify({
      type: "assistant",
      message: {
        usage: {
          input_tokens: 12,
          output_tokens: 6,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    }) + "\n",
    "utf-8",
  );

  initGitRepoAt(worktreeDir, "feat/retry-finalization");
  execSync("git init --bare", { cwd: remoteDir, stdio: "pipe" });
  execSync(`git remote add origin ${JSON.stringify(remoteDir)}`, {
    cwd: worktreeDir,
    stdio: "pipe",
  });
  execSync("git push -u origin feat/retry-finalization", {
    cwd: worktreeDir,
    stdio: "pipe",
  });
  await fs.writeFile(path.join(worktreeDir, "feature.txt"), "changed once\n", "utf-8");

  const fakeBin = path.join(tempRoot, "fake-bin");
  const failOnceMarker = path.join(tempRoot, "git-status-failed-once");
  const realGit = execSync("which git", { encoding: "utf-8" }).trim();
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  await fs.writeFile(
    path.join(fakeBin, "gh"),
    [
      "#!/bin/sh",
      'if [ "$1" = "pr" ] && [ "$2" = "create" ]; then',
      '  echo "https://example.com/pull/123"',
      "  exit 0",
      "fi",
      'if [ "$1" = "pr" ] && [ "$2" = "edit" ]; then',
      "  exit 0",
      "fi",
      'if [ "$1" = "pr" ] && [ "$2" = "view" ]; then',
      "  exit 1",
      "fi",
      "exit 0",
    ].join("\n"),
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(fakeBin, "git"),
    [
      "#!/bin/sh",
      `FAIL_ONCE_MARKER=${JSON.stringify(failOnceMarker)}`,
      'if [ "$1" = "status" ] && [ ! -f "$FAIL_ONCE_MARKER" ]; then',
      '  touch "$FAIL_ONCE_MARKER"',
      '  echo "status failed once" >&2',
      "  exit 1",
      "fi",
      `exec ${JSON.stringify(realGit)} "$@"`,
    ].join("\n"),
    { mode: 0o755 },
  );
  process.env.PATH = `${fakeBin}:${path.dirname(realGit)}:/usr/bin:/bin`;
  resetResolvedClaudePath();
  setShellPathForTest();

  let failCloudFinalization = true;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    fetchCalls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : "",
    });
    if (failCloudFinalization) {
      return new Response("retry later", { status: 502 });
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const jobStore = createStore("finalizer-execute-retry-after-error");
  const job = createBaseJob({
    claudeWorkDir,
    worktreeDir,
    command: "EXECUTE",
    baseBranch: "main",
    webAppOrigin: "https://app.closedloop.ai",
    committer: {
      name: "Test User",
      email: "test@example.com",
    },
  });
  jobStore.upsert(job);

  await finalizeLoopFromRuntime(job, "live-exit", {
    jobStore,
    telemetry: { emit: () => {} },
    apiAuthToken: "token",
    apiBaseUrl: "http://127.0.0.1:12345",
    isProcessRunning: () => false,
    getAllowedDirectories: () => [tempRoot],
  });

  const afterLiveError = jobStore.getByLoopId("loop-1");
  assert.ok(afterLiveError);
  assert.equal(afterLiveError.executeFinalizationStatus, "error");
  assert.equal(afterLiveError.executeFinalizationPath, "git-fallback");
  assert.equal(afterLiveError.cloudFinalizedAt, undefined);

  failCloudFinalization = false;
  fetchCalls = [];

  await finalizeLoopFromRuntime(afterLiveError, "boot-recovery", {
    jobStore,
    telemetry: { emit: () => {} },
    apiAuthToken: "token",
    apiBaseUrl: "http://127.0.0.1:12345",
    isProcessRunning: () => false,
    getAllowedDirectories: () => [tempRoot],
  });

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.executeFinalizationStatus, "success");
  assert.equal(persisted.executeFinalizationPath, "git-fallback");
  assert.ok(persisted.cloudFinalizedAt);

  const uploadCall = fetchCalls.find((call) =>
    call.url.includes("/upload-artifacts"),
  );
  assert.ok(uploadCall, "expected upload-artifacts on recovery retry");
  const uploadBody = JSON.parse(uploadCall.body) as {
    metadata?: Record<string, unknown>;
    artifacts?: { executionResult?: Record<string, unknown> };
  };
  assert.equal(uploadBody.metadata?.executeFinalizationStatus, "success");
  assert.equal(
    uploadBody.artifacts?.executionResult?.pr_url,
    "https://example.com/pull/123",
  );

  const completedEventCall = fetchCalls.find((call) =>
    call.body.includes('"type":"completed"'),
  );
  assert.ok(completedEventCall, "expected completed event on recovery retry");
});
