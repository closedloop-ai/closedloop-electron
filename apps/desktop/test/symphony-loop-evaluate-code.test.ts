/** Tests for symphony-loop EVALUATE_CODE command. */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  PLAN_ARTIFACT_TYPES,
} from "../src/server/operations/symphony-loop.js";
import { createEvaluateTestHarness, setupStubClaude } from "./symphony-test-utils.js";

// ---------------------------------------------------------------------------
// Shared test harness
// ---------------------------------------------------------------------------

const harness = createEvaluateTestHarness("evaluate-code-test-machine");
const { makeTempDir, makeGatewayServer, startEventServer } = harness;

beforeEach(() => harness.beforeEach());
afterEach(() => harness.afterEach());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a valid EVALUATE_CODE request body. */
function buildEvaluateCodeBody(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    loopId: "ec000001-0000-0000-0000-000000000001",
    command: "EVALUATE_CODE",
    closedLoopAuthToken: "cl-token",
    artifacts: [{ type: "IMPLEMENTATION_PLAN", content: "Plan content" }],
    repo: { fullName: "org/repo", branch: "main" },
    ...overrides,
  };
}

/** POST an EVALUATE_CODE request to the gateway server. */
async function postEvaluateCode(
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
// EVALUATE_CODE-specific validation
// ---------------------------------------------------------------------------

describe("T-5.2: EVALUATE_CODE dispatch validation", () => {
  test("(1) without repo returns 400", async () => {
    const server = makeGatewayServer();
    await server.start();

    const response = await postEvaluateCode(server.getActivePort(), buildEvaluateCodeBody({
      loopId: "ec000001-0000-0000-0000-000000000001",
      repo: undefined,
    }));

    assert.equal(response.status, 400, `Expected 400 when no repo provided, got ${response.status}`);
  });

  test("(2) missing plan artifact returns 400", async () => {
    const server = makeGatewayServer();
    await server.start();

    const response = await postEvaluateCode(server.getActivePort(), buildEvaluateCodeBody({
      loopId: "ec000002-0000-0000-0000-000000000002",
      artifacts: [],
    }));

    assert.equal(response.status, 400, `Expected 400 for missing plan artifact, got ${response.status}`);
    const body = await response.json() as { error: string };
    assert.ok(body.error.includes("EVALUATE_CODE requires"), `Error message should mention EVALUATE_CODE requires, got: ${body.error}`);
  });
});

// ---------------------------------------------------------------------------
// Prompt content (merged: artifact-type + --workdir + REPO_PATH)
// ---------------------------------------------------------------------------

describe("T-5.2: EVALUATE_CODE prompt content", () => {
  test("prompt contains --artifact-type code, --workdir, and REPO_PATH=", async () => {
    const tmpDir = makeTempDir("evaluate-code-test");
    await setupStubClaude(tmpDir);

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const repoName = "test-repo";
    const repoDir = path.join(tmpDir, repoName);
    await fs.mkdir(repoDir, { recursive: true });

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "a0000001-0000-0000-0000-000000000007";
    const response = await postEvaluateCode(server.getActivePort(), {
      loopId,
      command: "EVALUATE_CODE",
      closedLoopAuthToken: "cl-token",
      artifacts: [{ type: "IMPLEMENTATION_PLAN", content: "Plan content" }],
      repo: { fullName: `org/${repoName}`, branch: "main" },
    });

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-code-${loopId.slice(0, 8)}`);
    const promptFile = path.join(claudeWorkDir, "evaluate-code-prompt.txt");
    assert.ok(existsSync(promptFile), `Prompt file should exist at ${promptFile}`);
    const promptContent = await fs.readFile(promptFile, "utf-8");

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000
    );

    assert.ok(
      promptContent.includes("--artifact-type code"),
      `Prompt should contain --artifact-type code, got: ${promptContent}`
    );
    assert.ok(
      promptContent.includes(`--workdir ${claudeWorkDir}`),
      `Prompt should contain --workdir with claudeWorkDir, got: ${promptContent}`
    );
    assert.ok(
      promptContent.includes("REPO_PATH="),
      `Prompt should contain REPO_PATH= unconditionally, got: ${promptContent}`
    );
  });

  test("plan.md contains raw artifact content", async () => {
    const tmpDir = makeTempDir("evaluate-code-test");
    await setupStubClaude(tmpDir);

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const repoName = "plan-content-test-repo";
    const repoDir = path.join(tmpDir, repoName);
    await fs.mkdir(repoDir, { recursive: true });

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "a0000003-0000-0000-0000-000000000009";
    const planContent = "This is the raw implementation plan content for testing.";

    const response = await postEvaluateCode(server.getActivePort(), {
      loopId,
      command: "EVALUATE_CODE",
      closedLoopAuthToken: "cl-token",
      artifacts: [{ type: "IMPLEMENTATION_PLAN", content: planContent }],
      repo: { fullName: `org/${repoName}`, branch: "main" },
    });

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-code-${loopId.slice(0, 8)}`);
    const planFile = path.join(claudeWorkDir, "plan.md");
    assert.ok(existsSync(planFile), `plan.md should exist at ${planFile}`);
    const planFileContent = await fs.readFile(planFile, "utf-8");

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000
    );

    assert.equal(planFileContent, planContent, `plan.md content should match raw artifact content`);
  });
});

