import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { gatewayLog } from "./gateway-logger.js";
import { isProcessAlive, signalProcess } from "./agent-monitor-process-utils.js";

const TAG = "agent-monitor";

// Substring that identifies our generated sidecar in a process command line.
// Matches both the dev tree (.generated/agent-monitor/server/index.js) and the
// packaged tree (extraResources/agent-monitor/server/index.js).
const SIDECAR_COMMAND_MARKER = "agent-monitor/server/index.js";

const LSOF_TIMEOUT_MS = 1_500;
const PS_TIMEOUT_MS = 1_000;
const KILL_GRACE_MS = 2_000;
const KILL_TIMEOUT_MS = 2_000;
const EXIT_POLL_INTERVAL_MS = 100;

export interface PortHolder {
  pid: number;
  uid: number;
  ppid: number;
  command: string;
}

// foreign  -> not ours; never touch it.
// orphan   -> ours, parent died (PPID 1) or pid matches our last-run PID file.
// live     -> ours, but a real parent is still running (another ClosedLoop).
export type HolderClass = "foreign" | "orphan" | "live";

export type ReconcileOutcome =
  | "no-holder"
  | "foreign"
  | "killed-orphan"
  | "killed-live"
  | "blocked-live"
  | "kill-failed";

export interface ReconcileOptions {
  port: number;
  pidFilePath: string;
  selfUid: number;
  // Invoked only for the `live` case. Returns true if the user consents to
  // force-kill the other live instance. Injected so the Electron dialog stays
  // out of this module and the decision path is unit-testable.
  confirmKillLive: (holder: PortHolder) => Promise<boolean>;
}

// Pure classifier — the heart of the three-guard decision. Kept side-effect
// free so the full truth table can be asserted in unit tests.
export function classifyHolder(
  holder: PortHolder,
  selfUid: number,
  recordedPid: number | null,
): HolderClass {
  const ownedByUs =
    holder.uid === selfUid && holder.command.includes(SIDECAR_COMMAND_MARKER);
  if (!ownedByUs) {
    return "foreign";
  }
  const matchesPidFile = recordedPid !== null && holder.pid === recordedPid;
  if (holder.ppid === 1 || matchesPidFile) {
    return "orphan";
  }
  return "live";
}

// Parse the first numeric pid from `lsof -t` output (one pid per line).
export function parseFirstPid(lsofOutput: string): number | null {
  for (const line of lsofOutput.split("\n")) {
    const pid = Number.parseInt(line.trim(), 10);
    if (Number.isInteger(pid) && pid > 0) {
      return pid;
    }
  }
  return null;
}

// Parse a single `ps -o uid=,ppid=,command=` line into a PortHolder.
export function parsePsLine(pid: number, psOutput: string): PortHolder | null {
  const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(psOutput.trim());
  if (!match) {
    return null;
  }
  return {
    pid,
    uid: Number.parseInt(match[1], 10),
    ppid: Number.parseInt(match[2], 10),
    command: match[3].trim(),
  };
}

export function readRecordedPid(pidFilePath: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(pidFilePath, "utf-8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function writeSidecarPidFile(pidFilePath: string, pid: number): void {
  try {
    mkdirSync(path.dirname(pidFilePath), { recursive: true });
    writeFileSync(pidFilePath, String(pid), "utf-8");
  } catch (error) {
    gatewayLog.warn(TAG, `failed to write sidecar pid file: ${describe(error)}`);
  }
}

export function removeSidecarPidFile(pidFilePath: string): void {
  try {
    rmSync(pidFilePath, { force: true });
  } catch {
    // Best-effort: a missing/locked pid file must never affect shutdown.
  }
}

// Best-effort lookup of the process LISTENing on a loopback port. macOS/Linux
// only (relies on lsof + ps); returns null on win32 or any tooling failure, in
// which case the caller simply proceeds and the existing degrade path applies.
export async function findPortHolder(port: number): Promise<PortHolder | null> {
  if (process.platform === "win32") {
    return null;
  }
  const lsofOut = await runCapture(
    "lsof",
    ["-nP", `-iTCP@127.0.0.1:${port}`, "-sTCP:LISTEN", "-t"],
    LSOF_TIMEOUT_MS,
  );
  if (lsofOut === null) {
    return null;
  }
  const pid = parseFirstPid(lsofOut);
  if (pid === null) {
    return null;
  }
  const psOut = await runCapture(
    "ps",
    ["-o", "uid=,ppid=,command=", "-p", String(pid)],
    PS_TIMEOUT_MS,
  );
  if (psOut === null) {
    return null;
  }
  return parsePsLine(pid, psOut);
}

// Detect-and-reconcile preflight. Runs BEFORE the sidecar bind attempt and
// never throws — any failure degrades to "proceed and let the bind decide".
export async function reconcileAgentMonitorPort(
  options: ReconcileOptions,
): Promise<ReconcileOutcome> {
  const { port, pidFilePath, selfUid, confirmKillLive } = options;
  const holder = await findPortHolder(port);
  if (!holder) {
    return "no-holder";
  }

  const klass = classifyHolder(holder, selfUid, readRecordedPid(pidFilePath));

  if (klass === "foreign") {
    gatewayLog.warn(
      TAG,
      `port ${port} held by a non-ClosedLoop process pid=${holder.pid} (${holder.command}); the agent dashboard will be unavailable until it is freed`,
    );
    return "foreign";
  }

  if (klass === "orphan") {
    if (await reclaimFromHolder(holder.pid)) {
      gatewayLog.info(
        TAG,
        `reclaimed port ${port} from orphaned sidecar pid=${holder.pid}`,
      );
      return "killed-orphan";
    }
    gatewayLog.warn(
      TAG,
      `failed to reclaim port ${port} from orphaned sidecar pid=${holder.pid}`,
    );
    return "kill-failed";
  }

  // live: never kill without explicit consent.
  const consent = await confirmKillLive(holder);
  if (!consent) {
    gatewayLog.warn(
      TAG,
      `port ${port} in use by another live ClosedLoop instance pid=${holder.pid}; left running at the user's request`,
    );
    return "blocked-live";
  }
  if (await reclaimFromHolder(holder.pid)) {
    gatewayLog.info(
      TAG,
      `reclaimed port ${port} from live ClosedLoop instance pid=${holder.pid} (user requested)`,
    );
    return "killed-live";
  }
  return "kill-failed";
}

// SIGTERM the holder's process group, wait for it to exit, then escalate to
// SIGKILL (group + bare pid, since a reparented orphan keeps its own pgid but
// the bare-pid fallback covers any edge case). Returns true once the process
// is gone — at which point the kernel has released its listening socket.
async function reclaimFromHolder(pid: number): Promise<boolean> {
  signalProcess(pid, "SIGTERM", { group: true });
  if (await waitForProcessExit(pid, KILL_GRACE_MS)) {
    return true;
  }
  signalProcess(pid, "SIGKILL", { group: true });
  signalProcess(pid, "SIGKILL");
  return waitForProcessExit(pid, KILL_TIMEOUT_MS);
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await delay(EXIT_POLL_INTERVAL_MS);
  }
  return !isProcessAlive(pid);
}

// Runs a read-only diagnostic command with a hard timeout. Resolves the raw
// stdout (possibly empty), or null on spawn error / timeout. Args are fixed and
// the only interpolated value is an integer pid / port — no shell, no untrusted
// string reaches argv.
function runCapture(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve(null);
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      finish(null);
    }, timeoutMs);

    let out = "";
    child.stdout?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => {
      out += chunk;
    });
    child.on("error", () => finish(null));
    child.on("close", () => finish(out));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
