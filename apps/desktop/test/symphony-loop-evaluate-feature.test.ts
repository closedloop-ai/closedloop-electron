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
import {
  createEvaluateTestHarness,
  postToLoopEndpoint,
  setupStubClaude,
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

function buildEvaluateFeatureBody(
  overrides?: Partial<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    loopId: "ef000001-0000-0000-0000-000000000001",
    command: "EVALUATE_FEATURE",
    closedLoopAuthToken: "cl-token",
    artifacts: [{ type: "FEATURE", content: "Feature content" }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Dispatch validation
// ---------------------------------------------------------------------------

describe("EVALUATE_FEATURE dispatch validation", () => {
  test("without repo returns non-400 (repo is optional)", async () => {
    await setupStubClaude(makeTempDir("ef-stub"));
    const server = makeGatewayServer();
    await server.start();

    const response = await postToLoopEndpoint(
      server.getActivePort(),
      buildEvaluateFeatureBody(),
    );

    assert.notEqual(
      response.status,
      400,
      `Expected non-400, got ${response.status}`,
    );
  });

  test("without FEATURE artifact returns 400", async () => {
    await setupStubClaude(makeTempDir("ef-missing-feature"));
    const server = makeGatewayServer();
    await server.start();

    const response = await postToLoopEndpoint(server.getActivePort(), {
      loopId: "ef000006-0000-0000-0000-000000000006",
      command: "EVALUATE_FEATURE",
      closedLoopAuthToken: "cl-token",
      artifacts: [],
    });

    assert.equal(response.status, 400, `Expected 400, got ${response.status}`);
  });
});

// ---------------------------------------------------------------------------
// writeFeatureArtifact unit tests
// ---------------------------------------------------------------------------

describe("writeFeatureArtifact", () => {
  test("FEATURE-type artifact writes prd.md", async () => {
    const tmpDir = makeTempDir("ef-write-feature");
    await writeFeatureArtifact(tmpDir, [
      { type: "FEATURE", content: "This is the feature content" },
    ]);
    const prdPath = path.join(tmpDir, "prd.md");
    assert.ok(existsSync(prdPath), "prd.md should exist");
    const content = await fs.readFile(prdPath, "utf-8");
    assert.equal(content, "This is the feature content");
  });

  test("ignores PRD-type artifact and only uses FEATURE-type artifact", async () => {
    const tmpDir = makeTempDir("ef-ignore-prd");
    await writeFeatureArtifact(tmpDir, [
      { type: "PRD", content: "PRD content — should be ignored" },
      { type: "FEATURE", content: "Feature content — should win" },
    ]);
    const prdPath = path.join(tmpDir, "prd.md");
    assert.ok(existsSync(prdPath), "prd.md should exist");
    const content = await fs.readFile(prdPath, "utf-8");
    assert.equal(content, "Feature content — should win");
  });

  test("only PRD artifact does not write prd.md", async () => {
    const tmpDir = makeTempDir("ef-only-prd");
    await writeFeatureArtifact(tmpDir, [
      { type: "PRD", content: "PRD-only content" },
    ]);
    assert.ok(
      !existsSync(path.join(tmpDir, "prd.md")),
      "prd.md should not exist for PRD-only artifact",
    );
  });

  test("ignores lowercase feature type", async () => {
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
// Prompt content assertions
// ---------------------------------------------------------------------------

describe("EVALUATE_FEATURE prompt content", () => {
  test("prompt without repo contains --artifact-type feature but not REPO_PATH", async () => {
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
    });

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    const claudeWorkDir = path.join(
      os.tmpdir(),
      `symphony-evaluate-feature-${loopId.slice(0, 8)}`,
    );
    const promptFile = path.join(claudeWorkDir, "evaluate-feature-prompt.txt");
    assert.ok(existsSync(promptFile), `Prompt file should exist at ${promptFile}`);
    const promptContent = await fs.readFile(promptFile, "utf-8");

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000,
    );

    assert.ok(
      promptContent.includes("--artifact-type feature"),
      `Prompt should contain --artifact-type feature, got: ${promptContent}`,
    );
    assert.ok(
      !promptContent.includes("REPO_PATH"),
      `Prompt should NOT contain REPO_PATH when no repo, got: ${promptContent}`,
    );
  });

  test("prompt with repo contains both --artifact-type feature and REPO_PATH", async () => {
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

    const claudeWorkDir = path.join(
      os.tmpdir(),
      `symphony-evaluate-feature-${loopId.slice(0, 8)}`,
    );
    const promptFile = path.join(claudeWorkDir, "evaluate-feature-prompt.txt");
    assert.ok(existsSync(promptFile), `Prompt file should exist at ${promptFile}`);
    const promptContent = await fs.readFile(promptFile, "utf-8");

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000,
    );

    assert.ok(
      promptContent.includes("--artifact-type feature"),
      `Prompt should contain --artifact-type feature, got: ${promptContent}`,
    );
    assert.ok(
      promptContent.includes("REPO_PATH="),
      `Prompt should contain REPO_PATH= when repo is present, got: ${promptContent}`,
    );
    assert.ok(
      promptContent.includes(`REPO_PATH=${repoDir}`),
      `Prompt should point REPO_PATH at local repo root, got: ${promptContent}`,
    );
  });

  test("prompt file is named evaluate-feature-prompt.txt", async () => {
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
      artifacts: [{ type: "FEATURE", content: "Feature content" }],
    });

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    const claudeWorkDir = path.join(
      os.tmpdir(),
      `symphony-evaluate-feature-${loopId.slice(0, 8)}`,
    );
    assert.ok(
      existsSync(path.join(claudeWorkDir, "evaluate-feature-prompt.txt")),
      "evaluate-feature-prompt.txt should exist",
    );
    assert.ok(
      !existsSync(path.join(claudeWorkDir, "evaluate-prd-prompt.txt")),
      "evaluate-prd-prompt.txt should NOT exist",
    );

    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000,
    );
  });
});

