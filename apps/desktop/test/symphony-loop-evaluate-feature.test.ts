/** Tests for symphony-loop EVALUATE_FEATURE command. */

import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { LoopArtifactType } from "@closedloop-ai/loops-api/artifacts";
import {
  EvaluateArtifact,
  readEvaluateOutputs,
  writeFeatureArtifact,
} from "../src/server/operations/symphony-loop.js";
import {
  createEvaluateTestHarness,
  postToLoopEndpoint,
  setupStubClaudeBlocking,
} from "./symphony-test-utils.js";

const harness = createEvaluateTestHarness("evaluate-feature-test-machine");
const { makeTempDir, makeGatewayServer, startEventServer } = harness;

beforeEach(() => harness.beforeEach());
afterEach(() => harness.afterEach());

function buildEvaluateFeatureBody(
  overrides?: Partial<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    loopId: "fe000001-0000-0000-0000-000000000001",
    command: "EVALUATE_FEATURE",
    closedLoopAuthToken: "cl-token",
    apiBaseUrl: "https://api.example.com",
    artifacts: [{ type: "FEATURE", content: "Feature content for evaluation" }],
    ...overrides,
  };
}

describe("EVALUATE_FEATURE", () => {
  test("starts without a repo and writes the Feature artifact into the judge workdir", async () => {
    const tmpDir = makeTempDir("evaluate-feature-no-repo");
    const eventSrv = await startEventServer();
    const apiBaseUrl = `http://127.0.0.1:${eventSrv.port}`;

    const releaseSentinel = path.join(tmpDir, "release-stub");
    const stub = await setupStubClaudeBlocking(tmpDir, releaseSentinel);
    const server = makeGatewayServer({ getApiOrigin: () => apiBaseUrl });
    await server.start();

    const loopId = "fe000004-0000-0000-0000-000000000004";
    const featureContent = "# Feature: User Authentication\n\nDetails here.";
    const response = await postToLoopEndpoint(
      server.getActivePort(),
      buildEvaluateFeatureBody({
        loopId,
        apiBaseUrl,
        artifacts: [{ type: "FEATURE", content: featureContent }],
      }),
    );

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);

    const claudeWorkDir = path.join(
      os.tmpdir(),
      `symphony-evaluate-feature-${loopId.slice(0, 8)}`,
    );
    const prdFile = path.join(claudeWorkDir, "prd.md");
    const promptFile = path.join(claudeWorkDir, "evaluate-feature-prompt.txt");

    assert.equal(await fs.readFile(prdFile, "utf-8"), featureContent);
    assert.ok(existsSync(promptFile), `Prompt file should exist at ${promptFile}`);
    const promptContent = await fs.readFile(promptFile, "utf-8");
    assert.ok(
      promptContent.includes(
        `Activate judges:run-judges skill --artifact-type feature --workdir ${claudeWorkDir}.`,
      ),
      `Prompt should run feature judges, got: ${promptContent}`,
    );
    assert.ok(
      !promptContent.includes("REPO_PATH"),
      `Prompt should omit REPO_PATH when no repo is linked, got: ${promptContent}`,
    );

    await stub.release();
    await eventSrv.waitForEvent(
      (b) => b.type === "completed" || b.type === "error",
      15_000,
    );
  });
});

describe("writeFeatureArtifact", () => {
  test("writes Feature content to prd.md and rejects non-Feature inputs", async () => {
    const tmpDir = makeTempDir("write-feature-artifact");
    await writeFeatureArtifact(tmpDir, [
      { type: LoopArtifactType.Feature, content: "This is the Feature content" },
    ]);
    assert.equal(
      await fs.readFile(path.join(tmpDir, "prd.md"), "utf-8"),
      "This is the Feature content",
    );

    await assert.rejects(
      () => writeFeatureArtifact(tmpDir, []),
      /no LoopArtifactType\.Feature artifact found/,
    );
    await assert.rejects(
      () =>
        writeFeatureArtifact(tmpDir, [
          { type: LoopArtifactType.Prd, content: "PRD content" },
        ]),
      /no LoopArtifactType\.Feature artifact found/,
    );
  });
});

describe("readEvaluateOutputs(EvaluateArtifact.Feature)", () => {
  test("returns featureJudges from feature-judges.json", () => {
    const tmpDir = makeTempDir("read-feature-outputs");
    const featureJudgesData = { scores: [{ judge: "quality", score: 9 }] };
    writeFileSync(
      path.join(tmpDir, "feature-judges.json"),
      JSON.stringify(featureJudgesData),
    );

    const result = readEvaluateOutputs(tmpDir, EvaluateArtifact.Feature);
    assert.deepEqual(result.featureJudges, featureJudgesData);
  });
});
