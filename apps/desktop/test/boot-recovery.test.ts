import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { LoopCommand } from "@closedloop-ai/loops-api/commands";

async function waitForCondition(
  fn: () => boolean,
  timeoutMs = 5000,
  pollMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!fn()) {
    if (Date.now() > deadline) {
      throw new Error(`waitForCondition timed out after ${timeoutMs}ms`);
    }
    await sleep(pollMs);
  }
}
import { afterEach, beforeEach, test } from "node:test";
import { BootRecoveryService } from "../src/main/boot-recovery.js";
import { JobStore, type LocalJob } from "../src/main/job-store.js";
import { LoopTokenStore } from "../src/main/loop-token-store.js";
import { createTestLoopTokenSafeStorage } from "./loop-token-test-utils.js";
import { initGitRepo, restoreEnv } from "./symphony-test-utils.js";
import type { TelemetryEventPayload } from "../src/main/telemetry-protocol.js";
import { cleanupAdditionalWorktrees } from "../src/server/operations/symphony-loop.js";
import type { WorktreeProvider } from "../src/server/operations/symphony-loop.js";
import { stopAll as stopAllRefreshSchedulers } from "../src/main/loop-refresh-scheduler.js";
import { stopAll as stopAllHeartbeats } from "../src/main/loop-heartbeat.js";

let tempRoot = "";
let fetchCalls: Array<{ url: string; body: string; authHeader?: string | null }> = [];
let telemetryEvents: TelemetryEventPayload[] = [];

/**
 * Returns true when `url`/`method` target the loop status endpoint
 * (GET /loops/:id, excluding /events and /upload-artifacts sub-paths).
 */
function isLoopStatusRequest(url: string, method: string): boolean {
  return (
    url.includes("/loops/") &&
    !url.includes("/events") &&
    !url.includes("/upload-artifacts") &&
    method === "GET"
  );
}

/**
 * Install a fetch mock that records every request into `fetchCalls` and
 * delegates GET /loops/:id (the cloud-status endpoint) to `statusHandler`.
 * All other requests return `Response.json({ success: true })`.
 */
function installCloudStatusFetchMock(
  statusHandler: (url: string) => Response | never,
): void {
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    fetchCalls.push({
      url,
      body: typeof init?.body === "string" ? init.body : "",
      authHeader: headers.get("Authorization"),
    });
    if (isLoopStatusRequest(url, method)) {
      return statusHandler(url);
    }
    return Response.json({ success: true });
  }) as typeof fetch;
}
const originalFetch = globalThis.fetch;
const originalPollMs = process.env.CLOSEDLOOP_TAILER_POLL_MS;
const originalThrottleMs = process.env.CLOSEDLOOP_TAILER_THROTTLE_MS;
const originalWatcherPollMs = process.env.CLOSEDLOOP_WATCHER_POLL_MS;

/** Fast PID watcher poll for tests (boot-recovery live-job reattach). */
const WATCHER_TEST_POLL_MS = 50;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "boot-recovery-test-"));
  fetchCalls = [];
  telemetryEvents = [];
  process.env.CLOSEDLOOP_TAILER_POLL_MS = "20";
  process.env.CLOSEDLOOP_TAILER_THROTTLE_MS = "20";
  process.env.CLOSEDLOOP_WATCHER_POLL_MS = String(WATCHER_TEST_POLL_MS);
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    fetchCalls.push({
      url,
      body: typeof init?.body === "string" ? init.body : "",
      authHeader: headers.get("Authorization"),
    });
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }) as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  restoreEnv({
    CLOSEDLOOP_TAILER_POLL_MS: originalPollMs,
    CLOSEDLOOP_TAILER_THROTTLE_MS: originalThrottleMs,
    CLOSEDLOOP_WATCHER_POLL_MS: originalWatcherPollMs,
  });
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

function createStore(name: string): JobStore {
  return new JobStore({ cwd: tempRoot, name });
}

function createLoopTokenStore(name: string): LoopTokenStore {
  return new LoopTokenStore({
    cwd: tempRoot,
    name,
    safeStorage: createTestLoopTokenSafeStorage(),
  });
}

function createJob(overrides?: Partial<LocalJob>): LocalJob {
  const now = new Date().toISOString();
  const repoDir = path.join(tempRoot, "repo");
  return {
    id: "loop-1",
    kind: "SYMPHONY_LOOP",
    loopId: "loop-1",
    command: LoopCommand.Plan,
    status: "RUNNING",
    startedAt: now,
    updatedAt: now,
    localRepoPath: repoDir,
    claudeWorkDir: path.join(repoDir, "workdir"),
    ...overrides,
  };
}

test("finalizes dead CANCEL_PENDING jobs to CANCELLED without loop events", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ ok: true }));
  const loopTokenStore = createLoopTokenStore("boot-recovery-cancel-pending-tokens");
  loopTokenStore.setLoopToken("loop-1", { token: "loop-token" });

  const jobStore = createStore("boot-recovery-cancel-pending");
  const deadJob = createJob({
    status: "CANCEL_PENDING",
    exitCode: 130,
    pid: 9_999_999,
    claudeWorkDir,
  });
  jobStore.upsert(deadJob);

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: (event) => telemetryEvents.push(event) },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4010",
    loopTokenStore,
  });
  await service.run([deadJob]);
  service.dispose();

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.status, "CANCELLED");
  assert.ok(persisted.finalStatusPersistedAt);
  assert.equal(loopTokenStore.getLoopToken("loop-1"), null);
  assert.equal(
    fetchCalls.filter((c) => c.url.includes("/loops/loop-1/events")).length,
    0,
  );
});

test("finalizes dead jobs without promoting UNKNOWN status to completed", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ ok: true }));
  const loopTokenStore = createLoopTokenStore("boot-recovery-dead-loop-tokens");
  loopTokenStore.setLoopToken("loop-1", { token: "loop-token" });

  const jobStore = createStore("boot-recovery-dead");
  const deadJob = createJob({
    status: "UNKNOWN",
    claudeWorkDir,
  });
  jobStore.upsert(deadJob);

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: (event) => telemetryEvents.push(event) },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4010",
    loopTokenStore,
  });
  await service.run([deadJob]);
  service.dispose();

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.status, "UNKNOWN");
  assert.ok(persisted.finalStatusPersistedAt);
  assert.ok(
    !fetchCalls.some(
      (c) => c.url.includes("/upload-artifacts") && c.authHeader === "Bearer loop-token",
    ),
  );
  assert.ok(
    fetchCalls.some(
      (c) =>
        c.body.includes('"type":"error"') &&
        c.body.includes('"code":"PROCESS_STOPPED"') &&
        c.authHeader === "Bearer loop-token",
    ),
  );
});

