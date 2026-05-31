import { app } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

import {
  AGENT_MONITOR_PORT,
  resolveAgentMonitorPort,
} from "../shared/contracts.js";
import { gatewayLog } from "./gateway-logger.js";
import { resolveAgentMonitorPaths } from "./agent-monitor-path.js";

const TAG = "agent-monitor";
const HOST = "127.0.0.1";
const HEALTH_TIMEOUT_MS = 2_000;
const READY_POLL_INTERVAL_MS = 500;
const READY_TIMEOUT_MS = 60_000;
const LEGACY_RECLAIM_WAIT_TIMEOUT_MS = 2_000;
const requireFromHere = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

interface AgentMonitorRuntimeHandle {
  stop: () => Promise<void> | void;
}

interface AgentMonitorRuntimeModule {
  startClosedLoopAgentMonitorRuntime: (options: {
    rootDir: string;
    port: number;
    env: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  }) => Promise<AgentMonitorRuntimeHandle>;
}

// Runs the generated Claude-Code-Agent-Monitor runtime tree inside Electron
// main. The localhost port remains fixed by default because Claude Code hooks
// bake it at install time, but CL_AGENT_MONITOR_PORT can temporarily move dev
// builds away from another running Electron session.
export class AgentMonitorSidecar {
  private runtime: AgentMonitorRuntimeHandle | null = null;
  private readonly port = resolveAgentMonitorPort();
  private readonly dataDir = path.join(
    app.getPath("userData"),
    "agent-monitor",
  );
  private started = false;
  private stopping = false;
  private ready = false;
  private starting: Promise<void> | null = null;
  private startAbort: AbortController | null = null;
  private readyResolvers: Array<(ok: boolean) => void> = [];
  private onTerminalFailure?: (reason: string) => void;
  private sandboxBaseDirectory = "";

  constructor(options?: { onTerminalFailure?: (reason: string) => void }) {
    this.onTerminalFailure = options?.onTerminalFailure;
  }

  setSandboxBaseDirectory(dir: string): void {
    this.sandboxBaseDirectory = dir;
  }

  isReady(): boolean {
    return this.ready;
  }

  getUrl(): string | null {
    return this.ready ? `http://${HOST}:${this.port}` : null;
  }

  // Fire-and-forget safe: never rejects, never blocks app boot.
  async start(): Promise<void> {
    if (this.started || this.stopping) {
      return this.starting ?? undefined;
    }
    this.started = true;
    const controller = new AbortController();
    this.startAbort = controller;
    this.starting = this.launch(controller.signal)
      .catch((error) => {
        if (controller.signal.aborted || this.stopping || !this.started) {
          this.runtime = null;
          this.flushReady(false);
          return;
        }
        this.started = false;
        this.runtime = null;
        this.flushReady(false);
        const reason = this.describeStartupFailure(error);
        gatewayLog.error(TAG, reason);
        this.onTerminalFailure?.(reason);
      })
      .finally(() => {
        if (this.startAbort === controller) {
          this.startAbort = null;
          this.starting = null;
        }
      });
    return this.starting;
  }

  // Resolves true once the monitor answers health checks, false on timeout.
  async whenReady(timeoutMs = READY_TIMEOUT_MS): Promise<boolean> {
    if (this.isReady()) {
      return true;
    }
    void this.start();
    return new Promise<boolean>((resolve) => {
      const onResolve = (ok: boolean): void => {
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => {
        this.readyResolvers = this.readyResolvers.filter((r) => r !== onResolve);
        resolve(this.isReady());
      }, timeoutMs);
      this.readyResolvers.push(onResolve);
    });
  }

  async stop(): Promise<void> {
    this.started = false;
    this.stopping = true;
    this.startAbort?.abort();
    const starting = this.starting;
    try {
      const runtime = this.runtime;
      this.runtime = null;
      this.flushReady(false);
      if (runtime) {
        await runtime.stop();
        gatewayLog.info(TAG, "agent monitor stopped");
      } else if (starting) {
        await starting.catch(() => {});
      }
    } finally {
      this.stopping = false;
    }
  }

  private flushReady(ok: boolean): void {
    this.ready = ok;
    const resolvers = this.readyResolvers;
    this.readyResolvers = [];
    for (const resolve of resolvers) {
      resolve(ok);
    }
  }

