import os from "node:os";
import path from "node:path";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { app, dialog, ipcMain, nativeImage, Notification } from "electron";
import {
  type AlwaysAllowRule,
  DESKTOP_GATEWAY_VERSION,
  EMPTY_CAPABILITIES,
  type DesktopSettings,
  type RiskTier
} from "../shared/contracts.js";
import { buildAllowedDirectories, normalizeScopePath } from "../shared/sandbox-policy.js";
import { ApiKeyStore } from "./api-key-store.js";
import { CloudCommandExecutor } from "./cloud-command-executor.js";
import type { CloudSocketStatus } from "./cloud-protocol.js";
import { CloudSocketService } from "./cloud-socket.js";
import { SettingsStore } from "./settings-store.js";
import { DesktopTray } from "./tray.js";
import { DesktopWindow } from "./window.js";
import { DesktopGatewayServer } from "../server/server.js";
import {
  computeSymphonyDir,
  SymphonyDirNotConfiguredError
} from "../server/operations/symphony-utils.js";
import { seedReposConfig } from "./seed-repos-config.js";
import { SUPPORTED_OPERATION_IDS, resolveOperationId } from "./approval-operations.js";
import { shouldAutoApprove, OPERATION_RISK_TIERS } from "./approval-policy.js";
import { ActivityLogStore } from "./activity-log-store.js";
import { ApprovalStore } from "./approval-store.js";
import { JobStore, isTerminalJobStatus } from "./job-store.js";
import type { GatewayApprovalRequest, GatewayApprovalResult } from "../server/router.js";
import { normalizeAndValidateOrigin, normalizeWebAppOrigin } from "./origin-policy.js";
import { LocalSessionStore } from "./local-session-store.js";
import { enrichJobSnapshot } from "../server/operations/symphony-job-snapshot.js";
import pkg from "electron-updater";
const { autoUpdater } = pkg;
import { BUILD_COMMIT_HASH } from "../shared/build-info.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export class DesktopApplication {
  private readonly settingsStore: SettingsStore;
  private readonly apiKeyStore: ApiKeyStore;
  private readonly tray: DesktopTray;
  private readonly desktopWindow: DesktopWindow;
  private readonly server: DesktopGatewayServer;
  private readonly cloudSocket: CloudSocketService;
  private readonly commandExecutor: CloudCommandExecutor;
  private readonly activityLog: ActivityLogStore;
  private readonly approvalStore: ApprovalStore;
  private readonly jobStore: JobStore;
  private readonly gatewayAuthToken: string;
  private readonly sessionStore: LocalSessionStore;
  private shuttingDown = false;
  private dangerousAutoApprove = false;
  private cloudStatus: CloudSocketStatus = { state: "idle" };
  private cloudCommandsPaused: boolean;
  private cloudConnectionEnabled: boolean;
  private updateCheckTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.gatewayAuthToken = randomBytes(24).toString("hex");
    this.sessionStore = new LocalSessionStore();
    this.settingsStore = new SettingsStore();
    this.cloudCommandsPaused = this.settingsStore.getCloudCommandsPaused();
    this.cloudConnectionEnabled = this.settingsStore.getCloudConnectionEnabled();
    this.apiKeyStore = new ApiKeyStore();
    this.tray = new DesktopTray();
    this.desktopWindow = new DesktopWindow();
    this.activityLog = new ActivityLogStore();
    this.jobStore = new JobStore();
    this.approvalStore = new ApprovalStore({
      onChange: (pendingCount) => this.tray.setPendingApprovals(pendingCount),
      onNewApproval: (approval) => {
        const notification = new Notification({
          title: "Approval Required",
          body: approval.reason,
        });
        notification.on("click", () => {
          this.desktopWindow.show();
          this.desktopWindow.getWindow()?.webContents.send("desktop:navigate-tab", "approvals");
        });
        notification.show();
      }
    });
    this.server = DesktopGatewayServer.createDefault(
      this.settingsStore.getWebAppOrigin(),
      () => this.isNoAuthMode() ? undefined : this.gatewayAuthToken,
      () => this.getAllowedDirectoriesFromSandbox(),
      os.hostname(),
      DESKTOP_GATEWAY_VERSION,
      EMPTY_CAPABILITIES,
      (event) => {
        this.activityLog.add(event);
      },
      (request) => this.evaluateApproval(request),
      () => this.getSymphonyDir(),
      this.sessionStore,
      () => this.apiKeyStore.getApiKey(),
      () => this.settingsStore.getApiOrigin(),
      () => this.settingsStore.getWebAppOrigin(),
      this.isProdOriginsOnly(),
      this.jobStore
    );
    this.commandExecutor = new CloudCommandExecutor({
      getGatewayPort: () => this.server.getActivePort(),
      getGatewayAuthToken: () => this.gatewayAuthToken,
      maxInFlightCommands: MAX_IN_FLIGHT_COMMANDS,
      sendCommandAck: (event) => this.cloudSocket.sendCommandAck(event),
      sendCommandEvent: (event) => this.cloudSocket.sendCommandEvent(event),
      onQueueStatsChange: (stats) => {
        const presenceState =
          this.cloudStatus.state === "online" && !this.cloudCommandsPaused ? "online" : "degraded";
        this.cloudSocket.sendPresence({
          state: presenceState,
          ...(this.cloudCommandsPaused ? { error: "cloud commands paused by user" } : {}),
          activeCommands: stats.activeCommands,
          queueDepth: stats.queueDepth
        });
      }
    });
    this.cloudSocket = new CloudSocketService({
      getRelayOrigin: () => this.settingsStore.getRelayOrigin(),
      getApiKey: () => this.apiKeyStore.getApiKey(),
      getAllowedDirectories: () => this.getAllowedDirectoriesFromSandbox(),
      getMaxInFlightCommands: () => MAX_IN_FLIGHT_COMMANDS,
      machineName: os.hostname(),
      pluginVersion: DESKTOP_GATEWAY_VERSION,
      supportedOperations: [...SUPPORTED_OPERATION_IDS],
      onStatusChange: (status) => this.onCloudSocketStatus(status),
      onHelloAck: (event) => {
        if (event.resumeFromSequence) {
          this.commandExecutor.replayFrom(event.resumeFromSequence);
        }
      },
      onCommand: (command) => {
        if (!this.settingsStore.getOnboardingCompleted()) {
          this.cloudSocket.sendCommandAck({
            commandId: command.commandId,
            accepted: false,
            state: "failed",
            reason: "onboarding not completed"
          });
          return;
        }
        const resolvedOperationId = resolveOperationId(command.path);
        // Accept the command if either:
        // 1. The operationId matches exactly (explicit dispatch like symphony_loop)
        // 2. The path resolves to a known operation (relay HTTP proxy uses random UUIDs)
        if (!resolvedOperationId) {
          this.cloudSocket.sendCommandAck({
            commandId: command.commandId,
            accepted: false,
            state: "failed",
            reason: "operationId/path mismatch"
          });
          return;
        }
        if (this.cloudCommandsPaused) {
          this.cloudSocket.sendCommandAck({
            commandId: command.commandId,
            accepted: false,
            state: "failed",
            reason: "cloud commands paused by user"
          });
          return;
        }
        this.commandExecutor.enqueue(command);
      },
      onCancel: (event) => {
        this.commandExecutor.cancel(event);
      },
      onCommandEventAck: (event) => {
        this.commandExecutor.acknowledge(event);
      }
    });
    this.registerIpcHandlers();
  }

  async boot(): Promise<void> {
    if (process.platform === "darwin" && app.dock) {
      const resourcesDir = app.isPackaged
        ? process.resourcesPath
        : path.join(__dirname, "..", "..", "resources");
      const dockIcon = nativeImage.createFromPath(
        path.join(resourcesDir, "icon-1024.png")
      );
      app.dock.setIcon(dockIcon);
    }

    this.tray.init({
      onOpen: () => this.desktopWindow.show(),
      onTogglePaused: (paused) => this.setCloudCommandsPaused(paused)
    });
    this.tray.setPaused(this.cloudCommandsPaused);
    this.syncPendingApprovalsToTray();
    this.desktopWindow.init();

    this.migrateLegacyData();
    this.reconcileJobStore();

    const bootSandbox = this.settingsStore.getSandboxBaseDirectory();
    if (bootSandbox?.trim()) {
      await seedReposConfig(bootSandbox);
    }

    try {
      await this.server.start();
      const configuredOrigins = {
        relayOrigin: this.settingsStore.getRelayOrigin(),
        apiOrigin: this.settingsStore.getApiOrigin(),
        webAppOrigin: this.settingsStore.getWebAppOrigin()
      };
      this.refreshTrayState(
        `Serving on localhost:${this.server.getActivePort()} | relay=${configuredOrigins.relayOrigin} api=${configuredOrigins.apiOrigin} web=${configuredOrigins.webAppOrigin}`
      );

      if (this.cloudConnectionEnabled) {
        void this.cloudSocket.start();
      } else {
        this.cloudStatus = { state: "degraded", error: "Cloud connection disabled by user" };
      }

      if (app.isPackaged) {
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.on("update-available", (info) => {
          this.desktopWindow.getWindow()?.webContents.send("desktop:update-available", {
            updateAvailable: true,
            version: info.version
          });
        });
        void autoUpdater.checkForUpdates().catch(() => {});
        if (this.updateCheckTimer) clearInterval(this.updateCheckTimer);
        this.updateCheckTimer = setInterval(() => {
          void autoUpdater.checkForUpdates().catch(() => {});
        }, UPDATE_CHECK_INTERVAL_MS);
      } else {
        void this.checkForUpdate().then((result) => {
          if (result.updateAvailable) {
            this.desktopWindow.getWindow()?.webContents.send("desktop:update-available", result);
          }
        }).catch(() => {});
        if (this.updateCheckTimer) clearInterval(this.updateCheckTimer);
        this.updateCheckTimer = setInterval(() => {
          void this.checkForUpdate().then((result) => {
            if (result.updateAvailable) {
              this.desktopWindow.getWindow()?.webContents.send("desktop:update-available", result);
            }
          }).catch(() => {});
        }, UPDATE_CHECK_INTERVAL_MS);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown startup error";
      this.tray.setState("error", `Desktop startup failed: ${message}`);
      throw error;
    }
  }

  showWindow(): void {
    this.desktopWindow.init();
    this.desktopWindow.show();
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;
    if (this.updateCheckTimer) {
      clearInterval(this.updateCheckTimer);
      this.updateCheckTimer = null;
    }
    this.cloudSocket.stop();
    this.commandExecutor.dispose();
    await this.server.stop();
    this.desktopWindow.dispose();
    this.tray.dispose();
  }

  private onCloudSocketStatus(status: CloudSocketStatus): void {
    if (!this.cloudConnectionEnabled) {
      this.cloudStatus = { state: "degraded", error: "Cloud connection disabled by user" };
      this.refreshTrayState();
      return;
    }

    this.cloudStatus = status;
    const stats = this.commandExecutor.getStats();

    this.commandExecutor.setConnected(status.state === "online");

    if (status.state === "online") {
      this.cloudSocket.sendPresence({
        state: this.cloudCommandsPaused ? "degraded" : "online",
        ...(this.cloudCommandsPaused ? { error: "cloud commands paused by user" } : {}),
        activeCommands: stats.activeCommands,
        queueDepth: stats.queueDepth
      });
      this.refreshTrayState(`Serving on localhost:${this.server.getActivePort()} | cloud: online (${status.targetId})`);
      return;
    }

    if (status.state === "degraded") {
      this.cloudSocket.sendPresence({
        state: "degraded",
        error: status.error,
        activeCommands: stats.activeCommands,
        queueDepth: stats.queueDepth
      });
      this.refreshTrayState(`Serving on localhost:${this.server.getActivePort()} | cloud degraded: ${status.error}`);
      return;
    }

    this.refreshTrayState();
  }

  private setCloudCommandsPaused(paused: boolean): void {
    this.cloudCommandsPaused = paused;
    this.settingsStore.setCloudCommandsPaused(paused);
    this.tray.setPaused(paused);
    this.refreshTrayState(paused ? "Gateway paused from tray/menu" : undefined);

    const stats = this.commandExecutor.getStats();
    this.cloudSocket.sendPresence({
      state: this.cloudStatus.state === "online" && !paused ? "online" : "degraded",
      ...(paused ? { error: "cloud commands paused by user" } : {}),
      activeCommands: stats.activeCommands,
      queueDepth: stats.queueDepth
    });
  }

  private setCloudConnectionEnabled(enabled: boolean): void {
    this.cloudConnectionEnabled = enabled;
    this.settingsStore.setCloudConnectionEnabled(enabled);
    if (!enabled) {
      this.cloudSocket.stop();
      this.cloudStatus = { state: "degraded", error: "Cloud connection disabled by user" };
      this.refreshTrayState();
      return;
    }

    this.cloudStatus = { state: "idle" };
    this.refreshTrayState();
    this.cloudSocket.restart();
  }

  private restartCloudSocket(): void {
    if (this.shuttingDown) {
      return;
    }
    if (!this.cloudConnectionEnabled) {
      return;
    }
    this.cloudSocket.restart();
  }

  private syncPendingApprovalsToTray(): void {
    this.tray.setPendingApprovals(this.approvalStore.countPending());
  }

  private getSymphonyDir(): string {
    const sandboxBase = normalizeScopePath(this.settingsStore.getSandboxBaseDirectory());
    if (!sandboxBase?.trim()) {
      throw new SymphonyDirNotConfiguredError();
    }
    return computeSymphonyDir(sandboxBase);
  }

  private migrateLegacyData(): void {
    const sandboxBase = normalizeScopePath(this.settingsStore.getSandboxBaseDirectory());
    if (!sandboxBase?.trim()) {
      return;
    }

    const newDir = computeSymphonyDir(sandboxBase);

    const copyIfMissing = (src: string, dest: string): void => {
      if (existsSync(src) && !existsSync(dest)) {
        mkdirSync(path.dirname(dest), { recursive: true });
        copyFileSync(src, dest);
      }
    };

    const copyDirIfMissing = (srcDir: string, destDir: string): void => {
      if (!existsSync(srcDir)) return;
      try {
        for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            copyDirIfMissing(
              path.join(srcDir, entry.name),
              path.join(destDir, entry.name)
            );
          } else {
            copyIfMissing(
              path.join(srcDir, entry.name),
              path.join(destDir, entry.name)
            );
          }
        }
      } catch {
        // Best effort — skip unreadable entries
      }
    };

    try {
      // sessions.json — try newer path first, then legacy
      copyIfMissing(
        path.join(os.homedir(), ".closedloop-ai", "sessions.json"),
        path.join(newDir, "sessions.json")
      );
      copyIfMissing(
        path.join(os.homedir(), ".symphony", "sessions.json"),
        path.join(newDir, "sessions.json")
      );

      // repos.json
      copyIfMissing(
        path.join(os.homedir(), ".claude", "closedloop", "repos.json"),
        path.join(newDir, "config", "repos.json")
      );

      // chats from ~/.closedloop-ai/chats/
      copyDirIfMissing(
        path.join(os.homedir(), ".closedloop-ai", "chats"),
        path.join(newDir, "chats")
      );

      // chats from ~/.claude/.symphony/chats/
      copyDirIfMissing(
        path.join(os.homedir(), ".claude", ".symphony", "chats"),
        path.join(newDir, "chats")
      );
    } catch {
      // Migration is best-effort — don't block startup
    }
  }

  private isDebugAuthEnabled(): boolean {
    return process.env.CL_LOCAL_GATEWAY_DEBUG_AUTH === "1" && !app.isPackaged;
  }

  private isNoAuthMode(): boolean {
    return process.env.CL_LOCAL_GATEWAY_NO_AUTH === "1" && !app.isPackaged;
  }

  private isProdOriginsOnly(): boolean {
    return process.env.CL_LOCAL_GATEWAY_PROD_ORIGINS_ONLY === "1";
  }

  private getAllowedDirectoriesFromSandbox(): string[] {
    return buildAllowedDirectories(this.settingsStore.getSandboxBaseDirectory());
  }

  private getOnboardingState(): {
    completed: boolean;
    settings: DesktopSettings;
    hasStoredApiKey: boolean;
  } {
    const settings = this.settingsStore.getAll();
    return {
      completed: Boolean(settings.onboardingCompleted),
      settings: {
        ...settings,
        sandboxBaseDirectory:
          normalizeScopePath(settings.sandboxBaseDirectory) ?? settings.sandboxBaseDirectory
      },
      hasStoredApiKey: this.apiKeyStore.getStatus().hasApiKey
    };
  }

  private refreshTrayState(explicitDetails?: string): void {
    if (this.cloudCommandsPaused) {
      this.tray.setState(
        "degraded",
        explicitDetails ?? `Serving on localhost:${this.server.getActivePort()} | cloud commands paused`
      );
      return;
    }

    if (this.cloudStatus.state === "online") {
      this.tray.setState(
        "ready",
        explicitDetails ??
          `Serving on localhost:${this.server.getActivePort()} | cloud: online (${this.cloudStatus.targetId})`
      );
      return;
    }

    if (this.cloudStatus.state === "degraded") {
      this.tray.setState(
        "degraded",
        explicitDetails ??
          `Serving on localhost:${this.server.getActivePort()} | cloud degraded: ${this.cloudStatus.error}`
      );
      return;
    }

    this.tray.setState(
      "ready",
      explicitDetails ?? `Serving on localhost:${this.server.getActivePort()} | cloud: connecting`
    );
  }

  private async evaluateApproval(request: GatewayApprovalRequest): Promise<GatewayApprovalResult> {
    if (!this.settingsStore.getOnboardingCompleted()) {
      return {
        allow: false,
        statusCode: 403,
        payload: {
          error: "onboarding not completed"
        }
      };
    }

    if (this.dangerousAutoApprove) {
      return { allow: true };
    }

    const operationId = resolveOperationId(request.path);
    if (!operationId) {
      return {
        allow: false,
        statusCode: 403,
        payload: { error: `Unmapped operation: ${request.path}` }
      };
    }

    const settings = this.settingsStore.getAll();
    const requestScopePath = resolveApprovalScopePath(request.body);
    const activeAlwaysAllowRules = pruneExpiredAlwaysAllowRules(settings.alwaysAllowRules);
    if (activeAlwaysAllowRules.length !== settings.alwaysAllowRules.length) {
      this.settingsStore.setAlwaysAllowRules(activeAlwaysAllowRules);
    }
    if (
      matchesAlwaysAllowRule(activeAlwaysAllowRules, {
        operationId,
        method: request.method,
        path: request.path,
        scopePath: requestScopePath
      })
    ) {
      return { allow: true };
    }

    const configuredTier = (settings.autoApprovalRules[operationId] ??
      settings.defaultApprovalTier) as RiskTier;
    if (shouldAutoApprove(operationId, configuredTier, request.forceApproval ?? false)) {
      return { allow: true };
    }

    const operationRisk = (OPERATION_RISK_TIERS as Record<string, Exclude<RiskTier, "none">>)[operationId] ?? "high";
    const reason =
      request.approvalReason?.trim() ||
      `${operationId} is ${operationRisk}-risk, but your auto-approve threshold is ${configuredTier}`;
    const pending = this.approvalStore.enqueue({
      operationId,
      riskTier: operationRisk,
      method: request.method,
      path: request.path,
      body: request.body,
      scopePath: requestScopePath ?? undefined,
      location: describeRequestLocation(request),
      reason
    });
    const decision = await this.approvalStore.waitForDecision(pending.id, APPROVAL_TIMEOUT_MS);

    if (decision === "always_allow") {
      this.saveAlwaysAllowRuleForPending(pending);
    }

    if (decision === "approved" || decision === "always_allow") {
      return { allow: true };
    }

    if (decision === "expired") {
      return {
        allow: false,
        statusCode: 408,
        payload: {
          error: "approval timed out",
          operationId,
          approvalId: pending.id
        }
      };
    }

    return {
      allow: false,
      statusCode: 403,
      payload: {
        error: "request denied",
        operationId,
        approvalId: pending.id
      }
    };
  }

  private saveAlwaysAllowRuleForPending(pending: {
    operationId: string;
    method: string;
    path: string;
    scopePath?: string;
  }): void {
    const settings = this.settingsStore.getAll();
    const now = Date.now();
    const activeRules = pruneExpiredAlwaysAllowRules(settings.alwaysAllowRules, now);
    const expiresAt = new Date(now + ALWAYS_ALLOW_RULE_TTL_MS).toISOString();

    const existingIndex = activeRules.findIndex(
      (rule) =>
        rule.operationId === pending.operationId &&
        rule.method.toUpperCase() === pending.method.toUpperCase() &&
        rule.path === pending.path &&
        normalizeScopePath(rule.scopePath) === normalizeScopePath(pending.scopePath)
    );

    if (existingIndex >= 0) {
      activeRules[existingIndex] = {
        ...activeRules[existingIndex],
        expiresAt
      };
    } else {
      activeRules.push({
        id: randomUUID(),
        operationId: pending.operationId,
        method: pending.method.toUpperCase(),
        path: pending.path,
        scopePath: normalizeScopePath(pending.scopePath) ?? undefined,
        createdAt: new Date(now).toISOString(),
        expiresAt
      });
    }

    this.settingsStore.setAlwaysAllowRules(activeRules);
  }

  private async checkForUpdate(): Promise<{ updateAvailable: boolean; currentHash: string; remoteHash: string }> {
    const repoRoot = path.resolve(__dirname, "../../../..");
    await execFileAsync("git", ["fetch", "origin", "main"], { cwd: repoRoot });
    const { stdout } = await execFileAsync("git", ["rev-parse", "origin/main"], { cwd: repoRoot });
    const remoteHash = stdout.trim();
    return {
      updateAvailable: remoteHash !== BUILD_COMMIT_HASH,
      currentHash: BUILD_COMMIT_HASH,
      remoteHash
    };
  }

  private async applyUpdate(): Promise<void> {
    const repoRoot = path.resolve(__dirname, "../../../..");
    await execFileAsync("git", ["pull", "--rebase", "origin", "main"], { cwd: repoRoot });
    await execFileAsync("pnpm", ["-C", "apps/desktop", "build"], { cwd: repoRoot });
    app.relaunch();
    app.exit(0);
  }

  private reconcileJobStore(): void {
    this.jobStore.reconcile((job) => {
      const now = new Date().toISOString();

      // If no PID, we cannot verify liveness
      if (job.pid == null) {
        // Preserve CANCEL_PENDING -- we don't know if the process is gone
        if (job.status === "CANCEL_PENDING") {
          return job;
        }
        return { ...job, status: "UNKNOWN", updatedAt: now, completedAt: now };
      }

      // Check whether the process is still alive
      let processAlive = false;
      try {
        process.kill(job.pid, 0);
        processAlive = true;
      } catch {
        processAlive = false;
      }

      if (!processAlive) {
        // Try to determine final status from state.json
        if (job.statePath) {
          try {
            const stateRaw = readFileSync(job.statePath, "utf-8");
            const state = JSON.parse(stateRaw) as Record<string, unknown>;
            const rawStatus = typeof state.status === "string" ? state.status.toUpperCase() : null;
            if (rawStatus === "COMPLETED") {
              return { ...job, status: "COMPLETED", updatedAt: now, completedAt: now };
            }
            if (rawStatus === "FAILED") {
              return { ...job, status: "FAILED", updatedAt: now, completedAt: now };
            }
            if (rawStatus === "CANCELLED") {
              return { ...job, status: "CANCELLED", updatedAt: now, completedAt: now };
            }
            if (rawStatus === "AWAITING_USER") {
              return { ...job, status: "AWAITING_USER", updatedAt: now };
            }
            if (rawStatus === "STOPPED") {
              return { ...job, status: "STOPPED", updatedAt: now, completedAt: now };
            }
          } catch {
            // state.json unreadable -- fall through
          }
        }
        // CANCEL_PENDING + process dead = confirmed cancelled
        if (job.status === "CANCEL_PENDING") {
          return { ...job, status: "CANCELLED", updatedAt: now, completedAt: now };
        }
        return { ...job, status: "UNKNOWN", updatedAt: now, completedAt: now };
      }

      // Process is still alive -- preserve existing status (RUNNING, CANCEL_PENDING, etc.)
      // Only upgrade to RUNNING if it was in a pre-running state
      if (job.status === "QUEUED" || job.status === "STARTING") {
        return { ...job, status: "RUNNING", updatedAt: now };
      }
      return { ...job, updatedAt: now };
    });
  }

  private registerIpcHandlers(): void {
    ipcMain.handle("desktop:get-settings", () => {
      const settings = this.settingsStore.getAll();
      const activeAlwaysAllowRules = pruneExpiredAlwaysAllowRules(settings.alwaysAllowRules);
      if (activeAlwaysAllowRules.length !== settings.alwaysAllowRules.length) {
        this.settingsStore.setAlwaysAllowRules(activeAlwaysAllowRules);
      }
      return {
        ...settings,
        alwaysAllowRules: activeAlwaysAllowRules
      };
    });
    ipcMain.handle(
      "desktop:update-settings",
      async (_event, partial: {
        sandboxBaseDirectory?: string;
        onboardingCompleted?: boolean;
        relayOrigin?: string;
        apiOrigin?: string;
        webAppOrigin?: string;
        defaultApprovalTier?: "auto" | "none" | "low" | "medium" | "high";
        autoApprovalRules?: Record<string, "auto" | "none" | "low" | "medium" | "high">;
      }) => {
        const currentSettings = this.settingsStore.getAll();
        const nextPartial = { ...partial };
        // Normalize legacy "auto" tier to "high" (they behave identically)
        if (nextPartial.defaultApprovalTier === "auto") {
          nextPartial.defaultApprovalTier = "high";
        }
        if (nextPartial.autoApprovalRules) {
          for (const [key, val] of Object.entries(nextPartial.autoApprovalRules)) {
            if (val === "auto") nextPartial.autoApprovalRules[key] = "high";
          }
        }
        if (typeof partial.relayOrigin === "string") {
          nextPartial.relayOrigin = normalizeAndValidateOrigin(partial.relayOrigin);
        }
        if (typeof partial.apiOrigin === "string") {
          nextPartial.apiOrigin = normalizeAndValidateOrigin(partial.apiOrigin);
        }
        if (typeof partial.webAppOrigin === "string") {
          nextPartial.webAppOrigin = normalizeWebAppOrigin(partial.webAppOrigin);
        }
        const selectedSandbox =
          typeof partial.sandboxBaseDirectory === "string"
            ? normalizeScopePath(partial.sandboxBaseDirectory)
            : normalizeScopePath(currentSettings.sandboxBaseDirectory);
        if (typeof partial.sandboxBaseDirectory === "string") {
          if (!selectedSandbox) {
            throw new Error("Sandbox base directory is required");
          }
          nextPartial.sandboxBaseDirectory = selectedSandbox;
        }
        if (
          typeof partial.onboardingCompleted === "boolean" &&
          partial.onboardingCompleted &&
          !selectedSandbox
        ) {
          throw new Error("Complete onboarding requires a sandbox base directory");
        }

        const updated = this.settingsStore.update(nextPartial as Partial<DesktopSettings>);

        if (
          typeof partial.sandboxBaseDirectory === "string" &&
          selectedSandbox &&
          selectedSandbox !== normalizeScopePath(currentSettings.sandboxBaseDirectory)
        ) {
          await seedReposConfig(selectedSandbox);
        }

        this.restartCloudSocket();
        return updated;
      }
    );
    ipcMain.handle("desktop:get-runtime-status", () => ({
      port: this.server.getActivePort(),
      cloudStatus: this.cloudStatus,
      relayOrigin: this.settingsStore.getRelayOrigin(),
      apiOrigin: this.settingsStore.getApiOrigin(),
      sandboxBaseDirectory: this.settingsStore.getSandboxBaseDirectory(),
      commandsPaused: this.cloudCommandsPaused,
      connectionEnabled: this.cloudConnectionEnabled
    }));
    ipcMain.handle("desktop:list-running-jobs", async () => {
      const jobs = this.jobStore.listRunning();
      const snapshots = await Promise.all(jobs.map((j) => enrichJobSnapshot(j)));

      // Reconcile: if enrichment detected a terminal status (process dead),
      // persist it so the job moves from active to terminal in the store.
      const stillRunning = [];
      for (const snapshot of snapshots) {
        if (isTerminalJobStatus(snapshot.status) && !isTerminalJobStatus(this.jobStore.getById(snapshot.id)?.status ?? "UNKNOWN")) {
          this.jobStore.upsert({
            ...this.jobStore.getById(snapshot.id)!,
            status: snapshot.status,
            updatedAt: new Date().toISOString(),
            completedAt: snapshot.completedAt ?? new Date().toISOString(),
          });
        } else if (!isTerminalJobStatus(snapshot.status)) {
          stillRunning.push(snapshot);
        }
      }

      return stillRunning;
    });
    ipcMain.handle("desktop:list-completed-jobs", () => this.jobStore.listCompleted());
    ipcMain.handle("desktop:get-job", (_event, jobId: string) => {
      if (typeof jobId !== "string" || !jobId.trim()) {
        throw new Error("jobId is required");
      }
      return this.jobStore.getById(jobId.trim()) ?? null;
    });
    ipcMain.handle("desktop:get-job-log-tail", async (_event, jobId: string, lines?: number) => {
      if (typeof jobId !== "string" || !jobId.trim()) {
        throw new Error("jobId is required");
      }
      const job = this.jobStore.getById(jobId.trim());
      if (!job?.logPath) {
        return null;
      }
      try {
        const content = await readFile(job.logPath!, "utf-8");
        const allLines = content.split("\n");
        const maxLines = typeof lines === "number" && lines > 0 ? lines : 200;
        return allLines.slice(-maxLines).join("\n");
      } catch {
        return null;
      }
    });
    ipcMain.handle("desktop:get-activity-events", () => this.activityLog.list());
    ipcMain.handle("desktop:clear-activity-events", () => {
      this.activityLog.clear();
      return this.activityLog.list();
    });
    ipcMain.handle("desktop:get-pending-approvals", () => this.approvalStore.listPending());
    ipcMain.handle("desktop:get-resolved-approvals", () => this.approvalStore.listResolved());
    ipcMain.handle("desktop:clear-resolved-approvals", () => {
      this.approvalStore.clearResolved();
      return [];
    });
    ipcMain.handle("desktop:approve-approval", (_event, approvalId: string) => {
      if (typeof approvalId !== "string" || !approvalId.trim()) {
        throw new Error("approvalId is required");
      }
      this.approvalStore.approve(approvalId.trim());
      return this.approvalStore.listPending();
    });
    ipcMain.handle("desktop:deny-approval", (_event, approvalId: string) => {
      if (typeof approvalId !== "string" || !approvalId.trim()) {
        throw new Error("approvalId is required");
      }
      this.approvalStore.deny(approvalId.trim());
      return this.approvalStore.listPending();
    });
    ipcMain.handle("desktop:always-allow-approval", (_event, approvalId: string) => {
      if (typeof approvalId !== "string" || !approvalId.trim()) {
        throw new Error("approvalId is required");
      }
      const pending = this.approvalStore.getPendingById(approvalId.trim());
      if (!pending) {
        return {
          pendingApprovals: this.approvalStore.listPending(),
          settings: this.settingsStore.getAll()
        };
      }
      this.saveAlwaysAllowRuleForPending(pending);
      this.approvalStore.alwaysAllow(approvalId.trim());
      return {
        pendingApprovals: this.approvalStore.listPending(),
        settings: this.settingsStore.getAll()
      };
    });
    ipcMain.handle("desktop:remove-always-allow-rule", (_event, ruleId: string) => {
      if (typeof ruleId !== "string" || !ruleId.trim()) {
        throw new Error("ruleId is required");
      }
      const settings = this.settingsStore.getAll();
      const updated = (settings.alwaysAllowRules ?? []).filter((r) => r.id !== ruleId.trim());
      this.settingsStore.setAlwaysAllowRules(updated);
      return { alwaysAllowRules: updated };
    });
    ipcMain.handle("desktop:clear-pending-approvals", () => {
      this.approvalStore.clear();
      return this.approvalStore.listPending();
    });
    ipcMain.handle("desktop:get-api-key-status", () => this.apiKeyStore.getStatus());
    ipcMain.handle("desktop:set-api-key", (_event, apiKey: string) => {
      const trimmed = typeof apiKey === "string" ? apiKey.trim() : "";
      if (!trimmed.startsWith("sk_live_")) {
        throw new Error("API key must start with sk_live_");
      }
      this.apiKeyStore.setApiKey(trimmed);
      this.restartCloudSocket();
      return this.apiKeyStore.getStatus();
    });
    ipcMain.handle("desktop:clear-api-key", () => {
      this.apiKeyStore.clearApiKey();
      this.restartCloudSocket();
      return this.apiKeyStore.getStatus();
    });
    ipcMain.handle("desktop:get-cloud-commands-paused", () => this.cloudCommandsPaused);
    ipcMain.handle("desktop:set-cloud-commands-paused", (_event, paused: boolean) => {
      this.setCloudCommandsPaused(Boolean(paused));
      return { paused: this.cloudCommandsPaused };
    });
    ipcMain.handle("desktop:get-cloud-connection-enabled", () => this.cloudConnectionEnabled);
    ipcMain.handle("desktop:set-cloud-connection-enabled", (_event, enabled: boolean) => {
      this.setCloudConnectionEnabled(Boolean(enabled));
      return { enabled: this.cloudConnectionEnabled };
    });
    ipcMain.handle("desktop:get-onboarding-state", () => this.getOnboardingState());
    ipcMain.handle(
      "desktop:complete-onboarding",
      async (
        _event,
        payload: {
          relayOrigin?: string;
          apiOrigin?: string;
          webAppOrigin: string;
          sandboxBaseDirectory: string;
          apiKey?: string;
        }
      ) => {
        const relayOrigin = typeof payload.relayOrigin === "string" && payload.relayOrigin.trim()
          ? normalizeAndValidateOrigin(payload.relayOrigin)
          : undefined;
        const apiOrigin = typeof payload.apiOrigin === "string" && payload.apiOrigin.trim()
          ? normalizeAndValidateOrigin(payload.apiOrigin)
          : undefined;
        const webAppOrigin = normalizeWebAppOrigin(payload.webAppOrigin);
        const sandboxBaseDirectory = normalizeScopePath(payload.sandboxBaseDirectory);
        if (!sandboxBaseDirectory) {
          throw new Error("Sandbox base directory is required");
        }

        const trimmedApiKey = typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";
        if (trimmedApiKey) {
          if (!trimmedApiKey.startsWith("sk_live_")) {
            throw new Error("API key must start with sk_live_");
          }
          this.apiKeyStore.setApiKey(trimmedApiKey);
        }

        this.settingsStore.update({
          ...(relayOrigin !== undefined ? { relayOrigin } : {}),
          ...(apiOrigin !== undefined ? { apiOrigin } : {}),
          webAppOrigin,
          sandboxBaseDirectory,
          onboardingCompleted: true
        });
        await seedReposConfig(sandboxBaseDirectory);
        this.restartCloudSocket();
        return this.getOnboardingState();
      }
    );
    ipcMain.handle("desktop:pick-sandbox-directory", async () => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"]
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    });
    ipcMain.handle("desktop:get-dangerous-auto-approve", () => this.dangerousAutoApprove);
    ipcMain.handle("desktop:set-dangerous-auto-approve", (_event, enabled: boolean) => {
      this.dangerousAutoApprove = Boolean(enabled);
      return this.dangerousAutoApprove;
    });
    ipcMain.handle("desktop:is-debug-auth-enabled", () => this.isDebugAuthEnabled());
    ipcMain.handle("desktop:mint-debug-token", (_event, origin?: string) => {
      if (!this.isDebugAuthEnabled()) {
        throw new Error("Debug auth is not enabled");
      }
      const boundOrigin = typeof origin === "string" && origin.trim()
        ? origin.trim()
        : "http://localhost";
      const session = this.sessionStore.create(boundOrigin);
      return { ...session, origin: boundOrigin };
    });
    ipcMain.handle("desktop:check-for-update", async () => {
      try {
        if (app.isPackaged) {
          const result = await autoUpdater.checkForUpdates();
          const remoteVersion = result?.updateInfo?.version;
          return {
            updateAvailable: remoteVersion != null && remoteVersion !== app.getVersion(),
            version: remoteVersion
          };
        }
        return await this.checkForUpdate();
      } catch (error) {
        return { updateAvailable: false, error: error instanceof Error ? error.message : "unknown error" };
      }
    });
    ipcMain.handle("desktop:apply-update", async () => {
      if (app.isPackaged) {
        autoUpdater.quitAndInstall();
        return;
      }
      await this.applyUpdate();
    });
  }
}