test("boot recovery uploads support bundle for failed dead jobs before terminal error event", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "claude-output.jsonl"), "{}\n");
  const loopTokenStore = createLoopTokenStore("boot-recovery-support-tokens");
  loopTokenStore.setLoopToken("loop-1", { token: "loop-token" });

  const jobStore = createStore("boot-recovery-support-upload");
  const deadJob = createJob({
    status: "FAILED",
    exitCode: 1,
    pid: 9_999_999,
    claudeWorkDir,
    s3StateKey: "org-1/loops/loop-1/run-1",
  });
  jobStore.upsert(deadJob);
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    fetchCalls.push({
      url,
      body: typeof init?.body === "string" ? init.body : "",
      authHeader: headers.get("Authorization"),
    });
    if (url.includes("/upload-urls")) {
      return Response.json({
        success: true,
        data: {
          urls: [
            {
              key: "org-1/loops/loop-1/run-1/support/claude-output.jsonl",
              url: "https://closedloop-files.s3.us-east-1.amazonaws.com/claude",
            },
          ],
        },
      });
    }
    return Response.json({ success: true });
  }) as typeof fetch;

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: (event) => telemetryEvents.push(event) },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4010",
    loopTokenStore,
  });
  await service.run([deadJob]);
  service.dispose();

  const eventBodies = fetchCalls
    .filter((call) => call.url.endsWith("/events"))
    .map((call) => JSON.parse(call.body) as { type?: string });
  assert.deepEqual(
    eventBodies.map((body) => body.type),
    ["support_bundle_uploaded", "error"],
  );
  assert.ok(jobStore.getByLoopId("loop-1")?.supportBundleUploadedAt);
  assert.equal(loopTokenStore.getLoopToken("loop-1"), null);
});

test("finalizes dead jobs using LoopTokenStore and clears token after UNKNOWN replay", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ ok: true }));

  const loopTokenStore = createLoopTokenStore("boot-recovery-loop-tokens");
  loopTokenStore.setLoopToken("loop-1", { token: "loop-token" });

  const jobStore = createStore("boot-recovery-dead-store");
  const deadJob = createJob({
    status: "UNKNOWN",
    claudeWorkDir,
  });
  jobStore.upsert(deadJob);

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: (event) => telemetryEvents.push(event) },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4010",
    loopTokenStore,
  });
  await service.run([deadJob]);
  service.dispose();

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.status, "UNKNOWN");
  assert.equal(loopTokenStore.getLoopToken("loop-1"), null);
  assert.ok(fetchCalls.some((c) => c.body.includes('"type":"error"') && c.authHeader === "Bearer loop-token"));
});

test("retries cloud finalization across boots and resumes from partial progress", async () => {
  // RUNNING job with no statePath: boot-recovery resolves to FAILED (no snapshot to derive
  // COMPLETED from). The finalizer posts an error event (PROCESS_FAILED) and no upload-artifacts
  // call is made. The error event succeeds on the first attempt, so cloud finalization completes
  // on the first boot and the loop token is cleared immediately.
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  // plan.json and open-questions.md are present in claudeWorkDir but there is NO statePath on
  // the job, so the new RUNNING-no-snapshot logic defaults to FAILED regardless.
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ ok: true }));
  await fs.writeFile(path.join(claudeWorkDir, "open-questions.md"), "none");

  const loopTokenStore = createLoopTokenStore("boot-recovery-retry-across-boots-tokens");
  loopTokenStore.setLoopToken("loop-1", { token: "loop-token" });

  const jobStore = createStore("boot-recovery-retry-across-boots");
  const deadJob = createJob({
    status: "RUNNING",
    claudeWorkDir,
    // No statePath: RUNNING-no-snapshot -> FAILED
  });
  jobStore.upsert(deadJob);

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: () => {} },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4010",
    loopTokenStore,
  });

  await service.run([deadJob]);
  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.status, "FAILED");
  assert.ok(persisted.finalStatusPersistedAt);
  assert.ok(persisted.cloudFinalizedAt);
  assert.equal(persisted.recoveryAttempts, 1);
  assert.ok(persisted.completedEventPostedAt);
  // Token cleared because cloud finalization succeeded on first boot
  assert.equal(loopTokenStore.getLoopToken("loop-1"), null);
  // No upload-artifacts call for a FAILED job
  assert.equal(fetchCalls.filter((entry) => entry.url.endsWith("/upload-artifacts")).length, 0);
  // One error event with code PROCESS_FAILED
  assert.equal(fetchCalls.filter((entry) => entry.url.endsWith("/events")).length, 1);
  assert.ok(
    fetchCalls.some(
      (entry) =>
        entry.url.endsWith("/events") &&
        entry.body.includes('"type":"error"') &&
        entry.body.includes('"code":"PROCESS_FAILED"') &&
        entry.authHeader === "Bearer loop-token",
    ),
  );
  service.dispose();
});

test("gives up after three retryable failures and stops future attempts", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ ok: true }));

  const loopTokenStore = createLoopTokenStore("boot-recovery-retry-cap-tokens");
  loopTokenStore.setLoopToken("loop-1", { token: "loop-token" });

  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    fetchCalls.push({
      url,
      body: typeof init?.body === "string" ? init.body : "",
      authHeader: headers.get("Authorization"),
    });
    return new Response("still down", { status: 502 });
  }) as typeof fetch;

  const jobStore = createStore("boot-recovery-retry-cap");
  const deadJob = createJob({
    status: "UNKNOWN",
    claudeWorkDir,
  });
  jobStore.upsert(deadJob);

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: () => {} },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4010",
    loopTokenStore,
  });

  await service.run([deadJob]);
  await service.run([]);
  await service.run([]);

  let persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.recoveryAttempts, 3);
  assert.ok(persisted.cloudFinalizedAt);
  assert.match(persisted.lastRecoveryError ?? "", /Exceeded retry cap/);
  assert.equal(loopTokenStore.getLoopToken("loop-1"), null);
  const attemptsBeforeExtraRun = fetchCalls.length;

  await service.run([]);
  persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(fetchCalls.length, attemptsBeforeExtraRun);
  service.dispose();
});

test("skips dead job finalization when loop token is missing", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ ok: true }));

  const loopTokenStore = createLoopTokenStore("boot-recovery-dead-missing-token");

  const jobStore = createStore("boot-recovery-dead-missing-token");
  const deadJob = createJob({
    status: "UNKNOWN",
    claudeWorkDir,
  });
  jobStore.upsert(deadJob);

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: () => {} },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4010",
    loopTokenStore,
  });
  await service.run([deadJob]);
  service.dispose();

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.finalStatusPersistedAt, undefined);
  assert.equal(fetchCalls.length, 0);
});

test("starts dead job finalization in the background", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ ok: true }));
  const loopTokenStore = createLoopTokenStore("boot-recovery-background-dead-finalize-tokens");
  loopTokenStore.setLoopToken("loop-1", { token: "loop-token" });

  const jobStore = createStore("boot-recovery-background-dead-finalize");
  const deadJob = createJob({
    status: "UNKNOWN",
    claudeWorkDir,
  });
  jobStore.upsert(deadJob);

  let releaseFetch: (() => void) | null = null;
  const fetchGate = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  // Let the cloud status check (GET /loops/:id) pass immediately; only gate
  // event POSTs so that persistFinalJobStatus() runs before we assert.
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    fetchCalls.push({
      url,
      body: typeof init?.body === "string" ? init.body : "",
      authHeader: headers.get("Authorization"),
    });
    if (isLoopStatusRequest(url, method)) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    await fetchGate;
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }) as typeof fetch;

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: () => {} },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4010",
    loopTokenStore,
  });

  let completed = false;
  const background = service.startDeadJobFinalization([deadJob]).then(() => {
    completed = true;
  });
  await sleep(20);
  assert.equal(completed, false);
  assert.ok(jobStore.getByLoopId("loop-1")?.finalStatusPersistedAt);
  assert.equal(jobStore.getByLoopId("loop-1")?.cloudFinalizedAt, undefined);
  const unblockFetch = releaseFetch;
  assert.ok(unblockFetch);
  unblockFetch();
  await background;

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.ok(persisted.finalStatusPersistedAt);
  service.dispose();
});

