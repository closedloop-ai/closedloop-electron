import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { OperationDispatcher, OperationRequestContext } from "../operation-dispatcher.js";
import { DirectoryNotAllowedError, assertPathAllowed } from "../security.js";
import { expandHome } from "./symphony-utils.js";

type DirectoryEntry = {
  name: string;
  path: string;
  isDirectory: true;
  isGitRepo: boolean;
};

export function registerFilesystemDirectoriesRoutes(
  dispatcher: OperationDispatcher,
  getAllowedDirectories: () => string[]
): void {
  dispatcher.register("GET", "/api/gateway/directories", async (context) => {
    try {
      const pathParam = context.query.get("path") || "~";
      const expandedPath = expandHome(pathParam);

      try {
        assertPathAllowed(expandedPath, getAllowedDirectories());
      } catch (error) {
        if (error instanceof DirectoryNotAllowedError) {
          json(context, 403, { error: "directory not allowed" });
          return;
        }
        throw error;
      }

      if (!existsSync(expandedPath)) {
        json(context, 200, { directories: [] });
        return;
      }

      const entries = await fs.readdir(expandedPath, { withFileTypes: true });
      const directories: DirectoryEntry[] = [];

      for (const entry of entries) {
        if (entry.name.startsWith(".")) {
          continue;
        }

        if (!entry.isDirectory()) {
          continue;
        }

        const fullPath = path.join(expandedPath, entry.name);
        const isGitRepo = existsSync(path.join(fullPath, ".git"));
        const displayPath = pathParam.startsWith("~") ? path.join(pathParam, entry.name) : fullPath;

        directories.push({
          name: entry.name,
          path: displayPath,
          isDirectory: true,
          isGitRepo
        });
      }

      directories.sort((a, b) => {
        if (a.isGitRepo && !b.isGitRepo) {
          return -1;
        }
        if (!a.isGitRepo && b.isGitRepo) {
          return 1;
        }
        return a.name.localeCompare(b.name);
      });

      json(context, 200, { directories });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      json(context, 500, { error: `Failed to list directories: ${message}` });
    }
  });
}

function json(context: OperationRequestContext, status: number, payload: unknown): void {
  context.response.statusCode = status;
  context.response.setHeader("content-type", "application/json");
  context.response.end(JSON.stringify(payload));
}

