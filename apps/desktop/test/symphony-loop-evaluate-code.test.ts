/** Tests for symphony-loop EVALUATE_CODE command. */

import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  PLAN_ARTIFACT_TYPES,
  readEvaluateCodeOutputs,
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
// T-5.2: EVALUATE_CODE dispatch validation
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

  test("(3) IMPLEMENTATION_PLAN type artifact is accepted", async () => {
    const tmpDir = makeTempDir("evaluate-code-test");
    const server = makeGatewayServer({ allowedDirs: [tmpDir] });
    await server.start();

    const response = await postEvaluateCode(server.getActivePort(), buildEvaluateCodeBody({
      loopId: "ec000003-0000-0000-0000-000000000003",
      artifacts: [{ type: "IMPLEMENTATION_PLAN", content: "Plan content" }],
      repo: { fullName: "org/nonexistent-validation-repo", branch: "main" },
    }));

    assert.notEqual(response.status, 400, `Expected non-400 for IMPLEMENTATION_PLAN artifact type, got ${response.status}`);
  });

  test("(4) 'plan' type artifact is accepted", async () => {
    const tmpDir = makeTempDir("evaluate-code-test");
    const server = makeGatewayServer({ allowedDirs: [tmpDir] });
    await server.start();

    const response = await postEvaluateCode(server.getActivePort(), buildEvaluateCodeBody({
      loopId: "ec000004-0000-0000-0000-000000000004",
      artifacts: [{ type: "plan", content: "Plan content" }],
      repo: { fullName: "org/nonexistent-validation-repo", branch: "main" },
    }));

    assert.notEqual(response.status, 400, `Expected non-400 for 'plan' artifact type, got ${response.status}`);
  });

  test("(5) disallowed localRepoPath returns 403", async () => {
    const tmpDir = makeTempDir("evaluate-code-test");
    const server = makeGatewayServer({ allowedDirs: [tmpDir] });
    await server.start();

    const disallowedPath = path.join(path.dirname(tmpDir), "sibling-dir-not-allowed");

    const response = await postEvaluateCode(server.getActivePort(), buildEvaluateCodeBody({
      loopId: "ec000005-0000-0000-0000-000000000005",
      localRepoPath: disallowedPath,
      repo: undefined,
    }));

    assert.equal(response.status, 403, `Expected 403 for disallowed localRepoPath, got ${response.status}`);
  });

  test("(6) unresolvable repo returns 400 or 404", async () => {
    const tmpDir = makeTempDir("evaluate-code-test");
    const server = makeGatewayServer({ allowedDirs: [tmpDir] });
    await server.start();

    const response = await postEvaluateCode(server.getActivePort(), buildEvaluateCodeBody({
      loopId: "ec000006-0000-0000-0000-000000000006",
      repo: { fullName: "org/nonexistent-repo-xyz-abc", branch: "main" },
    }));

    assert.ok(
      response.status === 400 || response.status === 404,
      `Expected 400 or 404 for unresolvable repo, got ${response.status}`
    );
  });
});

// ---------------------------------------------------------------------------
// T-5.2: Prompt content assertions
// ---------------------------------------------------------------------------

describe("T-5.2: EVALUATE_CODE prompt content", () => {
  test("(7) prompt contains --artifact-type code and --workdir", async () => {
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
  });

  test("(8) prompt contains REPO_PATH unconditionally", async () => {
    const tmpDir = makeTempDir("evaluate-code-test");
    await setupStubClaude(tmpDir);

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const repoName = "another-test-repo";
    const repoDir = path.join(tmpDir, repoName);
    await fs.mkdir(repoDir, { recursive: true });

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "a0000002-0000-0000-0000-000000000008";
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
      promptContent.includes("REPO_PATH="),
      `Prompt should contain REPO_PATH= unconditionally, got: ${promptContent}`
    );
  });

  test("(9) plan.md contains raw artifact content", async () => {
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

  test("(10) temp dir label contains 'evaluate-code'", async () => {
    const tmpDir = makeTempDir("evaluate-code-test");
    await setupStubClaude(tmpDir);

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const repoName = "label-test-repo";
    const repoDir = path.join(tmpDir, repoName);
    await fs.mkdir(repoDir, { recursive: true });

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "a0000004-0000-0000-0000-00000000000a";
    const response = await postEvaluateCode(server.getActivePort(), {
      loopId,
      command: "EVALUATE_CODE",
      closedLoopAuthToken: "cl-token",
      artifacts: [{ type: "IMPLEMENTATION_PLAN", content: "Plan content" }],
      repo: { fullName: `org/${repoName}`, branch: "main" },
    });

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    const expectedWorkDir = path.join(os.tmpdir(), `symphony-evaluate-code-${loopId.slice(0, 8)}`);
    assert.ok(existsSync(expectedWorkDir), `Temp dir with 'evaluate-code' label should exist at ${expectedWorkDir}`);

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000
    );
  });
});

// ---------------------------------------------------------------------------
// T-5.2: readEvaluateCodeOutputs unit tests
// ---------------------------------------------------------------------------