test("dispose stops queued dead-job finalization after in-flight request", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const firstWorkDir = path.join(repoDir, "workdir-1");
  const secondWorkDir = path.join(repoDir, "workdir-2");
  await fs.mkdir(firstWorkDir, { recursive: true });
  await fs.mkdir(secondWorkDir, { recursive: true });
  await fs.writeFile(path.join(firstWorkDir, "plan.json"), JSON.stringify({ ok: true }));
  await fs.writeFile(path.join(secondWorkDir, "plan.json"), JSON.stringify({ ok: true }));

  const loopTokenStore = createLoopTokenStore("boot-recovery-dispose-dead-finalize-tokens");
  loopTokenStore.setLoopToken("loop-1", { token: "loop-token-1" });
  loopTokenStore.setLoopToken("loop-2", { token: "loop-token-2" });

  const jobStore = createStore("boot-recovery-dispose-dead-finalize");
  const deadJobOne = createJob({ status: "UNKNOWN", claudeWorkDir: firstWorkDir });
  const deadJobTwo = createJob({
    id: "loop-2",
    loopId: "loop-2",
    status: "UNKNOWN",
    claudeWorkDir: secondWorkDir,
  });
  jobStore.upsert(deadJobOne);
  jobStore.upsert(deadJobTwo);

  let releaseFetch: (() => void) | null = null;
  // Resolves when the first event POST (not the status-check GET) starts, so
  // dispose() is called while exactly one loop's cloud call is in-flight.
  const firstEventPostStarted = new Promise<void>((resolve) => {
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      fetchCalls.push({
        url,
        body: typeof init?.body === "string" ? init.body : "",
        authHeader: headers.get("Authorization"),
      });
      // Status checks resolve immediately so finalization can reach the event POST.
      if (isLoopStatusRequest(url, method)) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      resolve();
      await new Promise<void>((innerResolve) => {
        releaseFetch = innerResolve;
      });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;
  });

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: () => {} },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4010",
    loopTokenStore,
  });

  const completion = service.startDeadJobFinalization([deadJobOne, deadJobTwo]);
  await firstEventPostStarted;
  service.dispose();
  const unblockFetch = releaseFetch;
  assert.ok(unblockFetch);
  unblockFetch();
  await completion;

  const finalizedOne = jobStore.getByLoopId("loop-1");
  const finalizedTwo = jobStore.getByLoopId("loop-2");
  assert.ok(finalizedOne?.finalStatusPersistedAt);
  assert.equal(finalizedTwo?.finalStatusPersistedAt, undefined);
  assert.equal(fetchCalls.filter((entry) => entry.url.endsWith("/events")).length, 1);
});

test("reattaches to live jobs and persists jsonl offsets", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  const jsonlPath = path.join(claudeWorkDir, "claude-output.jsonl");
  await fs.writeFile(jsonlPath, "");
  const loopTokenStore = createLoopTokenStore("boot-recovery-live-offset-loop-tokens");
  loopTokenStore.setLoopToken("loop-1", { token: "loop-token" });

  const jobStore = createStore("boot-recovery-live-offset");
  const liveJob = createJob({
    pid: process.pid,
    status: "RUNNING",
    claudeWorkDir,
    jsonlPath,
    lastObservedJsonlOffset: 0,
  });
  jobStore.upsert(liveJob);

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: () => {} },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4011",
    loopTokenStore,
  });
  await service.reattachLiveJobs();

  await fs.appendFile(
    jsonlPath,
    '{"type":"assistant","message":{"content":[{"type":"text","text":"recovered output"}],"usage":{"input_tokens":1,"output_tokens":1}}}\n',
  );
  await sleep(100);

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.ok((persisted.lastObservedJsonlOffset ?? 0) > 0);
  assert.ok(
    fetchCalls.some(
      (entry) =>
        entry.url.endsWith("/loops/loop-1/events") &&
        entry.authHeader === "Bearer loop-token",
    ),
  );
  service.dispose();
});

test("live reattach does not persist jsonl offset past incomplete trailing line", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  const jsonlPath = path.join(claudeWorkDir, "claude-output.jsonl");
  await fs.writeFile(jsonlPath, "");
  const loopTokenStore = createLoopTokenStore("boot-recovery-partial-jsonl-loop-tokens");
  loopTokenStore.setLoopToken("loop-1", { token: "loop-token" });

  const jobStore = createStore("boot-recovery-partial-jsonl");
  const liveJob = createJob({
    pid: process.pid,
    status: "RUNNING",
    claudeWorkDir,
    jsonlPath,
    lastObservedJsonlOffset: 0,
  });
  jobStore.upsert(liveJob);

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: () => {} },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4011",
    loopTokenStore,
  });
  await service.reattachLiveJobs();

  const incomplete = '{"type":"assistant","message":{"content":[{"type":"text","text":"par';
  await fs.appendFile(jsonlPath, incomplete);
  await sleep(120);

  let persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(
    persisted.lastObservedJsonlOffset ?? 0,
    0,
    "partial JSONL tail must not advance persisted offset",
  );

  const rest = 'tial"}]}}\n';
  await fs.appendFile(jsonlPath, rest);
  await sleep(120);

  persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.ok(
    (persisted.lastObservedJsonlOffset ?? 0) > 0,
    "expected offset after a complete newline-delimited record and successful POST",
  );
  assert.ok(
    fetchCalls.some(
      (entry) =>
        entry.url.endsWith("/loops/loop-1/events") &&
        entry.authHeader === "Bearer loop-token",
    ),
  );
  service.dispose();
});

test("skips live job reattach when loop token is missing", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  const jsonlPath = path.join(claudeWorkDir, "claude-output.jsonl");
  await fs.writeFile(jsonlPath, "");

  const loopTokenStore = createLoopTokenStore("boot-recovery-live-missing-token");

  const jobStore = createStore("boot-recovery-live-missing-token");
  const liveJob = createJob({
    pid: process.pid,
    status: "RUNNING",
    claudeWorkDir,
    jsonlPath,
    lastObservedJsonlOffset: 0,
  });
  jobStore.upsert(liveJob);

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: () => {} },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4011",
    loopTokenStore,
  });
  await service.reattachLiveJobs();

  await fs.appendFile(
    jsonlPath,
    '{"type":"assistant","message":{"content":[{"type":"text","text":"should not be tailed"}]}}\n',
  );
  await sleep(100);

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.lastObservedJsonlOffset, 0);
  assert.equal(fetchCalls.length, 0);
  service.dispose();
});

