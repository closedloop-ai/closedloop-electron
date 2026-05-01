/** Tests for symphony-loop EVALUATE_FEATURE command. */

import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  EvaluateArtifact,
  readEvaluateOutputs,
  writeFeatureArtifact,
} from "../src/server/operations/symphony-loop.js";
import { LoopArtifactType } from "@closedloop-ai/loops-api/artifacts";
import { setShellPathForTest } from "../src/server/shell-path.js";
import {
  createEvaluateTestHarness,
  postToLoopEndpoint,
  setupStubClaude,
  setupStubClaudeBlocking,
} from "./symphony-test-utils.js";

// ---------------------------------------------------------------------------
// Shared test harness
// ---------------------------------------------------------------------------

const harness = createEvaluateTestHarness("evaluate-feature-test-machine");
const { makeTempDir, makeGatewayServer, startEventServer } = harness;

beforeEach(() => harness.beforeEach());
afterEach(() => harness.afterEach());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a valid EVALUATE_FEATURE request body. */
function buildEvaluateFeatureBody(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    loopId: "fe000001-0000-0000-0000-000000000001",
    command: "EVALUATE_FEATURE",
    closedLoopAuthToken: "cl-token",
    apiBaseUrl: "https://api.example.com",
    artifacts: [{ type: "FEATURE", content: "Feature content for evaluation" }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// T-4.1a: EVALUATE_FEATURE dispatch validation
// ---------------------------------------------------------------------------

describe("T-4.1a: EVALUATE_FEATURE dispatch validation", () => {
  test("EVALUATE_FEATURE without repo returns non-400 (repo is optional)", async () => {
    // EVALUATE_FEATURE treats repo as OPTIONAL — missing repo should NOT return 400.
    await setupStubClaude(makeTempDir("evaluate-feature-stub"));
    const server = makeGatewayServer();
    await server.start();

    const response = await postToLoopEndpoint(
      server.getActivePort(),
      buildEvaluateFeatureBody(),
    );

    assert.notEqual(response.status, 400, `Expected non-400, got ${response.status}`);
  });

  test("EVALUATE_FEATURE without Feature artifact returns 500 (writeFeatureArtifact throws)", async () => {
    // writeFeatureArtifact requires a LoopArtifactType.Feature artifact.
    // When none is present, the handler posts ArtifactWriteFailed and returns 500.
    const tmpDir = makeTempDir("evaluate-feature-no-artifact");
    await setupStubClaude(tmpDir);
    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer({ getApiOrigin: () => apiBaseUrl });
    await server.start();

    const response = await postToLoopEndpoint(
      server.getActivePort(),
      buildEvaluateFeatureBody({
        loopId: "fe000011-0000-0000-0000-000000000011",
        apiBaseUrl,
        artifacts: [],
      }),
    );

    assert.equal(response.status, 500, `Expected 500 when Feature artifact is missing, got ${response.status}`);
  });

  test("EVALUATE_FEATURE with PRD artifact (not Feature type) returns 500", async () => {
    // writeFeatureArtifact is strict — it only accepts LoopArtifactType.Feature.
    const tmpDir = makeTempDir("evaluate-feature-wrong-type");
    await setupStubClaude(tmpDir);
    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer({ getApiOrigin: () => apiBaseUrl });
    await server.start();

    const response = await postToLoopEndpoint(
      server.getActivePort(),
      buildEvaluateFeatureBody({
        loopId: "fe000012-0000-0000-0000-000000000012",
        apiBaseUrl,
        artifacts: [{ type: "PRD", content: "PRD content (wrong type)" }],
      }),
    );

    assert.equal(response.status, 500, `Expected 500 when only PRD artifact provided (not Feature), got ${response.status}`);
  });

  test("INVALID_COMMAND returns 400", async () => {
    const server = makeGatewayServer();
    await server.start();

    const response = await postToLoopEndpoint(
      server.getActivePort(),
      buildEvaluateFeatureBody({ command: "INVALID_COMMAND" }),
    );

    assert.equal(response.status, 400);
    const body = await response.json() as { error: string };
    assert.ok(body.error.includes("Invalid command"));
  });

  test("EVALUATE_FEATURE ignores stale repo.fullName and still proceeds", async () => {
    const tmpDir = makeTempDir("evaluate-feature-stale-repo");
    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const releaseSentinel = path.join(tmpDir, "release-stub");
    const stub = await setupStubClaudeBlocking(tmpDir, releaseSentinel);

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "fe000002-0000-0000-0000-000000000002";
    const response = await postToLoopEndpoint(
      server.getActivePort(),
      {
        loopId,
        command: "EVALUATE_FEATURE",
        closedLoopAuthToken: "cl-token",
        apiBaseUrl,
        artifacts: [{ type: "FEATURE", content: "Feature content here" }],
        repo: { fullName: "org/missing-repo", branch: "main" },
      },
    );

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-feature-${loopId.slice(0, 8)}`);
    const promptFile = path.join(claudeWorkDir, "evaluate-feature-prompt.txt");
    assert.ok(existsSync(promptFile), `Prompt file should exist at ${promptFile}`);
    const promptContent = await fs.readFile(promptFile, "utf-8");
    assert.ok(
      !promptContent.includes("REPO_PATH"),
      `Prompt should not include REPO_PATH for stale repo metadata, got: ${promptContent}`,
    );

    await stub.release();

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000,
    );
  });

  test("EVALUATE_FEATURE ignores disallowed localRepoPath and still proceeds", async () => {
    const tmpDir = makeTempDir("evaluate-feature-disallowed-repo");
    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const releaseSentinel = path.join(tmpDir, "release-stub");
    const stub = await setupStubClaudeBlocking(tmpDir, releaseSentinel);

    const disallowedRepoPath = path.join(tmpDir, "..", "outside-allowed-dir");
    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "fe000003-0000-0000-0000-000000000003";
    const response = await postToLoopEndpoint(
      server.getActivePort(),
      {
        loopId,
        command: "EVALUATE_FEATURE",
        closedLoopAuthToken: "cl-token",
        apiBaseUrl,
        artifacts: [{ type: "FEATURE", content: "Feature content here" }],
        localRepoPath: disallowedRepoPath,
      },
    );

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-feature-${loopId.slice(0, 8)}`);
    const promptFile = path.join(claudeWorkDir, "evaluate-feature-prompt.txt");
    assert.ok(existsSync(promptFile), `Prompt file should exist at ${promptFile}`);
    const promptContent = await fs.readFile(promptFile, "utf-8");
    assert.ok(
      !promptContent.includes("REPO_PATH"),
      `Prompt should not include REPO_PATH for disallowed localRepoPath, got: ${promptContent}`,
    );

    await stub.release();

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000,
    );
  });
});

