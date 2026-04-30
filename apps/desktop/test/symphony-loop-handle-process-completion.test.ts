import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { JobStore, type LocalJob } from "../src/main/job-store.js";
import { handleProcessCompletion } from "../src/server/operations/symphony-loop.js";

let tempRoot = "";
let fetchCalls: Array<{ url: string; body: string }> = [];
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "symphony-handle-process-completion-"),
  );
  fetchCalls = [];
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push({
      url,
      body: typeof init?.body === "string" ? init.body : "",
    });

    if (url.includes("upload-artifacts")) {
      return new Response("nope", {
        status: 500,
        statusText: "Internal Server Error",
      });
    }

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

function createBaseJob(
  loopId: string,
  claudeWorkDir: string,
  overrides?: Partial<LocalJob>,
): LocalJob {
  return {
    id: loopId,
    kind: "SYMPHONY_LOOP",
    loopId,
    command: "EXECUTE",
    localRepoPath: path.join(tempRoot, "repo"),
    claudeWorkDir,
    status: "RUNNING",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function getPostedErrorEvent(): Record<string, unknown> {
  const errorEvent = fetchCalls.find(({ url }) => url.includes("/events"));
  assert.ok(errorEvent, "Expected handleProcessCompletion to post an error event");
  return JSON.parse(errorEvent.body) as Record<string, unknown>;
}

test("handleProcessCompletion merges existing warnings with failure upload warnings", async () => {
  const loopId = "loop-merge-failure-warning";
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeWorkDir, "plan.json"),
    JSON.stringify({ content: "Plan content", tasks: [] }),
  );

  const jobStore = createStore("symphony-handle-process-completion");
  jobStore.upsert(
    createBaseJob(loopId, claudeWorkDir, {
      warning: "PRE_EXISTING_WARNING",
    }),
  );

  await handleProcessCompletion(
    1,
    {
      loopId,
      command: "EXECUTE",
      closedLoopAuthToken: "token",
    } as Parameters<typeof handleProcessCompletion>[1],
    "http://127.0.0.1:12345",
    null,
    claudeWorkDir,
    false,
    null,
    () => [tempRoot],
    undefined,
    jobStore,
  );

  const persisted = jobStore.getByLoopId(loopId);
  assert.ok(persisted);
  assert.equal(persisted.status, "FAILED");
  assert.deepEqual(
    persisted.warning?.split("; ").sort(),
    ["ARTIFACT_UPLOAD_FAILED", "PRE_EXISTING_WARNING"],
  );

  const eventBody = getPostedErrorEvent() as { warnings?: string[] };
  assert.deepEqual(eventBody.warnings, ["ARTIFACT_UPLOAD_FAILED"]);
});

test("handleProcessCompletion surfaces valid user-visible runner failure marker", async () => {
  const loopId = "loop-user-visible-runner-failure";
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeWorkDir, "loop-error.json"),
    JSON.stringify({
      code: "RUNNER_ERROR",
      message: "Loop execution failed because XYZ.",
      result: { subcode: "XYZ_FAILURE" },
      schemaVersion: 1,
    }),
  );

  const jobStore = createStore("symphony-user-visible-runner-failure");
  jobStore.upsert(createBaseJob(loopId, claudeWorkDir));

  await handleProcessCompletion(
    1,
    {
      loopId,
      command: "EXECUTE",
      closedLoopAuthToken: "token",
    } as Parameters<typeof handleProcessCompletion>[1],
    "http://127.0.0.1:12345",
    null,
    claudeWorkDir,
    false,
    null,
    () => [tempRoot],
    undefined,
    jobStore,
  );

  const persisted = jobStore.getByLoopId(loopId);
  assert.ok(persisted);
  assert.equal(persisted.status, "FAILED");

  const eventBody = getPostedErrorEvent();
  assert.equal(eventBody.code, "RUNNER_ERROR");
  assert.equal(eventBody.message, "Loop execution failed because XYZ.");
  assert.deepEqual(eventBody.result, { subcode: "XYZ_FAILURE" });
  assert.equal(eventBody.logTail, undefined);
});

test("handleProcessCompletion ignores invalid user-visible runner failure marker", async () => {
  const loopId = "loop-invalid-runner-failure";
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeWorkDir, "loop-error.json"),
    JSON.stringify({
      code: "UNSUPPORTED_CODE",
      message: "Do not surface this.",
      result: { subcode: "XYZ_FAILURE" },
    }),
  );

  const jobStore = createStore("symphony-invalid-runner-failure");
  jobStore.upsert(createBaseJob(loopId, claudeWorkDir));

  await handleProcessCompletion(
    1,
    {
      loopId,
      command: "EXECUTE",
      closedLoopAuthToken: "token",
    } as Parameters<typeof handleProcessCompletion>[1],
    "http://127.0.0.1:12345",
    null,
    claudeWorkDir,
    false,
    null,
    () => [tempRoot],
    undefined,
    jobStore,
  );

  const eventBody = getPostedErrorEvent();
  assert.equal(eventBody.code, "PROCESS_FAILED");
  assert.equal(eventBody.message, "Process exited with code 1");
  assert.equal(eventBody.result, undefined);
});

