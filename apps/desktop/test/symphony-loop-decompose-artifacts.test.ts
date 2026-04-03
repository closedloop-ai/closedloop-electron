/**
 * Unit tests for DECOMPOSE context-pack staging (writeArtifactsForDecompose).
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { writeArtifactsForDecompose } from "../src/server/operations/symphony-loop.js";

const tempPathsToClean: string[] = [];

afterEach(async () => {
  for (const p of tempPathsToClean.splice(0)) {
    await fs.rm(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

test("writeArtifactsForDecompose writes prd.md under .closedloop-ai/context/artifacts", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "decompose-stage-"));
  tempPathsToClean.push(base);

  const { stagedPrdPath, artifactsDir } = await writeArtifactsForDecompose(base, [
    { type: "PRD", content: "Actual PRD markdown body" },
  ]);

  const expected = path.join(base, ".closedloop-ai", "context", "artifacts", "prd.md");
  assert.equal(stagedPrdPath, expected);
  assert.equal(artifactsDir, path.join(base, ".closedloop-ai", "context", "artifacts"));

  const content = await fs.readFile(expected, "utf8");
  assert.equal(content, "Actual PRD markdown body");
});

test("writeArtifactsForDecompose prefers request prompt over artifacts", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "decompose-prompt-"));
  tempPathsToClean.push(base);

  await writeArtifactsForDecompose(
    base,
    [{ type: "PRD", content: "from artifact" }],
    "from prompt wins",
  );

  const p = path.join(base, ".closedloop-ai", "context", "artifacts", "prd.md");
  assert.equal(await fs.readFile(p, "utf8"), "from prompt wins");
});
