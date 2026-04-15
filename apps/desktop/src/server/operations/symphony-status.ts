import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isTerminalJobStatus, type JobStore, type LocalJobStatus } from "../../main/job-store.js";
import type { OperationDispatcher, OperationRequestContext } from "../operation-dispatcher.js";
import { DirectoryNotAllowedError, assertPathAllowed } from "../security.js";
import { expandHome, readProcessPidSync, resolveWorktreeDir } from "./symphony-utils.js";

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
  getAllowedDirectories: () => string[],
  jobStore?: JobStore
): void {
  dispatcher.register("GET", "/api/gateway/symphony/status/:ticketId", async (context) => {
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

      let worktreeDir = resolveWorktreeDir(expandedRepoPath, ticketId);

      // Fallback: if the ticket-based worktree doesn't exist, check the
      // JobStore for a loop-backed job matching this ticketId. The loop
      // handler creates worktrees at a different path (<repoName>-loop-<slug>)
      // than the ticket-based scheme (<repoName>-<ticketId>).
      if (!existsSync(worktreeDir) && jobStore) {
        for (const job of jobStore.listRunning()) {
          if (job.ticketId === ticketId && job.worktreeDir && existsSync(job.worktreeDir)) {
            worktreeDir = job.worktreeDir;
            break;
          }
        }
        // Also check completed jobs (process may have finished)
        if (!existsSync(worktreeDir)) {
          for (const job of jobStore.listCompleted()) {
            if (job.ticketId === ticketId && job.worktreeDir && existsSync(job.worktreeDir)) {
              worktreeDir = job.worktreeDir;
              break;
            }
          }
        }
      }
      const statePath = path.join(worktreeDir, ".closedloop-ai", "work", "state.json");

      if (!existsSync(worktreeDir)) {
        json(context, 200, {
          exists: false,
          phase: null,
          status: null,
          message: "Worktree not found"
        });
        return;
      }

      if (!existsSync(statePath)) {
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

      const effective = await resolveEffectiveState(worktreeDir, state, statePath);
      const resolvedPlanPath = path.join(worktreeDir, ".closedloop-ai", "work", "plan.json");
      const planExists = existsSync(resolvedPlanPath);
      const { taskProgress, currentTaskId } = await readPlanProgress(resolvedPlanPath);
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

async function detectCompletionFromLogs(
  worktreeDir: string
): Promise<{ completed: boolean; awaitingUser: boolean }> {
  const logPath = path.join(worktreeDir, ".closedloop-ai", "work", "symphony-launch.log");
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
  state: Record<string, unknown>,
  statePath: string
): Promise<EffectiveState> {
  let effectiveStatus = typeof state.status === "string" ? state.status : "UNKNOWN";
  let effectivePhase = typeof state.phase === "string" ? state.phase : "Unknown";
  const pid = readProcessPidSync(worktreeDir);
  const processRunning = pid !== null && isProcessRunning(pid);
  const base = { processRunning, pid };

  // Normalize: if process is alive but state.json says terminal, treat as IN_PROGRESS
  if (processRunning && isTerminalJobStatus(effectiveStatus as LocalJobStatus)) {
    effectiveStatus = "IN_PROGRESS";
    effectivePhase = "Running";
  }

  if (effectiveStatus !== "IN_PROGRESS") {
    return { status: effectiveStatus, phase: effectivePhase, fallbackDetected: false, ...base };
  }

  if (pid !== null && !processRunning) {
    return {
      status: "STOPPED",
      phase: "Process stopped unexpectedly",
      fallbackDetected: false,
      ...base
    };
  }

  const lockPath = path.join(worktreeDir, ".closedloop-ai", "work", ".learnings", ".lock");
  if (existsSync(lockPath)) {
    return { status: effectiveStatus, phase: effectivePhase, fallbackDetected: false, ...base };
  }

  const stateStats = await stat(statePath);
  const stateAgeMs = Date.now() - stateStats.mtime.getTime();
  if (stateAgeMs <= 2 * 60 * 1000) {
    return { status: effectiveStatus, phase: effectivePhase, fallbackDetected: false, ...base };
  }

  const fallback = await detectCompletionFromLogs(worktreeDir);
  if (!fallback.completed) {
    return { status: effectiveStatus, phase: effectivePhase, fallbackDetected: false, ...base };
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
  const agentTypesDir = path.join(worktreeDir, ".closedloop-ai", "work", ".agent-types");
  if (!existsSync(agentTypesDir)) {
    return [];
  }

  const agents: ActiveAgent[] = [];
  try {
    const files = await readdir(agentTypesDir);
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
  } catch {
    // Best effort
  }

  return agents;
}

function json(context: OperationRequestContext, status: number, payload: unknown): void {
  context.response.statusCode = status;
  context.response.setHeader("content-type", "application/json");
  context.response.end(JSON.stringify(payload));
}