// ---------------------------------------------------------------------------
// T-4.1b: writeFeatureArtifact unit tests
// ---------------------------------------------------------------------------

describe("T-4.1b: writeFeatureArtifact", () => {
  test("(a) Feature type artifact writes prd.md", async () => {
    const tmpDir = makeTempDir("write-feature-artifact-a");
    await writeFeatureArtifact(tmpDir, [
      { type: LoopArtifactType.Feature, content: "This is the Feature content" },
    ]);
    const prdPath = path.join(tmpDir, "prd.md");
    assert.ok(existsSync(prdPath), "prd.md should exist");
    const content = await fs.readFile(prdPath, "utf-8");
    assert.equal(content, "This is the Feature content");
  });

  test("(b) empty artifacts throws (strict — no fallback)", async () => {
    const tmpDir = makeTempDir("write-feature-artifact-b");
    await assert.rejects(
      () => writeFeatureArtifact(tmpDir, []),
      /no LoopArtifactType\.Feature artifact found/,
    );
    assert.ok(!existsSync(path.join(tmpDir, "prd.md")), "prd.md should not exist");
  });

  test("(c) PRD artifact alone throws (strict — no fallback to PRD)", async () => {
    const tmpDir = makeTempDir("write-feature-artifact-c");
    await assert.rejects(
      () => writeFeatureArtifact(tmpDir, [
        { type: LoopArtifactType.Prd, content: "PRD content" },
      ]),
      /no LoopArtifactType\.Feature artifact found/,
    );
    assert.ok(!existsSync(path.join(tmpDir, "prd.md")), "prd.md should not exist");
  });

  test("(d) Feature artifact content is written verbatim to prd.md", async () => {
    const tmpDir = makeTempDir("write-feature-artifact-d");
    const featureContent = "# Feature: User Authentication\n\nDetails here.";
    await writeFeatureArtifact(tmpDir, [
      { type: LoopArtifactType.Feature, content: featureContent },
    ]);
    const prdPath = path.join(tmpDir, "prd.md");
    assert.ok(existsSync(prdPath), "prd.md should exist");
    const content = await fs.readFile(prdPath, "utf-8");
    assert.equal(content, featureContent, "Feature content should be written verbatim");
  });

  test("prompt without repo contains --artifact-type feature --workdir but not REPO_PATH=", async () => {
    const tmpDir = makeTempDir("evaluate-feature-prompt-no-repo");
    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const releaseSentinel = path.join(tmpDir, "release-stub");
    const stub = await setupStubClaudeBlocking(tmpDir, releaseSentinel);

    const server = makeGatewayServer({ getApiOrigin: () => apiBaseUrl });
    await server.start();

    const loopId = "fe000004-0000-0000-0000-000000000004";
    const response = await postToLoopEndpoint(
      server.getActivePort(),
      {
        loopId,
        command: "EVALUATE_FEATURE",
        closedLoopAuthToken: "cl-token",
        apiBaseUrl,
        artifacts: [{ type: "FEATURE", content: "Feature content here" }],
        // No repo — prompt should not include REPO_PATH
      },
    );

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-feature-${loopId.slice(0, 8)}`);
    const promptFile = path.join(claudeWorkDir, "evaluate-feature-prompt.txt");

    assert.ok(existsSync(promptFile), `Prompt file should exist at ${promptFile}`);
    const promptContent = await fs.readFile(promptFile, "utf-8");

    await stub.release();

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000,
    );

    assert.ok(
      promptContent.includes(
        `Activate judges:run-judges skill --artifact-type feature --workdir ${claudeWorkDir}.`,
      ),
      `Prompt should contain skill with --artifact-type feature and --workdir runDir, got: ${promptContent}`,
    );
    assert.ok(
      !promptContent.includes("REPO_PATH"),
      `Prompt should NOT contain REPO_PATH when no repo, got: ${promptContent}`,
    );
  });

  test("prompt with repo contains --workdir runDir and REPO_PATH=", async () => {
    const tmpDir = makeTempDir("evaluate-feature-prompt-with-repo");
    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const releaseSentinel = path.join(tmpDir, "release-stub");
    const stub = await setupStubClaudeBlocking(tmpDir, releaseSentinel);

    // Create a fake repo dir for findLocalRepo to discover
    const repoName = "my-feature-repo";
    const repoDir = path.join(tmpDir, repoName);
    await fs.mkdir(repoDir, { recursive: true });

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "fe000005-0000-0000-0000-000000000005";
    const response = await postToLoopEndpoint(
      server.getActivePort(),
      {
        loopId,
        command: "EVALUATE_FEATURE",
        closedLoopAuthToken: "cl-token",
        apiBaseUrl,
        artifacts: [{ type: "FEATURE", content: "Feature content here" }],
        repo: { fullName: `org/${repoName}`, branch: "main" },
      },
    );

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-feature-${loopId.slice(0, 8)}`);
    const promptFile = path.join(claudeWorkDir, "evaluate-feature-prompt.txt");

    assert.ok(existsSync(promptFile), `Prompt file should exist at ${promptFile}`);
    const promptContent = await fs.readFile(promptFile, "utf-8");

    await stub.release();

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000,
    );

    assert.ok(
      promptContent.includes("REPO_PATH="),
      `Prompt should contain REPO_PATH=, got: ${promptContent}`,
    );
    assert.ok(
      promptContent.includes(
        `Activate judges:run-judges skill --artifact-type feature --workdir ${claudeWorkDir}.`,
      ),
      `Prompt should contain skill with --workdir runDir, got: ${promptContent}`,
    );
    assert.ok(
      promptContent.includes(`REPO_PATH=${repoDir}`),
      `Prompt should point REPO_PATH at local repo root, got: ${promptContent}`,
    );
  });
});