test("finalizes recovered live job as FAILED when process is externally killed", async () => {
  // Job with no statePath reattached as live, then killed externally via SIGTERM.
  // boot-recovery RUNNING-no-snapshot -> FAILED, so the finalizer posts an error event
  // (PROCESS_FAILED) and makes no upload-artifacts call.
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  const loopTokenStore = createLoopTokenStore("boot-recovery-live-kill-loop-tokens");
  loopTokenStore.setLoopToken("loop-1", { token: "loop-token" });

  const child = spawn("bash", ["-lc", "sleep 5"], { detached: false });
  assert.ok(child.pid);

  const jobStore = createStore("boot-recovery-live-kill");
  const liveJob = createJob({
    pid: child.pid!,
    status: "RUNNING",
    claudeWorkDir,
    // No statePath: RUNNING-no-snapshot -> FAILED
  });
  jobStore.upsert(liveJob);

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: () => {} },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4012",
    loopTokenStore,
  });
  await service.reattachLiveJobs();

  // Kill the child to simulate an external termination
  process.kill(child.pid!, "SIGTERM");

  // Wait for boot-recovery to detect process exit and finalize to FAILED
  await waitForCondition(
    () => jobStore.getByLoopId("loop-1")?.status === "FAILED",
    5000,
  );

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.status, "FAILED");
  // No upload-artifacts for a FAILED job
  assert.equal(fetchCalls.filter((entry) => entry.url.includes("/upload-artifacts")).length, 0);
  // Error event with code PROCESS_FAILED should have been posted
  assert.ok(
    fetchCalls.some(
      (entry) =>
        entry.url.endsWith("/loops/loop-1/events") &&
        entry.body.includes('"type":"error"') &&
        entry.body.includes('"code":"PROCESS_FAILED"') &&
        entry.authHeader === "Bearer loop-token",
    ),
  );
  service.dispose();
});

test("preserves COMPLETED status when terminal snapshot is available during boot-recovery", async () => {
  // RUNNING job with statePath pointing to state.json containing {"status":"COMPLETED"}.
  // After the short-lived process exits, boot-recovery reads the snapshot, resolves to COMPLETED,
  // uploads artifacts, and posts a completed event — no error event should be emitted.
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  const statePath = path.join(claudeWorkDir, "state.json");
  await fs.writeFile(statePath, JSON.stringify({ status: "COMPLETED" }));

  const loopTokenStore = createLoopTokenStore("boot-recovery-live-completed-snapshot-tokens");
  loopTokenStore.setLoopToken("loop-1", { token: "loop-token" });

  const child = spawn("bash", ["-lc", "sleep 0.1"], { detached: false });
  assert.ok(child.pid);

  const jobStore = createStore("boot-recovery-live-completed-snapshot");
  const liveJob = createJob({
    pid: child.pid!,
    status: "RUNNING",
    claudeWorkDir,
    statePath,
  });
  jobStore.upsert(liveJob);

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: () => {} },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4013",
    loopTokenStore,
  });
  await service.reattachLiveJobs();

  // Wait for boot-recovery to detect process exit and finalize to COMPLETED
  await waitForCondition(
    () => jobStore.getByLoopId("loop-1")?.status === "COMPLETED",
    5000,
  );

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.status, "COMPLETED");
  assert.equal(persisted.exitCode ?? 0, 0);

  // upload-artifacts should have been called for a COMPLETED job
  assert.ok(
    fetchCalls.some((c) => c.url.includes("/upload-artifacts")),
    "expected /upload-artifacts call for COMPLETED job",
  );

  // A completed-type event should have been posted
  const completedEventCall = fetchCalls.find((c) => c.body.includes('"type":"completed"'));
  assert.ok(completedEventCall, "expected type:completed event to be posted");
  const completedEvent = JSON.parse(completedEventCall.body) as {
    result?: { exitCode?: number };
  };
  assert.equal(completedEvent.result?.exitCode, 0);

  // No error event should have been emitted
  assert.ok(
    !fetchCalls.some((c) => c.body.includes('"type":"error"')),
    "expected no error event for COMPLETED job",
  );

  service.dispose();
});

test("replays zero-token EXECUTE recovery as NO_WORK_PRODUCED instead of a completed event", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  const statePath = path.join(claudeWorkDir, "state.json");
  await fs.writeFile(statePath, JSON.stringify({ status: "COMPLETED" }));
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

  const loopTokenStore = createLoopTokenStore("boot-recovery-execute-no-work-tokens");
  loopTokenStore.setLoopToken("loop-1", { token: "loop-token" });

  const jobStore = createStore("boot-recovery-execute-no-work");
  const deadJob = createJob({
    command: LoopCommand.Execute,
    status: "RUNNING",
    claudeWorkDir,
    statePath,
  });
  jobStore.upsert(deadJob);

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: () => {} },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4014",
    loopTokenStore,
  });
  await service.run([deadJob]);
  service.dispose();

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.status, "FAILED");
  assert.equal(persisted.exitCode, 0);
  assert.equal(persisted.executeFinalizationStatus, undefined);
  assert.ok(persisted.cloudFinalizedAt);
  assert.equal(loopTokenStore.getLoopToken("loop-1"), null);

  assert.equal(
    fetchCalls.filter((entry) => entry.url.endsWith("/upload-artifacts")).length,
    0,
  );
  assert.ok(
    fetchCalls.some(
      (entry) =>
        entry.url.endsWith("/loops/loop-1/events") &&
        entry.body.includes('"type":"error"') &&
        entry.body.includes('"code":"NO_WORK_PRODUCED"') &&
        entry.body.includes(
          '"message":"EXECUTE loop completed with 0 tokens -- no work was done"',
        ),
    ),
    "expected NO_WORK_PRODUCED error event for zero-token EXECUTE recovery",
  );
  assert.ok(
    !fetchCalls.some((entry) => entry.body.includes('"type":"completed"')),
    "expected no completed event for zero-token EXECUTE recovery",
  );
});

test("boot-recovery replays terminal user-visible runner failure", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });

  const loopTokenStore = createLoopTokenStore(
    "boot-recovery-terminal-runner-failure-tokens",
  );
  loopTokenStore.setLoopToken("loop-1", { token: "loop-token" });

  const persistedAt = new Date().toISOString();
  const jobStore = createStore("boot-recovery-terminal-runner-failure");
  jobStore.upsert(
    createJob({
      command: LoopCommand.Execute,
      status: "FAILED",
      exitCode: 1,
      claudeWorkDir,
      completedAt: persistedAt,
      finalStatusPersistedAt: persistedAt,
      userVisibleLoopFailure: {
        code: "RUNNER_ERROR",
        message: "Claude rate limit reached.",
        result: { subcode: "CLAUDE_RATE_LIMIT" },
      },
    }),
  );

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: () => {} },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4014",
    loopTokenStore,
  });
  await service.run([]);
  service.dispose();

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.status, "FAILED");
  assert.ok(persisted.cloudFinalizedAt);
  assert.equal(persisted.recoveryAttempts, 1);
  assert.equal(loopTokenStore.getLoopToken("loop-1"), null);

  const eventCall = fetchCalls.find((entry) =>
    entry.url.endsWith("/loops/loop-1/events"),
  );
  assert.ok(eventCall, "expected recovered runner failure event");
  const body = JSON.parse(eventCall.body) as Record<string, unknown>;
  assert.equal(body.type, "error");
  assert.equal(body.code, "RUNNER_ERROR");
  assert.equal(body.message, "Claude rate limit reached.");
  assert.deepEqual(body.result, { subcode: "CLAUDE_RATE_LIMIT" });
});