test("handleProcessCompletion ignores stale user-visible runner failure marker", async () => {
  const loopId = "loop-stale-runner-failure";
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  const markerPath = path.join(claudeWorkDir, "loop-error.json");
  await fs.writeFile(
    markerPath,
    JSON.stringify({
      code: "RUNNER_ERROR",
      message: "Do not surface this stale marker.",
      result: { subcode: "XYZ_FAILURE" },
    }),
  );

  const jobStore = createStore("symphony-stale-runner-failure");
  jobStore.upsert(createBaseJob(loopId, claudeWorkDir));

  await handleProcessCompletion(
    1,
    {
      loopId,
      command: "EXECUTE",
      closedLoopAuthToken: "token",
    } as Parameters<typeof handleProcessCompletion>[1],
    "http://127.0.0.1:12345",
    null,
    claudeWorkDir,
    false,
    null,
    () => [tempRoot],
    undefined,
    jobStore,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    [],
    undefined,
    Date.now() + 60_000,
  );

  const eventBody = getPostedErrorEvent();
  assert.equal(eventBody.code, "PROCESS_FAILED");
  assert.equal(eventBody.message, "Process exited with code 1");
  assert.equal(eventBody.result, undefined);
});

test("handleProcessCompletion preserves sanitized runner failure message in local job activity", async () => {
  const loopId = "loop-user-visible-live-activity";
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeWorkDir, "loop-error.json"),
    JSON.stringify({
      code: "PRE_RUN_VALIDATION_FAILED",
      message: "\u001b[31mPlan state is not loadable.\u001b[0m",
      result: { subcode: "BAD_PLAN_STATE" },
    }),
  );

  const jobStore = createStore("symphony-user-visible-live-activity");
  jobStore.upsert(createBaseJob(loopId, claudeWorkDir));

  await handleProcessCompletion(
    1,
    {
      loopId,
      command: "EXECUTE",
      closedLoopAuthToken: "token",
    } as Parameters<typeof handleProcessCompletion>[1],
    "http://127.0.0.1:12345",
    null,
    claudeWorkDir,
    false,
    null,
    () => [tempRoot],
    undefined,
    jobStore,
  );

  const persisted = jobStore.getByLoopId(loopId);
  assert.ok(persisted);
  assert.equal(persisted.liveActivity, "Plan state is not loadable.");

  const eventBody = getPostedErrorEvent();
  assert.equal(eventBody.code, "PRE_RUN_VALIDATION_FAILED");
  assert.equal(eventBody.message, "Plan state is not loadable.");
  assert.deepEqual(eventBody.result, { subcode: "BAD_PLAN_STATE" });
});

test("handleProcessCompletion keeps context-limit precedence over runner failure marker", async () => {
  const loopId = "loop-context-precedence";
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeWorkDir, "loop-error.json"),
    JSON.stringify({
      code: "RUNNER_ERROR",
      message: "Do not surface this.",
      result: { subcode: "XYZ_FAILURE" },
    }),
  );
  await fs.writeFile(
    path.join(claudeWorkDir, "claude-output.jsonl"),
    `${JSON.stringify({
      type: "result",
      is_error: true,
      result: "Prompt is too long for this model.",
    })}\n`,
  );

  const jobStore = createStore("symphony-context-precedence");
  jobStore.upsert(createBaseJob(loopId, claudeWorkDir));

  await handleProcessCompletion(
    1,
    {
      loopId,
      command: "EXECUTE",
      closedLoopAuthToken: "token",
    } as Parameters<typeof handleProcessCompletion>[1],
    "http://127.0.0.1:12345",
    null,
    claudeWorkDir,
    false,
    null,
    () => [tempRoot],
    undefined,
    jobStore,
  );

  const eventBody = getPostedErrorEvent();
  assert.equal(eventBody.code, "CONTEXT_LIMIT_EXCEEDED");
  assert.equal(eventBody.message, "Prompt is too long for this model.");
  assert.equal(eventBody.result, undefined);
});

test("handleProcessCompletion keeps cancellation precedence over runner failure marker", async () => {
  const loopId = "loop-cancel-precedence";
  const claudeWorkDir = path.join(tempRoot, "repo", "workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeWorkDir, "loop-error.json"),
    JSON.stringify({
      code: "RUNNER_ERROR",
      message: "Do not surface this.",
      result: { subcode: "XYZ_FAILURE" },
    }),
  );

  const jobStore = createStore("symphony-cancel-precedence");
  jobStore.upsert(
    createBaseJob(loopId, claudeWorkDir, {
      status: "CANCEL_PENDING",
    }),
  );

  await handleProcessCompletion(
    1,
    {
      loopId,
      command: "EXECUTE",
      closedLoopAuthToken: "token",
    } as Parameters<typeof handleProcessCompletion>[1],
    "http://127.0.0.1:12345",
    null,
    claudeWorkDir,
    false,
    null,
    () => [tempRoot],
    undefined,
    jobStore,
  );

  const persisted = jobStore.getByLoopId(loopId);
  assert.ok(persisted);
  assert.equal(persisted.status, "CANCELLED");

  const eventBody = getPostedErrorEvent();
  assert.equal(eventBody.code, "CANCELLED");
  assert.equal(eventBody.message, "Loop cancelled");
  assert.equal(eventBody.result, undefined);
});
