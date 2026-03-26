/** Tests for symphony-loop EVALUATE_PLAN command. */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  readEvaluatePlanOutputs
} from "../src/server/operations/symphony-loop.js";
import { createEvaluateTestHarness, setupStubClaude } from "./symphony-test-utils.js";

// ---------------------------------------------------------------------------
// Shared test harness
// ---------------------------------------------------------------------------

const harness = createEvaluateTestHarness("evaluate-plan-test-machine");
const { makeTempDir, makeGatewayServer, startEventServer } = harness;

beforeEach(() => harness.beforeEach());
afterEach(() => harness.afterEach());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a valid EVALUATE_PLAN request body with PRD and plan artifacts. */
function buildEvaluatePlanBody(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    loopId: "aaaaaaaa-0000-0000-0000-000000000001",
    command: "EVALUATE_PLAN",
    closedLoopAuthToken: "cl-token",
    apiBaseUrl: "https://api.example.com",
    artifacts: [
      { type: "PRD", content: "PRD content" },
      { type: "IMPLEMENTATION_PLAN", content: "Plan content" },
    ],
    ...overrides,
  };
}

/** POST an EVALUATE_PLAN request to the gateway server. */
async function postEvaluatePlan(
  serverPort: number,
  body: Record<string, unknown>
): Promise<Response> {
  return fetch(
    `http://127.0.0.1:${serverPort}/api/engineer/symphony/loop`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-desktop-gateway-token": "test-token",
      },
      body: JSON.stringify(body),
    }
  );
}

// ---------------------------------------------------------------------------
// Validation tests (tests 1-8)
// ---------------------------------------------------------------------------

