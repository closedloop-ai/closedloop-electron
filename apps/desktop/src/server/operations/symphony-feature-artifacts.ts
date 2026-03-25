import fs from "node:fs/promises";
import path from "node:path";
import { readJsonFileSync } from "../read-json-file-sync.js";

/** Minimal artifact shape for feature resolution (EVALUATE_FEATURE). */
export interface LoopFeatureArtifact {
  type: string;
  content: string;
  id?: string;
  title?: string;
}

/**
 * Write feature artifact files to a work directory from a list of artifacts
 * and an optional explicit prompt. Filters by FEATURE type and writes each
 * artifact to artifacts/feature-<safeId>.md.
 */
export async function writeFeatureArtifact(
  workDir: string,
  artifacts: LoopFeatureArtifact[],
  prompt?: string
): Promise<void> {
  await fs.mkdir(path.join(workDir, "artifacts"), { recursive: true });

  const featureArtifacts = artifacts.filter(
    (a) => a.type.toUpperCase() === "FEATURE"
  );

  for (const artifact of featureArtifacts) {
    const safeId = (artifact.id ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
    await fs.writeFile(
      path.join(workDir, "artifacts", "feature-" + safeId + ".md"),
      artifact.content
    );
  }

  if (prompt) {
    await fs.writeFile(path.join(workDir, "prompt.md"), prompt);
  }
}

export function readEvaluateFeatureOutputs(workDir: string): Record<string, unknown> {
  const featureJudges = readJsonFileSync(path.join(workDir, "feature-judges.json"));
  return { featureJudges: featureJudges ?? undefined };
}
