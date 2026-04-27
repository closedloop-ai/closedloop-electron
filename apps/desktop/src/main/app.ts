import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { app, dialog, ipcMain, nativeImage, Notification, safeStorage } from "electron";
import {
  type AlwaysAllowRule,
  DEFAULT_DESKTOP_SETTINGS,
  DEFAULT_POSTHOG_HOST,
  GATEWAY_PROTOCOL_VERSION,
  EMPTY_CAPABILITIES,
  type DesktopSettings,
  type RiskTier,
} from "../shared/contracts.js";
import {
  buildAllowedDirectories,
  isRiskyAllowedDirectory,
  normalizeScopePath,
} from "../shared/sandbox-policy.js";
import { ApiKeyStore } from "./api-key-store.js";
import {
  claimDesktopManagedApiKey,
  isRetryableBootstrapClaimFailure,
  type BootstrapClaimDiagnostic,
  type BootstrapClaimResult,
} from "./bootstrap-claim.js";
import { CloudCommandExecutor } from "./cloud-command-executor.js";
import type { CloudSocketStatus } from "./cloud-protocol.js";
import { CloudSocketService } from "./cloud-socket.js";
import {
  DesktopPopUnavailableError,
  signDesktopPopHeaders,
  type DesktopPopHeaders,
  type DesktopPopSigningRequest,
} from "./desktop-pop.js";
import { GatewaySigningKeyStore } from "./gateway-signing-key-store.js";
import { SettingsStore } from "./settings-store.js";
import { DesktopTray } from "./tray.js";
import { DesktopWindow } from "./window.js";
import { DesktopGatewayServer } from "../server/server.js";
import {
  computeSymphonyDir,
  SymphonyDirNotConfiguredError,
} from "../server/operations/symphony-utils.js";
import { getResolvedGitPath, resetResolvedClaudePath } from "../server/operations/symphony-loop.js";
import { resetMcpDetectionCache } from "../server/operations/mcp-detection.js";
import { resolveBinary } from "../server/shell-path.js";
import { getCodePluginVersion } from "../server/operations/plugin-cache.js";
import { seedReposConfig } from "./seed-repos-config.js";
import {
  SUPPORTED_OPERATION_IDS,
  resolveOperationId,
} from "./approval-operations.js";
import { shouldAutoApprove, OPERATION_RISK_TIERS } from "./approval-policy.js";
import { gatewayLog, isNetworkError } from "./gateway-logger.js";
import { ActivityLogStore } from "./activity-log-store.js";
import { ApprovalStore } from "./approval-store.js";
import { JobStore, isTerminalJobStatus, type LocalJob } from "./job-store.js";
import { Observability } from "./observability.js";
import type {
  GatewayApprovalRequest,
  GatewayApprovalResult,
} from "../server/router.js";
import {
  normalizeAndValidateOrigin,
  normalizeWebAppOrigin,
} from "./origin-policy.js";
import { LocalSessionStore } from "./local-session-store.js";
import { enrichJobSnapshot } from "../server/operations/symphony-job-snapshot.js";
import { GatewayRecoveryManager } from "./gateway-recovery.js";
import { runShutdownSequence } from "./shutdown.js";
import type { ShutdownResult } from "./shutdown.js";
import type { RetrySpawnDeps } from "./spawn-retry.js";
import pkg from "electron-updater";
const { autoUpdater } = pkg;
import { BUILD_COMMIT_HASH } from "../shared/build-info.js";
import { BootRecoveryService } from "./boot-recovery.js";
import { LoopTokenStore } from "./loop-token-store.js";
import { GatewayIdentityStore } from "./gateway-identity.js";
import {
  createQueueStatsDebounce,
  type QueueStatsDebounce,
} from "./queue-stats-debounce.js";
import {
  fetchTrustedDesktopConfig,
  type TrustedDesktopConfigResult,
  withSingleManagedOnboardingRetry,
} from "./managed-onboarding.js";
import {
  getCanonicalOnboardingHandoffPath,
  isCanonicalOnboardingHandoffPath,
  OnboardingHandoffQueue,
  readPendingOnboardingHandoff,
  type OnboardingHandoffFailureReason,
  type PendingOnboardingHandoff,
} from "./onboarding-handoff.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MANAGED_ONBOARDING_RETRY_DELAY_MS = 5_000;

type ManagedOnboardingStatus =
  | "idle"
  | "awaiting-origin-confirmation"
  | "provisioning"
  | "sandbox-required"
  | "failed";

type ManagedOnboardingState = {
  status: ManagedOnboardingStatus;
  webAppOrigin?: string;
  message?: string;
  recoveryActions?: Array<"retry_automated_onboarding" | "use_manual_setup" | "choose_sandbox">;
};

export class DesktopApplication {
  private readonly settingsStore: SettingsStore;
  private readonly apiKeyStore: ApiKeyStore;
  private readonly gatewaySigningKeyStore: GatewaySigningKeyStore;
  private readonly loopTokenStore: LoopTokenStore;
  private readonly tray: DesktopTray;
  private readonly desktopWindow: DesktopWindow;
  private readonly server: DesktopGatewayServer;
  private readonly cloudSocket: CloudSocketService;
  private readonly commandExecutor: CloudCommandExecutor;
  private readonly activityLog: ActivityLogStore;
  private readonly approvalStore: ApprovalStore;
  private readonly jobStore: JobStore;
  private readonly recovery: GatewayRecoveryManager;
  private readonly bootRecovery: BootRecoveryService;
  private readonly gatewayAuthToken: string;
  private readonly gatewayId: string;
  private readonly sessionStore: LocalSessionStore;
  private shuttingDown = false;
  private dangerousAutoApprove = false;
  private cloudStatus: CloudSocketStatus = { state: "idle" };
  private cloudCommandsPaused: boolean;
  private cloudConnectionEnabled: boolean;
  private updateCheckTimer: NodeJS.Timeout | null = null;
  private readonly onboardingHandoffPath = getCanonicalOnboardingHandoffPath();
  private bootReadyForOnboarding = false;
  private processingOnboardingHandoff = false;
  private readonly queuedOpenFileHandoffs = new OnboardingHandoffQueue();
  private managedOnboardingState: ManagedOnboardingState = { status: "idle" };
  private readonly queueStatsTelemetryDebounce: QueueStatsDebounce =
    createQueueStatsDebounce(
      (active, depth) => Observability.queueStatsChanged(active, depth),
      QUEUE_STATS_DEBOUNCE_MS,
    );