describe("EVALUATE_PLAN validation", () => {
  // Test 1: without repo returns 400
  test("without repo returns 400", async () => {
    const server = makeGatewayServer();
    await server.start();

    const response = await postEvaluatePlan(server.getActivePort(), buildEvaluatePlanBody());

    assert.equal(response.status, 400, `Expected 400 when no repo provided, got ${response.status}`);
    const body = await response.json() as { error: string };
    assert.ok(body.error, "Response should have error message");
  });

  // Test 2: missing PRD returns 400
  test("missing PRD artifact returns 400", async () => {
    const tmpDir = makeTempDir("evaluate-plan-test");
    const repoDir = path.join(tmpDir, "my-repo");
    mkdirSync(repoDir, { recursive: true });

    const server = makeGatewayServer({ allowedDirs: [tmpDir] });
    await server.start();

    const response = await postEvaluatePlan(server.getActivePort(), buildEvaluatePlanBody({
      artifacts: [{ type: "IMPLEMENTATION_PLAN", content: "Plan content" }],
      localRepoPath: repoDir,
    }));

    assert.equal(response.status, 400, `Expected 400 when PRD missing, got ${response.status}`);
    const responseBody = await response.json() as { error: string };
    assert.ok(responseBody.error, `Error should be set, got: ${responseBody.error}`);
  });

  // Test 3: missing plan returns 400
  test("missing plan artifact returns 400", async () => {
    const tmpDir = makeTempDir("evaluate-plan-test");
    const repoDir = path.join(tmpDir, "my-repo");
    mkdirSync(repoDir, { recursive: true });

    const server = makeGatewayServer({ allowedDirs: [tmpDir] });
    await server.start();

    const response = await postEvaluatePlan(server.getActivePort(), buildEvaluatePlanBody({
      artifacts: [{ type: "PRD", content: "PRD content" }],
      localRepoPath: repoDir,
    }));

    assert.equal(response.status, 400, `Expected 400 when plan missing, got ${response.status}`);
    const responseBody = await response.json() as { error: string };
    assert.ok(responseBody.error, "Response should have error message");
  });

  // Test 4: IMPLEMENTATION_PLAN type accepted
  test("IMPLEMENTATION_PLAN type accepted (non-400 response)", async () => {
    const tmpDir = makeTempDir("evaluate-plan-test");
    const repoDir = path.join(tmpDir, "my-repo");
    mkdirSync(repoDir, { recursive: true });

    const server = makeGatewayServer({ allowedDirs: [tmpDir] });
    await server.start();

    const response = await postEvaluatePlan(server.getActivePort(), buildEvaluatePlanBody({
      loopId: "aaaaaaaa-0000-0000-0000-000000000004",
      artifacts: [
        { type: "PRD", content: "PRD content" },
        { type: "IMPLEMENTATION_PLAN", content: "Plan content" },
      ],
      localRepoPath: repoDir,
    }));

    assert.equal(response.status, 200, `IMPLEMENTATION_PLAN type should be accepted, got ${response.status}`);
  });

  // Test 5: plan type accepted
  test("plan type accepted (non-400 response)", async () => {
    const tmpDir = makeTempDir("evaluate-plan-test");
    const repoDir = path.join(tmpDir, "my-repo");
    mkdirSync(repoDir, { recursive: true });

    const server = makeGatewayServer({ allowedDirs: [tmpDir] });
    await server.start();

    const response = await postEvaluatePlan(server.getActivePort(), buildEvaluatePlanBody({
      loopId: "aaaaaaaa-0000-0000-0000-000000000005",
      artifacts: [
        { type: "PRD", content: "PRD content" },
        { type: "plan", content: "Plan content" },
      ],
      localRepoPath: repoDir,
    }));

    assert.equal(response.status, 200, `'plan' type should be accepted, got ${response.status}`);
  });

  // Test 6: FEATURE artifact fallback for PRD accepted
  test("FEATURE artifact as PRD fallback accepted (non-400 response)", async () => {
    const tmpDir = makeTempDir("evaluate-plan-test");
    const repoDir = path.join(tmpDir, "my-repo");
    mkdirSync(repoDir, { recursive: true });

    const server = makeGatewayServer({ allowedDirs: [tmpDir] });
    await server.start();

    const response = await postEvaluatePlan(server.getActivePort(), buildEvaluatePlanBody({
      loopId: "aaaaaaaa-0000-0000-0000-000000000006",
      artifacts: [
        { type: "FEATURE", content: "Feature content as PRD" },
        { type: "IMPLEMENTATION_PLAN", content: "Plan content" },
      ],
      localRepoPath: repoDir,
    }));

    assert.equal(response.status, 200, `FEATURE artifact fallback for PRD should be accepted, got ${response.status}`);
  });

  // Test 7: disallowed localRepoPath returns 403
  test("disallowed localRepoPath returns 403", async () => {
    const tmpDir = makeTempDir("evaluate-plan-test");
    const disallowedPath = path.join(tmpDir, "..", "outside-allowed");

    const server = makeGatewayServer({ allowedDirs: [tmpDir] });
    await server.start();

    // Use a unique loopId to avoid 409 conflict with concurrently-running
    // tests 4-6 that also use buildEvaluatePlanBody()'s default loopId.
    const response = await postEvaluatePlan(server.getActivePort(), buildEvaluatePlanBody({
      loopId: "aaaaaaaa-0000-0000-0000-000000000007",
      localRepoPath: disallowedPath,
    }));

    assert.equal(response.status, 403, `Expected 403 for disallowed localRepoPath, got ${response.status}`);
  });

  // Test 8: unresolvable repo returns 400/404
  test("unresolvable repo.fullName returns 400 or 404", async () => {
    const tmpDir = makeTempDir("evaluate-plan-test");
    const server = makeGatewayServer({ allowedDirs: [tmpDir] });
    await server.start();

    // Use a unique loopId to avoid 409 conflict with concurrently-running
    // tests 4-6 that also use buildEvaluatePlanBody()'s default loopId.
    const response = await postEvaluatePlan(server.getActivePort(), buildEvaluatePlanBody({
      loopId: "aaaaaaaa-0000-0000-0000-000000000008",
      repo: { fullName: "org/nonexistent-repo", branch: "main" },
    }));

    const status = response.status;
    assert.ok(
      status === 400 || status === 404,
      `Expected 400 or 404 for unresolvable repo, got ${status}`
    );
  });
});

// ---------------------------------------------------------------------------
// Prompt content tests (tests 9-12)
// ---------------------------------------------------------------------------

