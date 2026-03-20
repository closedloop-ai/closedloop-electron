import fs from "node:fs/promises";
import path from "node:path";
import { readJsonFileSync } from "../read-json-file-sync.js";

/** Minimal artifact shape for PRD resolution (DECOMPOSE / EVALUATE_PRD). */
export interface LoopPrdArtifact {
  type: string;
  content: string;
}

/**
 * Write prd.md to a work directory from a list of artifacts and an optional
 * explicit prompt. Priority: prompt > PRD artifact > FEATURE artifact.
 * Shared by DECOMPOSE and EVALUATE_PRD, which both need the same prd.md.
 */
export async function writePrdArtifact(
  workDir: string,
  artifacts: LoopPrdArtifact[],
  prompt?: string
): Promise<void> {
  let prdContent = prompt ?? null;

  if (!prdContent) {
    const prdArtifact = artifacts.find((a) => a.type === "PRD" || a.type === "prd");
    const featureArtifact = prdArtifact
      ? null
      : artifacts.find((a) => a.type === "FEATURE" || a.type === "artifact");
    const source = prdArtifact ?? featureArtifact;
    if (source?.content) {
      prdContent = source.content;
    }
  }

  if (prdContent) {
    await fs.writeFile(path.join(workDir, "prd.md"), prdContent);
  }
}

export function readEvaluatePrdOutputs(workDir: string): Record<string, unknown> {
  const prdJudges = readJsonFileSync(path.join(workDir, "prd-judges.json"));
  return { prdJudges: prdJudges ?? undefined };
}