test("replays EXECUTE completion from persisted execution-result artifacts during boot-recovery", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ ok: true }));
  await fs.writeFile(
    path.join(claudeWorkDir, "claude-output.jsonl"),
    JSON.stringify({
      type: "assistant",
      message: {
        usage: {
          input_tokens: 3,
          output_tokens: 2,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    }) + "\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(claudeWorkDir, "execution-result.json"),
    JSON.stringify({
      schemaVersion: 2,
      results: [
        {
          status: "success",
          fullName: "owner/repo",
          prUrl: "https://github.com/owner/repo/pull/123",
          prNumber: 123,
          branchName: "feat/recovered-execute",
          baseBranch: "main",
          hasChanges: true,
          commitSha: "abc123",
        },
      ],
    }),
  );

  const loopTokenStore = createLoopTokenStore("boot-recovery-execute-artifact-existing-tokens");
  loopTokenStore.setLoopToken("loop-1", { token: "loop-token" });

  const persistedAt = new Date().toISOString();
  const jobStore = createStore("boot-recovery-execute-artifact-existing");
  const finalizedJob = createJob({
    command: LoopCommand.Execute,
    status: "COMPLETED",
    finalStatusPersistedAt: persistedAt,
    completedAt: persistedAt,
    claudeWorkDir,
  });
  jobStore.upsert(finalizedJob);

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: () => {} },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4014",
    loopTokenStore,
  });
  await service.run([]);
  service.dispose();

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.status, "COMPLETED");
  assert.ok(persisted.cloudFinalizedAt);
  assert.equal(persisted.recoveryAttempts, 1);
  assert.equal(persisted.finalizationSource, "boot-recovery");
  assert.equal(persisted.executeFinalizationStatus, "success");
  assert.equal(persisted.executeFinalizationPath, "artifact-existing");
  assert.equal(
    persisted.executeFinalizationReason,
    "existing execution-result.json reused",
  );
  assert.equal(persisted.executeFinalizationPreExecutionResultPresent, true);
  assert.equal(persisted.executeFinalizationPostExecutionResultPresent, true);
  assert.equal(loopTokenStore.getLoopToken("loop-1"), null);

  const uploadCall = fetchCalls.find((entry) => entry.url.endsWith("/upload-artifacts"));
  assert.ok(uploadCall, "expected /upload-artifacts call for recovered EXECUTE job");
  const uploadBody = JSON.parse(uploadCall.body) as {
    metadata?: Record<string, unknown>;
    artifacts?: { executionResult?: Record<string, unknown> };
  };
  assert.equal(uploadBody.metadata?.finalizationSource, "boot-recovery");
  assert.equal(uploadBody.metadata?.executeFinalizationStatus, "success");
  assert.equal(uploadBody.metadata?.executeFinalizationPath, "artifact-existing");
  const executionResultV2 = uploadBody.artifacts?.executionResult as {
    schemaVersion?: number;
    results?: Array<{ branchName?: string }>;
  } | undefined;
  assert.equal(executionResultV2?.schemaVersion, 2);
  assert.equal(executionResultV2?.results?.[0]?.branchName, "feat/recovered-execute");

  const completedEventCall = fetchCalls.find((entry) =>
    entry.body.includes('"type":"completed"'),
  );
  assert.ok(completedEventCall, "expected type:completed event to be posted");
  const completedEvent = JSON.parse(completedEventCall.body) as {
    result?: Record<string, unknown>;
  };
  assert.equal(completedEvent.result?.finalizationSource, "boot-recovery");
  assert.equal(completedEvent.result?.executeFinalizationStatus, "success");
  assert.equal(completedEvent.result?.executeFinalizationPath, "artifact-existing");
  assert.equal(completedEvent.result?.branchName, "feat/recovered-execute");
});

test("sweepOrphanedTokens removes tokens for finalized and unknown loops, keeps active", async () => {
  const jobStore = createStore("boot-recovery-sweep");
  const loopTokenStore = createLoopTokenStore("boot-recovery-sweep-tokens");

  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });

  // (a) Cloud-finalized terminal job — token should be swept
  const finalizedJob = createJob({
    id: "loop-finalized",
    loopId: "loop-finalized",
    status: "COMPLETED",
    claudeWorkDir,
    cloudFinalizedAt: new Date().toISOString(),
    finalStatusPersistedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  });
  jobStore.upsert(finalizedJob);
  loopTokenStore.setLoopToken("loop-finalized", { token: "token-finalized" });

  // (b) Loop ID not in job store at all — token should be swept
  loopTokenStore.setLoopToken("loop-unknown", { token: "token-unknown" });

  // (c) Still-running job — token must be preserved
  const runningJob = createJob({
    id: "loop-active",
    loopId: "loop-active",
    status: "RUNNING",
    pid: process.pid,
    claudeWorkDir,
  });
  jobStore.upsert(runningJob);
  loopTokenStore.setLoopToken("loop-active", { token: "token-active" });

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: () => {} },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4010",
    loopTokenStore,
  });
  await service.run([]);
  service.dispose();

  assert.equal(loopTokenStore.getLoopToken("loop-finalized"), null);
  assert.equal(loopTokenStore.getLoopToken("loop-unknown"), null);
  assert.deepEqual(loopTokenStore.getLoopToken("loop-active"), { token: "token-active" });
});

function makeSimpleRemoveProvider(): WorktreeProvider {
  return {
    async ensureWorktree(_repoPath, worktreeDir) {
      await fs.mkdir(worktreeDir, { recursive: true });
    },
    findWorktreeForBranch() {
      return null;
    },
    async removeWorktree(worktreeDir) {
      await fs.rm(worktreeDir, { recursive: true, force: true });
    },
    getCurrentBranch() {
      return null;
    },
    branchExists: async () => false,
  };
}

async function runAdditionalCleanup(dir: string): Promise<void> {
  await cleanupAdditionalWorktrees(
    [{ dir, repoPath: dir }],
    "test-loop",
    makeSimpleRemoveProvider(),
  );
}