describe("EVALUATE_PLAN prompt content", () => {
  // Test 9: prompt contains --artifact-type plan and --workdir
  test("prompt contains --artifact-type plan and --workdir", async () => {
    const tmpDir = makeTempDir("evaluate-plan-test");
    await setupStubClaude(tmpDir);
    const repoDir = path.join(tmpDir, "my-repo");
    await fs.mkdir(repoDir, { recursive: true });

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "bbbbbbbb-0000-0000-0000-000000000009";
    const response = await postEvaluatePlan(server.getActivePort(), buildEvaluatePlanBody({
      loopId,
      localRepoPath: repoDir,
      apiBaseUrl,
    }));

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-plan-${loopId.slice(0, 8)}`);
    const promptFile = path.join(claudeWorkDir, "evaluate-plan-prompt.txt");
    assert.ok(existsSync(promptFile), `Prompt file should exist at ${promptFile}`);
    const promptContent = await fs.readFile(promptFile, "utf-8");

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000
    );

    assert.ok(
      promptContent.includes("--artifact-type plan"),
      `Prompt should contain --artifact-type plan, got: ${promptContent}`
    );
    assert.ok(
      promptContent.includes(`--workdir ${claudeWorkDir}`),
      `Prompt should contain --workdir ${claudeWorkDir}, got: ${promptContent}`
    );
  });

  // Test 10: prompt contains REPO_PATH unconditionally
  test("prompt contains REPO_PATH unconditionally", async () => {
    const tmpDir = makeTempDir("evaluate-plan-test");
    await setupStubClaude(tmpDir);
    const repoDir = path.join(tmpDir, "my-repo");
    await fs.mkdir(repoDir, { recursive: true });

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "cccccccc-0000-0000-0000-000000000010";
    const response = await postEvaluatePlan(server.getActivePort(), buildEvaluatePlanBody({
      loopId,
      localRepoPath: repoDir,
      apiBaseUrl,
    }));

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-plan-${loopId.slice(0, 8)}`);
    const promptFile = path.join(claudeWorkDir, "evaluate-plan-prompt.txt");
    assert.ok(existsSync(promptFile), `Prompt file should exist at ${promptFile}`);
    const promptContent = await fs.readFile(promptFile, "utf-8");

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000
    );

    assert.ok(
      promptContent.includes("REPO_PATH="),
      `Prompt should contain REPO_PATH= unconditionally, got: ${promptContent}`
    );
  });

  // Test 11: plan.md contains raw artifact.content
  test("plan.md contains raw artifact.content", async () => {
    const tmpDir = makeTempDir("evaluate-plan-test");
    await setupStubClaude(tmpDir);
    const repoDir = path.join(tmpDir, "my-repo");
    await fs.mkdir(repoDir, { recursive: true });

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const planContent = "My unique implementation plan content 12345";
    const loopId = "dddddddd-0000-0000-0000-000000000011";
    const response = await postEvaluatePlan(server.getActivePort(), buildEvaluatePlanBody({
      loopId,
      localRepoPath: repoDir,
      apiBaseUrl,
      artifacts: [
        { type: "PRD", content: "PRD content" },
        { type: "IMPLEMENTATION_PLAN", content: planContent },
      ],
    }));

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-plan-${loopId.slice(0, 8)}`);
    const planFile = path.join(claudeWorkDir, "plan.md");
    assert.ok(existsSync(planFile), `plan.md should exist at ${planFile}`);
    const actualPlanContent = await fs.readFile(planFile, "utf-8");
    assert.equal(actualPlanContent, planContent, "plan.md should contain raw artifact content");

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000
    );
  });

  // Test 12: temp dir label contains 'evaluate-plan'
  test("temp dir path label contains 'evaluate-plan'", async () => {
    const tmpDir = makeTempDir("evaluate-plan-test");
    await setupStubClaude(tmpDir);
    const repoDir = path.join(tmpDir, "my-repo");
    await fs.mkdir(repoDir, { recursive: true });

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "eeeeeeee-0000-0000-0000-000000000012";
    const response = await postEvaluatePlan(server.getActivePort(), buildEvaluatePlanBody({
      loopId,
      localRepoPath: repoDir,
      apiBaseUrl,
    }));

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    const expectedWorkDir = path.join(os.tmpdir(), `symphony-evaluate-plan-${loopId.slice(0, 8)}`);
    assert.ok(
      existsSync(expectedWorkDir),
      `Temp dir with 'evaluate-plan' label should exist: ${expectedWorkDir}`
    );

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000
    );
  });
});

// ---------------------------------------------------------------------------
// readEvaluatePlanOutputs unit tests (tests 13-15)
// ---------------------------------------------------------------------------

describe("readEvaluatePlanOutputs", () => {
  // Test 13: plan-judges.json present returns planJudges
  test("plan-judges.json present returns planJudges", () => {
    const tmpDir = makeTempDir("evaluate-plan-test");
    const planJudgesData = { scores: [{ judge: "quality", score: 9 }] };
    writeFileSync(
      path.join(tmpDir, "plan-judges.json"),
      JSON.stringify(planJudgesData)
    );

    const result = readEvaluatePlanOutputs(tmpDir);
    assert.deepEqual(result.planJudges, planJudgesData);
  });

  // Test 14: plan-judges.json absent returns empty without throwing
  test("plan-judges.json absent returns empty planJudges without throwing", () => {
    const tmpDir = makeTempDir("evaluate-plan-test");
    let result: Record<string, unknown> | undefined;
    assert.doesNotThrow(() => {
      result = readEvaluatePlanOutputs(tmpDir);
    });
    assert.equal(result?.planJudges, undefined);
  });

  // Test 15: malformed plan-judges.json returns empty without throwing
  test("malformed plan-judges.json returns empty without throwing", () => {
    const tmpDir = makeTempDir("evaluate-plan-test");
    writeFileSync(path.join(tmpDir, "plan-judges.json"), "not valid json {{{{");
    let result: Record<string, unknown> | undefined;
    assert.doesNotThrow(() => {
      result = readEvaluatePlanOutputs(tmpDir);
    });
    assert.equal(result?.planJudges, undefined);
  });
});

// ---------------------------------------------------------------------------
// Temp dir cleanup tests (tests 16-17)
// ---------------------------------------------------------------------------

describe("EVALUATE_PLAN temp dir cleanup", () => {
  // Test 16: temp dir cleaned up after success
  test("temp dir is removed after claude exits 0 and completed event is received", async () => {
    const tmpDir = makeTempDir("evaluate-plan-test");
    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });

    const stubScript = [
      "#!/bin/sh",
      'echo "{}" > "$CLOSEDLOOP_WORKDIR/plan-judges.json"',
      'echo \'{"type":"result","subtype":"success","result":"","is_error":false}\'',
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "claude"), stubScript, { mode: 0o755 });
    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;

    const repoDir = path.join(tmpDir, "my-repo");
    await fs.mkdir(repoDir, { recursive: true });

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "ffffffff-0000-0000-0000-000000000016";
    const response = await postEvaluatePlan(server.getActivePort(), buildEvaluatePlanBody({
      loopId,
      localRepoPath: repoDir,
      apiBaseUrl,
    }));

    assert.equal(response.status, 200, `Expected 200 on spawn, got ${response.status}`);

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000
    );

    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-plan-${loopId.slice(0, 8)}`);

    // Poll for fs.rm completion (fire-and-forget in handleProcessCompletion)
    const deadline = Date.now() + 3_000;
    while (existsSync(claudeWorkDir) && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }

    assert.equal(
      existsSync(claudeWorkDir),
      false,
      `Expected temp dir to be cleaned up: ${claudeWorkDir}`
    );
  });
});

