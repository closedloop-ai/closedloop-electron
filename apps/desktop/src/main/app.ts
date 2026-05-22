import os from "node:os";
import path from "node:path";
import { readFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { app, dialog, ipcMain, nativeImage, Notification, safeStorage, shell } from "electron";
import {
  type AlwaysAllowRule,
  DEFAULT_DESKTOP_SETTINGS,
  GATEWAY_PROTOCOL_VERSION,
  EMPTY_CAPABILITIES,
  type SavedConfig,
  type DesktopSettings,
  type RiskTier,
} from "../shared/contracts.js";
import {
  buildCommandSigningCapabilities,
  shouldEnforceCommandSigning,
} from "../shared/command-signing-policy.js";
import {
  buildAllowedDirectories,
  isRiskyAllowedDirectory,
  normalizeScopePath,
} from "../shared/sandbox-policy.js";
import { isGitRepository } from "../shared/git-utils.js";
import { ApiKeyStore } from "./api-key-store.js";
import { AuthorizedCommandKeyStore } from "./authorized-command-key-store.js";
import {
  fetchOrganizationCommandKeys,
  type OrganizationCommandPublicKey,
} from "./authorized-public-keys-client.js";
import {
  claimDesktopManagedApiKey,
  isRetryableBootstrapClaimFailure,
  type BootstrapClaimDiagnostic,
  type BootstrapClaimResult,
} from "./bootstrap-claim.js";
import { CloudCommandExecutor } from "./cloud-command-executor.js";
import type { CloudSocketStatus, DesktopCommandEvent } from "./cloud-protocol.js";
import { CloudSocketService } from "./cloud-socket.js";
import { CommandSignatureVerifier } from "./command-signature-verifier.js";
import { CommandKeyReconciler } from "./command-key-reconciler.js";
import {
  classifyBrowserCommandKeyApprovalRequestCommand,
  handleBrowserCommandKeyApprovalRequestCommand as handleReservedBrowserCommandKeyApprovalRequest,
} from "./browser-command-key-approval-request.js";
import {
  classifyBrowserCommandKeyRevocationCommand,
  handleBrowserCommandKeyRevocationCommand as handleReservedBrowserCommandKeyRevocation,
} from "./browser-command-key-revocation.js";
import {
  DesktopPopUnavailableError,
  signDesktopPopHeaders,
  type DesktopPopHeaders,
  type DesktopPopSigningRequest,
} from "./desktop-pop.js";
import {
  GatewaySigningKeyStore,
  type GatewaySigningKeyResult,
} from "./gateway-signing-key-store.js";
import { SettingsStore, type SavedConfigManagedPatch } from "./settings-store.js";
import { DesktopTray } from "./tray.js";
import { DesktopWindow } from "./window.js";
import { AgentMonitorSidecar } from "./agent-monitor-sidecar.js";
import { AgentSessionSyncService } from "./agent-session-sync-service.js";
import {
  isAgentMonitorHooksEnabled,
  setAgentMonitorHooksEnabled,
  syncAgentMonitorHooksOnBoot,
} from "./agent-monitor-hooks.js";
import { DesktopGatewayServer } from "../server/server.js";
import {
  computeSymphonyDir,
  SymphonyDirNotConfiguredError,
} from "../server/operations/symphony-utils.js";
import { getResolvedGitPath, resetResolvedClaudePath } from "../server/operations/symphony-loop.js";
import { resetMcpDetectionCache } from "../server/operations/mcp-detection.js";
import { resolveBinaryFromLoginShell } from "../server/shell-path.js";
import { getCodePluginVersion } from "../server/operations/plugin-cache.js";
import { seedReposConfig } from "./seed-repos-config.js";
import {
  SUPPORTED_OPERATION_IDS,
  resolveOperationId,
} from "./approval-operations.js";
import { shouldAutoApprove, OPERATION_RISK_TIERS, FORCE_INTERACTIVE_OPERATIONS } from "./approval-policy.js";
import { gatewayLog, isNetworkError } from "./gateway-logger.js";
import { ActivityLogStore } from "./activity-log-store.js";
import { ApprovalStore } from "./approval-store.js";
import { JobStore, isTerminalJobStatus, type LocalJob } from "./job-store.js";
import { Observability } from "./observability.js";
import type {
  DesktopSecurityUpgradePayload,
  DesktopSecurityUpgradeResult,
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
import {
  electronLog,
  getMainLogFilePath,
  openMainLogFile,
  readPreviousSessionLogTail,
} from "./persistent-log.js";
import type { DesktopShutdownDiagnostics } from "./telemetry-protocol.js";
import {
  assertPackagedUpdateReadyToInstall,
  createInitialPackagedUpdateState,
  mergePackagedUpdateState,
  PACKAGED_UPDATE_NOT_DOWNLOADED_MESSAGE,
  toPackagedUpdateStatusPayload,
  type PackagedUpdateState,
  type PackagedUpdateStatusPayload,
} from "./packaged-update-state.js";
import pkg from "electron-updater";
const { autoUpdater } = pkg;
import { BUILD_COMMIT_HASH } from "../shared/build-info.js";
import { BootRecoveryService } from "./boot-recovery.js";
import { LoopTokenStore } from "./loop-token-store.js";
import { prepareLoopCommandForExecution } from "./loop-command-preparer.js";
import { GatewayIdentityStore } from "./gateway-identity.js";
import {
  buildUpdateAndRestartDisabledResult,
  canApplyPackagedUpdate,
  resolvePackagedUpdateCheckResult,
  shouldHonorAlwaysAllowRule,
} from "./update-and-restart-helpers.js";
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
  ManagedOnboardingRunTracker,
  type ManagedOnboardingRunToken,
} from "./managed-onboarding-run.js";
import {
  getCanonicalOnboardingHandoffPath,
  isCanonicalOnboardingHandoffPath,
  OnboardingHandoffQueue,
  readPendingOnboardingHandoff,
  type OnboardingHandoffFailureReason,
  type PendingOnboardingHandoff,
} from "./onboarding-handoff.js";
import {
  fetchOnboardingStatus,
  ONBOARDING_WIZARD_PATH,
  resolveOnboardingPopupDecision,
} from "./onboarding-popup.js";
import { isSecurityUpgradeProvisioned } from "./security-upgrade-result.js";
import { isDesktopSetupCompleteFromState } from "./setup-readiness.js";
import { PendingCommandKeyNotifier } from "./pending-command-key-notifier.js";
import * as loopSleepRecovery from "./loop-sleep-recovery.js";
import { LoopSchedulerContext } from "./loop-scheduler-context.js";

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
  private readonly authorizedCommandKeys: AuthorizedCommandKeyStore;
  private readonly commandSignatureVerifier: CommandSignatureVerifier;
  private readonly pendingCommandKeyNotifier: PendingCommandKeyNotifier;
  private readonly commandKeyReconciler: CommandKeyReconciler;
  private readonly gatewaySigningKeyStore: GatewaySigningKeyStore;
  private readonly loopTokenStore: LoopTokenStore;
  private readonly tray: DesktopTray;
  private readonly desktopWindow: DesktopWindow;
  private readonly server: DesktopGatewayServer;
  private readonly cloudSocket: CloudSocketService;
  private readonly commandExecutor: CloudCommandExecutor;
  private readonly agentMonitor: AgentMonitorSidecar;
  private readonly agentSessionSync: AgentSessionSyncService;
  private readonly activityLog: ActivityLogStore;
  private readonly approvalStore: ApprovalStore;
  private readonly jobStore: JobStore;
  private readonly recovery: GatewayRecoveryManager;
  private readonly bootRecovery: BootRecoveryService;
  private readonly schedulers: LoopSchedulerContext;
  private readonly gatewayAuthToken: string;
  private readonly legacyGatewayId: string;
  private readonly sessionStore: LocalSessionStore;
  private shuttingDown = false;
  private dangerousAutoApprove = false;
  private cloudStatus: CloudSocketStatus = { state: "idle" };
  private cloudCommandsPaused: boolean;
  private cloudConnectionEnabled: boolean;
  private serverCommandSigningSupported = false;
  private serverAgentSessionSyncSupported = false;
  private updateCheckTimer: NodeJS.Timeout | null = null;
  private packagedUpdateState: PackagedUpdateState =
    createInitialPackagedUpdateState();
  private applyingDownloadedUpdate = false;
  private readonly onboardingHandoffPath = getCanonicalOnboardingHandoffPath();
  private bootReadyForOnboarding = false;
  private processingOnboardingHandoff = false;
  private readonly queuedOpenFileHandoffs = new OnboardingHandoffQueue();
  private readonly managedOnboardingRuns = new ManagedOnboardingRunTracker();
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
      analytics: {
        send: (event) => this.cloudSocket?.emitAnalytics(event),
        flush: (options) =>
          this.cloudSocket?.flushAnalytics(options) ?? Promise.resolve(),
      },
      desktopClientVersion: app.getVersion(),
    });
    this.settingsStore = new SettingsStore();
    this.cloudCommandsPaused = this.settingsStore.getCloudCommandsPaused();
    this.cloudConnectionEnabled =
      this.settingsStore.getCloudConnectionEnabled();
    this.apiKeyStore = new ApiKeyStore();
    this.authorizedCommandKeys = new AuthorizedCommandKeyStore();
    this.commandSignatureVerifier = new CommandSignatureVerifier({
      authorizedKeys: this.authorizedCommandKeys,
    });
    this.pendingCommandKeyNotifier = new PendingCommandKeyNotifier({
      getPendingKeys: () => this.getPendingCommandSigningKeysForNotification(),
      createNotification: (options) => new Notification(options),
      supportsActions: () => process.platform === "darwin",
      onOpenSettings: () => this.openBrowserCommandKeysSettings(),
      onApprove: async (fingerprint) => {
        await this.approveOrganizationCommandPublicKey(fingerprint);
      },
      onDecline: async (fingerprint) => {
        await this.rejectOrganizationCommandPublicKey(fingerprint);
      },
      onChanged: () => this.notifyCommandKeysChanged(),
      log: (message) => gatewayLog.debug("command-keys", message),
    });
    this.commandKeyReconciler = new CommandKeyReconciler({
      hasApiKey: () => Boolean(this.apiKeyStore.getApiKey()),
      fetchOrganizationKeys: () =>
        this.fetchAvailableCommandSigningKeys({ requireApiKey: true }),
      reconcileOrganizationKeys: (fingerprints) =>
        this.authorizedCommandKeys.reconcileOrganizationKeys(fingerprints),
      notifyPendingKeys: (organizationKeys) =>
        this.notifyPendingCommandSigningKeysForOrganizationKeys(
          organizationKeys,
        ),
      onChanged: () => this.notifyCommandKeysChanged(),
      log: (level, message) => {
        gatewayLog[level]("command-keys", message);
      },
    });
    this.loopTokenStore = new LoopTokenStore();
    this.gatewaySigningKeyStore = new GatewaySigningKeyStore();
    this.tray = new DesktopTray();
    this.desktopWindow = new DesktopWindow();
    this.agentMonitor = new AgentMonitorSidecar();
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
    this.legacyGatewayId = gatewayIdentityStore.loadSync();
    // Initialized before the gateway server so the server constructor can take
    // ownership of the same instance the BootRecoveryService is later given.
    this.schedulers = new LoopSchedulerContext();
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
      () => this.getActiveGatewayId(),
      () => this.settingsStore.getBinaryPaths(),
      (patch) => this.applyBinaryPathPatchAndInvalidateCaches(patch),
      async () => {
        if (app.isPackaged) {
          const result = await autoUpdater.checkForUpdates();
          const remoteVersion = result?.updateInfo?.version;
          return resolvePackagedUpdateCheckResult(
            app.getVersion(),
            this.packagedUpdateState,
            remoteVersion
          );
        }
        return this.checkForUpdate();
      },
      async () => {
        if (app.isPackaged) {
          if (!canApplyPackagedUpdate(app.getVersion(), this.packagedUpdateState)) {
            throw new Error("Update has not finished downloading yet");
          }
          autoUpdater.quitAndInstall();
          return;
        }
        await this.applyUpdate();
      },
      () => this.settingsStore.getUpdateAndRestartEnabled(),
      () => this.apiKeyStore.getApiKeyProvenance(),
      (request) => this.signDesktopRequest(request),
      (surface, reason) => this.reportDesktopPopUnavailable(surface, reason),
      () =>
        this.cloudStatus.state === "online" ? this.cloudStatus.targetId : null,
      (payload) => this.handleSecurityUpgradeCommand(payload),
      () => this.isDesktopSetupComplete(),
      this.schedulers,
    );
    this.commandExecutor = new CloudCommandExecutor({
      getGatewayPort: () => this.server.getActivePort(),
      getGatewayAuthToken: () => this.gatewayAuthToken,
      maxInFlightCommands: MAX_IN_FLIGHT_COMMANDS,
      sendCommandAck: (event) => this.cloudSocket.sendCommandAck(event),
      sendCommandEvent: (event) => this.cloudSocket.sendCommandEvent(event),
      commandSignatureVerifier: this.commandSignatureVerifier,
      isCommandSigningEnforced: () => this.isCommandSigningEnforced(),
      prepareCommandForExecution: (command) =>
        this.prepareCloudCommandForExecution(command),
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
      getCapabilities: () => this.getLocalCapabilities() as unknown as Record<string, unknown>,
      getMaxInFlightCommands: () => MAX_IN_FLIGHT_COMMANDS,
      getGatewayId: () => this.getUpgradeCapableGatewayId(),
      machineName: os.hostname(),
      pluginVersion: getCodePluginVersion(),
      desktopClientVersion: app.getVersion(),
      gatewayProtocolVersion: GATEWAY_PROTOCOL_VERSION,
      getEnabledOperations: () => {
        const enabled = this.settingsStore.getUpdateAndRestartEnabled();
        return SUPPORTED_OPERATION_IDS.filter(
          (id) => id !== "update_and_restart" || enabled
        );
      },
      onStatusChange: (status) => this.onCloudSocketStatus(status),
      onDisconnect: (reason) => {
        this.serverCommandSigningSupported = false;
        this.serverAgentSessionSyncSupported = false;
        this.commandKeyReconciler.stop();
        this.agentSessionSync.refresh();
        this.notifyCommandKeysChanged();
        Observability.connectionLost(reason);
      },
      onHelloAck: (event) => {
        this.serverCommandSigningSupported =
          event.serverCapabilities?.computeTargetSigning === true;
        this.serverAgentSessionSyncSupported =
          event.serverCapabilities?.agentSessionSync === true;
        gatewayLog.info(
          "command-signing",
          `Server support from hello ack: computeTargetId=${event.computeTargetId}, computeTargetSigning=${event.serverCapabilities?.computeTargetSigning === true}`,
        );
        if (this.serverCommandSigningSupported) {
          this.commandKeyReconciler.start();
          void this.commandKeyReconciler.reconcileNow("hello_ack");
        } else {
          this.commandKeyReconciler.stop();
        }
        this.notifyCommandKeysChanged();
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
          process.env.NODE_ENV ?? "production",
        );
        this.agentSessionSync.refresh();
      },
      onCommand: (command) => {
        const keyApprovalRequestMatch =
          classifyBrowserCommandKeyApprovalRequestCommand(command);
        if (keyApprovalRequestMatch === "match") {
          this.handleBrowserCommandKeyApprovalRequestCommand(command);
          return;
        }
        if (keyApprovalRequestMatch === "mismatch") {
          this.cloudSocket.sendCommandAck({
            commandId: command.commandId,
            accepted: false,
            state: "failed",
            reason: "operationId/path mismatch",
          });
          return;
        }
        const keyRevocationMatch =
          classifyBrowserCommandKeyRevocationCommand(command);
        if (keyRevocationMatch === "match") {
          this.handleBrowserCommandKeyRevocationCommand(command);
          return;
        }
        if (keyRevocationMatch === "mismatch") {
          this.cloudSocket.sendCommandAck({
            commandId: command.commandId,
            accepted: false,
            state: "failed",
            reason: "operationId/path mismatch",
          });
          return;
        }
        if (!this.isDesktopSetupComplete()) {
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
    this.agentSessionSync = new AgentSessionSyncService({
      isAgentMonitorEnabled: () => this.settingsStore.getAgentMonitorEnabled(),
      isRelayReady: () =>
        this.serverAgentSessionSyncSupported &&
        this.cloudStatus.state === "online",
      sendBatch: (batch) => this.cloudSocket.sendAgentSessions(batch),
      getUserDataPath: () => app.getPath("userData"),
      onBatchOutcome: (event) => {
        Observability.agentSessionSyncBatchFailed(event);
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
      schedulers: this.schedulers,
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
      onManageCommandKeys: () => this.openBrowserCommandKeysSettings(),
      onOpenClaudeDashboard: () => this.openClaudeDashboard(),
      onTogglePaused: (paused) => this.setCloudCommandsPaused(paused),
    });
    this.tray.setAgentMonitorEnabled(this.settingsStore.getAgentMonitorEnabled());
    this.tray.setPaused(this.cloudCommandsPaused);
    this.syncPendingApprovalsToTray();
    this.desktopWindow.init();
    this.bootReadyForOnboarding = true;
    void this.drainQueuedOnboardingHandoffs();
    void this.processCanonicalOnboardingHandoff("cold-start");
    void this.maybeShowOnboardingPopup();

    gatewayLog.setVerbose(this.settingsStore.getAll().verboseLogging);
    const previousLogEntries = await readPreviousSessionLogTail(200);
    gatewayLog.seedPreviousSessionEntries(previousLogEntries);
    gatewayLog.info(
      "startup",
      `Desktop boot starting version=${app.getVersion()} log=${getMainLogFilePath()}`,
    );
    const deadJobs = this.reconcileJobStore();
    await this.bootRecovery.reattachLiveJobs();

    const bootSandbox = this.settingsStore.getSandboxBaseDirectory();
    if (bootSandbox?.trim()) {
      await seedReposConfig(bootSandbox);
    }

    // Register the sleep/wake recovery listener so active loops refresh their
    // tokens and send heartbeats after the system wakes from sleep.
    loopSleepRecovery.init();

    // Independent of the gateway, but fully feature-gated. When enabled, start
    // the sidecar fire-and-forget BEFORE the gateway try-block so a
    // gateway-start failure never prevents it from running, and a sidecar
    // failure never blocks or fails app boot. The relay sync service follows
    // the same flag, so disabling Agent Monitor leaves only dormant wiring in
    // the desktop shell and no background sync loop. Hook repair remains
    // opt-in and self-healing.
    if (this.settingsStore.getAgentMonitorEnabled()) {
      void this.agentMonitor.start();
      syncAgentMonitorHooksOnBoot();
      this.agentSessionSync.start();
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

      if (this.cloudConnectionEnabled && this.apiKeyStore.getStatus().hasApiKey) {
        void this.cloudSocket.start();
      } else if (!this.cloudConnectionEnabled) {
        this.cloudStatus = {
          state: "degraded",
          error: "Cloud connection disabled by user",
        };
      }

      if (app.isPackaged) {
        autoUpdater.logger = electronLog;
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.on("error", (err) => {
          const level = isNetworkError(err.message) ? "debug" : "error";
          gatewayLog[level]("auto-update", `Auto-update error: ${err.message}`);
          this.setPackagedUpdateState({
            status: "error",
            available: false,
            downloaded: false,
            error: err.message,
            percent: undefined,
          });
          this.notifyPackagedUpdateStatus();
          Observability.electronUpdateFailed({
            trigger: "updater-error",
            status: this.packagedUpdateState.status,
            version: this.packagedUpdateState.version,
            error: err.message,
            downloaded: this.packagedUpdateState.downloaded,
            readyToInstall: this.packagedUpdateState.downloaded,
          });
        });
        autoUpdater.on("update-available", (info) => {
          this.setPackagedUpdateState({
            status: "available",
            available: true,
            downloaded: false,
            version: info.version,
            error: undefined,
            percent: undefined,
          });
          gatewayLog.info(
            "auto-update",
            `Update available version=${info.version}; waiting for download`,
          );
          this.notifyPackagedUpdateStatus();
          this.desktopWindow
            .getWindow()
            ?.webContents.send("desktop:update-available", {
              updateAvailable: true,
              version: info.version,
              readyToInstall: false,
            });
        });
        autoUpdater.on("download-progress", (progress) => {
          const percent =
            typeof progress.percent === "number"
              ? Math.max(0, Math.min(100, progress.percent))
              : undefined;
          this.setPackagedUpdateState({
            status: "downloading",
            available: true,
            downloaded: false,
            percent,
            error: undefined,
          });
          gatewayLog.debug(
            "auto-update",
            () =>
              `Update download progress version=${this.packagedUpdateState.version ?? "unknown"} percent=${percent?.toFixed(1) ?? "unknown"}`,
          );
          this.notifyPackagedUpdateStatus();
        });
        autoUpdater.on("update-downloaded", (info) => {
          this.setPackagedUpdateState({
            status: "downloaded",
            available: true,
            downloaded: true,
            version: info.version,
            percent: 100,
            error: undefined,
          });
          gatewayLog.info(
            "auto-update",
            `Update downloaded version=${info.version}; ready to restart`,
          );
          this.notifyPackagedUpdateStatus();
        });
        autoUpdater.on("update-not-available", (info) => {
          this.setPackagedUpdateState({
            status: "not-available",
            available: false,
            downloaded: false,
            version: info.version,
            percent: undefined,
            error: undefined,
          });
          gatewayLog.debug(
            "auto-update",
            () => `No packaged update available version=${info.version ?? "unknown"}`,
          );
          this.notifyPackagedUpdateStatus();
        });
        void autoUpdater.checkForUpdates().catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          gatewayLog.error(
            "auto-update",
            `Failed to check for updates: ${msg}`,
          );
          this.setPackagedUpdateState({
            status: "error",
            available: false,
            downloaded: false,
            error: msg,
            percent: undefined,
          });
          this.notifyPackagedUpdateStatus();
          Observability.electronUpdateFailed({
            trigger: "check-for-updates",
            status: this.packagedUpdateState.status,
            version: this.packagedUpdateState.version,
            error: msg,
            downloaded: this.packagedUpdateState.downloaded,
            readyToInstall: this.packagedUpdateState.downloaded,
          });
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
    const run = this.managedOnboardingRuns.begin();
    this.managedOnboardingState = {
      status: "awaiting-origin-confirmation",
      webAppOrigin: payload.webAppOrigin,
      message: "Waiting for URL confirmation before automated provisioning.",
    };
    this.notifyOnboardingStateChanged();
    this.showWindow();

    const confirmed = await this.confirmManagedOnboardingOrigin(payload);
    if (this.shouldStopManagedOnboardingRun(run, "origin confirmation")) {
      return;
    }
    if (!confirmed) {
      this.setManagedOnboardingFailure(
        "origin_confirmation_dismissed",
        "Automated provisioning was canceled. Start a fresh onboarding attempt from the web app or use manual setup.",
        ["retry_automated_onboarding", "use_manual_setup"],
      );
      return;
    }

    await this.runManagedOnboardingProvisioning(payload, run);
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

  /**
   * Returns the gateway identity for the active saved profile, creating a
   * profile-scoped UUID when needed. Unsaved legacy installs keep the original
   * singleton identity for backward compatibility.
   */
  private getActiveGatewayId(): string {
    const activeConfigId = this.settingsStore.getActiveConfigId();
    if (!activeConfigId) {
      return this.legacyGatewayId;
    }
    return this.settingsStore.ensureConfigGatewayId(activeConfigId).gatewayId ?? this.legacyGatewayId;
  }

  /** Reports setup completion for first-run onboarding and already-provisioned profiles. */
  private isDesktopSetupComplete(): boolean {
    return isDesktopSetupCompleteFromState({
      onboardingCompleted: this.settingsStore.getOnboardingCompleted(),
      sandboxBaseDirectory: this.settingsStore.getSandboxBaseDirectory(),
      hasApiKey: this.apiKeyStore.getApiKey() !== null,
    });
  }

  private async prepareCloudCommandForExecution(
    command: DesktopCommandEvent,
  ): Promise<DesktopCommandEvent> {
    return prepareLoopCommandForExecution(command, {
      getApiOrigin: () => this.settingsStore.getApiOrigin(),
      getApiKey: () => this.apiKeyStore.getApiKey(),
      getApiKeyProvenance: () => this.apiKeyStore.getApiKeyProvenance(),
      getComputeTargetId: () =>
        this.cloudStatus.state === "online" ? this.cloudStatus.targetId : null,
      signDesktopRequest: (request) => this.signDesktopRequest(request),
      onDesktopPopUnavailable: (surface, reason) =>
        this.reportDesktopPopUnavailable(surface, reason),
    });
  }

  private getUpgradeCapableGatewayId(): string | null {
    const keyPair = this.getOrCreateActiveSigningKey();
    return keyPair.ok ? keyPair.keyPair.gatewayId : null;
  }

  private getActiveConfig(): SavedConfig | null {
    return this.settingsStore.getActiveConfig();
  }

  private getConnectionSecurityStatus(): {
    mode:
      | "enhanced"
      | "standard"
      | "unconfigured"
      | "signing_unavailable";
    detail: string;
  } {
    const apiKeyStatus = this.apiKeyStore.getStatus();
    if (!apiKeyStatus.hasApiKey) {
      return {
        mode: "unconfigured",
        detail: "No cloud API key is configured.",
      };
    }
    if (apiKeyStatus.provenance !== "DESKTOP_MANAGED") {
      return {
        mode: "standard",
        detail: "Using a manually configured bearer key.",
      };
    }

    const keyPair = this.gatewaySigningKeyStore.load(this.getActiveGatewayId());
    if (!keyPair.ok) {
      return {
        mode: "signing_unavailable",
        detail: "Managed key is present but request signing is unavailable.",
      };
    }

    return {
      mode: "enhanced",
      detail: "Managed key with request signing is configured.",
    };
  }

  private getOrCreateActiveSigningKey(): GatewaySigningKeyResult {
    const gatewayId = this.getActiveGatewayId();
    const keyPair = this.gatewaySigningKeyStore.getOrCreate(gatewayId);
    if (keyPair.ok) {
      this.persistActiveConfigManagedMetadata({
        gatewayId,
        gatewayPublicKeyPem: keyPair.keyPair.publicKeySpkiPem,
        desktopSecurityUpgradeProtocolVersion: 1,
      });
    }
    return keyPair;
  }

  private persistActiveConfigManagedMetadata(patch: SavedConfigManagedPatch): void {
    this.settingsStore.updateActiveConfigManagedMetadata(patch);
  }

  private persistActiveProfileKey(
    apiKey: string,
    provenance: "USER_CREATED" | "DESKTOP_MANAGED",
  ): void {
    const activeConfig = this.getActiveConfig();
    if (!activeConfig) {
      return;
    }
    this.apiKeyStore.saveProfileKey(activeConfig.id, apiKey, provenance);
    this.persistActiveConfigManagedMetadata({ apiKeySource: provenance });
  }

  private async runManagedOnboardingProvisioning(
    payload: PendingOnboardingHandoff,
    run: ManagedOnboardingRunToken,
  ): Promise<void> {
    if (this.shouldStopManagedOnboardingRun(run, "provisioning start")) {
      return;
    }
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
      isCancelled: () =>
        this.managedOnboardingRuns.isCancelled(run, this.shuttingDown),
    });
    if (this.shouldStopManagedOnboardingRun(run, "trusted config result")) {
      return;
    }
    if (trustedConfig.kind !== "ok") {
      this.setManagedOnboardingFailure(
        trustedConfig.reason,
        managedOnboardingFailureMessage(trustedConfig),
        managedOnboardingRecoveryActions(trustedConfig),
      );
      return;
    }

    if (this.shouldStopManagedOnboardingRun(run, "claim start")) {
      return;
    }
    this.managedOnboardingState = {
      status: "provisioning",
      webAppOrigin: payload.webAppOrigin,
      message: "Claiming managed Desktop key...",
    };
    this.notifyOnboardingStateChanged();

    const activeGatewayId = this.getActiveGatewayId();
    const claimResult = await withSingleManagedOnboardingRetry({
      operation: () =>
        claimDesktopManagedApiKey({
          apiOrigin: trustedConfig.config.apiOrigin,
          onboardingAttemptId: payload.onboardingAttemptId,
          webAppOrigin: payload.webAppOrigin,
          gatewayId: activeGatewayId,
          signingKeys: this.gatewaySigningKeyStore,
          onDiagnostic: (diagnostic) =>
            this.reportBootstrapClaimDiagnostic(diagnostic),
        }),
      shouldRetry: isRetryableBootstrapClaimFailure,
      delayMs: MANAGED_ONBOARDING_RETRY_DELAY_MS,
      isCancelled: () =>
        this.managedOnboardingRuns.isCancelled(run, this.shuttingDown),
    });

    if (this.shouldStopManagedOnboardingRun(run, "claim result")) {
      return;
    }
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

    if (this.shouldStopManagedOnboardingRun(run, "managed key persistence")) {
      return;
    }
    const keyPair = this.gatewaySigningKeyStore.load(activeGatewayId);
    const sandboxBaseDirectory = normalizeScopePath(
      payload.sandboxBaseDirectory,
    );
    const safeSandboxBaseDirectory =
      sandboxBaseDirectory && !isRiskyAllowedDirectory(sandboxBaseDirectory)
        ? sandboxBaseDirectory
        : null;

    this.apiKeyStore.setApiKey(claimResult.apiKey, "DESKTOP_MANAGED");
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
    const activeConfig =
      this.settingsStore.ensureActiveConfigForCurrentOrigins();
    this.apiKeyStore.saveProfileKey(
      activeConfig.id,
      claimResult.apiKey,
      "DESKTOP_MANAGED",
    );
    this.settingsStore.updateConfigManagedMetadata(activeConfig.id, {
      apiKeySource: "DESKTOP_MANAGED",
      gatewayId: activeGatewayId,
      ...(keyPair.ok
        ? { gatewayPublicKeyPem: keyPair.keyPair.publicKeySpkiPem }
        : {}),
      desktopSecurityUpgradeProtocolVersion: 1,
      pendingOnboardingAttemptId: null,
    });

    if (safeSandboxBaseDirectory) {
      if (this.shouldStopManagedOnboardingRun(run, "repo config seeding")) {
        return;
      }
      await seedReposConfig(safeSandboxBaseDirectory, {
        isCancelled: () =>
          this.managedOnboardingRuns.isCancelled(run, this.shuttingDown),
      });
      if (this.shouldStopManagedOnboardingRun(run, "completion state update")) {
        return;
      }
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

  private openBrowserCommandKeysSettings(): void {
    this.desktopWindow.show();
    this.desktopWindow
      .getWindow()
      ?.webContents.send("desktop:navigate-tab", "settings");
    this.desktopWindow
      .getWindow()
      ?.webContents.send("desktop:navigate-settings-tab", "security");
  }

  private isAgentMonitorEnabled(): boolean {
    return this.settingsStore.getAgentMonitorEnabled();
  }

  private isPlanExtractionEnabled(): boolean {
    return this.settingsStore.getPlanExtractionEnabled();
  }

  private async applyAgentMonitorSetting(enabled: boolean): Promise<void> {
    this.tray.setAgentMonitorEnabled(enabled);

    if (enabled) {
      void this.agentMonitor.start();
      syncAgentMonitorHooksOnBoot();
      this.agentSessionSync.start();
      return;
    }

    const hooksResult = isAgentMonitorHooksEnabled()
      ? setAgentMonitorHooksEnabled(false)
      : { ok: true, enabled: false };
    if (!hooksResult.ok) {
      gatewayLog.warn(
        "agent-monitor",
        `feature disabled but hooks could not be removed: ${hooksResult.error ?? "unknown error"}`,
      );
    }

    await this.agentMonitor.stop();
    this.agentSessionSync.stop();
    this.desktopWindow
      .getWindow()
      ?.webContents.send("desktop:navigate-tab", "settings");
    this.desktopWindow
      .getWindow()
      ?.webContents.send("desktop:navigate-settings-tab", "relay-gateway");
  }

  openClaudeDashboard(): void {
    this.desktopWindow.show();
    if (!this.isAgentMonitorEnabled()) {
      this.desktopWindow
        .getWindow()
        ?.webContents.send("desktop:navigate-tab", "settings");
      this.desktopWindow
        .getWindow()
        ?.webContents.send("desktop:navigate-settings-tab", "relay-gateway");
      return;
    }
    this.desktopWindow
      .getWindow()
      ?.webContents.send("desktop:navigate-tab", "claude-dashboard");
  }

  private notifyCommandKeysChanged(): void {
    this.desktopWindow
      .getWindow()
      ?.webContents.send("desktop:command-keys-changed");
  }

  private handleBrowserCommandKeyRevocationCommand(
    command: DesktopCommandEvent,
  ): void {
    handleReservedBrowserCommandKeyRevocation(command, {
      removeAuthorizedKey: (fingerprint) =>
        this.authorizedCommandKeys.remove(fingerprint),
      sendCommandAck: (event) => this.cloudSocket.sendCommandAck(event),
      sendCommandEvent: (event) => this.cloudSocket.sendCommandEvent(event),
      onChanged: () => this.notifyCommandKeysChanged(),
      log: (level, message) => gatewayLog[level]("command-keys", message),
    });
  }

  private handleBrowserCommandKeyApprovalRequestCommand(
    command: DesktopCommandEvent,
  ): void {
    handleReservedBrowserCommandKeyApprovalRequest(command, {
      notifyPendingKeys: (fingerprint) =>
        this.notifyPendingCommandSigningKeyByFingerprint(fingerprint),
      sendCommandAck: (event) => this.cloudSocket.sendCommandAck(event),
      sendCommandEvent: (event) => this.cloudSocket.sendCommandEvent(event),
      onChanged: () => this.notifyCommandKeysChanged(),
      log: (level, message) => gatewayLog[level]("command-keys", message),
    });
  }

  private getLocalCapabilities(): ReturnType<typeof buildCommandSigningCapabilities> {
    return {
      ...buildCommandSigningCapabilities({
        commandSigningEnforcementEnabled:
          this.settingsStore.getCommandSigningEnforcementEnabled(),
      }),
      loopRunnerRefreshSupported: true,
      loopRunnerHeartbeatSupported: true,
    };
  }

  private isCommandSigningEnforced(): boolean {
    return shouldEnforceCommandSigning({
      serverCommandSigningSupported: this.serverCommandSigningSupported,
      commandSigningEnforcementEnabled:
        this.settingsStore.getCommandSigningEnforcementEnabled(),
    });
  }

  private async handleSecurityUpgradeCommand(
    payload: DesktopSecurityUpgradePayload,
  ): Promise<DesktopSecurityUpgradeResult> {
    const activeGatewayId = this.getActiveGatewayId();
    if (payload.gatewayId !== activeGatewayId) {
      return {
        ok: false,
        code: "SECURITY_UPGRADE_GATEWAY_MISMATCH",
        retryable: false,
        statusCode: 409,
      };
    }
    if (
      this.cloudStatus.state === "online" &&
      this.cloudStatus.targetId !== payload.computeTargetId
    ) {
      return {
        ok: false,
        code: "SECURITY_UPGRADE_TARGET_MISMATCH",
        retryable: false,
        statusCode: 409,
      };
    }
    if (Date.parse(payload.expiresAt) <= Date.now()) {
      return {
        ok: false,
        code: "SECURITY_UPGRADE_ATTEMPT_EXPIRED",
        retryable: false,
        statusCode: 410,
      };
    }

    let webAppOrigin: string;
    try {
      webAppOrigin = normalizeWebAppOrigin(payload.webAppOrigin);
    } catch {
      return {
        ok: false,
        code: "SECURITY_UPGRADE_INVALID_ORIGIN",
        retryable: false,
        statusCode: 400,
      };
    }

    const confirmation = await dialog.showMessageBox({
      type: "question",
      buttons: ["Upgrade security", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: "Upgrade Desktop Security",
      message:
        "ClosedLoop wants to upgrade this Desktop connection to a protected managed key. Confirm the web app URL before continuing.",
      detail: webAppOrigin,
    });
    if (confirmation.response !== 0) {
      return {
        ok: false,
        code: "SECURITY_UPGRADE_CONFIRMATION_DISMISSED",
        retryable: false,
        statusCode: 409,
      };
    }

    const run = this.managedOnboardingRuns.begin();
    await this.runManagedOnboardingProvisioning(
      {
        onboardingAttemptId: payload.onboardingAttemptId,
        webAppOrigin,
        sandboxBaseDirectory: this.settingsStore.getSandboxBaseDirectory(),
        createdAt: new Date().toISOString(),
      },
      run,
    );
    if (this.shouldStopManagedOnboardingRun(run, "security upgrade result")) {
      return {
        ok: false,
        code: "SECURITY_UPGRADE_CANCELLED",
        retryable: true,
        statusCode: 409,
      };
    }

    const currentKey = this.apiKeyStore.getApiKeyRecord();
    if (isSecurityUpgradeProvisioned(currentKey)) {
      return { ok: true };
    }

    return {
      ok: false,
      code: "SECURITY_UPGRADE_FAILED",
      retryable: false,
      statusCode: 503,
    };
  }

  private async startDesktopFirstDeviceOnboarding(
    webAppOriginInput?: string,
  ): Promise<{ status: "approved" | "pending"; verificationUrl?: string }> {
    const webAppOrigin = normalizeWebAppOrigin(
      webAppOriginInput || this.settingsStore.getWebAppOrigin(),
    );
    const keyPair = this.getOrCreateActiveSigningKey();
    if (!keyPair.ok) {
      throw new Error(`Desktop signing key unavailable: ${keyPair.reason}`);
    }
    const activeGatewayId = keyPair.keyPair.gatewayId;

    const apiOrigin = normalizeAndValidateOrigin(
      this.settingsStore.getApiOrigin(),
    );
    const startUrl = new URL("/desktop/device-onboarding/start", apiOrigin);
    const startResponse = await fetch(startUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webAppOrigin,
        gatewayId: activeGatewayId,
        gatewayPublicKeyPem: keyPair.keyPair.publicKeySpkiPem,
        machineName: os.hostname(),
        platform: process.platform,
        desktopVersion: app.getVersion(),
        desktopSecurityUpgradeProtocolVersion: 1,
      }),
    });
    const startBody = (await startResponse.json().catch(() => null)) as
      | {
          deviceSessionId?: string;
          deviceSessionSecret?: string;
          verificationUrl?: string;
          expiresAt?: string;
          pollIntervalSeconds?: number;
        }
      | null;
    if (
      !startResponse.ok ||
      !startBody?.deviceSessionId ||
      !startBody.deviceSessionSecret ||
      !startBody.verificationUrl ||
      !startBody.expiresAt
    ) {
      throw new Error("Could not start browser connection");
    }

    const run = this.managedOnboardingRuns.begin();
    this.managedOnboardingState = {
      status: "provisioning",
      webAppOrigin,
      message: "Waiting for browser approval...",
    };
    this.notifyOnboardingStateChanged();
    await shell.openExternal(startBody.verificationUrl);

    const pollUrl = new URL("/desktop/device-onboarding/poll", apiOrigin);
    const pollIntervalMs = Math.max(
      1_000,
      (startBody.pollIntervalSeconds ?? 5) * 1000,
    );
    while (
      !this.managedOnboardingRuns.isCancelled(run, this.shuttingDown) &&
      Date.parse(startBody.expiresAt) > Date.now()
    ) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      type DeviceOnboardingPollBody = {
        status?: string;
        onboardingAttemptId?: string;
        webAppOrigin?: string;
        expiresAt?: string;
      };
      let pollResponse: Response;
      let pollBody: DeviceOnboardingPollBody | null = null;
      try {
        pollResponse = await fetch(pollUrl.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deviceSessionId: startBody.deviceSessionId,
            deviceSessionSecret: startBody.deviceSessionSecret,
          }),
        });
        pollBody = (await pollResponse
          .json()
          .catch(() => null)) as DeviceOnboardingPollBody | null;
      } catch {
        continue;
      }
      if (!pollResponse.ok || !pollBody?.status) {
        continue;
      }
      if (pollBody.status === "pending") {
        continue;
      }
      if (
        pollBody.status === "approved" &&
        pollBody.onboardingAttemptId &&
        pollBody.webAppOrigin
      ) {
        const confirmed = await this.confirmManagedOnboardingOrigin({
          onboardingAttemptId: pollBody.onboardingAttemptId,
          webAppOrigin: pollBody.webAppOrigin,
          createdAt: new Date().toISOString(),
        });
        if (!confirmed) {
          this.setManagedOnboardingFailure(
            "origin_confirmation_dismissed",
            "Browser connection was canceled. Use manual setup or start again.",
            ["use_manual_setup", "retry_automated_onboarding"],
          );
          return { status: "pending", verificationUrl: startBody.verificationUrl };
        }
        await this.runManagedOnboardingProvisioning(
          {
            onboardingAttemptId: pollBody.onboardingAttemptId,
            webAppOrigin: pollBody.webAppOrigin,
            sandboxBaseDirectory: this.settingsStore.getSandboxBaseDirectory(),
            createdAt: new Date().toISOString(),
          },
          run,
        );
        return { status: "approved", verificationUrl: startBody.verificationUrl };
      }
      this.setManagedOnboardingFailure(
        `device_session_${pollBody.status}`,
        "Browser connection was not approved. Use manual setup or start again.",
        ["use_manual_setup", "retry_automated_onboarding"],
      );
      return { status: "pending", verificationUrl: startBody.verificationUrl };
    }

    this.setManagedOnboardingFailure(
      "device_session_expired",
      "Browser connection expired. Use manual setup or start again.",
      ["use_manual_setup", "retry_automated_onboarding"],
    );
    return { status: "pending", verificationUrl: startBody.verificationUrl };
  }

  private shouldStopManagedOnboardingRun(
    run: ManagedOnboardingRunToken,
    stage: string,
  ): boolean {
    if (!this.managedOnboardingRuns.isCancelled(run, this.shuttingDown)) {
      return false;
    }
    gatewayLog.debug(
      "managed-onboarding",
      `Skipping stale managed onboarding continuation at ${stage}.`,
    );
    return true;
  }

  private cancelManagedOnboardingForUserChange(reason: string): void {
    this.managedOnboardingRuns.cancel();
    if (this.managedOnboardingState.status === "idle") {
      return;
    }
    gatewayLog.debug(
      "managed-onboarding",
      `Canceled automated onboarding because ${reason}.`,
    );
    this.managedOnboardingState = { status: "idle" };
    this.notifyOnboardingStateChanged();
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

  private async maybeShowOnboardingPopup(): Promise<void> {
    try {
      if (this.settingsStore.getOnboardingPopupDismissedPermanent()) {
        return;
      }
      if (!this.isDesktopSetupComplete()) {
        return;
      }
      const apiKey = this.apiKeyStore.getApiKey();
      if (!apiKey) {
        return;
      }
      const apiOrigin = this.settingsStore.getApiOrigin();
      const statusResult = await fetchOnboardingStatus({ apiOrigin, apiKey });
      const decision = resolveOnboardingPopupDecision({
        setupComplete: true,
        dismissedPermanent: false,
        statusResult,
      });
      if (decision === "skip") {
        return;
      }
      if (decision === "suppress") {
        this.settingsStore.setOnboardingPopupDismissedPermanent(true);
        Observability.onboardingPopupSuppressedAuto();
        return;
      }
      this.desktopWindow
        .getWindow()
        ?.webContents.send("desktop:show-onboarding-popup");
      Observability.onboardingPopupShown();
    } catch (error) {
      gatewayLog.warn(
        "onboarding-popup",
        `maybeShowOnboardingPopup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private setPackagedUpdateState(patch: Partial<PackagedUpdateState>): void {
    this.packagedUpdateState = mergePackagedUpdateState(
      this.packagedUpdateState,
      patch,
    );
  }

  private getPackagedUpdateStatusPayload(): PackagedUpdateStatusPayload {
    return toPackagedUpdateStatusPayload(this.packagedUpdateState);
  }

  private notifyPackagedUpdateStatus(): void {
    this.desktopWindow
      .getWindow()
      ?.webContents.send(
        "desktop:update-status",
        this.getPackagedUpdateStatusPayload(),
      );
  }

  setQuitting(): void {
    this.desktopWindow.setQuitting();
  }

  reportShutdownFailure(
    input: Omit<DesktopShutdownDiagnostics, "duringUpdate">,
  ): void {
    Observability.desktopShutdownFailed({
      ...input,
      duringUpdate: this.applyingDownloadedUpdate,
    });
  }

  async shutdown(): Promise<ShutdownResult> {
    if (this.shuttingDown) {
      return "clean";
    }

    this.shuttingDown = true;
    this.bootRecovery[Symbol.dispose]();
    await this.bootRecovery.quiesce(1_000);
    this.queueStatsTelemetryDebounce.cancel();
    this.commandKeyReconciler.stop();
    this.agentSessionSync.stop();
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
      agentMonitor: this.agentMonitor,
      server: this.server,
      desktopWindow: this.desktopWindow,
      tray: this.tray,
      log: (message) => gatewayLog.info("shutdown", message),
      reportFailure: (failure) =>
        Observability.desktopShutdownFailed({
          trigger: "shutdown-sequence",
          result: failure.result,
          phase: failure.phase,
          elapsedMs: failure.elapsedMs,
          error: failure.error,
          duringUpdate: this.applyingDownloadedUpdate,
        }),
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

  private async fetchAvailableCommandSigningKeys(options?: {
    requireApiKey?: boolean;
  }): Promise<OrganizationCommandPublicKey[]> {
    const apiKey = this.apiKeyStore.getApiKey();
    if (!apiKey) {
      if (options?.requireApiKey) {
        throw new Error("missing API key");
      }
      return [];
    }
    return fetchOrganizationCommandKeys({
      apiOrigin: this.settingsStore.getApiOrigin(),
      apiKey,
      apiKeyProvenance:
        this.apiKeyStore.getApiKeyProvenance() ?? "USER_CREATED",
      signDesktopRequest: (request) => this.signDesktopRequest(request),
      onDesktopPopUnavailable: (surface, reason) =>
        this.reportDesktopPopUnavailable(surface, reason),
    });
  }

  private async listCommandSigningKeys(): Promise<{
    available: OrganizationCommandPublicKey[];
    authorized: ReturnType<AuthorizedCommandKeyStore["list"]>;
    rejectedFingerprints: string[];
    serverSupported: boolean;
    enforcementEnabled: boolean;
    availableError?: string;
  }> {
    if (!this.serverCommandSigningSupported) {
      gatewayLog.info(
        "command-signing",
        "List browser command keys skipped; server support is disabled",
      );
      return {
        available: [],
        authorized: [],
        rejectedFingerprints: [],
        serverSupported: false,
        enforcementEnabled: this.settingsStore.getCommandSigningEnforcementEnabled(),
      };
    }

    const authorizedFingerprints = new Set(
      this.authorizedCommandKeys.list().map((key) => key.fingerprint),
    );
    const rejectedFingerprints = new Set(
      this.authorizedCommandKeys.listRejectedFingerprints(),
    );
    let available: OrganizationCommandPublicKey[] = [];
    let availableError: string | undefined;
    try {
      available = await this.fetchAvailableCommandSigningKeys();
    } catch (error) {
      availableError =
        error instanceof Error ? error.message : "Failed to list public keys";
    }
    return {
      available: available.filter(
        (key) =>
          !authorizedFingerprints.has(key.fingerprint) &&
          !rejectedFingerprints.has(key.fingerprint),
      ),
      authorized: this.authorizedCommandKeys.list(),
      rejectedFingerprints: [...rejectedFingerprints],
      serverSupported: this.serverCommandSigningSupported,
      enforcementEnabled: this.settingsStore.getCommandSigningEnforcementEnabled(),
      ...(availableError ? { availableError } : {}),
    };
  }

  private async getPendingCommandSigningKeysForNotification(): Promise<
    OrganizationCommandPublicKey[]
  > {
    if (!this.apiKeyStore.getApiKey()) {
      return [];
    }
    const state = await this.listCommandSigningKeys();
    if (state.availableError) {
      return [];
    }
    return state.available;
  }

  private getPendingCommandSigningKeysFromOrganizationKeys(
    organizationKeys: OrganizationCommandPublicKey[],
  ): OrganizationCommandPublicKey[] {
    const authorizedFingerprints = new Set(
      this.authorizedCommandKeys.list().map((key) => key.fingerprint),
    );
    const rejectedFingerprints = new Set(
      this.authorizedCommandKeys.listRejectedFingerprints(),
    );
    return organizationKeys.filter(
      (key) =>
        !authorizedFingerprints.has(key.fingerprint) &&
        !rejectedFingerprints.has(key.fingerprint),
    );
  }

  private async notifyPendingCommandSigningKeysForOrganizationKeys(
    organizationKeys: OrganizationCommandPublicKey[],
  ): Promise<void> {
    await this.pendingCommandKeyNotifier.notifyPendingKeys(
      this.getPendingCommandSigningKeysFromOrganizationKeys(organizationKeys),
    );
  }

  private async notifyPendingCommandSigningKeyByFingerprint(
    fingerprint: string,
  ): Promise<void> {
    await this.pendingCommandKeyNotifier.notifyPendingKeys([
      {
        fingerprint,
        ownerName: "A browser session",
      },
    ]);
  }

  private async approveOrganizationCommandPublicKey(
    fingerprint: unknown,
  ): Promise<Awaited<ReturnType<DesktopApplication["listCommandSigningKeys"]>>> {
    const trimmedFingerprint = typeof fingerprint === "string" ? fingerprint.trim() : "";
    if (!trimmedFingerprint) {
      throw new Error("fingerprint is required");
    }
    const keys = await this.fetchAvailableCommandSigningKeys();
    const key = keys.find((entry) => entry.fingerprint === trimmedFingerprint);
    if (!key) {
      throw new Error("Command signing key not found");
    }
    this.authorizedCommandKeys.authorize({
      fingerprint: key.fingerprint,
      publicKeyBase64: key.publicKeyBase64,
      ownerName: key.ownerEmail || key.ownerName || key.fingerprint,
      ...(key.ownerEmail ? { ownerEmail: key.ownerEmail } : {}),
      source: "org",
      ...(key.id ? { sourceUserPublicKeyId: key.id } : {}),
    });
    this.pendingCommandKeyNotifier.dismiss(key.fingerprint);
    const state = await this.listCommandSigningKeys();
    this.notifyCommandKeysChanged();
    return state;
  }

  private async rejectOrganizationCommandPublicKey(
    fingerprint: unknown,
  ): Promise<Awaited<ReturnType<DesktopApplication["listCommandSigningKeys"]>>> {
    const trimmedFingerprint = typeof fingerprint === "string" ? fingerprint.trim() : "";
    if (!trimmedFingerprint) {
      throw new Error("fingerprint is required");
    }
    this.authorizedCommandKeys.reject(trimmedFingerprint);
    this.pendingCommandKeyNotifier.dismiss(trimmedFingerprint);
    const state = await this.listCommandSigningKeys();
    this.notifyCommandKeysChanged();
    return state;
  }

  private onCloudSocketStatus(status: CloudSocketStatus): void {
    if (!this.cloudConnectionEnabled) {
      this.cloudStatus = {
        state: "degraded",
        error: "Cloud connection disabled by user",
      };
      this.agentSessionSync.refresh();
      this.refreshTrayState();
      return;
    }

    this.cloudStatus = status;
    this.agentSessionSync.refresh();
    const stats = this.commandExecutor.getStats();

    if (status.state === "online") {
      if (this.serverCommandSigningSupported) {
        this.commandKeyReconciler.start();
      }
      this.persistActiveConfigManagedMetadata({
        lastComputeTargetId: status.targetId,
      });
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
    this.serverCommandSigningSupported = false;
    this.commandKeyReconciler.stop();

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
      this.serverCommandSigningSupported = false;
      this.serverAgentSessionSyncSupported = false;
      this.commandKeyReconciler.stop();
      this.cloudStatus = {
        state: "degraded",
        error: "Cloud connection disabled by user",
      };
      this.agentSessionSync.refresh();
      this.refreshTrayState();
      return;
    }

    this.cloudStatus = { state: "idle" };
    this.agentSessionSync.refresh();
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
    this.serverCommandSigningSupported = false;
    this.serverAgentSessionSyncSupported = false;
    this.commandKeyReconciler.stop();
    this.agentSessionSync.refresh();
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
      completed: isDesktopSetupCompleteFromState({
        onboardingCompleted: settings.onboardingCompleted,
        sandboxBaseDirectory: settings.sandboxBaseDirectory,
        hasApiKey: this.apiKeyStore.getStatus().hasApiKey,
      }),
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
    if (!this.isDesktopSetupComplete()) {
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

    if (
      operationId === "update_and_restart" &&
      !this.settingsStore.getUpdateAndRestartEnabled()
    ) {
      return buildUpdateAndRestartDisabledResult();
    }

    const settings = this.settingsStore.getAll();
    const requestScopePath = resolveApprovalScopePath(request.body);
    const activeAlwaysAllowRules = pruneExpiredAlwaysAllowRules(
      settings.alwaysAllowRules,
    );
    if (activeAlwaysAllowRules.length !== settings.alwaysAllowRules.length) {
      this.settingsStore.setAlwaysAllowRules(activeAlwaysAllowRules);
    }
    const isForceInteractiveOperation =
      !shouldHonorAlwaysAllowRule(
        operationId,
        FORCE_INTERACTIVE_OPERATIONS as ReadonlySet<string>
      );
    if (
      !isForceInteractiveOperation &&
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
    // Force-interactive operations skip auto-approve and always go through
    // the interactive approval queue.
    if (
      !isForceInteractiveOperation &&
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

    if (decision === "always_allow" && !isForceInteractiveOperation) {
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
    ipcMain.handle("desktop:get-agent-monitor-url", () => ({
      url: this.agentMonitor.getUrl(),
      ready: this.agentMonitor.isReady(),
      enabled: this.isAgentMonitorEnabled(),
      planExtractionEnabled: this.isPlanExtractionEnabled(),
    }));
    // FEA-1334: proxy the sidecar's cold-start ingest progress so the renderer
    // can drive the floating progress card without a cross-origin fetch.
    // Returns null whenever the sidecar is not reachable — the renderer treats
    // that as "keep polling, nothing to show yet".
    ipcMain.handle("desktop:get-agent-monitor-ingest-progress", async () => {
      const baseUrl = this.agentMonitor.getUrl();
      if (!baseUrl) {
        return null;
      }
      try {
        const response = await fetch(`${baseUrl}/api/import/progress`, {
          signal: AbortSignal.timeout(2_000),
        });
        if (!response.ok) {
          return null;
        }
        return await response.json();
      } catch {
        return null;
      }
    });
    // FEA-1334: clear the dashboard DB and restart the sidecar so it
    // re-imports every agent session from scratch. The sidecar's empty-DB
    // boot path clears the persisted ingest caches and re-runs the
    // orchestrator, which the progress banner tracks.
    ipcMain.handle("desktop:reprocess-agent-logs", async () => {
      if (!this.isAgentMonitorEnabled()) {
        return { ok: false, error: "Agent Dashboard is disabled in Settings." };
      }
      try {
        await this.agentMonitor.stop();
        const agentMonitorDir = path.join(
          app.getPath("userData"),
          "agent-monitor",
        );
        for (const name of [
          "dashboard.db",
          "dashboard.db-wal",
          "dashboard.db-shm",
        ]) {
          try {
            rmSync(path.join(agentMonitorDir, name));
          } catch {
            /* file may not exist — fine */
          }
        }
        void this.agentMonitor.start();
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
    ipcMain.handle("desktop:open-agent-monitor", () =>
      this.openClaudeDashboard(),
    );
    ipcMain.handle("desktop:get-agent-monitor-hooks-enabled", () =>
      this.isAgentMonitorEnabled() && isAgentMonitorHooksEnabled(),
    );
    ipcMain.handle(
      "desktop:set-agent-monitor-hooks-enabled",
      (_event, enabled: boolean) => {
        if (!this.isAgentMonitorEnabled()) {
          return {
            ok: false,
            enabled: false,
            error: "Agent Dashboard is disabled in Settings.",
          };
        }
        return setAgentMonitorHooksEnabled(enabled === true);
      },
    );
    ipcMain.handle("desktop:get-logs", () => gatewayLog.getEntries());
    ipcMain.handle("desktop:clear-logs", () => {
      gatewayLog.clear();
    });
    ipcMain.handle("desktop:get-log-file-path", () => getMainLogFilePath());
    ipcMain.handle("desktop:open-log-file", () => openMainLogFile());

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
          updateAndRestartEnabled?: boolean;
          agentMonitorEnabled?: boolean;
          planExtractionEnabled?: boolean;
          commandSigningEnforcementEnabled?: boolean;
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
        if (typeof partial.commandSigningEnforcementEnabled === "boolean") {
          nextPartial.commandSigningEnforcementEnabled =
            partial.commandSigningEnforcementEnabled;
        }
        if (typeof partial.agentMonitorEnabled === "boolean") {
          nextPartial.agentMonitorEnabled = partial.agentMonitorEnabled;
        }
        if (typeof partial.planExtractionEnabled === "boolean") {
          nextPartial.planExtractionEnabled = partial.planExtractionEnabled;
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

        const updatesOnboardingState = (
          [
            "sandboxBaseDirectory",
            "onboardingCompleted",
            "relayOrigin",
            "apiOrigin",
            "webAppOrigin",
          ] as const
        ).some((key) => key in partial);
        if (updatesOnboardingState) {
          this.cancelManagedOnboardingForUserChange(
            "settings were updated manually",
          );
        }

        const updated = this.settingsStore.update(
          nextPartial as Partial<DesktopSettings>,
        );
        if (typeof nextPartial.verboseLogging === "boolean") {
          gatewayLog.setVerbose(nextPartial.verboseLogging);
        }
        if (
          typeof nextPartial.agentMonitorEnabled === "boolean" &&
          nextPartial.agentMonitorEnabled !== currentSettings.agentMonitorEnabled
        ) {
          await this.applyAgentMonitorSetting(nextPartial.agentMonitorEnabled);
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
      connectionSecurity: this.getConnectionSecurityStatus(),
      commandSigning: {
        serverSupported: this.serverCommandSigningSupported,
        enforcementEnabled:
          this.settingsStore.getCommandSigningEnforcementEnabled(),
        authorizedKeyCount: this.authorizedCommandKeys.list().length,
      },
      serverAlive: this.server.isAlive(),
      gatewayHealthy: this.recovery.gatewayHealthy,
    }));
    ipcMain.handle("desktop:list-command-signing-keys", async () =>
      this.listCommandSigningKeys(),
    );
    ipcMain.handle("desktop:list-authorized-keys", () =>
      this.authorizedCommandKeys.list(),
    );
    ipcMain.handle("desktop:authorize-key", (_event, payload: unknown) => {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("public key payload is required");
      }
      const input = payload as Record<string, unknown>;
      if (typeof input.publicKeyBase64 !== "string") {
        throw new Error("publicKeyBase64 is required");
      }
      this.authorizedCommandKeys.authorize({
        publicKeyBase64: input.publicKeyBase64,
        ownerName:
          typeof input.label === "string"
            ? input.label
            : typeof input.ownerName === "string"
              ? input.ownerName
              : undefined,
        ownerEmail:
          typeof input.ownerEmail === "string" ? input.ownerEmail : undefined,
        fingerprint:
          typeof input.fingerprint === "string" ? input.fingerprint : undefined,
        source: "manual",
      });
      this.notifyCommandKeysChanged();
      return this.authorizedCommandKeys.list();
    });
    ipcMain.handle("desktop:remove-authorized-key", (_event, fingerprint: string) => {
      if (typeof fingerprint !== "string" || !fingerprint.trim()) {
        throw new Error("fingerprint is required");
      }
      this.authorizedCommandKeys.remove(fingerprint);
      this.notifyCommandKeysChanged();
      return this.authorizedCommandKeys.list();
    });
    ipcMain.handle("desktop:list-org-public-keys", async () =>
      (await this.listCommandSigningKeys()).available,
    );
    ipcMain.handle(
      "desktop:approve-org-public-key",
      async (_event, fingerprint: string) => {
        return this.approveOrganizationCommandPublicKey(fingerprint);
      },
    );
    ipcMain.handle(
      "desktop:reject-org-public-key",
      (_event, fingerprint: string) => {
        return this.rejectOrganizationCommandPublicKey(fingerprint);
      },
    );
    ipcMain.handle(
      "desktop:authorize-command-signing-key",
      async (_event, fingerprint: string) => {
        return this.approveOrganizationCommandPublicKey(fingerprint);
      },
    );
    ipcMain.handle(
      "desktop:revoke-command-signing-key",
      async (_event, fingerprint: string) => {
        if (typeof fingerprint !== "string" || !fingerprint.trim()) {
          throw new Error("fingerprint is required");
        }
        this.authorizedCommandKeys.remove(fingerprint.trim());
        const state = await this.listCommandSigningKeys();
        this.notifyCommandKeysChanged();
        return state;
      },
    );
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
      this.cancelManagedOnboardingForUserChange("a manual API key was set");
      this.apiKeyStore.setApiKey(trimmed);
      this.restartCloudSocket();
      return this.apiKeyStore.getStatus();
    });
    ipcMain.handle("desktop:clear-api-key", () => {
      this.cancelManagedOnboardingForUserChange("the API key was cleared");
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
        } else {
          const onboardingAttemptId =
            typeof payload.onboardingAttemptId === "string"
              ? payload.onboardingAttemptId.trim()
              : "";
          if (onboardingAttemptId) {
            throw new Error("Automated onboarding must start from the installer handoff file.");
          }
        }

        this.cancelManagedOnboardingForUserChange("manual onboarding completed");
        if (trimmedApiKey) {
          this.apiKeyStore.setApiKey(trimmedApiKey, "USER_CREATED");
          this.persistActiveProfileKey(trimmedApiKey, "USER_CREATED");
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
    ipcMain.handle(
      "desktop:start-device-onboarding",
      async (_event, payload: { webAppOrigin?: string } | undefined) =>
        this.startDesktopFirstDeviceOnboarding(payload?.webAppOrigin),
    );
    ipcMain.handle(
      "desktop:dismiss-onboarding-popup",
      (_event, payload: { permanent?: boolean } | undefined) => {
        const permanent = payload?.permanent === true;
        if (permanent) {
          this.settingsStore.setOnboardingPopupDismissedPermanent(true);
          Observability.onboardingPopupDismissedPermanent();
        } else {
          Observability.onboardingPopupDismissedSession();
        }
        return { permanent };
      },
    );
    ipcMain.handle("desktop:onboarding-popup-cta", async () => {
      Observability.onboardingPopupCtaClicked();
      const webAppOrigin = this.settingsStore.getWebAppOrigin();
      const targetUrl = new URL(ONBOARDING_WIZARD_PATH, webAppOrigin).toString();
      await shell.openExternal(targetUrl);
      return { opened: targetUrl };
    });
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
          const resolved = await resolveBinaryFromLoginShell(name, override);
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
    const inspectSandboxPath = (
      targetPath: string,
    ): { path: string; isGitRepo: boolean; suggestedPath: string | undefined } => {
      const isGitRepo = isGitRepository(targetPath);
      let suggestedPath: string | undefined;
      if (isGitRepo) {
        const candidate = path.dirname(targetPath);
        if (candidate !== targetPath && !isRiskyAllowedDirectory(candidate)) {
          suggestedPath = candidate;
        }
      }
      return { path: targetPath, isGitRepo, suggestedPath };
    };
    ipcMain.handle("desktop:pick-sandbox-directory", async () => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return inspectSandboxPath(result.filePaths[0]);
    });
    ipcMain.handle(
      "desktop:inspect-sandbox-path",
      (_event, targetPath: unknown) => {
        if (typeof targetPath !== "string") return null;
        const trimmed = targetPath.trim();
        if (!trimmed) return null;
        return inspectSandboxPath(trimmed);
      },
    );
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
          if (
            remoteVersion != null &&
            remoteVersion !== app.getVersion() &&
            this.packagedUpdateState.status === "idle"
          ) {
            this.setPackagedUpdateState({
              status: "available",
              available: true,
              downloaded: false,
              version: remoteVersion,
            });
          }
          return this.getPackagedUpdateStatusPayload();
        }
        return await this.checkForUpdate();
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        if (app.isPackaged) {
          this.setPackagedUpdateState({
            status: "error",
            available: false,
            downloaded: false,
            error: message,
          });
          this.notifyPackagedUpdateStatus();
          Observability.electronUpdateFailed({
            trigger: "manual-check",
            status: this.packagedUpdateState.status,
            version: this.packagedUpdateState.version,
            error: message,
            downloaded: this.packagedUpdateState.downloaded,
            readyToInstall: this.packagedUpdateState.downloaded,
          });
          return this.getPackagedUpdateStatusPayload();
        }
        return {
          updateAvailable: false,
          error: message,
        };
      }
    });
    ipcMain.handle("desktop:apply-update", async () => {
      if (app.isPackaged) {
        gatewayLog.info(
          "auto-update",
          `apply-update IPC invoked status=${this.packagedUpdateState.status} downloaded=${this.packagedUpdateState.downloaded}`,
        );
        try {
          assertPackagedUpdateReadyToInstall(this.packagedUpdateState);
        } catch {
          const message = PACKAGED_UPDATE_NOT_DOWNLOADED_MESSAGE;
          gatewayLog.warn("auto-update", message);
          Observability.electronUpdateFailed({
            trigger: "apply-before-downloaded",
            status: this.packagedUpdateState.status,
            version: this.packagedUpdateState.version,
            error: message,
            downloaded: this.packagedUpdateState.downloaded,
            readyToInstall: false,
          });
          throw new Error(message);
        }

        this.applyingDownloadedUpdate = true;
        Observability.electronUpdateInitiated({
          trigger: "renderer-apply-update",
          status: this.packagedUpdateState.status,
          version: this.packagedUpdateState.version,
          downloaded: true,
          readyToInstall: true,
        });
        gatewayLog.info(
          "auto-update",
          "calling quitAndInstall(isSilent=true, isForceRunAfter=true)",
        );
        autoUpdater.quitAndInstall(true, true);
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
      let savedConfig = this.settingsStore.saveConfig(payload?.name ?? "");
      const status = this.apiKeyStore.getStatus();
      if (status.source === "safeStorage") {
        const currentApiKey = this.apiKeyStore.getApiKey() ?? "";
        if (currentApiKey) {
          const provenance =
            this.apiKeyStore.getApiKeyProvenance() ?? "USER_CREATED";
          // A new saved profile must not inherit the active profile's managed
          // signing identity. Treat copied managed keys as bearer-only until
          // that profile completes its own security upgrade.
          const profileProvenance =
            provenance === "DESKTOP_MANAGED" ? "USER_CREATED" : provenance;
          this.apiKeyStore.saveProfileKey(
            savedConfig.id,
            currentApiKey,
            profileProvenance,
          );
          const managedPatch: SavedConfigManagedPatch = {
            apiKeySource: profileProvenance,
          };
          if (provenance === "DESKTOP_MANAGED") {
            const profileGateway = this.settingsStore.ensureConfigGatewayId(
              savedConfig.id,
            );
            managedPatch.gatewayId = profileGateway.gatewayId;
            managedPatch.desktopSecurityUpgradeProtocolVersion = 1;
          }
          savedConfig = this.settingsStore.updateConfigManagedMetadata(
            savedConfig.id,
            managedPatch,
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
      const config = this.settingsStore.listConfigs().find((c) => c.id === id);
      const { wasActive } = this.settingsStore.deleteConfig(id);
      if (wasActive) {
        this.cancelManagedOnboardingForUserChange(
          "the active saved config was deleted",
        );
        this.settingsStore.setRelayOrigin(DEFAULT_DESKTOP_SETTINGS.relayOrigin);
        this.settingsStore.setApiOrigin(DEFAULT_DESKTOP_SETTINGS.apiOrigin);
        this.settingsStore.setWebAppOrigin(DEFAULT_DESKTOP_SETTINGS.webAppOrigin);
        this.cloudSocket.stop();
        this.serverCommandSigningSupported = false;
        this.serverAgentSessionSyncSupported = false;
        this.cloudStatus = { state: "idle" };
        this.agentSessionSync.refresh();
        this.apiKeyStore.clearApiKey();
        this.refreshTrayState();
      }
      this.apiKeyStore.deleteProfileKey(id);
      if (config?.gatewayId) {
        const activeRuntimeGatewayId = this.settingsStore.getActiveConfigId()
          ? null
          : this.legacyGatewayId;
        if (
          !this.settingsStore.isGatewayIdReferenced(config.gatewayId, {
            activeRuntimeGatewayId,
          })
        ) {
          this.gatewaySigningKeyStore.delete(config.gatewayId);
        }
      }
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
      this.cancelManagedOnboardingForUserChange("a saved config was applied");
      const appliedConfig = this.settingsStore.applyConfig(id);
      const profileKey = this.apiKeyStore.getProfileKeyRecord(id);
      if (profileKey) {
        const hasManagedIdentity =
          appliedConfig.gatewayId &&
          appliedConfig.gatewayPublicKeyPem &&
          profileKey.provenance === "DESKTOP_MANAGED";
        const provenance = hasManagedIdentity ? "DESKTOP_MANAGED" : "USER_CREATED";
        this.apiKeyStore.setApiKey(profileKey.apiKey, provenance);
        this.settingsStore.updateConfigManagedMetadata(id, {
          apiKeySource: provenance,
        });
      } else {
        this.apiKeyStore.clearApiKey();
        this.settingsStore.updateConfigManagedMetadata(id, {
          apiKeySource: "USER_CREATED",
        });
      }
      this.restartCloudSocket();
      return appliedConfig;
    });
  }

  private signDesktopRequest(
    request: DesktopPopSigningRequest,
  ): DesktopPopHeaders | null {
    const activeGatewayId = this.getActiveGatewayId();
    const keyPair = this.gatewaySigningKeyStore.load(activeGatewayId);
    if (!keyPair.ok) {
      throw new DesktopPopUnavailableError(keyPair.reason);
    }
    try {
      return signDesktopPopHeaders({
        ...request,
        gatewayId: activeGatewayId,
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