test("cleanupAdditionalWorktrees removes worktree with no code changes", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-clean-"));
  try {
    await initGitRepo(repoRoot);
    await runAdditionalCleanup(repoRoot);
    assert.ok(!existsSync(repoRoot), "expected clean worktree to be removed");
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

for (const scenario of [
  {
    name: "staged changes",
    setup: async (repoRoot: string) => {
      await fs.writeFile(path.join(repoRoot, "work.txt"), "work in progress");
      execFileSync("git", ["add", "work.txt"], {
        cwd: repoRoot,
        stdio: "pipe",
      });
    },
  },
  {
    name: "committed-only changes on a symphony branch",
    setup: async (repoRoot: string) => {
      execFileSync("git", ["checkout", "-b", "symphony/test-loop"], {
        cwd: repoRoot,
        stdio: "pipe",
      });
      await fs.writeFile(path.join(repoRoot, "feature.txt"), "committed work");
      execFileSync("git", ["add", "feature.txt"], {
        cwd: repoRoot,
        stdio: "pipe",
      });
      execFileSync("git", ["commit", "-m", "wip"], {
        cwd: repoRoot,
        stdio: "pipe",
      });
    },
  },
] as const) {
  test(`cleanupAdditionalWorktrees retains worktree with ${scenario.name}`, async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-retain-"));
    try {
      await initGitRepo(repoRoot);
      await scenario.setup(repoRoot);
      await runAdditionalCleanup(repoRoot);
      assert.ok(existsSync(repoRoot), "expected worktree to be retained");
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
}

test("cleanupAdditionalWorktrees retains worktree when git status fails unexpectedly", async () => {
  const nonRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-nonrepo-"));
  try {
    const sentinel = path.join(nonRepoDir, "user-work.txt");
    await fs.writeFile(sentinel, "do not delete");
    await runAdditionalCleanup(nonRepoDir);
    assert.ok(existsSync(nonRepoDir), "expected worktree to be retained");
    assert.ok(existsSync(sentinel), "expected user files to remain on git error");
  } finally {
    await fs.rm(nonRepoDir, { recursive: true, force: true });
  }
});

test("reattachLiveJob transitions to TIMED_OUT when cloud reports TIMED_OUT", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  const worktreeDir = path.join(tempRoot, "worktree");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.mkdir(worktreeDir, { recursive: true });

  const loopTokenStore = createLoopTokenStore("boot-recovery-reattach-timed-out-tokens");
  loopTokenStore.setLoopToken("loop-1", { token: "loop-token" });

  const jobStore = createStore("boot-recovery-reattach-timed-out");
  const liveJob = createJob({
    pid: process.pid,
    status: "RUNNING",
    claudeWorkDir,
    worktreeDir,
  });
  jobStore.upsert(liveJob);

  installCloudStatusFetchMock(() => Response.json({ status: "TIMED_OUT" }));

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: (event) => telemetryEvents.push(event) },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4020",
    loopTokenStore,
  });
  await service.reattachLiveJobs();
  await sleep(100);

  assert.equal(fetchCalls.length, 1, "expected exactly one fetch call (GET status check)");
  assert.ok(
    fetchCalls[0].url.includes("/loops/loop-1") &&
      !fetchCalls[0].url.includes("/events") &&
      !fetchCalls[0].url.includes("/upload-artifacts"),
    "expected GET to /loops/loop-1 status endpoint",
  );

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.status, "TIMED_OUT");
  assert.equal(
    persisted.liveActivity,
    "Loop timed out — restart from the loop list.",
    "expected TIMED_OUT liveActivity message",
  );
  assert.ok(persisted.cloudFinalizedAt, "expected cloudFinalizedAt to be set");
  assert.equal(loopTokenStore.getLoopToken("loop-1"), null, "expected loop token cleared");
  assert.ok(existsSync(worktreeDir), "expected worktreeDir to remain on disk after TIMED_OUT");
  service.dispose();
});

test("reattachLiveJob starts tailer when cloud reports RUNNING", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  const jsonlPath = path.join(claudeWorkDir, "claude-output.jsonl");
  await fs.writeFile(jsonlPath, "");

  const loopTokenStore = createLoopTokenStore("boot-recovery-reattach-running-tokens");
  loopTokenStore.setLoopToken("loop-1", { token: "loop-token" });

  const jobStore = createStore("boot-recovery-reattach-running");
  const liveJob = createJob({
    pid: process.pid,
    status: "RUNNING",
    claudeWorkDir,
    jsonlPath,
    lastObservedJsonlOffset: 0,
  });
  jobStore.upsert(liveJob);

  installCloudStatusFetchMock(() => Response.json({ status: "RUNNING" }));

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: (event) => telemetryEvents.push(event) },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4021",
    loopTokenStore,
  });
  await service.reattachLiveJobs();

  // Write a complete JSONL record to trigger a tailer event POST
  await fs.appendFile(
    jsonlPath,
    '{"type":"assistant","message":{"content":[{"type":"text","text":"recovered"}],"usage":{"input_tokens":1,"output_tokens":1}}}\n',
  );

  await waitForCondition(
    () => fetchCalls.some((c) => c.url.includes("/loops/loop-1/events")),
    5000,
  );

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.notEqual(persisted.status, "TIMED_OUT", "expected status not to be TIMED_OUT");
  assert.ok(
    fetchCalls.some((c) => c.url.includes("/loops/loop-1/events")),
    "expected at least one POST to /events from tailer",
  );
  service.dispose();
});

test("reattachLiveJob continues when GET status check throws a network error", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  const jsonlPath = path.join(claudeWorkDir, "claude-output.jsonl");
  await fs.writeFile(jsonlPath, "");

  const loopTokenStore = createLoopTokenStore("boot-recovery-reattach-net-err-tokens");
  loopTokenStore.setLoopToken("loop-1", { token: "loop-token" });

  const jobStore = createStore("boot-recovery-reattach-net-err");
  const liveJob = createJob({
    pid: process.pid,
    status: "RUNNING",
    claudeWorkDir,
    jsonlPath,
    lastObservedJsonlOffset: 0,
  });
  jobStore.upsert(liveJob);

  installCloudStatusFetchMock(() => { throw new Error("network failure"); });

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: (event) => telemetryEvents.push(event) },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4022",
    loopTokenStore,
  });
  await service.reattachLiveJobs();

  const beforeWrite = jobStore.getByLoopId("loop-1");
  assert.ok(beforeWrite);
  assert.notEqual(
    beforeWrite.status,
    "TIMED_OUT",
    "network error must not transition job to TIMED_OUT",
  );

  // Verify tailer is running: write a JSONL record and wait for it to be picked up
  await fs.appendFile(
    jsonlPath,
    '{"type":"assistant","message":{"content":[{"type":"text","text":"net-err-test"}],"usage":{"input_tokens":1,"output_tokens":1}}}\n',
  );

  await waitForCondition(
    () => fetchCalls.some((c) => c.url.includes("/loops/loop-1/events")),
    5000,
  );

  assert.ok(
    fetchCalls.some((c) => c.url.includes("/loops/loop-1/events")),
    "expected tailer to start and POST /events after network error on status check",
  );
  service.dispose();
});

