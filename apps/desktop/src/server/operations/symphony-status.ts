import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { OperationDispatcher, OperationRequestContext } from "../operation-dispatcher.js";
import { DirectoryNotAllowedError, assertPathAllowed } from "../security.js";
import { expandHome, findFirstExisting, resolveWorktreeDir } from "./symphony-utils.js";

type TaskProgress = {
  pending: number;
  completed: number;
  total: number;
};

type ActiveAgent = {
  agentId: string;
  agentType: string;
  agentName: string;
  startedAt: string;
};

type EffectiveState = {
  status: string;
  phase: string;
  fallbackDetected: boolean;
  processRunning: boolean;
  pid: number | null;
};

export function registerSymphonyStatusRoutes(
  dispatcher: OperationDispatcher,
  getAllowedDirectories: () => string[]
): void {
  dispatcher.register("GET", "/api/engineer/symphony/status/:ticketId", async (context) => {
    try {
      const ticketId = context.params.ticketId;
      const repoPath = context.query.get("repo");

      if (!ticketId) {
        json(context, 400, { error: "ticketId is required" });
        return;
      }

      if (!repoPath) {
        json(context, 400, { error: "repo query parameter is required" });
        return;
      }

      const expandedRepoPath = expandHome(repoPath);
      try {
        assertPathAllowed(expandedRepoPath, getAllowedDirectories());
      } catch (error) {
        if (error instanceof DirectoryNotAllowedError) {
          json(context, 403, { error: "directory not allowed" });
          return;
        }
        throw error;
      }

      const worktreeDir = resolveWorktreeDir(expandedRepoPath, ticketId);
      const statePath = findFirstExisting(
        path.join(worktreeDir, ticketId, "state.json"),
        path.join(worktreeDir, ".claude", "work", "state.json")
      );

      if (!existsSync(worktreeDir)) {
        json(context, 200, {
          exists: false,
          phase: null,
          status: null,
          message: "Worktree not found"
        });
        return;
      }

      if (!statePath) {
        json(context, 200, {
          exists: true,
          stateExists: false,
          phase: "Initializing",
          status: "STARTING",
          message: "Symphony is starting up..."
        });
        return;
      }

      const stateContent = await readFile(statePath, "utf-8");
      const state = JSON.parse(stateContent) as Record<string, unknown>;

      const effective = await resolveEffectiveState(worktreeDir, state);
      const resolvedPlanPath = findFirstExisting(
        path.join(worktreeDir, ticketId, "plan.json"),
        path.join(worktreeDir, ".claude", "work", "plan.json")
      );
      const planExists = resolvedPlanPath !== null;
      const { taskProgress, currentTaskId } = await readPlanProgress(resolvedPlanPath ?? "");
      const activeAgents = await readActiveAgents(worktreeDir);

      json(context, 200, {
        exists: true,
        stateExists: true,
        phase: effective.phase,
        status: effective.status,
        timestamp: state.timestamp,
        raw: state,
        worktreeDir,
        fallbackDetected: effective.fallbackDetected,
        planExists,
        taskProgress,
        currentTaskId,
        activeAgents,
        pid: effective.pid,
        processRunning: effective.processRunning
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      json(context, 500, { error: `Failed to read status: ${message}` });
    }
  });
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readProcessPid(worktreeDir: string): Promise<number | null> {
  const pidPath = path.join(worktreeDir, ".claude", "work", "process.pid");
  if (!existsSync(pidPath)) {
    return null;
  }

  try {
    const pidContent = await readFile(pidPath, "utf-8");
    const pid = Number.parseInt(pidContent.trim(), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

async function detectCompletionFromLogs(
  worktreeDir: string
): Promise<{ completed: boolean; awaitingUser: boolean }> {
  const logPath = path.join(worktreeDir, ".claude", "work", "symphony-launch.log");
  if (!existsSync(logPath)) {
    return { completed: false, awaitingUser: false };
  }

  try {
    const logContent = await readFile(logPath, "utf-8");
    if (!logContent.includes("<promise>COMPLETE</promise>")) {
      return { completed: false, awaitingUser: false };
    }

    const awaitingUser =
      logContent.includes("AWAITING_USER") ||
      logContent.includes("Plan created") ||
      logContent.includes("requires review");

    return { completed: true, awaitingUser };
  } catch {
    return { completed: false, awaitingUser: false };
  }
}

async function resolveEffectiveState(
  worktreeDir: string,
  state: Record<string, unknown>
): Promise<EffectiveState> {
  const status = typeof state.status === "string" ? state.status : "UNKNOWN";
  const phase = typeof state.phase === "string" ? state.phase : "Unknown";
  const pid = await readProcessPid(worktreeDir);
  const processRunning = pid !== null && isProcessRunning(pid);
  const base = { processRunning, pid };

  if (status !== "IN_PROGRESS") {
    return { status, phase, fallbackDetected: false, ...base };
  }

  if (pid !== null && !processRunning) {
    return {
      status: "STOPPED",
      phase: "Process stopped unexpectedly",
      fallbackDetected: false,
      ...base
    };
  }

  const lockPath = path.join(worktreeDir, ".claude", "work", ".learnings", ".lock");
  if (existsSync(lockPath)) {
    return { status, phase, fallbackDetected: false, ...base };
  }

  const statePath = path.join(worktreeDir, ".claude", "work", "state.json");
  const stateStats = await stat(statePath);
  const stateAgeMs = Date.now() - stateStats.mtime.getTime();
  if (stateAgeMs <= 2 * 60 * 1000) {
    return { status, phase, fallbackDetected: false, ...base };
  }

  const fallback = await detectCompletionFromLogs(worktreeDir);
  if (!fallback.completed) {
    return { status, phase, fallbackDetected: false, ...base };
  }

  const resolvedStatus = fallback.awaitingUser ? "AWAITING_USER" : "COMPLETED";
  const resolvedPhase = fallback.awaitingUser ? "Completed (awaiting review)" : "Completed";
  return {
    status: resolvedStatus,
    phase: resolvedPhase,
    fallbackDetected: true,
    ...base
  };
}

async function readPlanProgress(
  planPath: string
): Promise<{ taskProgress?: TaskProgress; currentTaskId?: string }> {
  if (!existsSync(planPath)) {
    return {};
  }

  try {
    let planContent = await readFile(planPath, "utf-8");
    planContent = planContent.replaceAll(/,\s*([\]}])/g, "$1");
    const plan = JSON.parse(planContent) as {
      pendingTasks?: Array<{ id?: string }>;
      completedTasks?: unknown[];
    };
    const pendingTasks = Array.isArray(plan.pendingTasks) ? plan.pendingTasks : [];
    const completedTasks = Array.isArray(plan.completedTasks) ? plan.completedTasks : [];
    const firstPending = pendingTasks[0];
    return {
      taskProgress: {
        pending: pendingTasks.length,
        completed: completedTasks.length,
        total: pendingTasks.length + completedTasks.length
      },
      currentTaskId: firstPending?.id
    };
  } catch {
    return {};
  }
}

async function readActiveAgents(worktreeDir: string): Promise<ActiveAgent[]> {
  const agentTypesDir = path.join(worktreeDir, ".claude", "work", ".agent-types");
  if (!existsSync(agentTypesDir)) {
    return [];
  }

  try {
    const files = await readdir(agentTypesDir);
    const agents: ActiveAgent[] = [];

    for (const file of files) {
      if (file.includes("-")) {
        continue;
      }

      try {
        const content = await readFile(path.join(agentTypesDir, file), "utf-8");
        const [agentType, agentName, startedAt] = content.trim().split("|");
        if (agentType && agentName) {
          agents.push({
            agentId: file,
            agentType,
            agentName,
            startedAt: startedAt || ""
          });
        }
      } catch {
        continue;
      }
    }

    return agents;
  } catch {
    return [];
  }
}

function json(context: OperationRequestContext, status: number, payload: unknown): void {
  context.response.statusCode = status;
  context.response.setHeader("content-type", "application/json");
  context.response.end(JSON.stringify(payload));
}
