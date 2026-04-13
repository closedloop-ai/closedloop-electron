import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { readTextFile } from "../../main/diagnostics-helpers.js";
import { readJsonFileSync } from "../read-json-file-sync.js";
import {
  LoopArtifactFile,
  LoopArtifactType,
} from "@closedloop-ai/loops-api/artifacts";
import type { LoopArtifact, ContextPackAttachment } from "./symphony-loop-types.js";
import { PLAN_ARTIFACT_TYPES } from "./symphony-loop-types.js";

// ---------------------------------------------------------------------------
// Per-command artifact writing
// ---------------------------------------------------------------------------

/**
 * Write prd.md to a work directory from a list of artifacts and an optional
 * explicit prompt.
 *
 * The PRD artifact content is always preferred for prd.md when present.
 * Fallback priority: PRD artifact > FEATURE artifact > prompt.
 *
 * When a prompt is provided alongside a PRD artifact, both are written:
 * - prd.md  <- artifact content (what Claude needs to read)
 * - prompt.md <- decompose/evaluate instructions (written by caller)
 */
export async function writePrdArtifact(
  workDir: string,
  artifacts: LoopArtifact[],
  prompt?: string,
): Promise<void> {
  const prdArtifact = artifacts.find((a) => a.type === LoopArtifactType.Prd);
  const featureArtifact = prdArtifact
    ? null
    : artifacts.find((a) => a.type === LoopArtifactType.Feature);
  const source = prdArtifact ?? featureArtifact;

  const prdContent = source?.content || prompt || "";

  if (prdContent) {
    await fs.writeFile(path.join(workDir, LoopArtifactFile.Prd), prdContent);
  }
}

/** Internal helper: writes plan.md to workDir from the first matching plan artifact. */
async function writePlanFileToWorkDir(
  workDir: string,
  artifacts: LoopArtifact[],
): Promise<void> {
  const artifact = artifacts.find((a) =>
    (PLAN_ARTIFACT_TYPES as readonly string[]).includes(a.type),
  );
  if (artifact?.content) {
    await fs.writeFile(
      path.join(workDir, LoopArtifactFile.PlanMarkdown),
      artifact.content,
    );
  }
}

/** Write both prd.md and plan.md to a work directory from a list of artifacts. */
export async function writePlanArtifact(
  workDir: string,
  artifacts: LoopArtifact[],
  prompt?: string,
): Promise<void> {
  await writePrdArtifact(workDir, artifacts, prompt);
  await writePlanFileToWorkDir(workDir, artifacts);
}

/** Write plan.md to a work directory from a list of artifacts. */
export async function writeCodeArtifact(
  workDir: string,
  artifacts: LoopArtifact[],
): Promise<void> {
  await writePlanFileToWorkDir(workDir, artifacts);
}

/**
 * Read outputs produced by an EVALUATE_{type} loop iteration.
 * Returns undefined values for missing or unreadable files.
 */
function readEvaluateOutputs(
  workDir: string,
  artifactType: string,
): Record<string, unknown> {
  const judges = readJsonFileSync(
    path.join(workDir, `${artifactType}-judges.json`),
  );
  return { [`${artifactType}Judges`]: judges ?? undefined };
}

export function readEvaluatePrdOutputs(
  workDir: string,
): Record<string, unknown> {
  return readEvaluateOutputs(workDir, "prd");
}

export function readEvaluatePlanOutputs(
  workDir: string,
): Record<string, unknown> {
  return readEvaluateOutputs(workDir, "plan");
}

export function readEvaluateCodeOutputs(
  workDir: string,
): Record<string, unknown> {
  return readEvaluateOutputs(workDir, "code");
}

/**
 * Download attachment files to {claudeWorkDir}/attachments/{attachmentId}-{sanitizedFilename}.
 * Non-fatal: logs warnings and skips individual failures without aborting.
 */