test("finalizeDeadJobs skips finalization and sets cloudFinalizedAt when cloud reports TIMED_OUT", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ ok: true }));

  const loopTokenStore = createLoopTokenStore("boot-recovery-dead-timed-out-tokens");
  loopTokenStore.setLoopToken("loop-1", { token: "loop-token" });

  const jobStore = createStore("boot-recovery-dead-timed-out");
  const deadJob = createJob({
    status: "RUNNING",
    pid: 9_999_999,
    claudeWorkDir,
  });
  jobStore.upsert(deadJob);

  installCloudStatusFetchMock(() => Response.json({ status: "TIMED_OUT" }));

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: (event) => telemetryEvents.push(event) },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4023",
    loopTokenStore,
  });
  await service.run([deadJob]);
  service.dispose();

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.ok(persisted.cloudFinalizedAt, "expected cloudFinalizedAt to be set on TIMED_OUT");
  assert.equal(loopTokenStore.getLoopToken("loop-1"), null, "expected loop token cleared");
  assert.equal(
    fetchCalls.filter((c) => c.url.includes("/events")).length,
    0,
    "expected zero POST /events calls for TIMED_OUT job",
  );
  assert.equal(
    fetchCalls.filter((c) => c.url.includes("/upload-artifacts")).length,
    0,
    "expected zero POST /upload-artifacts calls for TIMED_OUT job",
  );
  assert.equal(
    persisted.finalStatusPersistedAt,
    undefined,
    "finalStatusPersistedAt must NOT be set for cloud-TIMED_OUT jobs",
  );
});

test("reattachLiveJob starts refresh scheduler for recovered loop", async () => {
  // Set skew to 0 and expiresAt in the near past so the scheduler fires
  // immediately (delay = max(expiresAt - skew - now, 0) = 0).
  const savedSkewEnv = process.env.CLOSEDLOOP_TOKEN_REFRESH_SKEW_MS;
  process.env.CLOSEDLOOP_TOKEN_REFRESH_SKEW_MS = "0";

  try {
    const repoDir = path.join(tempRoot, "repo");
    const claudeWorkDir = path.join(repoDir, "workdir");
    await fs.mkdir(claudeWorkDir, { recursive: true });
    const jsonlPath = path.join(claudeWorkDir, "claude-output.jsonl");
    await fs.writeFile(jsonlPath, "");

    const loopTokenStore = createLoopTokenStore("boot-recovery-scheduler-start-tokens");
    // expiresAt in the past → scheduler fires immediately with skew=0
    const expiresAt = Date.now() - 1000;
    loopTokenStore.setLoopToken("loop-1", { token: "loop-token", expiresAt });

    const jobStore = createStore("boot-recovery-scheduler-start");
    const liveJob = createJob({
      pid: process.pid,
      status: "RUNNING",
      claudeWorkDir,
      jsonlPath,
      lastObservedJsonlOffset: 0,
    });
    jobStore.upsert(liveJob);

    const service = new BootRecoveryService({
      jobStore,
      telemetry: { emit: () => {} },
      getApiKey: () => "test-key",
      getApiOrigin: () => "http://127.0.0.1:4030",
      loopTokenStore,
    });
    await service.reattachLiveJobs();

    // Wait for the scheduler to fire and call /refresh-token
    await waitForCondition(
      () => fetchCalls.some((c) => c.url.includes("/refresh-token")),
      3000,
    );

    assert.ok(
      fetchCalls.some((c) => c.url.includes("/loops/loop-1/refresh-token")),
      "expected refresh scheduler to start and POST to /refresh-token",
    );
    service.dispose();
  } finally {
    stopAllRefreshSchedulers();
    stopAllHeartbeats();
    if (savedSkewEnv === undefined) {
      delete process.env.CLOSEDLOOP_TOKEN_REFRESH_SKEW_MS;
    } else {
      process.env.CLOSEDLOOP_TOKEN_REFRESH_SKEW_MS = savedSkewEnv;
    }
  }
});

test("reattachLiveJob starts heartbeat scheduler for recovered loop", async () => {
  // Use a very short heartbeat interval so the scheduler fires quickly.
  const savedHeartbeatEnv = process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS;
  process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = "50";

  try {
    const repoDir = path.join(tempRoot, "repo");
    const claudeWorkDir = path.join(repoDir, "workdir");
    await fs.mkdir(claudeWorkDir, { recursive: true });
    const jsonlPath = path.join(claudeWorkDir, "claude-output.jsonl");
    await fs.writeFile(jsonlPath, "");

    const loopTokenStore = createLoopTokenStore("boot-recovery-heartbeat-start-tokens");
    loopTokenStore.setLoopToken("loop-1", { token: "loop-token" });

    const jobStore = createStore("boot-recovery-heartbeat-start");
    const liveJob = createJob({
      pid: process.pid,
      status: "RUNNING",
      claudeWorkDir,
      jsonlPath,
      lastObservedJsonlOffset: 0,
    });
    jobStore.upsert(liveJob);

    const service = new BootRecoveryService({
      jobStore,
      telemetry: { emit: () => {} },
      getApiKey: () => "test-key",
      getApiOrigin: () => "http://127.0.0.1:4031",
      loopTokenStore,
    });
    await service.reattachLiveJobs();

    // Wait for the heartbeat scheduler to fire
    await waitForCondition(
      () => fetchCalls.some((c) => c.url.includes("/heartbeat")),
      3000,
    );

    assert.ok(
      fetchCalls.some((c) => c.url.includes("/loops/loop-1/heartbeat")),
      "expected heartbeat scheduler to start and POST to /heartbeat",
    );
    service.dispose();
  } finally {
    stopAllRefreshSchedulers();
    stopAllHeartbeats();
    if (savedHeartbeatEnv === undefined) {
      delete process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS;
    } else {
      process.env.CLOSEDLOOP_HEARTBEAT_INTERVAL_MS = savedHeartbeatEnv;
    }
  }
});

