import type { OperationDispatcher, OperationRequestContext } from "../operation-dispatcher.js";
import { addRepo, loadReposConfig, removeRepo, updateSettings } from "./repos-config-utils.js";

export function registerReposConfigRoutes(dispatcher: OperationDispatcher): void {
  dispatcher.register("GET", "/api/engineer/repos", async (context) => {
    try {
      const config = await loadReposConfig();
      json(context, 200, { repos: config.repos, settings: config.settings });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      json(context, 500, { error: `Failed to list repos: ${message}` });
    }
  });

  dispatcher.register("POST", "/api/engineer/repos", async (context) => {
    try {
      const body = parseBody(context);
      if (!body) {
        json(context, 400, { error: "Invalid JSON body" });
        return;
      }

      const repoPath = typeof body.path === "string" ? body.path : null;
      const description = typeof body.description === "string" ? body.description : undefined;
      if (!repoPath) {
        json(context, 400, { error: "path is required and must be a string" });
        return;
      }

      const result = await addRepo(repoPath, description);
      if (!result.success) {
        json(context, 400, { error: result.error });
        return;
      }

      json(context, 200, { success: true, repo: result.repo });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      json(context, 500, { error: `Failed to add repo: ${message}` });
    }
  });

  dispatcher.register("DELETE", "/api/engineer/repos", async (context) => {
    try {
      const repoPath = context.query.get("path");
      if (!repoPath) {
        json(context, 400, { error: "path query parameter is required" });
        return;
      }

      const result = await removeRepo(repoPath);
      if (!result.success) {
        json(context, 400, { error: result.error });
        return;
      }

      json(context, 200, { success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      json(context, 500, { error: `Failed to remove repo: ${message}` });
    }
  });

  dispatcher.register("PATCH", "/api/engineer/repos", async (context) => {
    try {
      const body = parseBody(context);
      if (!body) {
        json(context, 400, { error: "Invalid JSON body" });
        return;
      }

      const updates: Record<string, string | boolean> = {};
      if (typeof body.worktreeParentDir === "string") {
        updates.worktreeParentDir = body.worktreeParentDir;
      }
      if (typeof body.worktreeParentDirConfirmed === "boolean") {
        updates.worktreeParentDirConfirmed = body.worktreeParentDirConfirmed;
      }

      if (Object.keys(updates).length === 0) {
        json(context, 400, { error: "No settings to update" });
        return;
      }

      const result = await updateSettings(updates);
      if (!result.success) {
        json(context, 400, { error: result.error });
        return;
      }

      json(context, 200, { success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      json(context, 500, { error: `Failed to update settings: ${message}` });
    }
  });
}

function parseBody(context: OperationRequestContext): Record<string, unknown> | null {
  if (!context.body.trim()) {
    return {};
  }

  try {
    return JSON.parse(context.body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function json(context: OperationRequestContext, status: number, payload: unknown): void {
  context.response.statusCode = status;
  context.response.setHeader("content-type", "application/json");
  context.response.end(JSON.stringify(payload));
}

