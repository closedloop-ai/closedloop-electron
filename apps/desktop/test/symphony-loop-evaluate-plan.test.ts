/** Tests for symphony-loop EVALUATE_PLAN command. */

import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
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
// EVALUATE_PLAN-specific validation
// ---------------------------------------------------------------------------

describe("EVALUATE_PLAN validation", () => {
  test("without repo returns 400", async () => {
    const server = makeGatewayServer();
    await server.start();

    const response = await postEvaluatePlan(server.getActivePort(), buildEvaluatePlanBody());

    assert.equal(response.status, 400, `Expected 400 when no repo provided, got ${response.status}`);
    const body = await response.json() as { error: string };
    assert.ok(body.error, "Response should have error message");
  });

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
});

// ---------------------------------------------------------------------------
// Prompt content (merged: artifact-type + --workdir + REPO_PATH)
// ---------------------------------------------------------------------------

describe("EVALUATE_PLAN prompt content", () => {
  test("prompt contains --artifact-type plan, --workdir, and REPO_PATH=", async () => {
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
    assert.ok(
      promptContent.includes("REPO_PATH="),
      `Prompt should contain REPO_PATH= unconditionally, got: ${promptContent}`
    );
  });

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
});

// ---------------------------------------------------------------------------
// Event subtype
// ---------------------------------------------------------------------------

describe("EVALUATE_PLAN event subtype", () => {
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

    const startedEvent = await eventSrv.waitForEvent(
      (b) => b.type === "started",
      10_000
    );
    assert.equal(startedEvent.type, "started");

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
