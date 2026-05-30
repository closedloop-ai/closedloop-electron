import { app, BrowserWindow, dialog } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { AGENT_MONITOR_PORT } from "../shared/contracts.js";
import { gatewayLog } from "./gateway-logger.js";
import { resolveAgentMonitorPaths } from "./agent-monitor-path.js";
import { isProcessAlive, signalProcess } from "./agent-monitor-process-utils.js";
import {
  reconcileAgentMonitorPort,
  removeSidecarPidFile,
  writeSidecarPidFile,
  type PortHolder,
  type ReconcileOutcome,
} from "./agent-monitor-port-reconcile.js";

const TAG = "agent-monitor";
const HOST = "127.0.0.1";
const HEALTH_TIMEOUT_MS = 2_000;
const READY_POLL_INTERVAL_MS = 500;
// Cold start = Electron-as-Node spawn + Express init + ~20 SQLite
// migrations/index builds on first DB open + a possibly-large first-run
// legacy import competing for the event loop. Ready != import-complete; the
// iframe shows a loading state and populates progressively over the socket.
const READY_TIMEOUT_MS = 60_000;
// EADDRINUSE crashes do not surface until the child has finished its SQLite
// init / migrations / Express boot and reached listen(). Live testing on a
// dev build observed up to ~2.5s between spawn and the EADDRINUSE error;
// production machines under load could be slower. Hold the readiness verdict
// long enough that an exit during init reliably arrives before we reset the
// restart counter, otherwise a foreign process on the same port answers
// /api/health while our child is still initializing and the supervisor loops
// forever at attempt 1/N. 5s leaves enough margin without making a real
// successful boot feel sluggish (cold start is already 60s budget).
const READY_STABILITY_WINDOW_MS = 5_000;
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_BASE_DELAY_MS = 1_000;
const RESTART_MAX_DELAY_MS = 30_000;
// Upstream's SIGINT/SIGTERM handler closes the HTTP server + DB synchronously,
// then a non-unref'd maintenance setInterval keeps the loop alive until a 5s
// forced process.exit(0). DB integrity is already flushed by then, so a short
// grace + process-group SIGKILL keeps app shutdown within budget.
const STOP_GRACE_MS = 2_000;
const requireFromHere = createRequire(import.meta.url);

