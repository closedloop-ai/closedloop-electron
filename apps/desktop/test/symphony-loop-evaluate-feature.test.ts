/** Tests for symphony-loop EVALUATE_FEATURE command. */

import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  readEvaluateFeatureOutputs,
  writeFeatureArtifact,
} from "../src/server/operations/symphony-loop.js";
import { createEvaluateTestHarness, postToLoopEndpoint, setupStubClaude } from "./symphony-test-utils.js";

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
    loopId: "ef000001-0000-0000-0000-000000000001",
    command: "EVALUATE_FEATURE",
    closedLoopAuthToken: "cl-token",
    artifacts: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// T-6.1(1): EVALUATE_FEATURE dispatch validation
// ---------------------------------------------------------------------------

describe("T-6.1: EVALUATE_FEATURE dispatch validation", () => {
  test("(1) EVALUATE_FEATURE without repo returns non-400", async () => {
    // EVALUATE_FEATURE treats repo as optional — repo is not required.
    // It may return 200 (spawn succeeds) or 500 (claude not found) but never 400.
    await setupStubClaude(makeTempDir("ef-stub"));
    const server = makeGatewayServer();
    await server.start();

    const response = await postToLoopEndpoint(
      server.getActivePort(),
      buildEvaluateFeatureBody()
    );

    assert.notEqual(response.status, 400, `Expected non-400, got ${response.status}`);
  });

  test("(2) EVALUATE_FEATURE with disallowed localRepoPath still proceeds", async () => {
    const tmpDir = makeTempDir("ef-disallowed");
    await setupStubClaude(tmpDir);

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const disallowedRepoPath = path.join(tmpDir, "..", "outside-allowed-dir");
    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "ef000002-0000-0000-0000-000000000002";
    const response = await postToLoopEndpoint(server.getActivePort(), {
      loopId,
      command: "EVALUATE_FEATURE",
      closedLoopAuthToken: "cl-token",
      artifacts: [{ type: "FEATURE", content: "Feature content" }],
      localRepoPath: disallowedRepoPath,
    });

    assert.equal(response.status, 200, `Expected 200 even with disallowed localRepoPath, got ${response.status}`);

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000
    );
  });
});

// ---------------------------------------------------------------------------
// T-6.1: writeFeatureArtifact unit tests
// ---------------------------------------------------------------------------

describe("T-6.1: writeFeatureArtifact", () => {
  test("(3) FEATURE-type artifact writes prd.md", async () => {
    const tmpDir = makeTempDir("ef-write-feature");
    await writeFeatureArtifact(tmpDir, [
      { type: "FEATURE", content: "This is the feature content" },
    ]);
    const prdPath = path.join(tmpDir, "prd.md");
    assert.ok(existsSync(prdPath), "prd.md should exist");
    const content = await fs.readFile(prdPath, "utf-8");
    assert.equal(content, "This is the feature content");
  });

  test("(4) writeFeatureArtifact ignores PRD-type artifact and only uses FEATURE-type artifact", async () => {
    const tmpDir = makeTempDir("ef-ignore-prd");
    await writeFeatureArtifact(tmpDir, [
      { type: "PRD", content: "PRD content — should be ignored" },
      { type: "FEATURE", content: "Feature content — should win" },
    ]);
    const prdPath = path.join(tmpDir, "prd.md");
    assert.ok(existsSync(prdPath), "prd.md should exist");
    const content = await fs.readFile(prdPath, "utf-8");
    assert.equal(content, "Feature content — should win", "FEATURE artifact content should win over PRD");
  });

  test("(5) writeFeatureArtifact with only PRD artifact does not write prd.md", async () => {
    const tmpDir = makeTempDir("ef-only-prd");
    await writeFeatureArtifact(tmpDir, [
      { type: "PRD", content: "PRD-only content" },
    ]);
    assert.ok(!existsSync(path.join(tmpDir, "prd.md")), "prd.md should not exist for PRD-only artifact");
  });

  test("(6) writeFeatureArtifact with empty artifacts does not throw", async () => {
    const tmpDir = makeTempDir("ef-empty");
    await assert.doesNotReject(() => writeFeatureArtifact(tmpDir, []));
    assert.ok(!existsSync(path.join(tmpDir, "prd.md")), "prd.md should not exist when no artifacts");
  });

  test("(7) writeFeatureArtifact ignores lowercase feature type", async () => {
    const tmpDir = makeTempDir("ef-lowercase");
    await writeFeatureArtifact(tmpDir, [
      { type: "feature", content: "Lowercase feature content" },
    ]);
    assert.ok(
      !existsSync(path.join(tmpDir, "prd.md")),
      "prd.md should not exist for lowercase feature type",
    );
  });
});

// ---------------------------------------------------------------------------
// T-6.1: Prompt content assertions
// ---------------------------------------------------------------------------