// ---------------------------------------------------------------------------
// BINARY_NOT_FOUND test (test 18)
// ---------------------------------------------------------------------------

describe("EVALUATE_PLAN BINARY_NOT_FOUND", () => {
  // Test 18: BINARY_NOT_FOUND error event and HTTP 500 when claude absent
  test("returns HTTP 500 and posts error event with code BINARY_NOT_FOUND", async () => {
    const tmpDir = makeTempDir("evaluate-plan-test");
    const emptyBin = path.join(tmpDir, "empty-bin");
    await fs.mkdir(emptyBin, { recursive: true });
    process.env.PATH = emptyBin;

    const repoDir = path.join(tmpDir, "my-repo");
    await fs.mkdir(repoDir, { recursive: true });

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "22222222-bbbb-0000-0000-000000000018";
    const response = await postEvaluatePlan(server.getActivePort(), buildEvaluatePlanBody({
      loopId,
      localRepoPath: repoDir,
      apiBaseUrl,
    }));

    assert.equal(response.status, 500, `Expected 500 when claude not found, got ${response.status}`);

    const errorEvent = await eventSrv.waitForEvent(
      (b) => b.type === "error",
      5_000
    );
    assert.equal(errorEvent.type, "error");
    assert.equal(errorEvent.code, "BINARY_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// Started + completed events test (test 19)
// ---------------------------------------------------------------------------

describe("EVALUATE_PLAN event subtype", () => {
  // Test 19: started + completed events with subtype='evaluate_plan'
  test("posts started event and completed event with subtype='evaluate_plan'", async () => {
    const tmpDir = makeTempDir("evaluate-plan-test");
    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });

    const stubScript = [
      "#!/bin/sh",
      'echo \'{"type":"result","subtype":"success","result":"","is_error":false}\'',
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "claude"), stubScript, { mode: 0o755 });
    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;

    const repoDir = path.join(tmpDir, "my-repo");
    await fs.mkdir(repoDir, { recursive: true });

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "33333333-cccc-0000-0000-000000000019";
    const response = await postEvaluatePlan(server.getActivePort(), buildEvaluatePlanBody({
      loopId,
      localRepoPath: repoDir,
      apiBaseUrl,
    }));

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    // Wait for started event
    const startedEvent = await eventSrv.waitForEvent(
      (b) => b.type === "started",
      10_000
    );
    assert.equal(startedEvent.type, "started");

    // Wait for completed event with result.subtype='evaluate_plan'
    // The production code sets subtype inside the `result` object, not at the
    // top level of the completed event (see handleProcessCompletion in symphony-loop.ts).
    const completedEvent = await eventSrv.waitForEvent(
      (b) => b.type === "completed",
      15_000
    );
    assert.equal(completedEvent.type, "completed");
    const result = completedEvent.result as Record<string, unknown> | undefined;
    assert.equal(
      result?.subtype,
      "evaluate_plan",
      `Expected result.subtype='evaluate_plan', got: ${String(result?.subtype)}`
    );
  });
});