  private async launch(signal: AbortSignal): Promise<void> {
    if (signal.aborted || !this.started || this.stopping) {
      return;
    }

    const { rootDir, runtimeFile, entryFile } = resolveAgentMonitorPaths();
    if (!existsSync(runtimeFile)) {
      throw new Error(
        `agent monitor runtime not found at ${runtimeFile} - run \`pnpm -C apps/desktop build:agent-monitor\``,
      );
    }

    await fs.mkdir(this.dataDir, { recursive: true });
    await this.reclaimLegacySidecarOrphan(entryFile);
    if (signal.aborted || !this.started || this.stopping) {
      return;
    }
    const runtimeModule = requireFromHere(runtimeFile) as AgentMonitorRuntimeModule;
    if (
      !runtimeModule ||
      typeof runtimeModule.startClosedLoopAgentMonitorRuntime !== "function"
    ) {
      throw new Error(
        `agent monitor runtime at ${runtimeFile} does not export startClosedLoopAgentMonitorRuntime`,
      );
    }

    gatewayLog.info(TAG, `starting in-process agent monitor port=${this.port}`);
    const runtime = await runtimeModule.startClosedLoopAgentMonitorRuntime({
      rootDir,
      port: this.port,
      env: this.buildRuntimeEnv(rootDir),
      signal,
    });
    if (signal.aborted || !this.started || this.stopping) {
      await runtime.stop();
      return;
    }
    this.runtime = runtime;

    if (await this.waitForHealth(signal)) {
      gatewayLog.info(TAG, `agent monitor ready at http://${HOST}:${this.port}`);
      this.flushReady(true);
      return;
    }

    const currentRuntime = this.runtime;
    this.runtime = null;
    await currentRuntime?.stop();
    if (signal.aborted || !this.started || this.stopping) {
      return;
    }
    throw new Error(`agent monitor did not become healthy on port ${this.port}`);
  }

  private buildRuntimeEnv(rootDir: string): NodeJS.ProcessEnv {
    const dbPath = path.join(this.dataDir, "dashboard.db");
    const pushKeysPath = path.join(this.dataDir, "data", "vapid-keys.json");
    const runtimeNodePath = buildRuntimeNodePath();
    return {
      CCAM_RUNTIME_ROOT: rootDir,
      // The embedded dashboard always serves the generated client/dist tree.
      // Even in desktop-dev we are not running the upstream Vite dev server.
      NODE_ENV: "production",
      ...(runtimeNodePath ? { NODE_PATH: runtimeNodePath } : {}),
      DASHBOARD_PORT: String(this.port),
      CLAUDE_DASHBOARD_PORT: String(this.port),
      DASHBOARD_DB_PATH: dbPath,
      CCAM_VAPID_KEYS_PATH: pushKeysPath,
      CCAM_ENABLE_RUN: "0",
      // Hooks are host-managed via explicit opt-in (agent-monitor-hooks.ts).
      // Never let the generated server silently auto-install them.
      CCAM_AUTO_INSTALL_HOOKS: "0",
      ...(this.sandboxBaseDirectory
        ? { SANDBOX_BASE_DIRECTORY: this.sandboxBaseDirectory }
        : {}),
    };
  }

