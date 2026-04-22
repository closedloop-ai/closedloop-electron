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

  const errorEvent = fetchCalls.find(({ url }) => url.includes("/events"));
  assert.ok(errorEvent, "Expected handleProcessCompletion to post an error event");
  const eventBody = JSON.parse(errorEvent.body) as { warnings?: string[] };
  assert.deepEqual(eventBody.warnings, ["ARTIFACT_UPLOAD_FAILED"]);
});