// ---------------------------------------------------------------------------
// T-4.1c: readEvaluateOutputs(EvaluateArtifact.Feature) unit tests
// ---------------------------------------------------------------------------

describe("T-4.1c: readEvaluateOutputs(EvaluateArtifact.Feature)", () => {
  test("file exists: returns featureJudges from feature-judges.json", () => {
    const tmpDir = makeTempDir("read-feature-outputs-exists");
    const featureJudgesData = { scores: [{ judge: "quality", score: 9 }] };
    writeFileSync(
      path.join(tmpDir, "feature-judges.json"),
      JSON.stringify(featureJudgesData),
    );

    const result = readEvaluateOutputs(tmpDir, EvaluateArtifact.Feature);
    assert.deepEqual(result.featureJudges, featureJudgesData);
  });

  test("file absent: returns { featureJudges: undefined }", () => {
    const tmpDir = makeTempDir("read-feature-outputs-absent");
    const result = readEvaluateOutputs(tmpDir, EvaluateArtifact.Feature);
    assert.equal(result.featureJudges, undefined);
  });

  test("malformed JSON: returns { featureJudges: undefined } without throwing", () => {
    const tmpDir = makeTempDir("read-feature-outputs-malformed");
    writeFileSync(path.join(tmpDir, "feature-judges.json"), "not valid json {{{{");
    let result: Record<string, unknown> | undefined;
    assert.doesNotThrow(() => {
      result = readEvaluateOutputs(tmpDir, EvaluateArtifact.Feature);
    });
    assert.equal(result?.featureJudges, undefined);
  });
});