export async function downloadAttachmentsToDisk(
  claudeWorkDir: string,
  attachments?: ContextPackAttachment[],
): Promise<void> {
  if (!attachments || attachments.length === 0) {
    return;
  }

  const attachmentsDir = path.join(claudeWorkDir, "attachments");
  mkdirSync(attachmentsDir, { recursive: true });

  for (const attachment of attachments) {
    try {
      const expiresAt = new Date(attachment.signedUrlExpiresAt);
      if (expiresAt <= new Date()) {
        console.warn(
          `[downloadAttachmentsToDisk] Attachment ${attachment.id} signedUrl expired at ${attachment.signedUrlExpiresAt}, skipping`,
        );
        continue;
      }

      const safeName = path
        .basename(attachment.filename)
        .replaceAll(/[^a-zA-Z0-9._-]/g, "_");
      const diskName = `${attachment.id}-${safeName}`;
      const diskPath = path.resolve(attachmentsDir, diskName);

      if (
        !diskPath.startsWith(attachmentsDir + path.sep) &&
        diskPath !== attachmentsDir
      ) {
        console.warn(
          `[downloadAttachmentsToDisk] Attachment ${attachment.id} resolved path escapes attachmentsDir, skipping`,
        );
        continue;
      }

      const response = await fetch(attachment.signedUrl);
      if (!response.ok) {
        console.warn(
          `[downloadAttachmentsToDisk] Attachment ${attachment.id} fetch failed: ${response.status} ${response.statusText}, skipping`,
        );
        continue;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length > attachment.sizeBytes) {
        console.warn(
          `[downloadAttachmentsToDisk] Attachment ${attachment.id} buffer size ${buffer.length} exceeds declared sizeBytes ${attachment.sizeBytes}, skipping`,
        );
        continue;
      }
      if (buffer.length < attachment.sizeBytes) {
        console.warn(
          `[downloadAttachmentsToDisk] Attachment ${attachment.id} downloaded ${buffer.length} bytes but expected ${attachment.sizeBytes}, may be truncated -- writing anyway`,
        );
      }

      writeFileSync(diskPath, buffer);
    } catch (err) {
      console.warn(
        `[downloadAttachmentsToDisk] Failed to download attachment ${attachment.id}:`,
        err,
      );
    }
  }
}

/**
 * Write PRD for PLAN command.
 * Matches ECS harness writePrdFile(): prompt first, then PRD artifact, then FEATURE.
 */
export async function writeArtifactsForPlan(
  claudeWorkDir: string,
  artifacts: LoopArtifact[],
  prdContent: string | null = null,
  userContext?: string,
  attachments?: ContextPackAttachment[],
): Promise<void> {
  // Priority: explicit prompt > PRD artifact > FEATURE artifact (matches harness)

  if (!prdContent) {
    const prdArtifact = artifacts.find((a) => a.type === LoopArtifactType.Prd);
    const featureArtifact = prdArtifact
      ? null
      : artifacts.find((a) => a.type === LoopArtifactType.Feature);
    const source = prdArtifact ?? featureArtifact;
    if (source?.content) {
      prdContent = source.content;
    }
  }

  // Append user-supplied Additional Context to the PRD so the planning agent
  // sees it as part of the requirements (guaranteed to be read). Written as a
  // clearly delineated section at the end of prd.md.
  const safeUserContext =
    typeof userContext === "string" ? userContext.trim() : "";
  if (safeUserContext) {
    const section =
      "\n\n---\n\n## User Context / Additional Constraints\n\n" +
      safeUserContext +
      "\n";
    prdContent = prdContent ? prdContent + section : section;
  }

  if (prdContent) {
    await fs.writeFile(
      path.join(claudeWorkDir, LoopArtifactFile.Prd),
      prdContent,
    );
  }

  await downloadAttachmentsToDisk(claudeWorkDir, attachments);
}

