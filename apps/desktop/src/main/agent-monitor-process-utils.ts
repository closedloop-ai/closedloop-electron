import { gatewayLog } from "./gateway-logger.js";

const TAG = "agent-monitor";

// Liveness probe via signal 0 — does not actually deliver a signal, only runs
// the kernel's permission/existence check. EPERM still means the process is
// alive (owned by another user); only ESRCH means it is gone.
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

// Signals a process, optionally targeting its whole process group (negative
// pid). ESRCH (already gone) is ignored; any other failure is logged but never
// thrown, so callers can fire-and-forget during boot/shutdown without guarding.
export function signalProcess(
  pid: number,
  signal: NodeJS.Signals,
  options: { group?: boolean } = {},
): void {
  const target = options.group ? -pid : pid;
  try {
    process.kill(target, signal);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ESRCH") {
      gatewayLog.warn(TAG, `kill ${signal} (pid=${pid}) failed: ${describe(error)}`);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
