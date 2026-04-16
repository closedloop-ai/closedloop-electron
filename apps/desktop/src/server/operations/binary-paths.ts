import type { OperationDispatcher, OperationRequestContext } from "../operation-dispatcher.js";

type BinaryPaths = { claude?: string; gh?: string; codex?: string; python3?: string; git?: string };
type BinaryPathKey = "claude" | "gh" | "codex" | "python3" | "git";

const KNOWN_BINARY_KEYS: ReadonlySet<string> = new Set<BinaryPathKey>(["claude", "gh", "codex", "python3", "git"]);

function json(context: OperationRequestContext, status: number, payload: unknown): void {
  context.response.statusCode = status;
  context.response.setHeader("content-type", "application/json");
  context.response.end(JSON.stringify(payload));
}

export function registerBinaryPathsRoutes(
  dispatcher: OperationDispatcher,
  getBinaryPaths: () => BinaryPaths,
  applyPatch: (patch: Partial<Record<BinaryPathKey, string | null>>) => BinaryPaths
): void {
  dispatcher.register("GET", "/api/gateway/settings/binary-paths", (context) => {
    json(context, 200, { binaryPaths: getBinaryPaths() });
  });

  dispatcher.register("PATCH", "/api/gateway/settings/binary-paths", (context) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(context.body || "{}");
    } catch {
      json(context, 400, { error: "invalid JSON body" });
      return;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      json(context, 400, { error: "body must be a JSON object" });
      return;
    }

    const body = parsed as Record<string, unknown>;
    const patch: Partial<Record<BinaryPathKey, string | null>> = {};

    for (const [key, value] of Object.entries(body)) {
      if (!KNOWN_BINARY_KEYS.has(key)) {
        json(context, 400, { error: `unknown key: ${key}` });
        return;
      }
      if (value !== null && typeof value !== "string") {
        json(context, 400, { error: `value for ${key} must be a string or null` });
        return;
      }
      if (typeof value === "string" && value.trim() === "") {
        json(context, 400, { error: `value for ${key} must not be empty` });
        return;
      }
      patch[key as BinaryPathKey] = value as string | null;
    }

    try {
      const updated = applyPatch(patch);
      json(context, 200, { binaryPaths: updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      json(context, 400, { error: message });
    }
  });
}
