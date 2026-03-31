import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, test } from "node:test";
import { BootRecoveryService } from "../src/main/boot-recovery.js";
import { JobStore, type LocalJob } from "../src/main/job-store.js";
import type { TelemetryEventPayload } from "../src/main/telemetry-protocol.js";

let tempRoot = "";
let fetchCalls: Array<{ url: string; body: string }> = [];
let telemetryEvents: TelemetryEventPayload[] = [];
const originalFetch = globalThis.fetch;
const originalPollMs = process.env.CLOSEDLOOP_TAILER_POLL_MS;
const originalThrottleMs = process.env.CLOSEDLOOP_TAILER_THROTTLE_MS;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "boot-recovery-test-"));
  fetchCalls = [];
  telemetryEvents = [];
  process.env.CLOSEDLOOP_TAILER_POLL_MS = "20";
  process.env.CLOSEDLOOP_TAILER_THROTTLE_MS = "20";
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    fetchCalls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : "",
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
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

function createStore(name: string): JobStore {
  return new JobStore({ cwd: tempRoot, name });
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

test("finalizes dead jobs returned by reconcile", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ ok: true }));

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
  });
  await service.run([deadJob]);
  service.dispose();

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.status, "COMPLETED");
  assert.ok(persisted.finalStatusPersistedAt);
  assert.equal(fetchCalls.length, 2);
});

test("reattaches to live jobs and persists jsonl offsets", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  const jsonlPath = path.join(claudeWorkDir, "claude-output.jsonl");
  await fs.writeFile(jsonlPath, "");

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
  });
  await service.run([]);

  await fs.appendFile(
    jsonlPath,
    '{"type":"assistant","message":{"usage":{"input_tokens":1,"output_tokens":1}}}\n',
  );
  await sleep(100);

  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.ok((persisted.lastObservedJsonlOffset ?? 0) > 0);
  service.dispose();
});

test("finalizes recovered live job after process exits", async () => {
  const repoDir = path.join(tempRoot, "repo");
  const claudeWorkDir = path.join(repoDir, "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(path.join(claudeWorkDir, "plan.json"), JSON.stringify({ ok: true }));

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
  });
  await service.run([]);

  await sleep(3400);
  const persisted = jobStore.getByLoopId("loop-1");
  assert.ok(persisted);
  assert.equal(persisted.status, "COMPLETED");
  assert.ok(fetchCalls.some((entry) => entry.url.includes("/upload-artifacts")));
  assert.ok(fetchCalls.some((entry) => entry.url.includes("/events")));
  service.dispose();
});