// ---------------------------------------------------------------------------
// T-4.1d: Temp dir cleanup via stub claude
// ---------------------------------------------------------------------------

describe("T-4.1d: Temp dir cleanup after EVALUATE_FEATURE completes", () => {
  test("temp dir is removed after claude exits 0 and completed event is received", async () => {
    const tmpDir = makeTempDir("evaluate-feature-cleanup");
    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });

    // Stub claude: writes {} to $CLOSEDLOOP_WORKDIR/feature-judges.json and exits 0
    const stubScript = [
      "#!/bin/sh",
      'echo "{}" > "$CLOSEDLOOP_WORKDIR/feature-judges.json"',
      // One stream-json line starting with { so grep in buildClaudePipeline succeeds.
      'echo \'{"type":"result","subtype":"success","result":"","is_error":false}\'',
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "claude"), stubScript, { mode: 0o755 });
    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
    setShellPathForTest();

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer({ getApiOrigin: () => apiBaseUrl });
    await server.start();

    const loopId = "fe000006-0000-0000-0000-000000000006";
    const response = await postToLoopEndpoint(
      server.getActivePort(),
      {
        loopId,
        command: "EVALUATE_FEATURE",
        closedLoopAuthToken: "cl-token",
        apiBaseUrl,
        artifacts: [{ type: "FEATURE", content: "Feature content for cleanup test" }],
      },
    );

    assert.equal(response.status, 200, `Expected 200 on spawn, got ${response.status}`);

    // Wait for completed or error event from the loop
    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000,
    );

    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-feature-${loopId.slice(0, 8)}`);

    // Poll for fs.rm completion (fire-and-forget in handleProcessCompletion)
    const deadline = Date.now() + 3_000;
    while (existsSync(claudeWorkDir) && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }

    assert.equal(
      existsSync(claudeWorkDir),
      false,
      `Expected temp dir to be cleaned up: ${claudeWorkDir}`,
    );
  });
});

// ---------------------------------------------------------------------------
// T-4.1e: BINARY_NOT_FOUND when claude absent from PATH
// ---------------------------------------------------------------------------

describe("T-4.1e: BINARY_NOT_FOUND when claude not in PATH", () => {
  test("returns HTTP 500 and posts error event with code BINARY_NOT_FOUND", async () => {
    const tmpDir = makeTempDir("evaluate-feature-no-binary");
    const emptyBin = path.join(tmpDir, "empty-bin");
    await fs.mkdir(emptyBin, { recursive: true });
    // No claude binary in emptyBin — PATH points only there
    process.env.PATH = emptyBin;
    setShellPathForTest();

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer({ getApiOrigin: () => apiBaseUrl });
    await server.start();

    const loopId = "fe000007-0000-0000-0000-000000000007";
    const response = await postToLoopEndpoint(
      server.getActivePort(),
      {
        loopId,
        command: "EVALUATE_FEATURE",
        closedLoopAuthToken: "cl-token",
        apiBaseUrl,
        artifacts: [{ type: "FEATURE", content: "Feature content for binary test" }],
      },
    );

    assert.equal(response.status, 500, `Expected 500 when claude not found, got ${response.status}`);

    // Verify the BINARY_NOT_FOUND error event was posted to the event server
    const errorEvent = await eventSrv.waitForEvent(
      (b) => b.type === "error",
      5_000,
    );
    assert.equal(errorEvent.type, "error");
    assert.equal(errorEvent.code, "BINARY_NOT_FOUND");
  });
});