describe("T-5.2: readEvaluateCodeOutputs", () => {
  test("(11) code-judges.json present returns codeJudges", () => {
    const tmpDir = makeTempDir("evaluate-code-test");
    const codeJudgesData = { scores: [{ judge: "quality", score: 9 }] };
    writeFileSync(
      path.join(tmpDir, "code-judges.json"),
      JSON.stringify(codeJudgesData)
    );

    const result = readEvaluateCodeOutputs(tmpDir);
    assert.deepEqual(result.codeJudges, codeJudgesData);
  });

  test("(12) code-judges.json absent returns empty without throwing", () => {
    const tmpDir = makeTempDir("evaluate-code-test");
    let result: Record<string, unknown> | undefined;
    assert.doesNotThrow(() => {
      result = readEvaluateCodeOutputs(tmpDir);
    });
    assert.equal(result?.codeJudges, undefined);
  });

  test("(13) malformed code-judges.json returns empty without throwing", () => {
    const tmpDir = makeTempDir("evaluate-code-test");
    writeFileSync(path.join(tmpDir, "code-judges.json"), "not valid json {{{{");
    let result: Record<string, unknown> | undefined;
    assert.doesNotThrow(() => {
      result = readEvaluateCodeOutputs(tmpDir);
    });
    assert.equal(result?.codeJudges, undefined);
  });
});

// ---------------------------------------------------------------------------
// T-5.2: Temp dir cleanup
// ---------------------------------------------------------------------------

describe("T-5.2: Temp dir cleanup after EVALUATE_CODE completes", () => {
  test("(14) temp dir cleaned up after success", async () => {
    const tmpDir = makeTempDir("evaluate-code-test");
    await setupStubClaude(tmpDir, [
      "#!/bin/sh",
      'echo "{}" > "$CLOSEDLOOP_WORKDIR/code-judges.json"',
      'echo \'{"type":"result","subtype":"success","result":"","is_error":false}\'',
      "exit 0",
    ]);

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const repoName = "cleanup-success-repo";
    const repoDir = path.join(tmpDir, repoName);
    await fs.mkdir(repoDir, { recursive: true });

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "a0000005-0000-0000-0000-00000000000b";
    const response = await postEvaluateCode(server.getActivePort(), {
      loopId,
      command: "EVALUATE_CODE",
      closedLoopAuthToken: "cl-token",
      artifacts: [{ type: "IMPLEMENTATION_PLAN", content: "Plan content" }],
      repo: { fullName: `org/${repoName}`, branch: "main" },
    });

    assert.equal(response.status, 200, `Expected 200 on spawn, got ${response.status}`);

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000
    );

    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-code-${loopId.slice(0, 8)}`);

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

  test("(15) temp dir cleaned up after BINARY_NOT_FOUND error", async () => {
    const tmpDir = makeTempDir("evaluate-code-test");

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const repoName = "cleanup-fail-repo";
    const repoDir = path.join(tmpDir, repoName);
    await fs.mkdir(repoDir, { recursive: true });

    const loopId = "a0000006-0000-0000-0000-00000000000c";

    // Trigger BINARY_NOT_FOUND (no claude in PATH) which also cleans up the temp dir
    const emptyBin = path.join(tmpDir, "empty-bin");
    await fs.mkdir(emptyBin, { recursive: true });
    process.env.PATH = emptyBin;

    const response = await postEvaluateCode(server.getActivePort(), {
      loopId,
      command: "EVALUATE_CODE",
      closedLoopAuthToken: "cl-token",
      artifacts: [{ type: "IMPLEMENTATION_PLAN", content: "Plan content" }],
      repo: { fullName: `org/${repoName}`, branch: "main" },
    });

    assert.equal(response.status, 500, `Expected 500 when claude not found, got ${response.status}`);

    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-code-${loopId.slice(0, 8)}`);

    await eventSrv.waitForEvent(
      (b) => b.type === "error",
      5_000
    );

    // Poll for cleanup
    const deadline = Date.now() + 3_000;
    while (existsSync(claudeWorkDir) && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }

    assert.equal(
      existsSync(claudeWorkDir),
      false,
      `Expected temp dir to be cleaned up after error: ${claudeWorkDir}`
    );
  });

  test("(15b) temp dir cleaned up after ARTIFACT_WRITE_FAILED", async (t) => {
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

    // Mock fs.writeFile to throw for plan.md writes, triggering ARTIFACT_WRITE_FAILED
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

    // Poll for cleanup (fs.rm in the ARTIFACT_WRITE_FAILED branch)
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
// T-5.2: BINARY_NOT_FOUND
// ---------------------------------------------------------------------------

describe("T-5.2: BINARY_NOT_FOUND when claude not in PATH", () => {
  test("(16) BINARY_NOT_FOUND error event and HTTP 500 when claude absent", async () => {
    const tmpDir = makeTempDir("evaluate-code-test");
    const emptyBin = path.join(tmpDir, "empty-bin");
    await fs.mkdir(emptyBin, { recursive: true });
    process.env.PATH = emptyBin;

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const repoName = "binary-not-found-repo";
    const repoDir = path.join(tmpDir, repoName);
    await fs.mkdir(repoDir, { recursive: true });

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "a0000007-0000-0000-0000-00000000000d";
    const response = await postEvaluateCode(server.getActivePort(), {
      loopId,
      command: "EVALUATE_CODE",
      closedLoopAuthToken: "cl-token",
      artifacts: [{ type: "IMPLEMENTATION_PLAN", content: "Plan content" }],
      repo: { fullName: `org/${repoName}`, branch: "main" },
    });

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
// T-5.2: Started and completed events
// ---------------------------------------------------------------------------

describe("T-5.2: started + completed events", () => {
  test("(17) started and completed events with subtype='evaluate_code'", async () => {
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
// T-5.2: PLAN_ARTIFACT_TYPES validation
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
