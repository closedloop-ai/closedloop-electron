import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { OperationDispatcher, OperationRequestContext } from "../operation-dispatcher.js";
import { DirectoryNotAllowedError } from "../security.js";
import { assertRepoAllowed, resolveWorktreeDir } from "./symphony-utils.js";

export function registerSymphonyLogsRoutes(
  dispatcher: OperationDispatcher,
  getAllowedDirectories: () => string[]
): void {
  dispatcher.register("GET", "/api/engineer/symphony/logs/:ticketId", async (context) => {
    const ticketId = context.params.ticketId;
    const repoPath = context.query.get("repo");
    const lines = Number.parseInt(context.query.get("lines") ?? "100", 10);

    if (!repoPath) {
      json(context, 400, { error: "repo parameter is required" });
      return;
    }

    let expandedRepoPath: string;
    try {
      expandedRepoPath = assertRepoAllowed(repoPath, getAllowedDirectories());
    } catch (error) {
      if (error instanceof DirectoryNotAllowedError) {
        json(context, 403, { error: "directory not allowed" });
        return;
      }
      throw error;
    }

    const worktreeDir = resolveWorktreeDir(expandedRepoPath, ticketId);
    const jsonlFile = path.join(worktreeDir, ".claude", "work", "claude-output.jsonl");
    const legacyLogFile = path.join(worktreeDir, ".claude", "work", "symphony-launch.log");

    const isJsonl = existsSync(jsonlFile);
    const logFile = isJsonl ? jsonlFile : legacyLogFile;
    if (!existsSync(logFile)) {
      json(context, 200, {
        exists: false,
        format: "text",
        content: "",
        lines: 0
      });
      return;
    }

    try {
      const content = await fs.readFile(logFile, "utf-8");
      const allLines = content.split("\n").filter((line) => line.trim() !== "");

      if (isJsonl) {
        const lastLines = allLines.slice(-lines);
        json(context, 200, {
          exists: true,
          format: "jsonl",
          lines: lastLines,
          totalLines: allLines.length,
          returnedLines: lastLines.length
        });
        return;
      }

      const lastLines = allLines.slice(-lines).join("\n");
      json(context, 200, {
        exists: true,
        format: "text",
        content: lastLines,
        totalLines: allLines.length,
        returnedLines: Math.min(lines, allLines.length)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      json(context, 500, { error: message });
    }
  });
}

function json(context: OperationRequestContext, status: number, payload: unknown): void {
  context.response.statusCode = status;
  context.response.setHeader("content-type", "application/json");
  context.response.end(JSON.stringify(payload));
}