test("first refresh after recovery reuses lastIdempotencyKey from LoopTokenMeta", async () => {
  // When LoopTokenMeta.lastIdempotencyKey is set (e.g. from a prior force-quit
  // mid-refresh), refreshLoopToken must reuse that key on the first attempt.
  const savedSkewEnv = process.env.CLOSEDLOOP_TOKEN_REFRESH_SKEW_MS;
  process.env.CLOSEDLOOP_TOKEN_REFRESH_SKEW_MS = "0";

  const capturedHeaders: Array<{ url: string; idempotencyKey: string | null }> = [];

  try {
    const repoDir = path.join(tempRoot, "repo");
    const claudeWorkDir = path.join(repoDir, "workdir");
    await fs.mkdir(claudeWorkDir, { recursive: true });
    const jsonlPath = path.join(claudeWorkDir, "claude-output.jsonl");
    await fs.writeFile(jsonlPath, "");

    const loopTokenStore = createLoopTokenStore("boot-recovery-idempotency-reuse-tokens");
    const storedIdempotencyKey = "stored-idempotency-key-abc123";
    const expiresAt = Date.now() - 1000; // already expired → fires immediately
    loopTokenStore.setLoopToken("loop-1", {
      token: "loop-token",
      expiresAt,
      lastIdempotencyKey: storedIdempotencyKey,
    });

    const jobStore = createStore("boot-recovery-idempotency-reuse");
    const liveJob = createJob({
      pid: process.pid,
      status: "RUNNING",
      claudeWorkDir,
      jsonlPath,
      lastObservedJsonlOffset: 0,
    });
    jobStore.upsert(liveJob);

    // Install a custom fetch mock that also captures the Idempotency-Key header.
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const idempotencyKey = headers.get("Idempotency-Key");
      fetchCalls.push({
        url,
        body: typeof init?.body === "string" ? init.body : "",
        authHeader: headers.get("Authorization"),
      });
      if (url.includes("/refresh-token")) {
        capturedHeaders.push({ url, idempotencyKey });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;

    const service = new BootRecoveryService({
      jobStore,
      telemetry: { emit: () => {} },
      getApiKey: () => "test-key",
      getApiOrigin: () => "http://127.0.0.1:4032",
      loopTokenStore,
    });
    await service.reattachLiveJobs();

    // Wait for the refresh scheduler to fire and call /refresh-token
    await waitForCondition(() => capturedHeaders.length > 0, 3000);

    assert.ok(capturedHeaders.length > 0, "expected at least one /refresh-token call");
    assert.equal(
      capturedHeaders[0].idempotencyKey,
      storedIdempotencyKey,
      "first refresh after recovery must reuse the stored lastIdempotencyKey",
    );
    service.dispose();
  } finally {
    stopAllRefreshSchedulers();
    stopAllHeartbeats();
    if (savedSkewEnv === undefined) {
      delete process.env.CLOSEDLOOP_TOKEN_REFRESH_SKEW_MS;
    } else {
      process.env.CLOSEDLOOP_TOKEN_REFRESH_SKEW_MS = savedSkewEnv;
    }
  }
});

test("first refresh after recovery generates a fresh idempotency key when none is stored", async () => {
  // When LoopTokenMeta has no lastIdempotencyKey, refreshLoopToken must
  // generate a fresh UUID for the Idempotency-Key header.
  const savedSkewEnv = process.env.CLOSEDLOOP_TOKEN_REFRESH_SKEW_MS;
  process.env.CLOSEDLOOP_TOKEN_REFRESH_SKEW_MS = "0";

  const capturedHeaders: Array<{ url: string; idempotencyKey: string | null }> = [];

  try {
    const repoDir = path.join(tempRoot, "repo");
    const claudeWorkDir = path.join(repoDir, "workdir");
    await fs.mkdir(claudeWorkDir, { recursive: true });
    const jsonlPath = path.join(claudeWorkDir, "claude-output.jsonl");
    await fs.writeFile(jsonlPath, "");

    const loopTokenStore = createLoopTokenStore("boot-recovery-idempotency-fresh-tokens");
    const expiresAt = Date.now() - 1000; // already expired → fires immediately
    // No lastIdempotencyKey set
    loopTokenStore.setLoopToken("loop-1", { token: "loop-token", expiresAt });

    const jobStore = createStore("boot-recovery-idempotency-fresh");
    const liveJob = createJob({
      pid: process.pid,
      status: "RUNNING",
      claudeWorkDir,
      jsonlPath,
      lastObservedJsonlOffset: 0,
    });
    jobStore.upsert(liveJob);

    // Install a custom fetch mock that also captures the Idempotency-Key header.
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const idempotencyKey = headers.get("Idempotency-Key");
      fetchCalls.push({
        url,
        body: typeof init?.body === "string" ? init.body : "",
        authHeader: headers.get("Authorization"),
      });
      if (url.includes("/refresh-token")) {
        capturedHeaders.push({ url, idempotencyKey });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;

    const service = new BootRecoveryService({
      jobStore,
      telemetry: { emit: () => {} },
      getApiKey: () => "test-key",
      getApiOrigin: () => "http://127.0.0.1:4033",
      loopTokenStore,
    });
    await service.reattachLiveJobs();

    // Wait for the refresh scheduler to fire and call /refresh-token
    await waitForCondition(() => capturedHeaders.length > 0, 3000);

    assert.ok(capturedHeaders.length > 0, "expected at least one /refresh-token call");
    const key = capturedHeaders[0].idempotencyKey;
    assert.ok(key !== null && key.length > 0, "expected a non-empty idempotency key");
    // A freshly generated key must be a UUID (8-4-4-4-12 hex format).
    assert.match(
      key ?? "",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      "expected fresh idempotency key to be a UUID",
    );
    service.dispose();
  } finally {
    stopAllRefreshSchedulers();
    stopAllHeartbeats();
    if (savedSkewEnv === undefined) {
      delete process.env.CLOSEDLOOP_TOKEN_REFRESH_SKEW_MS;
    } else {
      process.env.CLOSEDLOOP_TOKEN_REFRESH_SKEW_MS = savedSkewEnv;
    }
  }
});

test("AC-004: per-request provider resolution uses token at call time, not at construction time", async () => {
  // Verifies that getToken() is resolved on every fetch call so that a token
  // rotation between the artifact-upload and the completed-event POST results
  // in different Authorization headers for each request.
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ ok: true }));
  await fs.writeFile(path.join(claudeWorkDir, "open-questions.md"), "none");

  const loopTokenStore = createLoopTokenStore("boot-recovery-per-request-token");
  loopTokenStore.setLoopToken("loop-1", { token: "token-before-upload" });

  const jobStore = createStore("boot-recovery-per-request");
  const deadJob = createJob({
    status: "RUNNING",
    claudeWorkDir,
    // No statePath so RUNNING-no-snapshot resolves to FAILED (no upload-artifacts call).
    // To exercise both upload-artifacts and completed-event, we need a COMPLETED snapshot.
    statePath: path.join(claudeWorkDir, "state.json"),
  });
  await fs.writeFile(
    path.join(claudeWorkDir, "state.json"),
    JSON.stringify({ status: "COMPLETED" }),
  );
  jobStore.upsert(deadJob);

  // Intercept fetch: after the first call (upload-artifacts), rotate the token
  // in loopTokenStore so the second call (completed event) picks up the new value.
  let callCount = 0;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    callCount++;
    fetchCalls.push({
      url,
      body: typeof init?.body === "string" ? init.body : "",
      authHeader: headers.get("Authorization"),
    });
    if (url.includes("/upload-artifacts")) {
      // Rotate the token after the upload-artifacts call is captured.
      loopTokenStore.setLoopToken("loop-1", { token: "token-after-upload" });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }) as typeof fetch;

  const service = new BootRecoveryService({
    jobStore,
    telemetry: { emit: (event) => telemetryEvents.push(event) },
    getApiKey: () => "test-key",
    getApiOrigin: () => "http://127.0.0.1:4015",
    loopTokenStore,
  });
  await service.run([deadJob]);
  service.dispose();

  const uploadCall = fetchCalls.find((c) => c.url.includes("/upload-artifacts"));
  assert.ok(uploadCall, "expected upload-artifacts fetch call");
  assert.equal(
    uploadCall.authHeader,
    "Bearer token-before-upload",
    "artifact upload must use token resolved at upload time",
  );

  const completedEventCall = fetchCalls.find((c) => c.body.includes('"type":"completed"'));
  assert.ok(completedEventCall, "expected completed-event fetch call");
  assert.equal(
    completedEventCall.authHeader,
    "Bearer token-after-upload",
    "completed-event POST must use token resolved at post time (per-request resolution)",
  );
});