describe("T-6.1: EVALUATE_FEATURE prompt content", () => {
  test("(8) prompt without repo contains --artifact-type feature but not REPO_PATH", async () => {
    const tmpDir = makeTempDir("ef-prompt-no-repo");
    await setupStubClaude(tmpDir);

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer({ getApiOrigin: () => apiBaseUrl });
    await server.start();

    const loopId = "ef000008-0000-0000-0000-000000000008";
    const response = await postToLoopEndpoint(server.getActivePort(), {
      loopId,
      command: "EVALUATE_FEATURE",
      closedLoopAuthToken: "cl-token",
      artifacts: [{ type: "FEATURE", content: "Feature content here" }],
      // No repo
    });

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    // Prompt file is written before the 200 response is sent — safe to read here.
    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-feature-${loopId.slice(0, 8)}`);
    const promptFile = path.join(claudeWorkDir, "evaluate-feature-prompt.txt");
    assert.ok(existsSync(promptFile), `Prompt file should exist at ${promptFile}`);
    const promptContent = await fs.readFile(promptFile, "utf-8");

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000
    );

    assert.ok(
      promptContent.includes("--artifact-type feature"),
      `Prompt should contain --artifact-type feature, got: ${promptContent}`
    );
    assert.ok(
      !promptContent.includes("REPO_PATH"),
      `Prompt should NOT contain REPO_PATH when no repo, got: ${promptContent}`
    );
  });

  test("(9) prompt with repo contains both --artifact-type feature and REPO_PATH", async () => {
    const tmpDir = makeTempDir("ef-prompt-with-repo");
    await setupStubClaude(tmpDir);

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const repoName = "my-feature-repo";
    const repoDir = path.join(tmpDir, repoName);
    await fs.mkdir(repoDir, { recursive: true });

    const server = makeGatewayServer({
      allowedDirs: [tmpDir],
      getApiOrigin: () => apiBaseUrl,
    });
    await server.start();

    const loopId = "ef000009-0000-0000-0000-000000000009";
    const response = await postToLoopEndpoint(server.getActivePort(), {
      loopId,
      command: "EVALUATE_FEATURE",
      closedLoopAuthToken: "cl-token",
      artifacts: [{ type: "FEATURE", content: "Feature content here" }],
      repo: { fullName: `org/${repoName}`, branch: "main" },
    });

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-feature-${loopId.slice(0, 8)}`);
    const promptFile = path.join(claudeWorkDir, "evaluate-feature-prompt.txt");
    assert.ok(existsSync(promptFile), `Prompt file should exist at ${promptFile}`);
    const promptContent = await fs.readFile(promptFile, "utf-8");

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000
    );

    assert.ok(
      promptContent.includes("--artifact-type feature"),
      `Prompt should contain --artifact-type feature, got: ${promptContent}`
    );
    assert.ok(
      promptContent.includes("REPO_PATH="),
      `Prompt should contain REPO_PATH= when repo is present, got: ${promptContent}`
    );
    assert.ok(
      promptContent.includes(`REPO_PATH=${repoDir}`),
      `Prompt should point REPO_PATH at local repo root, got: ${promptContent}`
    );
  });

  test("(10) prompt file is named evaluate-feature-prompt.txt, not evaluate-prd-prompt.txt", async () => {
    const tmpDir = makeTempDir("ef-prompt-filename");
    await setupStubClaude(tmpDir);

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer({ getApiOrigin: () => apiBaseUrl });
    await server.start();

    const loopId = "ef000010-0000-0000-0000-000000000010";
    const response = await postToLoopEndpoint(server.getActivePort(), {
      loopId,
      command: "EVALUATE_FEATURE",
      closedLoopAuthToken: "cl-token",
      artifacts: [],
    });

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-feature-${loopId.slice(0, 8)}`);
    assert.ok(
      existsSync(path.join(claudeWorkDir, "evaluate-feature-prompt.txt")),
      "evaluate-feature-prompt.txt should exist"
    );
    assert.ok(
      !existsSync(path.join(claudeWorkDir, "evaluate-prd-prompt.txt")),
      "evaluate-prd-prompt.txt should NOT exist"
    );

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000
    );
  });
});

// ---------------------------------------------------------------------------
// T-6.1: readEvaluateFeatureOutputs unit tests
// ---------------------------------------------------------------------------

describe("T-6.1: readEvaluateFeatureOutputs", () => {
  test("(11) reads feature-judges.json and returns featureJudges key", () => {
    const tmpDir = makeTempDir("ef-read-feature");
    const featureJudgesData = { scores: [{ judge: "quality", score: 9 }] };
    writeFileSync(
      path.join(tmpDir, "feature-judges.json"),
      JSON.stringify(featureJudgesData)
    );

    const result = readEvaluateFeatureOutputs(tmpDir);
    assert.ok("featureJudges" in result, "result should have featureJudges key");
    assert.deepEqual(result.featureJudges, featureJudgesData);
  });

  test("(12) returns undefined for missing file", () => {
    const tmpDir = makeTempDir("ef-read-missing");
    const result = readEvaluateFeatureOutputs(tmpDir);
    assert.ok("featureJudges" in result, "result should have featureJudges key");
    assert.equal(result.featureJudges, undefined);
  });

  test("(13) returns featureJudges: undefined for malformed JSON without throwing", () => {
    const tmpDir = makeTempDir("ef-read-malformed");
    writeFileSync(path.join(tmpDir, "feature-judges.json"), "not valid json {{{{");
    let result: Record<string, unknown> | undefined;
    assert.doesNotThrow(() => {
      result = readEvaluateFeatureOutputs(tmpDir);
    });
    assert.equal(result?.featureJudges, undefined);
  });
});

// ---------------------------------------------------------------------------
// T-6.1: Temp dir cleanup
// ---------------------------------------------------------------------------

describe("T-6.1: Temp dir cleanup after EVALUATE_FEATURE completes", () => {
  test("(14) temp dir cleanup after completion", async () => {
    const tmpDir = makeTempDir("ef-cleanup");
    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });

    // stub claude: writes {} to $CLOSEDLOOP_WORKDIR/feature-judges.json and exits 0
    const stubScript = [
      "#!/bin/sh",
      'echo "{}" > "$CLOSEDLOOP_WORKDIR/feature-judges.json"',
      'echo \'{"type":"result","subtype":"success","result":"","is_error":false}\'',
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "claude"), stubScript, { mode: 0o755 });

    const { setShellPathForTest } = await import("../src/server/shell-path.js");
    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
    setShellPathForTest();

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer({ getApiOrigin: () => apiBaseUrl });
    await server.start();

    const loopId = "ef000014-0000-0000-0000-000000000014";
    const response = await postToLoopEndpoint(server.getActivePort(), {
      loopId,
      command: "EVALUATE_FEATURE",
      closedLoopAuthToken: "cl-token",
      artifacts: [],
    });

    assert.equal(response.status, 200, `Expected 200 on spawn, got ${response.status}`);

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000
    );

    const claudeWorkDir = path.join(os.tmpdir(), `symphony-evaluate-feature-${loopId.slice(0, 8)}`);

    // Poll for fs.rm completion (fire-and-forget in handleProcessCompletion).
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
// T-6.1: BINARY_NOT_FOUND when claude absent from PATH
// ---------------------------------------------------------------------------

describe("T-6.1: BINARY_NOT_FOUND when claude not in PATH", () => {
  test("(15) BINARY_NOT_FOUND error event when claude absent", async () => {
    const tmpDir = makeTempDir("ef-no-binary");
    const emptyBin = path.join(tmpDir, "empty-bin");
    await fs.mkdir(emptyBin, { recursive: true });
    // No claude binary — PATH points only to empty dir
    const { setShellPathForTest } = await import("../src/server/shell-path.js");
    process.env.PATH = emptyBin;
    setShellPathForTest();

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer({ getApiOrigin: () => apiBaseUrl });
    await server.start();

    const loopId = "ef000015-0000-0000-0000-000000000015";
    const response = await postToLoopEndpoint(server.getActivePort(), {
      loopId,
      command: "EVALUATE_FEATURE",
      closedLoopAuthToken: "cl-token",
      artifacts: [],
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
// T-6.1: artifact upload payload (mirrors EVALUATE_PRD — judges on upload, not on completed)
// ---------------------------------------------------------------------------

describe("T-6.1: artifact upload payload", () => {
  test("(16) upload-artifacts payload includes featureJudges (not on completed event)", async () => {
    const tmpDir = makeTempDir("ef-upload-payload");
    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });

    // stub claude: writes feature-judges.json and exits 0
    const featureJudgesData = JSON.stringify({ scores: [{ judge: "coherence", score: 7 }] });
    const stubScript = [
      "#!/bin/sh",
      `echo '${featureJudgesData}' > "$CLOSEDLOOP_WORKDIR/feature-judges.json"`,
      'echo \'{"type":"result","subtype":"success","result":"","is_error":false}\'',
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "claude"), stubScript, { mode: 0o755 });

    const { setShellPathForTest } = await import("../src/server/shell-path.js");
    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
    setShellPathForTest();

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer({ getApiOrigin: () => apiBaseUrl });
    await server.start();

    const loopId = "ef000016-0000-0000-0000-000000000016";
    const response = await postToLoopEndpoint(server.getActivePort(), {
      loopId,
      command: "EVALUATE_FEATURE",
      closedLoopAuthToken: "cl-token",
      artifacts: [],
    });

    assert.equal(response.status, 200, `Expected 200 on spawn, got ${response.status}`);

    const uploadBody = await eventSrv.waitForEvent(
      (b) =>
        typeof b === "object" &&
        b !== null &&
        "artifacts" in b &&
        typeof (b as { artifacts: unknown }).artifacts === "object" &&
        (b as { artifacts: Record<string, unknown> }).artifacts !== null &&
        "featureJudges" in (b as { artifacts: Record<string, unknown> }).artifacts,
      15_000
    );

    const artifacts = (uploadBody as { artifacts: { featureJudges: unknown } }).artifacts;
    assert.deepEqual(artifacts.featureJudges, JSON.parse(featureJudgesData));

    const completedEvent = await eventSrv.waitForEvent(
      (b) => b.type === "completed",
      15_000
    );
    assert.equal(completedEvent.type, "completed");
    assert.ok(
      !("featureJudges" in completedEvent),
      "completed event should not carry top-level featureJudges (parity with EVALUATE_PRD)"
    );
  });
});