  private async deleteLegacyPidFile(): Promise<void> {
    try {
      await fs.unlink(path.join(this.dataDir, "sidecar.pid"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        gatewayLog.warn(TAG, `failed to delete legacy PID file: ${describe(error)}`);
      }
    }
  }

  private async reclaimLegacySidecarOrphan(entryFile: string): Promise<void> {
    if (this.port !== AGENT_MONITOR_PORT) {
      return;
    }

    const pidFile = path.join(this.dataDir, "sidecar.pid");
    let raw: string;
    try {
      raw = await fs.readFile(pidFile, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        gatewayLog.warn(TAG, `failed to read legacy PID file: ${describe(error)}`);
      }
      return;
    }

    let pid: number;
    let sessionToken: string | undefined;
    let recordedStartTime: string | null;
    try {
      const parsed = JSON.parse(raw) as {
        pid: number;
        sessionToken?: string;
        startTime?: string | null;
      };
      pid = parsed.pid;
      sessionToken = parsed.sessionToken;
      recordedStartTime = parsed.startTime ?? null;
    } catch (error) {
      gatewayLog.warn(TAG, `failed to parse legacy PID file: ${describe(error)}`);
      await this.deleteLegacyPidFile();
      return;
    }

    if (!Number.isInteger(pid) || pid <= 0) {
      gatewayLog.warn(TAG, `legacy PID file contains invalid pid=${pid}`);
      await this.deleteLegacyPidFile();
      return;
    }
    if (!sessionToken) {
      gatewayLog.warn(TAG, `legacy PID file missing sessionToken for pid=${pid}`);
      await this.deleteLegacyPidFile();
      return;
    }

    if (isRunning(pid)) {
      const [command, liveStartTime] = await Promise.all([
        getProcessCommand(pid),
        getProcessStartTime(pid),
      ]);
      const runsOurEntry = command !== null && command.includes(entryFile);
      const startTimeMatches =
        recordedStartTime === null ||
        (liveStartTime !== null && liveStartTime === recordedStartTime);

      if (runsOurEntry && startTimeMatches) {
        gatewayLog.info(TAG, `reclaiming legacy agent monitor process pid=${pid}`);
        killGroup(pid, "SIGKILL");
        const deadline = Date.now() + LEGACY_RECLAIM_WAIT_TIMEOUT_MS;
        while (isRunning(pid) && Date.now() < deadline) {
          await delay(READY_POLL_INTERVAL_MS);
        }
      } else {
        gatewayLog.warn(
          TAG,
          `legacy pid=${pid} does not match the agent monitor entry; skipping kill`,
        );
      }
    }

    await this.deleteLegacyPidFile();
  }

  private async waitForHealth(signal: AbortSignal): Promise<boolean> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (signal.aborted || this.stopping || !this.runtime) {
        return false;
      }
      if (await healthOk(this.port)) {
        return true;
      }
      await delay(READY_POLL_INTERVAL_MS);
    }
    return false;
  }

  private describeStartupFailure(error: unknown): string {
    const description = describe(error);
    if (description.includes("EADDRINUSE")) {
      return `Agent monitor failed: port ${this.port} is in use by another process. Close the conflicting process and retry.`;
    }
    return `Agent monitor failed: ${description}`;
  }
}

function buildRuntimeNodePath(): string | undefined {
  const values = [
    ...resolveRuntimeSupportNodePaths("agent-dashboard"),
    app.isPackaged
      ? path.join(process.resourcesPath, "app.asar", "app", "node_modules")
      : null,
    app.isPackaged
      ? path.join(process.resourcesPath, "app", "node_modules")
      : null,
    process.env.NODE_PATH,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  if (values.length === 0) {
    return undefined;
  }

  return Array.from(new Set(values)).join(path.delimiter);
}

function resolveRuntimeSupportNodePaths(packageName: string): string[] {
  try {
    const packageJsonPath = requireFromHere.resolve(`${packageName}/package.json`);
    const packageRoot = path.dirname(packageJsonPath);
    return [
      // pnpm keeps direct deps alongside the package under .pnpm/.../node_modules.
      // Prepending that directory lets the generated runtime borrow the
      // installed dependency graph instead of shipping a second copy.
      path.dirname(packageRoot),
      path.join(packageRoot, "node_modules"),
    ].filter((candidate) => existsSync(candidate));
  } catch {
    return [];
  }
}

async function healthOk(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://${HOST}:${port}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    gatewayLog.warn(TAG, `killGroup ignoring invalid pid=${pid}`);
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ESRCH") {
      gatewayLog.warn(TAG, `kill ${signal} failed: ${describe(error)}`);
    }
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function getProcessCommand(pid: number): Promise<string | null> {
  return queryProcess(pid, "command=");
}

async function getProcessStartTime(pid: number): Promise<string | null> {
  return queryProcess(pid, "lstart=");
}

async function queryProcess(
  pid: number,
  field: "command=" | "lstart=",
): Promise<string | null> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  try {
    const { stdout } = await execFileAsync("ps", [
      "-ww",
      "-p",
      String(pid),
      "-o",
      field,
    ]);
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