// ---------------------------------------------------------------------------
// readEvaluateFeatureOutputs unit tests
// ---------------------------------------------------------------------------

describe("readEvaluateFeatureOutputs", () => {
  test("returns undefined for missing file", () => {
    const tmpDir = makeTempDir("ef-read-missing");
    const result = readEvaluateFeatureOutputs(tmpDir);
    assert.ok("featureJudges" in result, "result should have featureJudges key");
    assert.equal(result.featureJudges, undefined);
  });

  test("returns featureJudges: undefined for malformed JSON without throwing", () => {
    const tmpDir = makeTempDir("ef-read-malformed");
    writeFileSync(
      path.join(tmpDir, "feature-judges.json"),
      "not valid json {{{{",
    );
    let result: Record<string, unknown> | undefined;
    assert.doesNotThrow(() => {
      result = readEvaluateFeatureOutputs(tmpDir);
    });
    assert.equal(result?.featureJudges, undefined);
  });
});

// ---------------------------------------------------------------------------
// Artifact upload payload
// ---------------------------------------------------------------------------

describe("EVALUATE_FEATURE artifact upload payload", () => {
  test("upload-artifacts payload includes featureJudges (not on completed event)", async () => {
    const tmpDir = makeTempDir("ef-upload-payload");
    const featureJudgesData = JSON.stringify({
      scores: [{ judge: "coherence", score: 7 }],
    });
    await setupStubClaude(tmpDir, [
      "#!/bin/sh",
      `echo '${featureJudgesData}' > "$CLOSEDLOOP_WORKDIR/feature-judges.json"`,
      'echo \'{"type":"result","subtype":"success","result":"","is_error":false}\'',
      "exit 0",
    ]);

    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const server = makeGatewayServer({ getApiOrigin: () => apiBaseUrl });
    await server.start();

    const loopId = "ef000016-0000-0000-0000-000000000016";
    const response = await postToLoopEndpoint(server.getActivePort(), {
      loopId,
      command: "EVALUATE_FEATURE",
      closedLoopAuthToken: "cl-token",
      artifacts: [{ type: "FEATURE", content: "Feature content" }],
    });

    assert.equal(
      response.status,
      200,
      `Expected 200 on spawn, got ${response.status}`,
    );

    const uploadBody = await eventSrv.waitForEvent(
      (b) =>
        typeof b === "object" &&
        b !== null &&
        "artifacts" in b &&
        typeof (b as { artifacts: unknown }).artifacts === "object" &&
        (b as { artifacts: Record<string, unknown> }).artifacts !== null &&
        "featureJudges" in
          (b as { artifacts: Record<string, unknown> }).artifacts,
      15_000,
    );

    const artifacts = (uploadBody as { artifacts: { featureJudges: unknown } })
      .artifacts;
    assert.deepEqual(artifacts.featureJudges, JSON.parse(featureJudgesData));

    const completedEvent = await eventSrv.waitForEvent(
      (b) => b.type === "completed",
      15_000,
    );
    assert.equal(completedEvent.type, "completed");
    assert.ok(
      !("featureJudges" in completedEvent),
      "completed event should not carry top-level featureJudges",
    );
  });
});
