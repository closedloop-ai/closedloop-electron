import type { LoopRequestBody } from "@closedloop-ai/loops-api/desktop-request";
import { z } from "zod";

const nullableString = z.string().nullable().optional();

const supportingArtifactSchema = z
  .object({
    id: z.string().optional(),
    type: z.string().optional(),
    title: z.string().optional(),
    filename: z.string().optional(),
    fileName: z.string().optional(),
    content: z.string(),
  })
  .passthrough();

const codeEvaluationContextSchema = z
  .object({
    repo: z
      .object({
        fullName: nullableString,
        branch: nullableString,
      })
      .nullable()
      .optional(),
    localRepoPath: nullableString,
    parentBranchName: nullableString,
    parentSessionId: nullableString,
    artifactSlug: nullableString,
    pullRequest: z
      .object({
        number: z.number().nullable().optional(),
        url: nullableString,
        headBranch: nullableString,
        baseBranch: nullableString,
        headSha: nullableString,
        repositoryFullName: nullableString,
      })
      .nullable()
      .optional(),
    detected: z
      .object({
        branch: nullableString,
        headSha: nullableString,
        gitDetectionError: nullableString,
      })
      .nullable()
      .optional(),
  });

export type SymphonyLoopSupportingArtifact = z.infer<
  typeof supportingArtifactSchema
>;
export type SymphonyCodeEvaluationContext = z.infer<
  typeof codeEvaluationContextSchema
>;

export interface CodeContextFile extends SymphonyCodeEvaluationContext {
  schemaVersion: 1;
}

export type SymphonyLoopRequestBody = LoopRequestBody & {
  supportingArtifacts: SymphonyLoopSupportingArtifact[];
  codeEvaluationContext: SymphonyCodeEvaluationContext | null;
  priorLoopSummaries?: unknown;
  parentBranchName?: string;
  parentSessionId?: string;
  artifactSlug?: string;
};

export class SymphonyLoopRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SymphonyLoopRequestValidationError";
  }
}

/**
 * Parses Desktop's locally extended loop request without requiring a new
 * @closedloop-ai/loops-api release. Existing LoopRequestBody fields are left
 * untouched while FEA-585-only fields are normalized for downstream code.
 */
export function parseSymphonyLoopRequestBody(
  rawBody: Record<string, unknown>,
): SymphonyLoopRequestBody {
  const supportingArtifacts = parseSupportingArtifacts(
    rawBody.supportingArtifacts,
  );
  const codeEvaluationContext = parseCodeEvaluationContext(
    rawBody.codeEvaluationContext,
  );

  return {
    ...(rawBody as unknown as LoopRequestBody),
    supportingArtifacts,
    codeEvaluationContext,
  };
}

function parseSupportingArtifacts(
  value: unknown,
): SymphonyLoopSupportingArtifact[] {
  if (value === undefined || value === null) {
    return [];
  }
  const result = z.array(supportingArtifactSchema).safeParse(value);
  if (!result.success) {
    throw new SymphonyLoopRequestValidationError(
      `supportingArtifacts is malformed: ${formatZodIssues(result.error)}`,
    );
  }
  return result.data;
}

function parseCodeEvaluationContext(
  value: unknown,
): SymphonyCodeEvaluationContext | null {
  if (value === undefined || value === null) {
    return null;
  }
  const result = codeEvaluationContextSchema.safeParse(value);
  if (!result.success) {
    throw new SymphonyLoopRequestValidationError(
      `codeEvaluationContext is malformed: ${formatZodIssues(result.error)}`,
    );
  }
  return result.data;
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "value";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}