const APPROVAL_TIMEOUT_MS = 120_000;
const MAX_IN_FLIGHT_COMMANDS = 2;
const ALWAYS_ALLOW_RULE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function pruneExpiredAlwaysAllowRules(
  rules: AlwaysAllowRule[] | undefined,
  now = Date.now()
): AlwaysAllowRule[] {
  if (!Array.isArray(rules) || rules.length === 0) {
    return [];
  }

  return rules.filter((rule) => {
    const expiresAt = Date.parse(rule.expiresAt);
    if (Number.isNaN(expiresAt)) {
      return false;
    }
    return expiresAt > now;
  });
}

function matchesAlwaysAllowRule(
  rules: AlwaysAllowRule[],
  request: { operationId: string; method: string; path: string; scopePath?: string | null }
): boolean {
  const normalizedScope = normalizeScopePath(request.scopePath);
  return rules.some((rule) => {
    if (rule.operationId !== request.operationId) {
      return false;
    }
    if (rule.method.toUpperCase() !== request.method.toUpperCase()) {
      return false;
    }
    if (rule.path !== request.path) {
      return false;
    }
    return normalizeScopePath(rule.scopePath) === normalizedScope;
  });
}

function resolveApprovalScopePath(rawBody: string): string | null {
  if (!rawBody || !rawBody.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    return (
      normalizeScopePath(maybeString(parsed.repoPath)) ??
      normalizeScopePath(maybeString(parsed.worktreePath)) ??
      normalizeScopePath(maybeString(parsed.workDir)) ??
      normalizeScopePath(maybeString(parsed.runDir)) ??
      normalizeScopePath(maybeString(parsed.path))
    );
  } catch {
    return null;
  }
}

function maybeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function describeRequestLocation(request: GatewayApprovalRequest): string {
  if (request.source) {
    return request.source;
  }
  if (request.origin) {
    return request.origin;
  }
  if (request.referer) {
    return request.referer;
  }
  if (request.remoteAddress) {
    return request.remoteAddress;
  }
  return "unknown";
}
