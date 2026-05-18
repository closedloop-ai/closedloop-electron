import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { AGENT_MONITOR_PORT } from "../shared/contracts.js";
import { gatewayLog } from "./gateway-logger.js";
import { resolveAgentMonitorPaths } from "./agent-monitor-path.js";

const TAG = "agent-monitor";
const HOST = "127.0.0.1";
const HEALTH_TIMEOUT_MS = 2_000;
const READY_POLL_INTERVAL_MS = 500;
// Cold start = Electron-as-Node spawn + Express init + ~20 SQLite
// migrations/index builds on first DB open + a possibly-large first-run
// legacy import competing for the event loop. Ready != import-complete; the
// iframe shows a loading state and populates progressively over the socket.
const READY_TIMEOUT_MS = 60_000;
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_BASE_DELAY_MS = 1_000;
const RESTART_MAX_DELAY_MS = 30_000;
// Upstream's SIGINT/SIGTERM handler closes the HTTP server + DB synchronously,
// then a non-unref'd maintenance setInterval keeps the loop alive until a 5s
// forced process.exit(0). DB integrity is already flushed by then, so a short
// grace + process-group SIGKILL keeps app shutdown within budget.
const STOP_GRACE_MS = 2_000;

// Runs the vendored Claude-Code-Agent-Monitor as a managed localhost child
// process. The Electron binary is reused as the Node runtime via
// ELECTRON_RUN_AS_NODE (a packaged app ships no standalone `node`). Unlike the
// gateway, the port is FIXED (see AGENT_MONITOR_PORT) because Claude Code hooks
// bake a port at install time.
export class AgentMonitorSidecar {
  private child: ChildProcess | null = null;
  private readonly port = AGENT_MONITOR_PORT;
  private started = false;
  private stopping = false;
  private ready = false;
  private restartAttempts = 0;
  private readyResolvers: Array<(ok: boolean) => void> = [];

  isReady(): boolean {
    return this.ready;
  }

  getUrl(): string | null {
    return this.ready ? `http://${HOST}:${this.port}` : null;
  }

  // Fire-and-forget safe: never rejects, never blocks app boot.
  async start(): Promise<void> {
    if (this.started || this.stopping) {
      return;
    }
    this.started = true;
    try {
      await this.launch();
    } catch (error) {
      gatewayLog.error(TAG, `start failed: ${describe(error)}`);
    }
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
    this.stopping = true;
    const child = this.child;
    this.child = null;
    this.ready = false;
    this.flushReady(false);
    if (!child?.pid) {
      return;
    }
    const { pid } = child;
    killGroup(pid, "SIGTERM");
    await delay(STOP_GRACE_MS);
    if (isRunning(pid)) {
      killGroup(pid, "SIGKILL");
    }
    gatewayLog.info(TAG, "agent monitor stopped");
  }

  private flushReady(ok: boolean): void {
    this.ready = ok;
    const resolvers = this.readyResolvers;
    this.readyResolvers = [];
    for (const resolve of resolvers) {
      resolve(ok);
    }
  }

  private async launch(): Promise<void> {
    if (this.stopping) {
      return;
    }

    const { rootDir, entryFile } = resolveAgentMonitorPaths();
    if (!existsSync(entryFile)) {
      gatewayLog.error(
        TAG,
        `agent monitor entry not found at ${entryFile} — run \`pnpm -C apps/desktop build:agent-monitor\``,
      );
      this.flushReady(false);
      return;
    }

    const dbPath = path.join(
      app.getPath("userData"),
      "agent-monitor",
      "dashboard.db",
    );

    const child = spawn(process.execPath, [entryFile], {
      cwd: rootDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        DASHBOARD_PORT: String(this.port),
        DASHBOARD_DB_PATH: dbPath,
        // Hooks are host-managed via explicit opt-in (agent-monitor-hooks.ts).
        // Never let the server silently auto-install them (vendor patch #2).
        CCAM_AUTO_INSTALL_HOOKS: "0",
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;

    if (!child.pid) {
      gatewayLog.error(TAG, "failed to spawn agent monitor process");
      this.flushReady(false);
      return;
    }
    gatewayLog.info(
      TAG,
      `starting agent monitor pid=${child.pid} port=${this.port}`,
    );

    pipeLines(child.stdout, (line) => gatewayLog.debug(TAG, line));
    pipeLines(child.stderr, (line) => gatewayLog.warn(TAG, line));
    child.on("error", (error) =>
      gatewayLog.error(TAG, `process error: ${describe(error)}`),
    );
    child.on("exit", (code, signal) => this.handleExit(code, signal));

    const healthy = await this.waitForHealth();
    if (healthy) {
      this.restartAttempts = 0;
      gatewayLog.info(TAG, `agent monitor ready at ${this.getUrl()}`);
      this.flushReady(true);
    } else {
      gatewayLog.warn(
        TAG,
        `agent monitor did not become healthy on port ${this.port}`,
      );
      this.flushReady(false);
    }
  }

  private handleExit(
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    this.child = null;
    this.ready = false;
    if (this.stopping) {
      return;
    }
    gatewayLog.warn(TAG, `agent monitor exited code=${code} signal=${signal}`);
    this.flushReady(false);

    // A fixed port can lose to another local process (EADDRINUSE). The backoff
    // + hard cap degrades to "no monitor" — it never blocks boot, and Claude
    // Code is unaffected (the hook handler fails silently in <=3s).
    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      gatewayLog.error(
        TAG,
        `giving up after ${this.restartAttempts} restart attempts`,
      );
      return;
    }
    const attempt = ++this.restartAttempts;
    const backoff = Math.min(
      RESTART_BASE_DELAY_MS * 2 ** (attempt - 1),
      RESTART_MAX_DELAY_MS,
    );
    gatewayLog.info(
      TAG,
      `restarting agent monitor in ${backoff}ms (attempt ${attempt}/${MAX_RESTART_ATTEMPTS})`,
    );
    setTimeout(() => {
      if (this.stopping) {
        return;
      }
      this.launch().catch((error) =>
        gatewayLog.error(TAG, `restart failed: ${describe(error)}`),
      );
    }, backoff);
  }

  private async waitForHealth(): Promise<boolean> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.stopping || this.child == null) {
        return false;
      }
      if (await healthOk(this.port)) {
        return true;
      }
      await delay(READY_POLL_INTERVAL_MS);
    }
    return false;
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

function pipeLines(
  stream: NodeJS.ReadableStream | null,
  onLine: (line: string) => void,
): void {
  if (!stream) {
    return;
  }
  stream.setEncoding("utf-8");
  let buffer = "";
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (line) {
        onLine(line);
      }
    }
  });
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    // Negative pid targets the detached process group.
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
