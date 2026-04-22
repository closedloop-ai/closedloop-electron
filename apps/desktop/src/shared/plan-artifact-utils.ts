export type UploadedPlanArtifact = {
  content: string;
  raw?: Record<string, unknown>;
};

export function isRawPlanArtifact(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toUploadedPlanArtifact(
  plan: unknown,
): UploadedPlanArtifact | undefined {
  if (isRawPlanArtifact(plan)) {
    return {
      content:
        typeof plan.content === "string"
          ? plan.content
          : JSON.stringify(plan, null, 2),
      raw: plan,
    };
  }

  if (typeof plan === "string") {
    return { content: plan };
  }

  return undefined;
}
