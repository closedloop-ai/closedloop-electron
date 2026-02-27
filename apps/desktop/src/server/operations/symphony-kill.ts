import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { OperationDispatcher, OperationRequestContext } from "../operation-dispatcher.js";
import { DirectoryNotAllowedError, assertPathAllowed } from "../security.js";
import { expandHome, resolveWorktreeDir } from "./symphony-utils.js";

type ResolveResult =
  | { pid: number; pidFilePath: string | null; worktreeDir: string | null }
  | { noPidFile: true; worktreeDir: string }
  | { error: string; status: number };

export function registerSymphonyKillRoutes(
  dispatcher: OperationDispatcher,
  getAllowedDirectories: () => string[]
): void {
  dispatcher.register("POST", "/api/engineer/symphony/kill", async (context) => {
    try {
      const body = parseJsonBody(context);
      if (!body) {
        json(context, 400, { error: "Invalid JSON body" });
        return;
      }

      const resolved = resolvePid(body, getAllowedDirectories);
      if ("error" in resolved) {
        json(context, resolved.status, { error: resolved.error });
        return;
      }

      if ("noPidFile" in resolved) {
        cancelLoop(resolved.worktreeDir);
        markStateAsStopped(resolved.worktreeDir);
        json(context, 200, {
          success: true,
          message: "No process to kill (no PID file), state marked as stopped"
        });
        return;
      }

      const { pid, pidFilePath, worktreeDir } = resolved;

      if (worktreeDir) {
        cancelLoop(worktreeDir);
      }

      try {
        process.kill(pid, 0);
      } catch {
        deletePidFile(pidFilePath);
        if (worktreeDir) {
          markStateAsStopped(worktreeDir);
        }
        json(context, 200, { success: true, message: "Process already terminated", pid });
        return;
      }

      try {
        process.kill(-pid, "SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 500));

        try {
          process.kill(pid, 0);
          process.kill(-pid, "SIGKILL");
        } catch {
          // Process already gone
        }

        deletePidFile(pidFilePath);
        if (worktreeDir) {
          markStateAsStopped(worktreeDir);
        }

        json(context, 200, { success: true, message: "Process terminated", pid });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        if (errorMessage.includes("ESRCH")) {
          deletePidFile(pidFilePath);
          if (worktreeDir) {
            markStateAsStopped(worktreeDir);
          }
          json(context, 200, { success: true, message: "Process already terminated", pid });
          return;
        }

        json(context, 500, { error: `Failed to kill process: ${errorMessage}` });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      json(context, 500, { error: `Failed to process kill request: ${errorMessage}` });
    }
  });
}

function parseJsonBody(context: OperationRequestContext): Record<string, unknown> | null {
  if (!context.body.trim()) {
    return {};
  }

  try {
    return JSON.parse(context.body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolvePid(
  body: Record<string, unknown>,
  getAllowedDirectories: () => string[]
): ResolveResult {
  const pid = typeof body.pid === "number" ? body.pid : null;
  const ticketId = typeof body.ticketId === "string" ? body.ticketId : null;
  const repoPath = typeof body.repoPath === "string" ? body.repoPath : null;

  if (pid && Number.isFinite(pid)) {
    return { pid, pidFilePath: null, worktreeDir: null };
  }

  if (ticketId && repoPath) {
    const expandedRepoPath = expandHome(repoPath);

    try {
      assertPathAllowed(expandedRepoPath, getAllowedDirectories());
    } catch (error) {
      if (error instanceof DirectoryNotAllowedError) {
        return { error: "directory not allowed", status: 403 };
      }
      throw error;
    }

    const worktreeDir = resolveWorktreeDir(expandedRepoPath, ticketId);
    const pidFilePath = path.join(worktreeDir, ".claude", "work", "process.pid");
    if (!existsSync(pidFilePath)) {
      return { noPidFile: true, worktreeDir };
    }

    try {
      const pidContent = readFileSync(pidFilePath, "utf-8");
      const resolvedPid = Number.parseInt(pidContent.trim(), 10);
      if (Number.isNaN(resolvedPid)) {
        return { error: "Invalid PID in process.pid file", status: 500 };
      }

      return { pid: resolvedPid, pidFilePath, worktreeDir };
    } catch {
      return { error: "Failed to read process.pid file", status: 500 };
    }
  }

  return { error: "Either pid or (ticketId + repoPath) is required", status: 400 };
}

function cancelLoop(worktreeDir: string): boolean {
  const stateFile = path.join(worktreeDir, ".claude", "symphony-loop.local.md");
  try {
    if (existsSync(stateFile)) {
      unlinkSync(stateFile);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function clearAgentTypes(worktreeDir: string): void {
  const agentTypesDir = path.join(worktreeDir, ".claude", "work", ".agent-types");
  try {
    if (!existsSync(agentTypesDir)) {
      return;
    }

    for (const file of readdirSync(agentTypesDir)) {
      unlinkSync(path.join(agentTypesDir, file));
    }
  } catch {
    return;
  }
}

function markStateAsStopped(worktreeDir: string): void {
  const statePath = path.join(worktreeDir, ".claude", "work", "state.json");

  try {
    let state: Record<string, unknown> = {};
    if (existsSync(statePath)) {
      const content = readFileSync(statePath, "utf-8");
      state = JSON.parse(content) as Record<string, unknown>;
    }

    state.status = "STOPPED";
    state.phase = "Process stopped by user";
    state.timestamp = new Date().toISOString();
    writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
  } catch {
    // Best effort only
  }

  clearAgentTypes(worktreeDir);
}

function deletePidFile(pidFilePath: string | null): void {
  if (!pidFilePath) {
    return;
  }

  try {
    if (existsSync(pidFilePath)) {
      unlinkSync(pidFilePath);
    }
  } catch {
    // Best effort only
  }
}

function json(context: OperationRequestContext, status: number, payload: unknown): void {
  context.response.statusCode = status;
  context.response.setHeader("content-type", "application/json");
  context.response.end(JSON.stringify(payload));
}