// Runs the generated Claude-Code-Agent-Monitor runtime tree as a managed
// localhost child process. The Electron binary is reused as the Node runtime
// via ELECTRON_RUN_AS_NODE (a packaged app ships no standalone `node`). Unlike
// the gateway, the port is FIXED (see AGENT_MONITOR_PORT) because Claude Code
// hooks bake a port at install time.
export class AgentMonitorSidecar {
  private child: ChildProcess | null = null;
  private readonly port = AGENT_MONITOR_PORT;
  private started = false;
  private stopping = false;
  private ready = false;
  private restartAttempts = 0;
  private readyResolvers: Array<(ok: boolean) => void> = [];
  private sandboxBaseDirectory = "";

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
      return;
    }
    this.started = true;
    try {
      await this.launch();
    } catch (error) {
      this.started = false;
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
    this.started = false;
    this.stopping = true;
    const child = this.child;
    this.child = null;
    this.ready = false;
    this.flushReady(false);
    // Clean shutdown: drop the PID file so the next boot does not treat our own
    // (now-terminated) pid as a recovered orphan.
    removeSidecarPidFile(this.pidFilePath);
    if (!child?.pid) {
      this.restartAttempts = 0;
      this.stopping = false;
      return;
    }
    const { pid } = child;
    try {
      signalProcess(pid, "SIGTERM", { group: true });
      await delay(STOP_GRACE_MS);
      if (isProcessAlive(pid)) {
        signalProcess(pid, "SIGKILL", { group: true });
      }
      gatewayLog.info(TAG, "agent monitor stopped");
    } finally {
      this.restartAttempts = 0;
      this.stopping = false;
    }
  }

  private get pidFilePath(): string {
    return path.join(app.getPath("userData"), "agent-monitor", "sidecar.pid");
  }

  // Detect-and-reconcile preflight: identify any process already holding the
  // fixed port and decide whether to reclaim it. Wrapped so a failure here can
  // never block boot — we simply proceed and let the bind attempt decide.
  //
  // `interactive` is true only for a user-initiated start (boot, settings
  // toggle, manual restart). The crash-restart path passes false so the
  // live-instance consent dialog can never pop up mid-session while the user is
  // working (PR #257 review, P2) — a live holder during background recovery
  // just stops the supervisor (blocked-live) instead of prompting.
  private async reconcilePort(interactive: boolean): Promise<ReconcileOutcome> {
    try {
      return await reconcileAgentMonitorPort({
        port: this.port,
        pidFilePath: this.pidFilePath,
        selfUid: typeof process.getuid === "function" ? process.getuid() : -1,
        confirmKillLive: interactive
          ? (holder) => this.confirmKillLiveInstance(holder)
          : async () => false,
      });
    } catch (error) {
      gatewayLog.warn(TAG, `port reconcile skipped: ${describe(error)}`);
      return "no-holder";
    }
  }

  // Guard 3: another *live* ClosedLoop instance owns the port. Never kill
  // without explicit user consent. Default/cancel is the non-destructive
  // "quit it first"; only an explicit "Kill It" click force-reclaims it.
  private async confirmKillLiveInstance(holder: PortHolder): Promise<boolean> {
    const options = {
      type: "warning" as const,
      buttons: ["Quit it first", "Kill It"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: "Agent dashboard port in use",
      message: `Another ClosedLoop instance (PID ${holder.pid}) is using the dashboard port ${this.port}.`,
      detail: `Process: ${holder.command}\n\nQuit that instance first, or force-kill it to free the dashboard port.`,
    };
    // Attach to the main window so the prompt is a sheet on top of the app
    // rather than a free-floating window that can hide behind it (macOS).
    const parent =
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const result = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    return result.response === 1;
  }

  private flushReady(ok: boolean): void {
    this.ready = ok;
    const resolvers = this.readyResolvers;
    this.readyResolvers = [];
    for (const resolve of resolvers) {
      resolve(ok);
    }
  }

  // `interactive` defaults true for user-initiated starts; the crash-restart
  // path calls launch(false) so the live-instance consent dialog never appears
  // during background recovery.
  private async launch(interactive = true): Promise<void> {
    if (!this.started || this.stopping) {
      return;
    }

    const { rootDir, entryFile } = resolveAgentMonitorPaths();
    if (!existsSync(entryFile)) {
      gatewayLog.error(
        TAG,
        `agent monitor entry not found at ${entryFile} — run \`pnpm -C apps/desktop build:agent-monitor\``,
      );
      this.started = false;
      this.flushReady(false);
      return;
    }

    // Detect-and-reconcile BEFORE the bind. Clears an orphaned sidecar from a
    // previous unclean exit so we don't burn the restart budget and degrade to
    // a blank dashboard. A dialog (live-instance case) can take arbitrary time,
    // so re-check our lifecycle flags after it returns.
    const outcome = await this.reconcilePort(interactive);
    if (!this.started || this.stopping) {
      return;
    }
    if (outcome === "blocked-live") {
      // The user chose to keep the other live instance running. Stop the
      // supervisor so we don't hammer the port with backoff retries; the
      // dashboard stays in "no monitor" mode until the next launch.
      this.started = false;
      this.flushReady(false);
      return;
    }

    const dbPath = path.join(
      app.getPath("userData"),
      "agent-monitor",
      "dashboard.db",
    );
    const pushKeysPath = path.join(
      app.getPath("userData"),
      "agent-monitor",
      "data",
      "vapid-keys.json",
    );
    const runtimeNodePath = buildRuntimeNodePath();

    const child = spawn(process.execPath, [entryFile], {
      cwd: rootDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        // The embedded sidecar always serves the generated client/dist tree.
        // Even in desktop-dev we are not running the upstream Vite dev server.
        NODE_ENV: "production",
        ...(runtimeNodePath ? { NODE_PATH: runtimeNodePath } : {}),
        DASHBOARD_PORT: String(this.port),
        DASHBOARD_DB_PATH: dbPath,
        CCAM_VAPID_KEYS_PATH: pushKeysPath,
        CCAM_ENABLE_RUN: "0",
        // Hooks are host-managed via explicit opt-in (agent-monitor-hooks.ts).
        // Never let the generated server silently auto-install them.
        CCAM_AUTO_INSTALL_HOOKS: "0",
        ...(this.sandboxBaseDirectory
          ? { SANDBOX_BASE_DIRECTORY: this.sandboxBaseDirectory }
          : {}),
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;

    if (!child.pid) {
      this.started = false;
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

    const healthy = await this.waitForHealth(child);
    // Don't trust a bare /api/health 200 — a foreign process on the same port
    // (orphaned dev sidecar, prior app instance, deliberate standalone build)
    // will answer while OUR child is mid-EADDRINUSE crash. Re-verify our child
    // is still the active one and still alive, then hold for a short stability
    // window and re-verify once more. Only then is readiness real and the
    // restart counter is safe to clear.
    if (healthy && this.isChildAliveAndCurrent(child)) {
      await delay(READY_STABILITY_WINDOW_MS);
      if (this.isChildAliveAndCurrent(child) && child.pid) {
        this.restartAttempts = 0;
        // Record our live pid so the next boot can recognise this exact process
        // as our prior orphan if it survives an unclean exit (Guard 2).
        writeSidecarPidFile(this.pidFilePath, child.pid);
        gatewayLog.info(
          TAG,
          `agent monitor ready at http://${HOST}:${this.port}`,
        );
        this.flushReady(true);
        return;
      }
    }
    gatewayLog.warn(
      TAG,
      `agent monitor did not become healthy on port ${this.port}`,
    );
    this.flushReady(false);
  }

  // Single source of truth for "the child we just spawned is still our
  // active reference AND still running". Keeping this in one place means a
  // future change cannot quietly skip half the guard at one of the three
  // call sites (waitForHealth poll, post-health gate, post-stability gate)
  // and reintroduce the false-positive-ready race fixed in FEA-1403.
  private isChildAliveAndCurrent(child: ChildProcess): boolean {
    return this.child === child && child.exitCode === null;
  }

  private handleExit(
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    const shouldRestart = this.started && !this.stopping;
    this.child = null;
    this.ready = false;
    if (!shouldRestart) {
      this.restartAttempts = 0;
      return;
    }
    gatewayLog.warn(TAG, `agent monitor exited code=${code} signal=${signal}`);
    this.flushReady(false);

    // A fixed port can lose to another local process (EADDRINUSE). The backoff
    // + hard cap degrades to "no monitor" — it never blocks boot, and Claude
    // Code is unaffected (the hook handler fails silently in <=3s).
    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      this.started = false;
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
      if (!this.started || this.stopping) {
        return;
      }
      this.launch(false).catch((error) =>
        gatewayLog.error(TAG, `restart failed: ${describe(error)}`),
      );
    }, backoff);
  }

  private async waitForHealth(child: ChildProcess): Promise<boolean> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      // Identity-scoped: a 200 from /api/health is only meaningful if it's
      // OUR child still serving it. If `this.child` has been replaced by a
      // newer launch, or the spawned child has already exited, abandon the
      // poll so the caller does not credit the success to this process.
      if (this.stopping || !this.isChildAliveAndCurrent(child)) {
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
