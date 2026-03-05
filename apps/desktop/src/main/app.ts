import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { app, dialog, ipcMain, Notification } from "electron";
import {
  type AlwaysAllowRule,
  DESKTOP_GATEWAY_VERSION,
  EMPTY_CAPABILITIES,
  type DesktopSettings,
  type RiskTier
} from "../shared/contracts.js";
import { ApiKeyStore } from "./api-key-store.js";
import { CloudCommandExecutor } from "./cloud-command-executor.js";
import type { CloudSocketStatus } from "./cloud-protocol.js";
import { CloudSocketService } from "./cloud-socket.js";
import { SettingsStore } from "./settings-store.js";
import { DesktopTray } from "./tray.js";
import { DesktopWindow } from "./window.js";
import { DesktopGatewayServer } from "../server/server.js";
import { ActivityLogStore } from "./activity-log-store.js";
import { ApprovalStore } from "./approval-store.js";
import type { GatewayApprovalRequest, GatewayApprovalResult } from "../server/router.js";
import { normalizeAndValidateApiOrigin, normalizeWebAppOrigin } from "./origin-policy.js";
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
  private readonly gatewayAuthToken: string;
  private shuttingDown = false;
  private dangerousAutoApprove = false;
  private cloudStatus: CloudSocketStatus = { state: "idle" };
  private cloudCommandsPaused: boolean;
  private cloudConnectionEnabled: boolean;
  private updateCheckTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.gatewayAuthToken = randomBytes(24).toString("hex");
    this.settingsStore = new SettingsStore();
    this.cloudCommandsPaused = this.settingsStore.getCloudCommandsPaused();
    this.cloudConnectionEnabled = this.settingsStore.getCloudConnectionEnabled();
    this.apiKeyStore = new ApiKeyStore();
    this.tray = new DesktopTray();
    this.desktopWindow = new DesktopWindow();
    this.activityLog = new ActivityLogStore();
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
      () => this.gatewayAuthToken,
      () => this.getEffectiveAllowedDirectories(),
      os.hostname(),
      DESKTOP_GATEWAY_VERSION,
      EMPTY_CAPABILITIES,
      (event) => {
        this.activityLog.add(event);
      },
      (request) => this.evaluateApproval(request)
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
      getApiOrigin: () => this.settingsStore.getApiOrigin(),
      getApiKey: () => this.apiKeyStore.getApiKey(),
      getAllowedDirectories: () => this.getEffectiveAllowedDirectories(),
      getMaxInFlightCommands: () => MAX_IN_FLIGHT_COMMANDS,
      machineName: os.hostname(),
      pluginVersion: DESKTOP_GATEWAY_VERSION,
      supportedOperations: SUPPORTED_OPERATION_IDS,
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
        if (!resolvedOperationId || resolvedOperationId !== command.operationId) {
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
    this.tray.init({
      onOpen: () => this.desktopWindow.show(),
      onTogglePaused: (paused) => this.setCloudCommandsPaused(paused)
    });
    this.tray.setPaused(this.cloudCommandsPaused);
    this.syncPendingApprovalsToTray();
    this.desktopWindow.init();

    try {
      await this.server.start();
      const configuredOrigins = {
        apiOrigin: this.settingsStore.getApiOrigin(),
        webAppOrigin: this.settingsStore.getWebAppOrigin()
      };
      this.refreshTrayState(
        `Serving on localhost:${this.server.getActivePort()} | api=${configuredOrigins.apiOrigin} web=${configuredOrigins.webAppOrigin}`
      );

      if (this.cloudConnectionEnabled) {
        void this.cloudSocket.start();
      } else {
        this.cloudStatus = { state: "degraded", error: "Cloud connection disabled by user" };
      }

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

  private getEffectiveAllowedDirectories(): string[] {
    const settings = this.settingsStore.getAll();
    const sandboxBaseDirectory = normalizeScopePath(settings.sandboxBaseDirectory);
    return applySandboxPolicyToAllowedDirectories(settings.allowedDirectories, sandboxBaseDirectory);
  }

  private getOnboardingState(): {
    completed: boolean;
    settings: DesktopSettings;
    hasStoredApiKey: boolean;
  } {
    const settings = this.settingsStore.getAll();
    const effectiveAllowedDirectories = this.getEffectiveAllowedDirectories();
    return {
      completed: Boolean(settings.onboardingCompleted),
      settings: {
        ...settings,
        allowedDirectories: effectiveAllowedDirectories,
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
      return { allow: true };
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
    const tier: RiskTier = request.forceApproval ? "high" : configuredTier;
    if (tier === "auto" && !request.forceApproval) {
      return { allow: true };
    }
    const manualTier: Exclude<RiskTier, "auto"> = tier === "auto" ? "high" : tier;

    const reason =
      request.approvalReason?.trim() ||
      `Manual approval required for ${operationId} (${manualTier})`;
    const pending = this.approvalStore.enqueue({
      operationId,
      riskTier: manualTier,
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

  private registerIpcHandlers(): void {
    ipcMain.handle("desktop:get-settings", () => {
      const settings = this.settingsStore.getAll();
      const activeAlwaysAllowRules = pruneExpiredAlwaysAllowRules(settings.alwaysAllowRules);
      if (activeAlwaysAllowRules.length !== settings.alwaysAllowRules.length) {
        this.settingsStore.setAlwaysAllowRules(activeAlwaysAllowRules);
      }
      return {
        ...settings,
        allowedDirectories: this.getEffectiveAllowedDirectories(),
        alwaysAllowRules: activeAlwaysAllowRules
      };
    });
    ipcMain.handle(
      "desktop:update-settings",
      (_event, partial: {
        allowedDirectories?: string[];
        sandboxBaseDirectory?: string;
        onboardingCompleted?: boolean;
        apiOrigin?: string;
        webAppOrigin?: string;
        defaultApprovalTier?: "auto" | "low" | "medium" | "high";
        autoApprovalRules?: Record<string, "auto" | "low" | "medium" | "high">;
      }) => {
        const currentSettings = this.settingsStore.getAll();
        const nextPartial = { ...partial };
        if (typeof partial.apiOrigin === "string") {
          nextPartial.apiOrigin = normalizeAndValidateApiOrigin(partial.apiOrigin);
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
        nextPartial.allowedDirectories = applySandboxPolicyToAllowedDirectories(
          partial.allowedDirectories ?? currentSettings.allowedDirectories,
          selectedSandbox
        );
        if (
          typeof partial.onboardingCompleted === "boolean" &&
          partial.onboardingCompleted &&
          !selectedSandbox
        ) {
          throw new Error("Complete onboarding requires a sandbox base directory");
        }

        const updated = this.settingsStore.update(nextPartial);
        this.restartCloudSocket();
        return updated;
      }
    );
    ipcMain.handle("desktop:get-runtime-status", () => ({
      port: this.server.getActivePort(),
      cloudStatus: this.cloudStatus,
      apiOrigin: this.settingsStore.getApiOrigin(),
      sandboxBaseDirectory: this.settingsStore.getSandboxBaseDirectory(),
      commandsPaused: this.cloudCommandsPaused,
      connectionEnabled: this.cloudConnectionEnabled
    }));
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
      const approved = this.approvalStore.approve(approvalId.trim());
      if (!approved) {
        throw new Error("approval not found");
      }
      return this.approvalStore.listPending();
    });
    ipcMain.handle("desktop:deny-approval", (_event, approvalId: string) => {
      if (typeof approvalId !== "string" || !approvalId.trim()) {
        throw new Error("approvalId is required");
      }
      const denied = this.approvalStore.deny(approvalId.trim());
      if (!denied) {
        throw new Error("approval not found");
      }
      return this.approvalStore.listPending();
    });
    ipcMain.handle("desktop:always-allow-approval", (_event, approvalId: string) => {
      if (typeof approvalId !== "string" || !approvalId.trim()) {
        throw new Error("approvalId is required");
      }
      const pending = this.approvalStore.getPendingById(approvalId.trim());
      if (!pending) {
        throw new Error("approval not found");
      }
      this.saveAlwaysAllowRuleForPending(pending);
      const resolved = this.approvalStore.alwaysAllow(approvalId.trim());
      if (!resolved) {
        throw new Error("approval not found");
      }
      return {
        pendingApprovals: this.approvalStore.listPending(),
        settings: this.settingsStore.getAll()
      };
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
          apiOrigin: string;
          webAppOrigin: string;
          sandboxBaseDirectory: string;
          apiKey?: string;
        }
      ) => {
        const apiOrigin = normalizeAndValidateApiOrigin(payload.apiOrigin);
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
          apiOrigin,
          webAppOrigin,
          sandboxBaseDirectory,
          allowedDirectories: [sandboxBaseDirectory],
          onboardingCompleted: true
        });
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
    ipcMain.handle("desktop:check-for-update", async () => {
      try {
        return await this.checkForUpdate();
      } catch (error) {
        return { updateAvailable: false, error: error instanceof Error ? error.message : "unknown error" };
      }
    });
    ipcMain.handle("desktop:apply-update", async () => {
      await this.applyUpdate();
    });
  }
}

const SUPPORTED_OPERATION_IDS = [
  "symphony_launch",
  "symphony_status",
  "symphony_kill",
  "symphony_chat",
  "symphony_comment_chat",
  "symphony_commit_message",
  "symphony_sessions",
  "terminal_chat",
  "ticket_chat",
  "run_viewer_chat",
  "codex_review",
  "codex_argue",
  "git_action",
  "git_pr",
  "health_check",
  "repos_config",
  "deploy",
  "learnings",
  "filesystem"
];

function resolveOperationId(pathname: string): string | null {
  if (!pathname.startsWith("/api/engineer/")) {
    return null;
  }

  if (pathname === "/api/engineer/symphony/launch") {
    return "symphony_launch";
  }
  if (pathname.startsWith("/api/engineer/symphony/status/")) {
    return "symphony_status";
  }
  if (pathname === "/api/engineer/symphony/kill") {
    return "symphony_kill";
  }
  if (pathname.startsWith("/api/engineer/symphony/chat/")) {
    return "symphony_chat";
  }
  if (pathname.startsWith("/api/engineer/symphony/comment-chat/")) {
    return "symphony_comment_chat";
  }
  if (pathname.startsWith("/api/engineer/symphony/commit-message/")) {
    return "symphony_commit_message";
  }
  if (pathname === "/api/engineer/symphony/sessions") {
    return "symphony_sessions";
  }
  if (pathname === "/api/engineer/terminal-chat") {
    return "terminal_chat";
  }
  if (pathname === "/api/engineer/ticket-chat") {
    return "ticket_chat";
  }
  if (pathname === "/api/engineer/run-viewer-chat") {
    return "run_viewer_chat";
  }
  if (pathname.startsWith("/api/engineer/codex/argue/")) {
    return "codex_argue";
  }
  if (pathname.startsWith("/api/engineer/codex/")) {
    return "codex_review";
  }
  if (pathname.startsWith("/api/engineer/git/pr") || pathname === "/api/engineer/git/user") {
    return "git_pr";
  }
  if (pathname.startsWith("/api/engineer/git")) {
    return "git_action";
  }
  if (pathname === "/api/engineer/health-check") {
    return "health_check";
  }
  if (pathname === "/api/engineer/repos") {
    return "repos_config";
  }
  if (pathname.startsWith("/api/engineer/deploy")) {
    return "deploy";
  }
  if (pathname === "/api/engineer/learnings" || pathname.includes("learnings")) {
    return "learnings";
  }
  if (
    pathname === "/api/engineer/directories" ||
    pathname === "/api/engineer/files/search" ||
    pathname.startsWith("/api/engineer/run-viewer-extract")
  ) {
    return "filesystem";
  }

  return null;
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

function normalizeScopePath(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return path.resolve(expandHomePath(trimmed));
}

function maybeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function expandHomePath(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function applySandboxPolicyToAllowedDirectories(
  allowedDirectories: string[] | undefined,
  sandboxBaseDirectory: string | null
): string[] {
  const normalizedAllowed = (allowedDirectories ?? [])
    .map((entry) => normalizeScopePath(entry))
    .filter((entry): entry is string => Boolean(entry));

  if (!sandboxBaseDirectory) {
    return [...new Set(normalizedAllowed)];
  }

  const filtered = normalizedAllowed.filter((entry) => isPathWithinSandbox(entry, sandboxBaseDirectory));
  if (!filtered.includes(sandboxBaseDirectory)) {
    filtered.unshift(sandboxBaseDirectory);
  }
  return [...new Set(filtered)];
}

function isPathWithinSandbox(targetPath: string, sandboxBaseDirectory: string): boolean {
  if (targetPath === sandboxBaseDirectory) {
    return true;
  }
  const prefix = sandboxBaseDirectory.endsWith(path.sep)
    ? sandboxBaseDirectory
    : `${sandboxBaseDirectory}${path.sep}`;
  return targetPath.startsWith(prefix);
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