export async function writeArtifactsForExecuteOrAmend(
  claudeWorkDir: string,
  artifacts: LoopArtifact[],
  prompt?: string,
  attachments?: ContextPackAttachment[],
): Promise<void> {
  for (const artifact of artifacts) {
    if (artifact.type === LoopArtifactType.ImplementationPlan) {
      // Sync plan content like ECS harness's syncPlanFromContextPack():
      // If plan.json already exists (from parent PLAN loop), update only the
      // .content field -- preserving tasks, openQuestions, metadata, etc.
      // This picks up manual edits the user made in the Liveblocks editor.
      const planJsonPath = path.join(claudeWorkDir, LoopArtifactFile.Plan);
      if (existsSync(planJsonPath)) {
        try {
          const existing = JSON.parse(
            readFileSync(planJsonPath, "utf-8"),
          ) as Record<string, unknown>;
          existing.content = artifact.content;
          await fs.writeFile(planJsonPath, JSON.stringify(existing, null, 2));
        } catch {
          // If existing plan.json is corrupt, overwrite entirely.
          // Apply same JSON validation as the no-existing-file path.
          try {
            JSON.parse(artifact.content);
            await fs.writeFile(planJsonPath, artifact.content);
          } catch {
            await fs.writeFile(
              planJsonPath,
              JSON.stringify({ content: artifact.content }, null, 2),
            );
          }
        }
      } else {
        // No existing plan.json -- write the content as-is.
        // If it's valid JSON, write directly. Otherwise wrap it.
        try {
          JSON.parse(artifact.content);
          await fs.writeFile(planJsonPath, artifact.content);
        } catch {
          await fs.writeFile(
            planJsonPath,
            JSON.stringify({ content: artifact.content }, null, 2),
          );
        }
      }
    } else if (
      artifact.type === LoopArtifactType.Prd ||
      artifact.type === LoopArtifactType.Feature
    ) {
      await fs.writeFile(
        path.join(claudeWorkDir, LoopArtifactFile.Prd),
        artifact.content,
      );
    }
  }
  if (prompt) {
    await fs.writeFile(path.join(claudeWorkDir, "prompt.md"), prompt);
  }

  await downloadAttachmentsToDisk(claudeWorkDir, attachments);
}

/**
 * Write context pack files for GENERATE_PRD command.
 * Mirrors writeContextPackFiles in harness-agent.mjs (lines 744-816).
 * Files go under worktreeDir/.closedloop-ai/context/ (NOT claudeWorkDir).
 */
export async function writeArtifactsForGeneratePrd(
  worktreeDir: string,
  artifacts: LoopArtifact[],
  prompt: string,
  repo?: unknown,
): Promise<void> {
  const contextDir = path.join(worktreeDir, ".closedloop-ai", "context");
  const artifactsDir = path.join(contextDir, "artifacts");
  await fs.mkdir(artifactsDir, { recursive: true });

  // Write prompt
  await fs.writeFile(path.join(contextDir, "prompt.md"), prompt);

  // Write repo-info.json when present
  if (repo) {
    await fs.writeFile(
      path.join(contextDir, "repo-info.json"),
      JSON.stringify(repo, null, 2),
    );
  }

  // Write each artifact
  for (const artifact of artifacts) {
    const safeName = artifact.type
      .toLowerCase()
      .replaceAll(/[^a-z0-9_-]/g, "_");
    const safeId = (artifact.id ?? "unknown").replaceAll(
      /[^a-zA-Z0-9_-]/g,
      "_",
    );
    const header = `# ${artifact.title ?? "Untitled"}\n\n`;
    await fs.writeFile(
      path.join(artifactsDir, `${safeName}-${safeId}.md`),
      header + artifact.content,
    );
  }
}

// ---------------------------------------------------------------------------
// Per-command output reading
// ---------------------------------------------------------------------------

export function readPlanOutputs(claudeWorkDir: string): Record<string, unknown> {
  const plan = readJsonFileSync(
    path.join(claudeWorkDir, LoopArtifactFile.Plan),
  );
  const openQuestions = readTextFile(
    path.join(claudeWorkDir, LoopArtifactFile.OpenQuestions),
  );
  const judges = readJsonFileSync(
    path.join(claudeWorkDir, LoopArtifactFile.Judges),
  );

  return {
    plan: plan ?? undefined,
    openQuestions: openQuestions ?? undefined,
    judges: judges ?? undefined,
  };
}

export function readExecuteOutputs(claudeWorkDir: string): Record<string, unknown> {
  const executionResult = readJsonFileSync(
    path.join(claudeWorkDir, LoopArtifactFile.ExecutionResult),
  );
  const codeJudges = readJsonFileSync(
    path.join(claudeWorkDir, LoopArtifactFile.CodeJudges),
  );

  return {
    executionResult: executionResult ?? undefined,
    codeJudges: codeJudges ?? undefined,
  };
}

export function readDecomposeOutputs(workDir: string): Record<string, unknown> {
  const features = readJsonFileSync(
    path.join(workDir, LoopArtifactFile.Features),
  );
  return { features: features ?? undefined };
}

export function readGeneratePrdOutputs(worktreeDir: string): Record<string, unknown> {
  const prdContent = readTextFile(path.join(worktreeDir, LoopArtifactFile.Prd));
  return { prd: prdContent ? { content: prdContent } : undefined };
}
