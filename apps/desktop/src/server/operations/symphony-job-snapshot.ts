import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { type LocalJob, type LocalJobStatus, type TaskProgress, isTerminalJobStatus } from "../../main/job-store.js";
import { hasPendingLoopExit } from "./symphony-loop-lifecycle.js";
import { isProcessRunning } from "./symphony-utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JobSnapshot = LocalJob & {
  processRunning: boolean;
  taskProgress?: TaskProgress;
  currentTaskId?: string;
};

// ---------------------------------------------------------------------------
// Effective status / phase from state.json
// ---------------------------------------------------------------------------

export async function readEffectiveStatusFromState(statePath: string): Promise<{
  status: LocalJobStatus | null;
  phase: string | null;
}> {
  if (!existsSync(statePath)) {
    return { status: null, phase: null };
  }

  try {
    const raw = await readFile(statePath, "utf-8");
    const state = JSON.parse(raw) as Record<string, unknown>;
    const rawStatus = typeof state.status === "string" ? state.status.toUpperCase() : null;
    const phase = typeof state.phase === "string" ? state.phase : null;

    let status: LocalJobStatus | null = null;
    if (rawStatus === "IN_PROGRESS") {
      status = "RUNNING";
    } else if (rawStatus === "AWAITING_USER") {
      status = "AWAITING_USER";
    } else if (rawStatus === "COMPLETED") {
      status = "COMPLETED";
    } else if (rawStatus === "FAILED") {
      status = "FAILED";
    } else if (rawStatus === "CANCELLED") {
      status = "CANCELLED";
    } else if (rawStatus === "STOPPED") {
      status = "STOPPED";
    }

    return { status, phase };
  } catch {
    return { status: null, phase: null };
  }
}

// ---------------------------------------------------------------------------
// Guard terminal status from state.json when process is alive
// ---------------------------------------------------------------------------

/**
 * Suppress terminal status from state.json when the process is still alive.
 */
export function shouldApplyStateStatus(
  stateStatus: string,
  processRunning: boolean
): boolean {
  if (!processRunning) return true;
  return !isTerminalJobStatus(stateStatus as LocalJobStatus);
}

// ---------------------------------------------------------------------------
// Task progress / currentTaskId from plan.json
// ---------------------------------------------------------------------------

export async function readPlanProgress(
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
        total: pendingTasks.length + completedTasks.length,
      },
      currentTaskId: firstPending?.id,
    };
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Active agents from .agent-types directory
// ---------------------------------------------------------------------------

export type ActiveAgent = {
  agentId: string;
  agentType: string;
  agentName: string;
  startedAt: string;
};

export async function readActiveAgents(claudeWorkDir: string): Promise<ActiveAgent[]> {
  const agentTypesDir = path.join(claudeWorkDir, ".agent-types");
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
            startedAt: startedAt ?? "",
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

// ---------------------------------------------------------------------------
// Log tail reading
// ---------------------------------------------------------------------------

export async function readLogTail(logPath: string, maxLines = 200): Promise<string | null> {
  if (!existsSync(logPath)) {
    return null;
  }

  try {
    const content = await readFile(logPath, "utf-8");
    const lines = content.split("\n");
    return lines.slice(-maxLines).join("\n");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Enrich a LocalJob with live snapshot data
// ---------------------------------------------------------------------------

export async function enrichJobSnapshot(job: LocalJob): Promise<JobSnapshot> {
  const processRunning = job.pid != null ? isProcessRunning(job.pid) : false;

  let taskProgress = job.taskProgress;
  let currentTaskId = job.currentTaskId;
  let phase = job.phase;
  let status = job.status;

  if (job.claudeWorkDir) {
    const planPath = path.join(job.claudeWorkDir, "plan.json");
    const planData = await readPlanProgress(planPath);
    if (planData.taskProgress) {
      taskProgress = planData.taskProgress;
    }
    if (planData.currentTaskId) {
      currentTaskId = planData.currentTaskId;
    }
  }

  if (job.statePath) {
    const stateData = await readEffectiveStatusFromState(job.statePath);
    if (stateData.phase) {
      if (processRunning && stateData.status && isTerminalJobStatus(stateData.status)) {
        // Don't apply "Completed" phase text while process is still alive
      } else {
        phase = stateData.phase;
      }
    }
    // Apply effective status from state.json for non-terminal jobs.
    // Terminal statuses (COMPLETED, FAILED, CANCELLED, STOPPED) set by the
    // process exit handler are authoritative and should not be overridden.
    if (stateData.status && !isTerminalJobStatus(status)) {
      if (shouldApplyStateStatus(stateData.status, processRunning)) {
        status = stateData.status;
      }
    }
  }

  // If the process is dead but the job isn't terminal yet, finalize it.
  // A live detached child can disappear from the process table before Node
  // delivers its exit event; suppress STOPPED while Desktop still owns that
  // child handle so the exit path can claim the job with exitCode first.
  if (!processRunning && !isTerminalJobStatus(status) && status !== "QUEUED" && status !== "STARTING") {
    if (status === "CANCEL_PENDING") {
      status = "CANCELLED";
    } else if (!hasPendingLoopExit(job.loopId)) {
      status = "STOPPED";
    }
  }

  // Finalize QUEUED/STARTING jobs that never got a PID and are older than
  // 60 seconds. These are ghost entries from confirm steps where the loop
  // dispatch failed or was never delivered.
  if (
    (status === "QUEUED" || status === "STARTING") &&
    !processRunning &&
    job.pid == null
  ) {
    const ageMs = Date.now() - new Date(job.startedAt).getTime();
    if (ageMs > 60_000) {
      status = "FAILED";
    }
  }

  return {
    ...job,
    status,
    processRunning,
    taskProgress,
    currentTaskId,
    phase,
  };
}
