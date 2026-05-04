/** Tests for writePlanFileToWorkDir delegation via writeCodeArtifact. */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { LoopArtifactType } from "@closedloop-ai/loops-api/artifacts";
import { writeCodeArtifact } from "../src/server/operations/symphony-loop.js";

const tempPathsToClean: string[] = [];

afterEach(async () => {
  for (const p of tempPathsToClean.splice(0)) {
    await fs.rm(p, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "write-plan-artifact-"));
  tempPathsToClean.push(dir);
  return dir;
}

describe("writePlanFileToWorkDir (via writeCodeArtifact)", () => {
  test("writes plan.md from the last ImplementationPlan artifact when no primaryArtifactId", async () => {
    const tmpDir = makeTempDir();
    await writeCodeArtifact(tmpDir, [
      { id: "plan-ref", type: LoopArtifactType.ImplementationPlan, content: "PLAN REF CONTENT" },
      { id: "plan-primary", type: LoopArtifactType.ImplementationPlan, content: "PRIMARY PLAN CONTENT" },
    ]);
    assert.equal(
      await fs.readFile(path.join(tmpDir, "plan.md"), "utf-8"),
      "PRIMARY PLAN CONTENT",
    );
  });

  test("delegates to resolvePrimaryArtifact: primaryArtifactId selects first artifact over findLast", async () => {
    // Both artifacts share LoopArtifactType.ImplementationPlan. Without
    // primaryArtifactId, findLast would select the last (second) artifact.
    // With primaryArtifactId pointing to the first artifact's id, id-based
    // selection wins and the first artifact's content is written to plan.md.
    const tmpDir = makeTempDir();
    await writeCodeArtifact(
      tmpDir,
      [
        { id: "plan-first", type: LoopArtifactType.ImplementationPlan, content: "FIRST PLAN (primary)" },
        { id: "plan-second", type: LoopArtifactType.ImplementationPlan, content: "SECOND PLAN (trailing)" },
      ],
      "plan-first",
    );
    assert.equal(
      await fs.readFile(path.join(tmpDir, "plan.md"), "utf-8"),
      "FIRST PLAN (primary)",
    );
  });

  test("does not write plan.md when no ImplementationPlan artifact is present", async () => {
    const tmpDir = makeTempDir();
    await writeCodeArtifact(tmpDir, [
      { id: "prd-001", type: LoopArtifactType.Prd, content: "PRD content" },
    ]);
    await assert.rejects(
      () => fs.readFile(path.join(tmpDir, "plan.md"), "utf-8"),
      { code: "ENOENT" },
    );
  });
});
