import type { LoopRequestBody } from "@closedloop-ai/loops-api/desktop-request";
import { BRANCH_NAME_REGEX } from "@closedloop-ai/loops-api/execution-result";
import { z } from "zod";

const nullableString = z.string().nullable().optional();
const REPOSITORY_FULL_NAME_REGEX = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
const BRANCH_NAME_MAX_LENGTH = 256;

const supportingArtifactSchema = z
  .object({
    id: z.string().default(""),
    type: z.string().default(""),
    title: z.string().default(""),
    content: z.string(),
    raw: z.record(z.string(), z.unknown()).optional(),
    filename: z.string().optional(),
    fileName: z.string().optional(),
  })
  .passthrough();

const codeEvaluationContextSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
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

const branchMaterializationEntrySchema = z
  .object({
    role: z.enum(["primary", "additional"]),
    repositoryFullName: z
      .string()
      .trim()
      .max(256)
      .regex(REPOSITORY_FULL_NAME_REGEX, "Must be in 'owner/repo' format"),
    baseBranch: z
      .string()
      .trim()
      .max(BRANCH_NAME_MAX_LENGTH)
      .regex(BRANCH_NAME_REGEX, "Branch name contains invalid characters"),
    branchName: z
      .string()
      .trim()
      .max(BRANCH_NAME_MAX_LENGTH)
      .regex(BRANCH_NAME_REGEX, "Branch name contains invalid characters"),
  })
  .strict();

const branchMaterializationSchema = z
  .object({
    schemaVersion: z.literal(1),
    branches: z.array(branchMaterializationEntrySchema).min(1),
  })
  .strict();

export type SymphonyLoopSupportingArtifact = z.infer<
  typeof supportingArtifactSchema
>;
export type SymphonyCodeEvaluationContext = z.infer<
  typeof codeEvaluationContextSchema
>;
export type SymphonyBranchMaterialization = z.infer<
  typeof branchMaterializationSchema
>;
export type SymphonyBranchMaterializationEntry = z.infer<
  typeof branchMaterializationEntrySchema
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
  branchMaterialization?: SymphonyBranchMaterialization;
  cloudSessionToken?: string;
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
 * untouched while Desktop-only extension fields are normalized for downstream
 * code.
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
  const branchMaterialization = parseBranchMaterialization(
    rawBody.branchMaterialization,
  );
  const { branchMaterialization: _rawBranchMaterialization, ...loopBody } =
    rawBody;

  return {
    ...(loopBody as unknown as LoopRequestBody),
    supportingArtifacts,
    codeEvaluationContext,
    ...(branchMaterialization ? { branchMaterialization } : {}),
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

function parseBranchMaterialization(
  value: unknown,
): SymphonyBranchMaterialization | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const result = branchMaterializationSchema.safeParse(value);
  if (!result.success) {
    throw new SymphonyLoopRequestValidationError(
      `branchMaterialization is malformed: ${formatZodIssues(result.error)}`,
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