  constructor() {
    this.gatewayAuthToken = randomBytes(24).toString("hex");
    this.sessionStore = new LocalSessionStore();
    Observability.init({
      telemetrySend: (event) => this.cloudSocket?.sendTelemetry(event),
      posthog: process.env.CL_POSTHOG_API_KEY
        ? { apiKey: process.env.CL_POSTHOG_API_KEY, host: DEFAULT_POSTHOG_HOST }
        : undefined,
      desktopClientVersion: app.getVersion(),
    });
    this.settingsStore = new SettingsStore();
    this.cloudCommandsPaused = this.settingsStore.getCloudCommandsPaused();
    this.cloudConnectionEnabled =
      this.settingsStore.getCloudConnectionEnabled();
    this.apiKeyStore = new ApiKeyStore();
    this.loopTokenStore = new LoopTokenStore();
    this.gatewaySigningKeyStore = new GatewaySigningKeyStore();
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
          this.desktopWindow
            .getWindow()
            ?.webContents.send("desktop:navigate-tab", "approvals");
        });
        notification.show();
      },
    });
    const retrySpawnDeps: RetrySpawnDeps = {
      log: (level, msg) => gatewayLog[level]("spawn-retry", msg),
      refreshTray: (msg) => this.refreshTrayState(msg),
      isShuttingDown: () => this.shuttingDown,
      delay: (ms) => new Promise((r) => setTimeout(r, ms)),
    };
    const gatewayIdentityStore = new GatewayIdentityStore(
      app.getPath("userData"),
    );
    this.gatewayId = gatewayIdentityStore.loadSync();
    this.server = DesktopGatewayServer.createDefault(
      this.settingsStore.getWebAppOrigin(),
      () => (this.isNoAuthMode() ? undefined : this.gatewayAuthToken),
      () => this.getAllowedDirectoriesFromSandbox(),
      os.hostname(),
      app.getVersion(),
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
      this.jobStore,
      () => this.recovery.onUnexpectedClose(),
      this.loopTokenStore,
      retrySpawnDeps,
      () => this.gatewayId,
      () => this.settingsStore.getBinaryPaths(),
      (patch) => this.applyBinaryPathPatchAndInvalidateCaches(patch),
      () => this.apiKeyStore.getApiKeyProvenance(),
      (request) => this.signDesktopRequest(request),
      (surface, reason) => this.reportDesktopPopUnavailable(surface, reason),
    );
    this.commandExecutor = new CloudCommandExecutor({
      getGatewayPort: () => this.server.getActivePort(),
      getGatewayAuthToken: () => this.gatewayAuthToken,
      maxInFlightCommands: MAX_IN_FLIGHT_COMMANDS,
      sendCommandAck: (event) => this.cloudSocket.sendCommandAck(event),
      sendCommandEvent: (event) => this.cloudSocket.sendCommandEvent(event),
      onQueueStatsChange: (stats) => {
        const presenceState =
          this.cloudStatus.state === "online" &&
          !this.cloudCommandsPaused &&
          this.recovery.gatewayHealthy
            ? "online"
            : "degraded";
        this.cloudSocket.sendPresence({
          state: presenceState,
          ...(this.cloudCommandsPaused
            ? { error: "cloud commands paused by user" }
            : {}),
          activeCommands: stats.activeCommands,
          queueDepth: stats.queueDepth,
        });
        this.queueStatsTelemetryDebounce.trigger(stats);
      },
    });
    this.cloudSocket = new CloudSocketService({
      getRelayOrigin: () => this.settingsStore.getRelayOrigin(),
      getApiKey: () => this.apiKeyStore.getApiKey(),
      getApiKeyProvenance: () => this.apiKeyStore.getApiKeyProvenance(),
      signDesktopRequest: (request) => this.signDesktopRequest(request),
      onDesktopPopUnavailable: (surface, reason) => this.reportDesktopPopUnavailable(surface, reason),
      getAllowedDirectories: () => this.getAllowedDirectoriesFromSandbox(),
      getMaxInFlightCommands: () => MAX_IN_FLIGHT_COMMANDS,
      machineName: os.hostname(),
      pluginVersion: getCodePluginVersion(),
      desktopClientVersion: app.getVersion(),
      gatewayProtocolVersion: GATEWAY_PROTOCOL_VERSION,
      supportedOperations: [...SUPPORTED_OPERATION_IDS],
      onStatusChange: (status) => this.onCloudSocketStatus(status),
      onDisconnect: (reason) => { Observability.connectionLost(reason); },
      onHelloAck: (event) => {
        Observability.setTargetId(event.computeTargetId);
        if (event.sessionId) {
          Observability.setGatewaySessionId(event.sessionId);
        }
        if (event.resumeFromSequence) {
          Observability.reconnectionResumed("relay_resumed", Object.keys(event.resumeFromSequence).length);
          this.commandExecutor.replayFrom(event.resumeFromSequence);
        }
        Observability.connectionEstablished(
          event.computeTargetId,
          app.getVersion(),
          process.env.NODE_ENV ?? "production",
        );
      },
      onCommand: (command) => {
        if (!this.settingsStore.getOnboardingCompleted()) {
          this.cloudSocket.sendCommandAck({
            commandId: command.commandId,
            accepted: false,
            state: "failed",
            reason: "onboarding not completed",
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
            reason: "operationId/path mismatch",
          });
          return;
        }
        if (this.cloudCommandsPaused) {
          this.cloudSocket.sendCommandAck({
            commandId: command.commandId,
            accepted: false,
            state: "failed",
            reason: "cloud commands paused by user",
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
      },
    });
    this.recovery = new GatewayRecoveryManager({
      probe: () => this.probeGatewayAlive(),
      restart: () => this.server.restart(),
      getCloudStatus: () => this.cloudStatus,
      setConnected: (connected) => this.commandExecutor.setConnected(connected),
      sendPresence: (state, error) => {
        const stats = this.commandExecutor.getStats();
        this.cloudSocket.sendPresence({
          state,
          ...(error ? { error } : {}),
          activeCommands: stats.activeCommands,
          queueDepth: stats.queueDepth,
        });
      },
      refreshTray: (detail) => this.refreshTrayState(detail),
      log: (level, msg) => gatewayLog[level]("gateway-recovery", msg),
      isShuttingDown: () => this.shuttingDown,
      isPaused: () => this.cloudCommandsPaused,
    });
    this.bootRecovery = new BootRecoveryService({
      jobStore: this.jobStore,
      telemetry: Observability.getTelemetryEmitter(),
      getApiKey: () => this.apiKeyStore.getApiKey(),
      getApiOrigin: () => this.settingsStore.getApiOrigin(),
      getAllowedDirectories: () => this.getAllowedDirectoriesFromSandbox(),
      loopTokenStore: this.loopTokenStore,
    });
    this.registerIpcHandlers();
    this.registerOnboardingFileOpenHandler();
  }

  async boot(): Promise<void> {
    if (process.platform === "darwin" && app.dock) {
      const resourcesDir = app.isPackaged
        ? process.resourcesPath
        : path.join(__dirname, "..", "..", "resources");
      const dockIcon = nativeImage.createFromPath(
        path.join(resourcesDir, "icon-1024.png"),
      );
      app.dock.setIcon(dockIcon);
    }

    this.tray.init({
      onOpen: () => this.desktopWindow.show(),
      onTogglePaused: (paused) => this.setCloudCommandsPaused(paused),
    });
    this.tray.setPaused(this.cloudCommandsPaused);
    this.syncPendingApprovalsToTray();
    this.desktopWindow.init();
    this.bootReadyForOnboarding = true;
    void this.drainQueuedOnboardingHandoffs();
    void this.processCanonicalOnboardingHandoff("cold-start");

    gatewayLog.setVerbose(this.settingsStore.getAll().verboseLogging);
    const deadJobs = this.reconcileJobStore();
    await this.bootRecovery.reattachLiveJobs();

    const bootSandbox = this.settingsStore.getSandboxBaseDirectory();
    if (bootSandbox?.trim()) {
      await seedReposConfig(bootSandbox);
    }

    try {
      await this.server.start();
      const configuredOrigins = {
        relayOrigin: this.settingsStore.getRelayOrigin(),
        apiOrigin: this.settingsStore.getApiOrigin(),
        webAppOrigin: this.settingsStore.getWebAppOrigin(),
      };
      this.refreshTrayState(
        `Serving on localhost:${this.server.getActivePort()} | relay=${configuredOrigins.relayOrigin} api=${configuredOrigins.apiOrigin} web=${configuredOrigins.webAppOrigin}`,
      );
      void this.bootRecovery
        .startDeadJobFinalization(deadJobs)
        .catch((err: unknown) => {
          gatewayLog.warn(
            "boot-recovery",
            `Background dead-loop finalization failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });

      if (this.cloudConnectionEnabled) {
        void this.cloudSocket.start();
      } else {
        this.cloudStatus = {
          state: "degraded",
          error: "Cloud connection disabled by user",
        };
      }

      if (app.isPackaged) {
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.on("error", (err) => {
          const level = isNetworkError(err.message) ? "debug" : "error";
          gatewayLog[level]("auto-update", `Auto-update error: ${err.message}`);
        });
        autoUpdater.on("update-available", (info) => {
          this.desktopWindow
            .getWindow()
            ?.webContents.send("desktop:update-available", {
              updateAvailable: true,
              version: info.version,
            });
        });
        void autoUpdater.checkForUpdates().catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          gatewayLog.error(
            "auto-update",
            `Failed to check for updates: ${msg}`,
          );
        });
        if (this.updateCheckTimer) clearInterval(this.updateCheckTimer);
        this.updateCheckTimer = setInterval(() => {
          void autoUpdater.checkForUpdates().catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            gatewayLog.debug(
              "auto-update",
              `Failed to check for updates: ${msg}`,
            );
          });
        }, UPDATE_CHECK_INTERVAL_MS);
      } else {
        void this.checkForUpdate()
          .then((result) => {
            if (result.updateAvailable) {
              this.desktopWindow
                .getWindow()
                ?.webContents.send("desktop:update-available", result);
            }
          })
          .catch(() => {});
        if (this.updateCheckTimer) clearInterval(this.updateCheckTimer);
        this.updateCheckTimer = setInterval(() => {
          void this.checkForUpdate()
            .then((result) => {
              if (result.updateAvailable) {
                this.desktopWindow
                  .getWindow()
                  ?.webContents.send("desktop:update-available", result);
              }
            })
            .catch(() => {});
        }, UPDATE_CHECK_INTERVAL_MS);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown startup error";
      this.tray.setState("error", `Desktop startup failed: ${message}`);
      throw error;
    }
  }

  showWindow(): void {
    this.desktopWindow.init();
    this.desktopWindow.show();
  }

  async handleActivate(): Promise<void> {
    this.showWindow();
    await this.processCanonicalOnboardingHandoff("activate");
  }

  private registerOnboardingFileOpenHandler(): void {
    app.on("open-file", (event, filePath) => {
      event.preventDefault();
      this.enqueueOnboardingFileOpen(filePath);
    });
  }

  private enqueueOnboardingFileOpen(filePath: string): void {
    if (!isCanonicalOnboardingHandoffPath(filePath, this.onboardingHandoffPath)) {
      gatewayLog.debug(
        "onboarding-handoff",
        `Ignoring non-canonical open-file path: ${filePath}`,
      );
      return;
    }

    if (!this.bootReadyForOnboarding || this.processingOnboardingHandoff) {
      this.queuedOpenFileHandoffs.enqueueCanonicalOpenFile();
      return;
    }

    void this.processCanonicalOnboardingHandoff("open-file");
  }

  private async drainQueuedOnboardingHandoffs(): Promise<void> {
    if (!this.queuedOpenFileHandoffs.drainCanonicalOpenFile()) {
      return;
    }
    await this.processCanonicalOnboardingHandoff("open-file");
  }

  private async processCanonicalOnboardingHandoff(
    entryPath: "open-file" | "cold-start" | "activate",
  ): Promise<void> {
    if (this.processingOnboardingHandoff || this.shuttingDown) {
      return;
    }
    this.processingOnboardingHandoff = true;
    try {
      const result = await readPendingOnboardingHandoff(
        this.onboardingHandoffPath,
      );
      if (result.kind === "absent") {
        return;
      }
      if (result.kind === "ignored") {
        this.setManagedOnboardingFailure(
          result.reason,
          handoffFailureMessage(result.reason),
          ["use_manual_setup", "retry_automated_onboarding"],
        );
        gatewayLog.warn(
          "onboarding-handoff",
          `Ignored pending onboarding handoff from ${entryPath}: ${result.reason}`,
        );
        this.showWindow();
        return;
      }

      await this.handleLoadedOnboardingHandoff(result.payload);
    } finally {
      this.processingOnboardingHandoff = false;
      if (
        !this.shuttingDown &&
        this.queuedOpenFileHandoffs.hasPendingCanonicalOpenFile()
      ) {
        await this.drainQueuedOnboardingHandoffs();
      }
    }
  }

  private async handleLoadedOnboardingHandoff(
    payload: PendingOnboardingHandoff,
  ): Promise<void> {
    this.managedOnboardingState = {
      status: "awaiting-origin-confirmation",
      webAppOrigin: payload.webAppOrigin,
      message: "Waiting for URL confirmation before automated provisioning.",
    };
    this.notifyOnboardingStateChanged();
    this.showWindow();

    const confirmed = await this.confirmManagedOnboardingOrigin(payload);
    if (!confirmed) {
      this.setManagedOnboardingFailure(
        "origin_confirmation_dismissed",
        "Automated provisioning was canceled. Start a fresh onboarding attempt from the web app or use manual setup.",
        ["retry_automated_onboarding", "use_manual_setup"],
      );
      return;
    }

    await this.runManagedOnboardingProvisioning(payload);
  }

  private async confirmManagedOnboardingOrigin(
    payload: PendingOnboardingHandoff,
  ): Promise<boolean> {
    const result = await dialog.showMessageBox({
      type: "question",
      buttons: ["Continue", "Use manual setup"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: "Confirm ClosedLoop Web App URL",
      message: "Auto-provisioning was initiated. Please confirm this ClosedLoop web app URL before we continue.",
      detail: payload.webAppOrigin,
    });
    return result.response === 0;
  }

  private async runManagedOnboardingProvisioning(
    payload: PendingOnboardingHandoff,
  ): Promise<void> {
    this.managedOnboardingState = {
      status: "provisioning",
      webAppOrigin: payload.webAppOrigin,
      message: "Fetching trusted Desktop configuration...",
    };
    this.notifyOnboardingStateChanged();

    const trustedConfig = await withSingleManagedOnboardingRetry({
      operation: () =>
        fetchTrustedDesktopConfig({ webAppOrigin: payload.webAppOrigin }),
      shouldRetry: isRetryableTrustedConfigFailure,
      delayMs: MANAGED_ONBOARDING_RETRY_DELAY_MS,
      isCancelled: () => this.shuttingDown,
    });
    if (trustedConfig.kind !== "ok") {
      this.setManagedOnboardingFailure(
        trustedConfig.reason,
        managedOnboardingFailureMessage(trustedConfig),
        managedOnboardingRecoveryActions(trustedConfig),
      );
      return;
    }

    this.managedOnboardingState = {
      status: "provisioning",
      webAppOrigin: payload.webAppOrigin,
      message: "Claiming managed Desktop key...",
    };
    this.notifyOnboardingStateChanged();

    const claimResult = await withSingleManagedOnboardingRetry({
      operation: () =>
        claimDesktopManagedApiKey({
          apiOrigin: trustedConfig.config.apiOrigin,
          onboardingAttemptId: payload.onboardingAttemptId,
          webAppOrigin: payload.webAppOrigin,
          gatewayId: this.gatewayId,
          signingKeys: this.gatewaySigningKeyStore,
          onDiagnostic: (diagnostic) =>
            this.reportBootstrapClaimDiagnostic(diagnostic),
        }),
      shouldRetry: isRetryableBootstrapClaimFailure,
      delayMs: MANAGED_ONBOARDING_RETRY_DELAY_MS,
      isCancelled: () => this.shuttingDown,
    });

    if (claimResult.kind === "manual_fallback") {
      this.setManagedOnboardingFailure(
        claimResult.reason,
        "Managed Desktop key setup is unavailable on this machine. Use manual API key setup.",
        ["use_manual_setup"],
      );
      return;
    }
    if (claimResult.kind === "failed") {
      this.setManagedOnboardingFailure(
        `claim_${claimResult.statusCode ?? "failed"}`,
        bootstrapClaimFailureMessage(claimResult),
        bootstrapClaimRecoveryActions(claimResult),
      );
      return;
    }

    this.apiKeyStore.setApiKey(claimResult.apiKey, "DESKTOP_MANAGED");
    const sandboxBaseDirectory = normalizeScopePath(
      payload.sandboxBaseDirectory,
    );
    const safeSandboxBaseDirectory =
      sandboxBaseDirectory && !isRiskyAllowedDirectory(sandboxBaseDirectory)
        ? sandboxBaseDirectory
        : null;

    this.settingsStore.update({
      apiOrigin: trustedConfig.config.apiOrigin,
      relayOrigin: trustedConfig.config.relayOrigin,
      webAppOrigin: payload.webAppOrigin,
      ...(safeSandboxBaseDirectory
        ? {
            sandboxBaseDirectory: safeSandboxBaseDirectory,
            onboardingCompleted: true,
          }
        : { onboardingCompleted: false }),
    });

    if (safeSandboxBaseDirectory) {
      await seedReposConfig(safeSandboxBaseDirectory);
      this.managedOnboardingState = {
        status: "idle",
        webAppOrigin: payload.webAppOrigin,
        message: "Automated onboarding completed.",
      };
      this.restartCloudSocket();
      this.notifyOnboardingStateChanged();
      return;
    }

    this.managedOnboardingState = {
      status: "sandbox-required",
      webAppOrigin: payload.webAppOrigin,
      message: "Choose a safe sandbox directory to finish Desktop setup.",
      recoveryActions: ["choose_sandbox", "use_manual_setup"],
    };
    this.notifyOnboardingStateChanged();
    this.showWindow();
  }

  private setManagedOnboardingFailure(
    reason: string,
    message: string,
    recoveryActions: ManagedOnboardingState["recoveryActions"],
  ): void {
    this.managedOnboardingState = {
      status: "failed",
      message,
      recoveryActions,
    };
    gatewayLog.warn("managed-onboarding", `${reason}: ${message}`);
    this.notifyOnboardingStateChanged();
    this.showWindow();
  }

  private notifyOnboardingStateChanged(): void {
    this.desktopWindow
      .getWindow()
      ?.webContents.send("desktop:onboarding-state-changed");
  }

  setQuitting(): void {
    this.desktopWindow.setQuitting();
  }

  async shutdown(): Promise<ShutdownResult> {
    if (this.shuttingDown) {
      return "clean";
    }

    this.shuttingDown = true;
    this.bootRecovery.dispose();
    await this.bootRecovery.quiesce(1_000);
    this.queueStatsTelemetryDebounce.cancel();
    return runShutdownSequence({
      observability: Observability,
      updateCheckTimer: this.updateCheckTimer,
      clearUpdateCheckTimer: () => {
        if (this.updateCheckTimer) {
          clearInterval(this.updateCheckTimer);
          this.updateCheckTimer = null;
        }
      },
      cloudSocket: this.cloudSocket,
      commandExecutor: this.commandExecutor,
      server: this.server,
      desktopWindow: this.desktopWindow,
      tray: this.tray,
    });
  }

  private async probeGatewayAlive(): Promise<boolean> {
    if (!this.server.isAlive()) return false;
    try {
      const response = await fetch(
        `http://127.0.0.1:${this.server.getActivePort()}/health`,
        { signal: AbortSignal.timeout(2000) },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  private onCloudSocketStatus(status: CloudSocketStatus): void {
    if (!this.cloudConnectionEnabled) {
      this.cloudStatus = {
        state: "degraded",
        error: "Cloud connection disabled by user",
      };
      this.refreshTrayState();
      return;
    }

    this.cloudStatus = status;
    const stats = this.commandExecutor.getStats();

    if (status.state === "online") {
      this.cloudSocket.sendPresence({
        state: this.cloudCommandsPaused ? "degraded" : "online",
        ...(this.cloudCommandsPaused
          ? { error: "cloud commands paused by user" }
          : {}),
        activeCommands: stats.activeCommands,
        queueDepth: stats.queueDepth,
      });
      this.refreshTrayState(
        `Serving on localhost:${this.server.getActivePort()} | cloud: online (${status.targetId})`,
      );
      void this.recovery.onCloudOnline();
      return;
    }

    this.commandExecutor.setConnected(false);

    if (status.state === "degraded") {
      Observability.connectionDegraded(status.error);
      this.cloudSocket.sendPresence({
        state: "degraded",
        error: status.error,
        ...this.commandExecutor.getStats(),
      });
      this.refreshTrayState(
        `Serving on localhost:${this.server.getActivePort()} | cloud degraded: ${status.error}`,
      );
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
    const presenceState =
      this.cloudStatus.state === "online" &&
      !paused &&
      this.recovery.gatewayHealthy
        ? "online"
        : "degraded";
    this.cloudSocket.sendPresence({
      state: presenceState,
      ...(paused ? { error: "cloud commands paused by user" } : {}),
      activeCommands: stats.activeCommands,
      queueDepth: stats.queueDepth,
    });
  }

  private setCloudConnectionEnabled(enabled: boolean): void {
    this.cloudConnectionEnabled = enabled;
    this.settingsStore.setCloudConnectionEnabled(enabled);
    if (!enabled) {
      this.cloudSocket.stop();
      this.cloudStatus = {
        state: "degraded",
        error: "Cloud connection disabled by user",
      };
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
    const sandboxBase = normalizeScopePath(
      this.settingsStore.getSandboxBaseDirectory(),
    );
    if (!sandboxBase?.trim()) {
      throw new SymphonyDirNotConfiguredError();
    }
    return computeSymphonyDir(sandboxBase);
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
    return buildAllowedDirectories(
      this.settingsStore.getSandboxBaseDirectory(),
    );
  }

  private getOnboardingState(): {
    completed: boolean;
    settings: DesktopSettings;
    hasStoredApiKey: boolean;
    managedProvisioning: ManagedOnboardingState;
  } {
    const settings = this.settingsStore.getAll();
    return {
      completed: Boolean(settings.onboardingCompleted),
      settings: {
        ...settings,
        sandboxBaseDirectory:
          normalizeScopePath(settings.sandboxBaseDirectory) ??
          settings.sandboxBaseDirectory,
      },
      hasStoredApiKey: this.apiKeyStore.getStatus().hasApiKey,
      managedProvisioning: this.managedOnboardingState,
    };
  }

  private refreshTrayState(explicitDetails?: string): void {
    if (!this.recovery.gatewayHealthy) {
      this.tray.setState(
        "error",
        explicitDetails ??
          `Gateway down on port ${this.server.getActivePort()}`,
      );
      return;
    }

    if (this.cloudCommandsPaused) {
      this.tray.setState(
        "degraded",
        explicitDetails ??
          `Serving on localhost:${this.server.getActivePort()} | cloud commands paused`,
      );
      return;
    }

    if (this.cloudStatus.state === "online") {
      this.tray.setState(
        "ready",
        explicitDetails ??
          `Serving on localhost:${this.server.getActivePort()} | cloud: online (${this.cloudStatus.targetId})`,
      );
      return;
    }

    if (this.cloudStatus.state === "degraded") {
      this.tray.setState(
        "degraded",
        explicitDetails ??
          `Serving on localhost:${this.server.getActivePort()} | cloud degraded: ${this.cloudStatus.error}`,
      );
      return;
    }

    this.tray.setState(
      "ready",
      explicitDetails ??
        `Serving on localhost:${this.server.getActivePort()} | cloud: connecting`,
    );
  }

  private async evaluateApproval(
    request: GatewayApprovalRequest,
  ): Promise<GatewayApprovalResult> {
    if (!this.settingsStore.getOnboardingCompleted()) {
      return {
        allow: false,
        statusCode: 403,
        payload: {
          error: "onboarding not completed",
        },
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
        payload: { error: `Unmapped operation: ${request.path}` },
      };
    }

    const settings = this.settingsStore.getAll();
    const requestScopePath = resolveApprovalScopePath(request.body);
    const activeAlwaysAllowRules = pruneExpiredAlwaysAllowRules(
      settings.alwaysAllowRules,
    );
    if (activeAlwaysAllowRules.length !== settings.alwaysAllowRules.length) {
      this.settingsStore.setAlwaysAllowRules(activeAlwaysAllowRules);
    }
    if (
      matchesAlwaysAllowRule(activeAlwaysAllowRules, {
        operationId,
        method: request.method,
        path: request.path,
        scopePath: requestScopePath,
      })
    ) {
      return { allow: true };
    }

    const configuredTier =
      settings.autoApprovalRules[operationId] ?? settings.defaultApprovalTier;
    if (
      shouldAutoApprove(
        operationId,
        configuredTier,
        request.forceApproval ?? false,
      )
    ) {
      return { allow: true };
    }

    const operationRisk =
      (OPERATION_RISK_TIERS as Record<string, Exclude<RiskTier, "none">>)[
        operationId
      ] ?? "high";
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
      reason,
    });
    const decision = await this.approvalStore.waitForDecision(
      pending.id,
      APPROVAL_TIMEOUT_MS,
    );

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
          approvalId: pending.id,
        },
      };
    }

    return {
      allow: false,
      statusCode: 403,
      payload: {
        error: "request denied",
        operationId,
        approvalId: pending.id,
      },
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
    const activeRules = pruneExpiredAlwaysAllowRules(
      settings.alwaysAllowRules,
      now,
    );
    const expiresAt = new Date(now + ALWAYS_ALLOW_RULE_TTL_MS).toISOString();

    const existingIndex = activeRules.findIndex(
      (rule) =>
        rule.operationId === pending.operationId &&
        rule.method.toUpperCase() === pending.method.toUpperCase() &&
        rule.path === pending.path &&
        normalizeScopePath(rule.scopePath) ===
          normalizeScopePath(pending.scopePath),
    );

    if (existingIndex >= 0) {
      activeRules[existingIndex] = {
        ...activeRules[existingIndex],
        expiresAt,
      };
    } else {
      activeRules.push({
        id: randomUUID(),
        operationId: pending.operationId,
        method: pending.method.toUpperCase(),
        path: pending.path,
        scopePath: normalizeScopePath(pending.scopePath) ?? undefined,
        createdAt: new Date(now).toISOString(),
        expiresAt,
      });
    }

    this.settingsStore.setAlwaysAllowRules(activeRules);
  }

  private async checkForUpdate(): Promise<{
    updateAvailable: boolean;
    currentHash: string;
    remoteHash: string;
  }> {
    const repoRoot = path.resolve(__dirname, "../../../..");
    await execFileAsync(getResolvedGitPath(), ["fetch", "origin", "main"], { cwd: repoRoot });
    const { stdout } = await execFileAsync(
      getResolvedGitPath(),
      ["rev-parse", "origin/main"],
      { cwd: repoRoot },
    );
    const remoteHash = stdout.trim();
    return {
      updateAvailable: remoteHash !== BUILD_COMMIT_HASH,
      currentHash: BUILD_COMMIT_HASH,
      remoteHash,
    };
  }

  private async applyUpdate(): Promise<void> {
    const repoRoot = path.resolve(__dirname, "../../../..");
    await execFileAsync(getResolvedGitPath(), ["pull", "--rebase", "origin", "main"], {
      cwd: repoRoot,
    });
    await execFileAsync("pnpm", ["-C", "apps/desktop", "build"], {
      cwd: repoRoot,
    });
    app.relaunch();
    app.exit(0);
  }

  private reconcileJobStore(): LocalJob[] {
    return this.jobStore.reconcile((job) => {
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
            const rawStatus =
              typeof state.status === "string"
                ? state.status.toUpperCase()
                : null;
            if (rawStatus === "COMPLETED") {
              return {
                ...job,
                status: "COMPLETED",
                updatedAt: now,
                completedAt: now,
              };
            }
            if (rawStatus === "FAILED") {
              return {
                ...job,
                status: "FAILED",
                updatedAt: now,
                completedAt: now,
              };
            }
            if (rawStatus === "CANCELLED") {
              return {
                ...job,
                status: "CANCELLED",
                updatedAt: now,
                completedAt: now,
              };
            }
            if (rawStatus === "AWAITING_USER") {
              return { ...job, status: "AWAITING_USER", updatedAt: now };
            }
            if (rawStatus === "STOPPED") {
              return {
                ...job,
                status: "STOPPED",
                updatedAt: now,
                completedAt: now,
              };
            }
          } catch {
            // state.json unreadable -- fall through
          }
        }
        // CANCEL_PENDING + process dead = confirmed cancelled
        if (job.status === "CANCEL_PENDING") {
          return {
            ...job,
            status: "CANCELLED",
            updatedAt: now,
            completedAt: now,
          };
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
    ipcMain.handle("desktop:get-app-version", () => app.getVersion());
    ipcMain.handle("desktop:get-logs", () => gatewayLog.getEntries());
    ipcMain.handle("desktop:clear-logs", () => {
      gatewayLog.clear();
    });

    ipcMain.handle("desktop:get-settings", () => {
      const settings = this.settingsStore.getAll();
      const activeAlwaysAllowRules = pruneExpiredAlwaysAllowRules(
        settings.alwaysAllowRules,
      );
      if (activeAlwaysAllowRules.length !== settings.alwaysAllowRules.length) {
        this.settingsStore.setAlwaysAllowRules(activeAlwaysAllowRules);
      }
      return {
        ...settings,
        alwaysAllowRules: activeAlwaysAllowRules,
      };
    });
    ipcMain.handle(
      "desktop:update-settings",
      async (
        _event,
        partial: {
          sandboxBaseDirectory?: string;
          onboardingCompleted?: boolean;
          relayOrigin?: string;
          apiOrigin?: string;
          webAppOrigin?: string;
          defaultApprovalTier?: "auto" | "none" | "low" | "medium" | "high";
          autoApprovalRules?: Record<
            string,
            "auto" | "none" | "low" | "medium" | "high"
          >;
          verboseLogging?: boolean;
        },
      ) => {
        if ("binaryPaths" in partial) {
          throw new Error("binaryPaths must be updated via PATCH /api/gateway/settings/binary-paths");
        }
        const currentSettings = this.settingsStore.getAll();
        const nextPartial = { ...partial };
        // Normalize legacy "auto" tier to "high" (they behave identically)
        if (nextPartial.defaultApprovalTier === "auto") {
          nextPartial.defaultApprovalTier = "high";
        }
        if (nextPartial.autoApprovalRules) {
          for (const [key, val] of Object.entries(
            nextPartial.autoApprovalRules,
          )) {
            if (val === "auto") nextPartial.autoApprovalRules[key] = "high";
          }
        }
        if (typeof partial.relayOrigin === "string") {
          nextPartial.relayOrigin = normalizeAndValidateOrigin(
            partial.relayOrigin,
          );
        }
        if (typeof partial.apiOrigin === "string") {
          nextPartial.apiOrigin = normalizeAndValidateOrigin(partial.apiOrigin);
        }
        if (typeof partial.webAppOrigin === "string") {
          nextPartial.webAppOrigin = normalizeWebAppOrigin(
            partial.webAppOrigin,
          );
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
          throw new Error(
            "Complete onboarding requires a sandbox base directory",
          );
        }

        const updated = this.settingsStore.update(
          nextPartial as Partial<DesktopSettings>,
        );
        if (typeof nextPartial.verboseLogging === "boolean") {
          gatewayLog.setVerbose(nextPartial.verboseLogging);
        }

        if (
          typeof partial.sandboxBaseDirectory === "string" &&
          selectedSandbox &&
          selectedSandbox !==
            normalizeScopePath(currentSettings.sandboxBaseDirectory)
        ) {
          await seedReposConfig(selectedSandbox);
        }

        this.restartCloudSocket();
        return updated;
      },
    );
    ipcMain.handle("desktop:get-runtime-status", () => ({
      port: this.server.getActivePort(),
      cloudStatus: this.cloudStatus,
      relayOrigin: this.settingsStore.getRelayOrigin(),
      apiOrigin: this.settingsStore.getApiOrigin(),
      sandboxBaseDirectory: this.settingsStore.getSandboxBaseDirectory(),
      commandsPaused: this.cloudCommandsPaused,
      connectionEnabled: this.cloudConnectionEnabled,
      serverAlive: this.server.isAlive(),
      gatewayHealthy: this.recovery.gatewayHealthy,
    }));
    ipcMain.handle("desktop:list-running-jobs", async () => {
      const jobs = this.jobStore.listRunning();
      const snapshots = await Promise.all(
        jobs.map((j) => enrichJobSnapshot(j)),
      );

      // Reconcile: if enrichment detected a terminal status (process dead),
      // persist it so the job moves from active to terminal in the store.
      // Skip jobs where the live-exit handler has already claimed the job
      // (exitCode is set but status is not yet terminal) to avoid a race
      // where this reconciliation overrides to STOPPED before the exit
      // handler finishes artifact processing and posts the correct status.
      const stillRunning = [];
      for (const snapshot of snapshots) {
        const rawJob = this.jobStore.getById(snapshot.id);
        if (
          isTerminalJobStatus(snapshot.status) &&
          !isTerminalJobStatus(rawJob?.status ?? "UNKNOWN")
        ) {
          if (rawJob && rawJob.exitCode != null) {
            stillRunning.push({ ...snapshot, status: rawJob.status });
            continue;
          }
          this.jobStore.upsert({
            ...rawJob!,
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
    ipcMain.handle("desktop:list-completed-jobs", () =>
      this.jobStore.listCompleted(),
    );
    ipcMain.handle("desktop:get-job", (_event, jobId: string) => {
      if (typeof jobId !== "string" || !jobId.trim()) {
        throw new Error("jobId is required");
      }
      return this.jobStore.getById(jobId.trim()) ?? null;
    });
    ipcMain.handle(
      "desktop:get-job-log-tail",
      async (_event, jobId: string, lines?: number) => {
        if (typeof jobId !== "string" || !jobId.trim()) {
          throw new Error("jobId is required");
        }
        const job = this.jobStore.getById(jobId.trim());
        if (!job?.logPath) {
          return null;
        }
        try {
          const content = await readFile(job.logPath, "utf-8");
          const allLines = content.split("\n");
          const maxLines = typeof lines === "number" && lines > 0 ? lines : 200;
          return allLines.slice(-maxLines).join("\n");
        } catch {
          return null;
        }
      },
    );
    ipcMain.handle("desktop:get-activity-events", () =>
      this.activityLog.list(),
    );
    ipcMain.handle("desktop:clear-activity-events", () => {
      this.activityLog.clear();
      return this.activityLog.list();
    });
    ipcMain.handle("desktop:get-pending-approvals", () =>
      this.approvalStore.listPending(),
    );
    ipcMain.handle("desktop:get-resolved-approvals", () =>
      this.approvalStore.listResolved(),
    );
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
    ipcMain.handle(
      "desktop:always-allow-approval",
      (_event, approvalId: string) => {
        if (typeof approvalId !== "string" || !approvalId.trim()) {
          throw new Error("approvalId is required");
        }
        const pending = this.approvalStore.getPendingById(approvalId.trim());
        if (!pending) {
          return {
            pendingApprovals: this.approvalStore.listPending(),
            settings: this.settingsStore.getAll(),
          };
        }
        this.saveAlwaysAllowRuleForPending(pending);
        this.approvalStore.alwaysAllow(approvalId.trim());
        return {
          pendingApprovals: this.approvalStore.listPending(),
          settings: this.settingsStore.getAll(),
        };
      },
    );
    ipcMain.handle(
      "desktop:remove-always-allow-rule",
      (_event, ruleId: string) => {
        if (typeof ruleId !== "string" || !ruleId.trim()) {
          throw new Error("ruleId is required");
        }
        const settings = this.settingsStore.getAll();
        const updated = (settings.alwaysAllowRules ?? []).filter(
          (r) => r.id !== ruleId.trim(),
        );
        this.settingsStore.setAlwaysAllowRules(updated);
        return { alwaysAllowRules: updated };
      },
    );
    ipcMain.handle("desktop:clear-pending-approvals", () => {
      this.approvalStore.clear();
      return this.approvalStore.listPending();
    });
    ipcMain.handle("desktop:get-api-key-status", () =>
      this.apiKeyStore.getStatus(),
    );
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
    ipcMain.handle(
      "desktop:get-cloud-commands-paused",
      () => this.cloudCommandsPaused,
    );
    ipcMain.handle(
      "desktop:set-cloud-commands-paused",
      (_event, paused: boolean) => {
        this.setCloudCommandsPaused(Boolean(paused));
        return { paused: this.cloudCommandsPaused };
      },
    );
    ipcMain.handle(
      "desktop:get-cloud-connection-enabled",
      () => this.cloudConnectionEnabled,
    );
    ipcMain.handle(
      "desktop:set-cloud-connection-enabled",
      (_event, enabled: boolean) => {
        this.setCloudConnectionEnabled(Boolean(enabled));
        return { enabled: this.cloudConnectionEnabled };
      },
    );
    ipcMain.handle("desktop:get-onboarding-state", () =>
      this.getOnboardingState(),
    );
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
          onboardingAttemptId?: string;
          bootstrapToken?: string;
          binaryPaths?: { claude?: string; gh?: string; codex?: string; python3?: string; git?: string };
        },
      ) => {
        const relayOrigin =
          typeof payload.relayOrigin === "string" && payload.relayOrigin.trim()
            ? normalizeAndValidateOrigin(payload.relayOrigin)
            : undefined;
        const apiOrigin =
          typeof payload.apiOrigin === "string" && payload.apiOrigin.trim()
            ? normalizeAndValidateOrigin(payload.apiOrigin)
            : undefined;
        const webAppOrigin = normalizeWebAppOrigin(payload.webAppOrigin);
        const sandboxBaseDirectory = normalizeScopePath(
          payload.sandboxBaseDirectory,
        );
        if (!sandboxBaseDirectory) {
          throw new Error("Sandbox base directory is required");
        }

        const trimmedApiKey =
          typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";
        if (trimmedApiKey) {
          if (!trimmedApiKey.startsWith("sk_live_")) {
            throw new Error("API key must start with sk_live_");
          }
          this.apiKeyStore.setApiKey(trimmedApiKey, "USER_CREATED");
        } else {
          const onboardingAttemptId =
            typeof payload.onboardingAttemptId === "string"
              ? payload.onboardingAttemptId.trim()
              : "";
          if (onboardingAttemptId) {
            throw new Error("Automated onboarding must start from the installer handoff file.");
          }
        }

        this.settingsStore.update({
          ...(relayOrigin !== undefined ? { relayOrigin } : {}),
          ...(apiOrigin !== undefined ? { apiOrigin } : {}),
          webAppOrigin,
          sandboxBaseDirectory,
          onboardingCompleted: true,
        });

        if (payload.binaryPaths) {
          const patch: Partial<Record<"claude" | "gh" | "codex" | "python3" | "git", string | null>> = {};
          for (const key of ["claude", "gh", "codex", "python3", "git"] as const) {
            const value = payload.binaryPaths[key];
            if (typeof value === "string" && value.trim()) {
              patch[key] = value.trim();
            }
          }
          if (Object.keys(patch).length > 0) {
            this.applyBinaryPathPatchAndInvalidateCaches(patch);
          }
        }

        await seedReposConfig(sandboxBaseDirectory);
        this.restartCloudSocket();
        return this.getOnboardingState();
      },
    );
    ipcMain.handle("desktop:get-binary-paths", () =>
      this.settingsStore.getBinaryPaths(),
    );
    ipcMain.handle(
      "desktop:patch-binary-paths",
      (
        _event,
        patch: Partial<Record<"claude" | "gh" | "codex" | "python3" | "git", string | null>>,
      ) => this.applyBinaryPathPatchAndInvalidateCaches(patch),
    );
    ipcMain.handle("desktop:detect-cli-tools", async () => {
      const overrides = this.settingsStore.getBinaryPaths();
      const names = ["claude", "gh", "codex", "python3", "git"] as const;
      const results = await Promise.all(
        names.map(async (name) => {
          const override = overrides[name];
          const resolved = await resolveBinary(name, override);
          return {
            name,
            override: override ?? null,
            source: resolved.source,
            resolvedPath: resolved.source === "fallback" ? null : resolved.path,
          };
        }),
      );
      return Object.fromEntries(results.map((r) => [r.name, r]));
    });
    ipcMain.handle("desktop:pick-sandbox-directory", async () => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    });
    ipcMain.handle(
      "desktop:get-dangerous-auto-approve",
      () => this.dangerousAutoApprove,
    );
    ipcMain.handle(
      "desktop:set-dangerous-auto-approve",
      (_event, enabled: boolean) => {
        this.dangerousAutoApprove = Boolean(enabled);
        return this.dangerousAutoApprove;
      },
    );
    ipcMain.handle("desktop:is-debug-auth-enabled", () =>
      this.isDebugAuthEnabled(),
    );
    ipcMain.handle("desktop:mint-debug-token", (_event, origin?: string) => {
      if (!this.isDebugAuthEnabled()) {
        throw new Error("Debug auth is not enabled");
      }
      const boundOrigin =
        typeof origin === "string" && origin.trim()
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
            updateAvailable:
              remoteVersion != null && remoteVersion !== app.getVersion(),
            version: remoteVersion,
          };
        }
        return await this.checkForUpdate();
      } catch (error) {
        return {
          updateAvailable: false,
          error: error instanceof Error ? error.message : "unknown error",
        };
      }
    });
    ipcMain.handle("desktop:apply-update", async () => {
      if (app.isPackaged) {
        autoUpdater.quitAndInstall();
        return;
      }
      await this.applyUpdate();
    });

    ipcMain.handle("desktop:find-matching-config", () => {
      return this.settingsStore.findConfigByOrigins(
        this.settingsStore.getRelayOrigin(),
        this.settingsStore.getApiOrigin(),
        this.settingsStore.getWebAppOrigin()
      );
    });

    ipcMain.handle("desktop:save-config", (_event, payload: { name: string }) => {
      // Name validation and trimming is performed by settingsStore.saveConfig
      const savedConfig = this.settingsStore.saveConfig(payload?.name ?? "");
      const status = this.apiKeyStore.getStatus();
      if (status.source === "safeStorage") {
        const currentApiKey = this.apiKeyStore.getApiKey() ?? "";
        if (currentApiKey) {
          this.apiKeyStore.saveProfileKey(
            savedConfig.id,
            currentApiKey,
            this.apiKeyStore.getApiKeyProvenance() ?? "USER_CREATED",
          );
        }
      }
      return savedConfig;
    });

    ipcMain.handle("desktop:list-configs", () => {
      return this.settingsStore.listConfigs().map((c) => ({
        ...c,
        hasCloudApiKey: Boolean(this.apiKeyStore.getProfileKey(c.id))
      }));
    });

    ipcMain.handle("desktop:delete-config", (_event, payload: { id: string }) => {
      const id = typeof payload?.id === "string" ? payload.id : "";
      if (!id) {
        throw new Error("id is required");
      }
      const { wasActive } = this.settingsStore.deleteConfig(id);
      if (wasActive) {
        this.settingsStore.setRelayOrigin(DEFAULT_DESKTOP_SETTINGS.relayOrigin);
        this.settingsStore.setApiOrigin(DEFAULT_DESKTOP_SETTINGS.apiOrigin);
        this.settingsStore.setWebAppOrigin(DEFAULT_DESKTOP_SETTINGS.webAppOrigin);
        this.cloudSocket.stop();
        this.cloudStatus = { state: "idle" };
        this.apiKeyStore.clearApiKey();
        this.refreshTrayState();
      }
      this.apiKeyStore.deleteProfileKey(id);
      return { wasActive };
    });

    ipcMain.handle("desktop:rename-config", (_event, payload: { id: string; name: string }) => {
      const id = typeof payload?.id === "string" ? payload.id : "";
      if (!id) {
        throw new Error("id is required");
      }
      // Name validation and trimming is performed by settingsStore.renameConfig
      this.settingsStore.renameConfig(id, payload?.name ?? "");
    });

    ipcMain.handle("desktop:apply-config", async (_event, payload: { id: string }) => {
      const id = typeof payload?.id === "string" ? payload.id : "";
      if (!id) {
        throw new Error("id is required");
      }
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("safeStorage is not available -- cannot apply config");
      }
      const appliedConfig = this.settingsStore.applyConfig(id);
      const profileKey = this.apiKeyStore.getProfileKeyRecord(id);
      if (profileKey) {
        this.apiKeyStore.setApiKey(profileKey.apiKey, profileKey.provenance);
      } else {
        this.apiKeyStore.clearApiKey();
      }
      this.restartCloudSocket();
      return appliedConfig;
    });
  }

  private signDesktopRequest(
    request: DesktopPopSigningRequest,
  ): DesktopPopHeaders | null {
    const keyPair = this.gatewaySigningKeyStore.load(this.gatewayId);
    if (!keyPair.ok) {
      throw new DesktopPopUnavailableError(keyPair.reason);
    }
    try {
      return signDesktopPopHeaders({
        ...request,
        gatewayId: this.gatewayId,
        privateKeyPkcs8Pem: keyPair.keyPair.privateKeyPkcs8Pem,
      });
    } catch {
      throw new DesktopPopUnavailableError("sign_failed");
    }
  }

  private reportBootstrapClaimDiagnostic(diagnostic: BootstrapClaimDiagnostic): void {
    gatewayLog.warn(
      "desktop-pop",
      `PoP unavailable for ${diagnostic.surface}; routing to manual USER_CREATED setup (${diagnostic.reason})`,
    );
    Observability.desktopPopUnavailable(diagnostic.surface, diagnostic.reason);
  }

  private reportDesktopPopUnavailable(surface: string, reason: string): void {
    Observability.desktopPopUnavailable(surface, reason);
  }

  private applyBinaryPathPatchAndInvalidateCaches(
    patch: Partial<Record<"claude" | "gh" | "codex" | "python3" | "git", string | null>>
  ): { claude?: string; gh?: string; codex?: string; python3?: string; git?: string } {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== null && value !== undefined) {
        const expanded = value.replace(/^~/, os.homedir());
        if (!path.isAbsolute(expanded)) {
          throw new Error(`Binary path for ${key} must be an absolute path: ${value}`);
        }
      }
    }
    const expandedPatch: Partial<Record<"claude" | "gh" | "codex" | "python3" | "git", string | null>> = {};
    for (const [key, value] of Object.entries(patch)) {
      expandedPatch[key as "claude" | "gh" | "codex" | "python3" | "git"] =
        value !== null && value !== undefined ? value.replace(/^~/, os.homedir()) : value;
    }
    const updated = this.settingsStore.patchBinaryPaths(expandedPatch as Record<string, string | null>);
    resetResolvedClaudePath();
    resetMcpDetectionCache();
    return updated;
  }
}

const APPROVAL_TIMEOUT_MS = 120_000;
const MAX_IN_FLIGHT_COMMANDS = 2;
const QUEUE_STATS_DEBOUNCE_MS = 1000;
const ALWAYS_ALLOW_RULE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function handoffFailureMessage(reason: OnboardingHandoffFailureReason): string {
  switch (reason) {
    case "stale":
      return "The automated onboarding handoff expired. Start a fresh onboarding attempt from the web app.";
    case "invalid_origin":
      return "The automated onboarding handoff contained an invalid web app URL. Use manual setup or start again from the web app.";
    case "read_failed":
      return "Desktop could not read the automated onboarding handoff. Use manual setup or start again from the web app.";
    case "delete_failed":
      return "Desktop could not consume the automated onboarding handoff safely. Use manual setup or start again from the web app.";
    default:
      return "The automated onboarding handoff was invalid. Use manual setup or start again from the web app.";
  }
}

function isRetryableTrustedConfigFailure(
  result: TrustedDesktopConfigResult,
): boolean {
  return result.kind === "failed" && result.retryable;
}

function managedOnboardingFailureMessage(
  result: Exclude<TrustedDesktopConfigResult, { kind: "ok" }>,
): string {
  if (result.retryable) {
    return "Desktop could not reach the trusted web app config after retrying. Start a fresh onboarding attempt or use manual setup.";
  }
  if (result.reason === "unsupported_protocol") {
    return "This ClosedLoop web app does not support this Desktop onboarding protocol. Use manual setup.";
  }
  return "Desktop could not validate the trusted web app config. Use manual setup or start again from the web app.";
}

function managedOnboardingRecoveryActions(
  result: Exclude<TrustedDesktopConfigResult, { kind: "ok" }>,
): ManagedOnboardingState["recoveryActions"] {
  return result.retryable
    ? ["retry_automated_onboarding", "use_manual_setup"]
    : ["use_manual_setup"];
}

function bootstrapClaimFailureMessage(
  result: Exclude<BootstrapClaimResult, { kind: "claimed" | "manual_fallback" }>,
): string {
  switch (result.statusCode) {
    case 401:
      return "The onboarding attempt expired or was already used. Start a fresh onboarding attempt from the web app.";
    case 400:
    case 403:
      return "The automated onboarding request was rejected. Use manual setup.";
    case 409:
      return "Desktop managed-key rotation conflicted with another active attempt. Start a fresh onboarding attempt or use manual setup.";
    case 502:
    case 503:
      if (result.retryable === false) {
        return "Desktop could not claim a managed key. Start a fresh onboarding attempt or use manual setup.";
      }
      return "Desktop could not claim a managed key after retrying. Start a fresh onboarding attempt or use manual setup.";
    default:
      return result.error || "Desktop could not claim a managed key. Use manual setup.";
  }
}

function bootstrapClaimRecoveryActions(
  result: Exclude<BootstrapClaimResult, { kind: "claimed" | "manual_fallback" }>,
): ManagedOnboardingState["recoveryActions"] {
  switch (result.statusCode) {
    case 400:
    case 403:
      return ["use_manual_setup"];
    default:
      return ["retry_automated_onboarding", "use_manual_setup"];
  }
}

function pruneExpiredAlwaysAllowRules(
  rules: AlwaysAllowRule[] | undefined,
  now = Date.now(),
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
  request: {
    operationId: string;
    method: string;
    path: string;
    scopePath?: string | null;
  },
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
  if (!rawBody?.trim()) {
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
  return value.trim();
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