// ---------------------------------------------------------------------------
// ARTIFACT_WRITE_FAILED cleanup (EVALUATE_CODE-specific)
// ---------------------------------------------------------------------------

describe("T-5.2: Temp dir cleanup after ARTIFACT_WRITE_FAILED", () => {
  test("temp dir cleaned up after ARTIFACT_WRITE_FAILED", async (t) => {
    const tmpDir = makeTempDir("evaluate-code-test");

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const repoName = "cleanup-artifact-fail-repo";
    const repoDir = path.join(tmpDir, repoName);
    await fs.mkdir(repoDir, { recursive: true });

    const loopId = "a0000006-0000-0000-0000-00000000000d";

    const original = fs.writeFile;
    t.mock.method(fs, "writeFile", async function (
      filePath: Parameters<typeof fs.writeFile>[0],
      ...args: unknown[]
    ) {
      if (typeof filePath === "string" && filePath.endsWith("/plan.md")) {
        throw new Error("Simulated artifact write failure");
      }
      return (original as Function).apply(fs, [filePath, ...args]);
    });

    const response = await postEvaluateCode(server.getActivePort(), {
      loopId,
      command: "EVALUATE_CODE",
      closedLoopAuthToken: "cl-token",
      artifacts: [{ type: "IMPLEMENTATION_PLAN", content: "Plan content" }],
      repo: { fullName: `org/${repoName}`, branch: "main" },
    });

    assert.equal(response.status, 500, `Expected 500 on artifact write failure, got ${response.status}`);

    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.error, "Failed to write artifacts to workdir");

    const errorEvent = await eventSrv.waitForEvent(
      (b) => b.type === "error" && b.code === "ARTIFACT_WRITE_FAILED",
      5_000
    );
    assert.ok(errorEvent, "Expected ARTIFACT_WRITE_FAILED error event");

    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-code-${loopId.slice(0, 8)}`);

    const deadline = Date.now() + 3_000;
    while (existsSync(claudeWorkDir) && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }

    assert.equal(
      existsSync(claudeWorkDir),
      false,
      `Expected temp dir to be cleaned up after ARTIFACT_WRITE_FAILED: ${claudeWorkDir}`
    );
  });
});

// ---------------------------------------------------------------------------
// Started and completed events
// ---------------------------------------------------------------------------

describe("T-5.2: started + completed events", () => {
  test("started and completed events with subtype='evaluate_code'", async () => {
    const tmpDir = makeTempDir("evaluate-code-test");
    await setupStubClaude(tmpDir);

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const repoName = "events-test-repo";
    const repoDir = path.join(tmpDir, repoName);
    await fs.mkdir(repoDir, { recursive: true });

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "a0000008-0000-0000-0000-00000000000e";
    const response = await postEvaluateCode(server.getActivePort(), {
      loopId,
      command: "EVALUATE_CODE",
      closedLoopAuthToken: "cl-token",
      artifacts: [{ type: "IMPLEMENTATION_PLAN", content: "Plan content" }],
      repo: { fullName: `org/${repoName}`, branch: "main" },
    });

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
    assert.ok(result, "completed event should have a result field");
    assert.equal(
      result.subtype,
      "evaluate_code",
      `completed event result.subtype should be 'evaluate_code', got: ${result.subtype}`
    );
  });
});

// ---------------------------------------------------------------------------
// PLAN_ARTIFACT_TYPES
// ---------------------------------------------------------------------------

describe("T-5.2: PLAN_ARTIFACT_TYPES includes both expected types", () => {
  test("PLAN_ARTIFACT_TYPES includes IMPLEMENTATION_PLAN and plan", () => {
    assert.ok(
      (PLAN_ARTIFACT_TYPES as readonly string[]).includes("IMPLEMENTATION_PLAN"),
      "PLAN_ARTIFACT_TYPES should include 'IMPLEMENTATION_PLAN'"
    );
    assert.ok(
      (PLAN_ARTIFACT_TYPES as readonly string[]).includes("plan"),
      "PLAN_ARTIFACT_TYPES should include 'plan'"
    );
  });
});
