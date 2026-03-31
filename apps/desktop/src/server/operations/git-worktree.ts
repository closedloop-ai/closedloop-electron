import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { OperationDispatcher, OperationRequestContext } from "../operation-dispatcher.js";
import type { ProcessManager } from "../process-manager.js";
import { DirectoryNotAllowedError, assertPathAllowed } from "../security.js";
import { loadReposConfig } from "./repos-config-utils.js";
import { expandHome, SymphonyDirNotConfiguredError } from "./symphony-utils.js";

const LOCAL_GIT_TIMEOUT_MS = 10_000;
const NETWORK_GIT_TIMEOUT_MS = 15_000;
const ROUTE_TIMEOUT_MS = 20_000;

export function registerGitWorktreeRoutes(
  dispatcher: OperationDispatcher,
  processManager: ProcessManager,
  getAllowedDirectories: () => string[],
  getSymphonyDir: () => string
): void {
  const configDir = () => path.join(getSymphonyDir(), "config");

  dispatcher.register("DELETE", "/api/engineer/git/worktree", async (context) => {
    await withRouteTimeout(context, "DELETE /api/engineer/git/worktree", async () => {
      const body = parseBody(context);
      if (!body) {
        json(context, 400, { error: "Invalid JSON body" });
        return;
      }

      const worktreePath = typeof body.worktreePath === "string" ? body.worktreePath : null;
      const force = body.force === true;

      if (!worktreePath) {
        json(context, 400, { error: "worktreePath is required and must be a string" });
        return;
      }

      const expandedPath = expandHome(worktreePath);
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
        json(context, 200, { success: true, message: "Worktree does not exist" });
        return;
      }

      const removeResult = await processManager.execWithTimeout(
        "git",
        ["worktree", "remove", ...(force ? ["--force"] : []), expandedPath],
        expandedPath,
        LOCAL_GIT_TIMEOUT_MS
      );
      if (removeResult.exitCode === 0) {
        json(context, 200, { success: true, message: "Worktree removed successfully" });
        return;
      }

      const errorText = removeResult.stderr || removeResult.stdout;
      if (errorText.includes("contains modified or untracked files") && !force) {
        json(context, 409, {
          error: "Worktree has uncommitted changes",
          hasChanges: true,
          message: "Use force=true to remove anyway"
        });
        return;
      }

      if (force) {
        await fs.rm(expandedPath, { recursive: true, force: true });
        json(context, 200, { success: true, message: "Worktree forcefully removed" });
        return;
      }

      json(context, 500, { error: `Failed to remove worktree: ${errorText}` });
    });
  });

  dispatcher.register("POST", "/api/engineer/git/worktree", async (context) => {
    await withRouteTimeout(context, "POST /api/engineer/git/worktree", async () => {
      try {
        const worktreeParentDir = await resolveWorktreeParentDir(configDir());
        if (!existsSync(worktreeParentDir)) {
          json(context, 200, { removed: [], kept: [], errors: [] });
          return;
        }

        const entries = await fs.readdir(worktreeParentDir, { withFileTypes: true });
        const prDirs = entries
          .filter((entry) => entry.isDirectory() && /-pr-\d+$/.test(entry.name))
          .map((entry) => path.join(worktreeParentDir, entry.name));

        const removed: string[] = [];
        const kept: string[] = [];
        const errors: string[] = [];

        for (const prDir of prDirs.slice(0, 10)) {
          try {
            assertPathAllowed(prDir, getAllowedDirectories());
          } catch {
            continue;
          }

          const branchResult = await processManager.execWithTimeout(
            "git",
            ["-C", prDir, "rev-parse", "--abbrev-ref", "HEAD"],
            undefined,
            LOCAL_GIT_TIMEOUT_MS
          );
          if (branchResult.exitCode !== 0) {
            kept.push(prDir);
            errors.push(`branch lookup failed for ${prDir}: ${summarizeExecResult(branchResult)}`);
            continue;
          }

          const branch = branchResult.stdout.trim();
          const remoteResult = await processManager.execWithTimeout(
            "git",
            ["-C", prDir, "ls-remote", "--heads", "origin", branch],
            undefined,
            NETWORK_GIT_TIMEOUT_MS
          );

          if (remoteResult.exitCode === 0 && remoteResult.stdout.trim() === "") {
            const removeResult = await processManager.execWithTimeout(
              "git",
              ["worktree", "remove", prDir],
              prDir,
              LOCAL_GIT_TIMEOUT_MS
            );
            if (removeResult.exitCode === 0) {
              removed.push(prDir);
            } else {
              kept.push(prDir);
              errors.push(`remove failed for ${prDir}: ${summarizeExecResult(removeResult)}`);
            }
          } else {
            kept.push(prDir);
            if (remoteResult.exitCode !== 0) {
              errors.push(`ls-remote failed for ${prDir}: ${summarizeExecResult(remoteResult)}`);
            }
          }
        }

        json(context, 200, { removed, kept, errors });
      } catch (error) {
        if (error instanceof SymphonyDirNotConfiguredError) throw error;
        const message = error instanceof Error ? error.message : "Unknown error";
        json(context, 500, { error: `Worktree cleanup failed: ${message}` });
      }
    });
  });
}

async function withRouteTimeout(
  context: OperationRequestContext,
  label: string,
  run: () => Promise<void>
): Promise<void> {
  console.log(`[route] start ${label}`);
  let completed = false;
  const timeout = setTimeout(() => {
    if (completed || context.response.writableEnded) {
      return;
    }
    console.error(`[route] timeout ${label}`);
    context.response.statusCode = 504;
    context.response.setHeader("content-type", "application/json");
    context.response.end(JSON.stringify({ error: "Route timed out", route: label }));
  }, ROUTE_TIMEOUT_MS);

  try {
    await run();
    completed = true;
    console.log(`[route] done ${label}`);
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeExecResult(result: { stderr: string; stdout: string }): string {
  const text = (result.stderr || result.stdout || "unknown error").trim();
  return text.slice(0, 200);
}

async function resolveWorktreeParentDir(reposConfigDir: string): Promise<string> {
  if (process.env.SYMPHONY_WORKTREE_PARENT_DIR) {
    return expandHome(process.env.SYMPHONY_WORKTREE_PARENT_DIR);
  }

  const config = await loadReposConfig(reposConfigDir);
  if (config.settings.worktreeParentDir) {
    return expandHome(config.settings.worktreeParentDir);
  }

  throw new Error("Worktree parent directory not configured");
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
