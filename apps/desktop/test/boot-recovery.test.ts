import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, test } from "node:test";
import { BootRecoveryService } from "../src/main/boot-recovery.js";
import { JobStore, type LocalJob } from "../src/main/job-store.js";
import { LoopTokenStore } from "../src/main/loop-token-store.js";
import { createTestLoopTokenSafeStorage } from "./loop-token-test-utils.js";
import type { TelemetryEventPayload } from "../src/main/telemetry-protocol.js";

let tempRoot = "";
let fetchCalls: Array<{ url: string; body: string; authHeader?: string | null }> = [];
let telemetryEvents: TelemetryEventPayload[] = [];
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
  if (originalPollMs === undefined) {
    delete process.env.CLOSEDLOOP_TAILER_POLL_MS;
  } else {
    process.env.CLOSEDLOOP_TAILER_POLL_MS = originalPollMs;
  }
  if (originalThrottleMs === undefined) {
    delete process.env.CLOSEDLOOP_TAILER_THROTTLE_MS;
  } else {
    process.env.CLOSEDLOOP_TAILER_THROTTLE_MS = originalThrottleMs;
  }
  if (originalWatcherPollMs === undefined) {
    delete process.env.CLOSEDLOOP_WATCHER_POLL_MS;
  } else {
    process.env.CLOSEDLOOP_WATCHER_POLL_MS = originalWatcherPollMs;
  }
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
    command: "PLAN",
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
  loopTokenStore.setLoopToken("loop-1", "loop-token");

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
  loopTokenStore.setLoopToken("loop-1", "loop-token");

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

test("finalizes dead jobs using LoopTokenStore and clears token after UNKNOWN replay", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ ok: true }));

  const loopTokenStore = createLoopTokenStore("boot-recovery-loop-tokens");
  loopTokenStore.setLoopToken("loop-1", "loop-token");

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
  loopTokenStore.setLoopToken("loop-1", "loop-token");

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
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    fetchCalls.push({
      url,
      body: typeof init?.body === "string" ? init.body : "",
      authHeader: headers.get("Authorization"),
    });
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
  assert.equal(jobStore.getByLoopId("loop-1")?.finalStatusPersistedAt, undefined);
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
  loopTokenStore.setLoopToken("loop-1", "loop-token-1");
  loopTokenStore.setLoopToken("loop-2", "loop-token-2");

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
  const firstFetchStarted = new Promise<void>((resolve) => {
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      fetchCalls.push({
        url,
        body: typeof init?.body === "string" ? init.body : "",
        authHeader: headers.get("Authorization"),
      });
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
  await firstFetchStarted;
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
  loopTokenStore.setLoopToken("loop-1", "loop-token");

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
  loopTokenStore.setLoopToken("loop-1", "loop-token");

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

test("finalizes recovered live job after process exits", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ ok: true }));
  const loopTokenStore = createLoopTokenStore("boot-recovery-live-exit-loop-tokens");
  loopTokenStore.setLoopToken("loop-1", "loop-token");

  const child = spawn("bash", ["-lc", "sleep 0.1"], { detached: false });
  assert.ok(child.pid);

  const jobStore = createStore("boot-recovery-live-exit");
  const liveJob = createJob({
    pid: child.pid!,
    status: "RUNNING",
    claudeWorkDir,
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

  // Child exits ~100ms; allow several watcher ticks + async finalization (not real-time 3s poll).
  await sleep(WATCHER_TEST_POLL_MS * 8);
  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.status, "COMPLETED");
  assert.ok(fetchCalls.some((entry) => entry.url.includes("/upload-artifacts")));
  assert.ok(fetchCalls.some((entry) => entry.url.includes("/events")));
  assert.ok(
    fetchCalls.some(
      (entry) =>
        entry.url.endsWith("/loops/loop-1/upload-artifacts") &&
        entry.authHeader === "Bearer loop-token",
    ),
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
