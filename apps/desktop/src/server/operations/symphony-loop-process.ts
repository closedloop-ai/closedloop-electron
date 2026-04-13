import type { JobStore } from "../../main/job-store.js";
import type { RunningLoop } from "./symphony-loop-types.js";

// ---------------------------------------------------------------------------
// Running loop process tracking
// ---------------------------------------------------------------------------

export const runningLoops = new Map<string, RunningLoop>();

export function getActiveLoopPid(loopId: string): number | null {
  const entry = runningLoops.get(loopId);
  return entry?.pid ?? null;
}

export function registerRecoveredLoop(loopId: string, pid: number): void {
  runningLoops.set(loopId, { pid, stage: "running" });
}

export function unregisterLoop(loopId: string): void {
  runningLoops.delete(loopId);
}

export function isCancelled(jobStore: JobStore | undefined, loopId: string): boolean {
  const status = jobStore?.getByLoopId(loopId)?.status;
  return status === "CANCEL_PENDING" || status === "CANCELLED";
}

// ---------------------------------------------------------------------------
// Graceful process kill helper (DRY: SIGTERM -> wait -> SIGKILL)
// ---------------------------------------------------------------------------

/**
 * Attempt to gracefully kill a process by sending SIGTERM to its process group,
 * waiting for `timeoutMs`, then escalating to SIGKILL if still alive.
 * Sends signals to -pid (process group) to clean up child processes.
 */
export async function killProcessGracefully(
  pid: number,
  timeoutMs = 3000,
): Promise<void> {
  try {
    process.kill(pid, 0); // check alive
    process.kill(-pid, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    try {
      process.kill(pid, 0); // still alive?
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone
    }
  } catch {
    // Process already terminated
  }
}
