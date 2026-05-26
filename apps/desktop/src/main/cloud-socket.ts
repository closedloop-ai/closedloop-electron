import { createHash, randomUUID } from "node:crypto";
import { gatewayLog } from "./gateway-logger.js";
import { io, type Socket } from "socket.io-client";
import {
  PROTOCOL_VERSION,
  type CloudSocketStatus,
  type CommandEventRecord,
  type DesktopAgentSessionsAck,
  DesktopAgentSessionsAckReason,
  type DesktopAgentSessionsEvent,
  DESKTOP_AGENT_SESSIONS_SOCKET_EVENT,
  type DesktopAnalyticsAck,
  DesktopAnalyticsAckReason,
  type DesktopAnalyticsEvent,
  DESKTOP_ANALYTICS_SOCKET_EVENT,
  type DesktopCancelEvent,
  type DesktopCommandAckEvent,
  type DesktopCommandEvent,
  type DesktopCommandStreamAckEvent,
  type DesktopCommandStreamEvent,
  type DesktopHelloAckEvent,
  type DesktopHelloEvent,
  type DesktopPresenceEvent,
  type ProtocolEnvelope
} from "./cloud-protocol.js";
import { normalizeAndValidateOrigin } from "./origin-policy.js";
import type { ApiKeyProvenance } from "./api-key-store.js";
import {
  buildManagedDesktopPopHeaders,
  type DesktopPopUnavailableReporter,
} from "./desktop-pop-sign-utils.js";
import {
  RELAY_API_KEY_VERIFY_PATH,
  type DesktopPopHeaders,
  type DesktopPopSigner,
} from "./desktop-pop.js";
import type { DesktopTelemetryEvent } from "./telemetry-protocol.js";

export interface CloudSocketOptions {
  getRelayOrigin: () => string;
  getApiKey: () => string | null;
  getApiKeyProvenance?: () => ApiKeyProvenance | null;
  signDesktopRequest?: DesktopPopSigner;
  onDesktopPopUnavailable?: DesktopPopUnavailableReporter;
  getAllowedDirectories: () => string[];
  getCapabilities?: () => Record<string, unknown>;
  getMaxInFlightCommands: () => number;
  getGatewayId?: () => string | null;
  machineName: string;
  pluginVersion: string;
  desktopClientVersion: string;
  gatewayProtocolVersion: string;
  getEnabledOperations: () => string[];
  onStatusChange?: (status: CloudSocketStatus) => void;
  onHelloAck?: (event: DesktopHelloAckEvent) => void;
  onCommand?: (event: DesktopCommandEvent) => void;
  onCancel?: (event: DesktopCancelEvent) => void;
  onCommandEventAck?: (event: DesktopCommandStreamAckEvent) => void;
  onDisconnect?: (reason: string) => void;
}

export class CloudSocketService {
  private readonly options: CloudSocketOptions;
  private socket: Socket | null = null;
  private stopped = true;
  private targetId: string | null = null;
  private helloAckTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private awaitingHelloAck = false;
  private lastPresenceState: string | null = null;
  private hadSuccessfulConnection = false;
  private degradedSince: number | null = null;
  private recoveryTimer: NodeJS.Timeout | null = null;
  private analyticsDisabledForSession = false;
  private agentSessionsDisabledForSession = false;
  private analyticsQueue: QueuedAnalyticsEvent[] = [];
  private readonly analyticsInFlight = new Set<Promise<void>>();

  constructor(options: CloudSocketOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.targetId = null;
    this.awaitingHelloAck = false;
    this.disconnectSocket();
    this.clearHelloAckTimer();
    this.clearReconnectTimer();

    const apiKey = this.options.getApiKey();
    if (!apiKey) {
      this.notifyStatus({ state: "degraded", error: "Missing API key for cloud socket connection" });
      return;
    }

    let relayOrigin: string;
    try {
      relayOrigin = normalizeAndValidateOrigin(this.options.getRelayOrigin());
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid relay origin";
      this.notifyStatus({ state: "degraded", error: message });
      return;
    }

    this.notifyStatus({ state: "idle" });
    const relayValidationPopHeaders = await buildRelayValidationPopHeaders(
      this.options.getApiKeyProvenance?.() ?? "USER_CREATED",
      this.options.signDesktopRequest,
      this.options.onDesktopPopUnavailable,
    );
    if (this.stopped) {
      return;
    }
    this.connect(apiKey, relayOrigin, relayValidationPopHeaders);
  }

  stop(): void {
    this.stopped = true;
    this.targetId = null;
    this.awaitingHelloAck = false;
    this.lastPresenceState = null;
    this.hadSuccessfulConnection = false;
    this.degradedSince = null;
    this.analyticsDisabledForSession = false;
    this.agentSessionsDisabledForSession = false;
    this.clearHelloAckTimer();
    this.clearReconnectTimer();
    this.clearRecoveryTimer();
    this.disconnectSocket();
  }

  restart(): void {
    this.stop();
    void this.start();
  }

  sendTelemetry(event: Omit<DesktopTelemetryEvent, keyof EnvelopeOnlyFields>): void {
    this.emit("desktop.telemetry", event);
  }

  emitAnalytics(event: Omit<DesktopAnalyticsEvent, keyof EnvelopeOnlyFields>): void {
    if (this.analyticsDisabledForSession) {
      return;
    }
    if (!this.isRelayReady()) {
      this.queueAnalyticsEvent(event);
      return;
    }
    this.trackAnalyticsSend(this.sendAnalyticsNow(event));
  }

  async sendAgentSessions(
    event: Omit<DesktopAgentSessionsEvent, keyof EnvelopeOnlyFields>,
  ): Promise<DesktopAgentSessionsAck> {
    if (this.agentSessionsDisabledForSession) {
      return {
        accepted: false,
        reason: DesktopAgentSessionsAckReason.FeatureDisabled,
      };
    }
    if (!this.isRelayReady()) {
      return {
        accepted: false,
        reason: DesktopAgentSessionsAckReason.RateLimited,
      };
    }

    const socket = this.socket;
    if (!socket?.connected) {
      return {
        accepted: false,
        reason: DesktopAgentSessionsAckReason.RateLimited,
      };
    }

    const payload = {
      ...createEnvelope(),
      ...event,
    };

    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        gatewayLog.debug(
          "cloud-socket",
          "desktop.agent-sessions ack timed out; will retry later",
        );
        resolve({
          accepted: false,
          reason: DesktopAgentSessionsAckReason.AckTimeout,
        });
      }, AGENT_SESSIONS_ACK_TIMEOUT_MS);

      socket.emit(
        DESKTOP_AGENT_SESSIONS_SOCKET_EVENT,
        payload,
        (ack: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          const parsedAck = parseDesktopAgentSessionsAck(ack);
          if (
            parsedAck.accepted === false &&
            parsedAck.reason === DesktopAgentSessionsAckReason.FeatureDisabled
          ) {
            this.agentSessionsDisabledForSession = true;
          }
          resolve(parsedAck);
        },
      );
    });
  }

  async flushAnalytics(options: { timeoutMs: number }): Promise<void> {
    this.drainAnalyticsQueue();
    if (this.analyticsInFlight.size === 0) {
      return;
    }
    await Promise.race([
      Promise.allSettled([...this.analyticsInFlight]).then(() => undefined),
      delay(options.timeoutMs),
    ]);
  }

  sendCommandAck(event: Omit<DesktopCommandAckEvent, keyof EnvelopeOnlyFields>): void {
    this.emit("desktop.command.ack", event);
  }

  sendCommandEvent(event: Omit<DesktopCommandStreamEvent, keyof EnvelopeOnlyFields>): void {
    this.emit("desktop.command.event", event);
  }

  sendPresence(
    event: Omit<DesktopPresenceEvent, keyof EnvelopeOnlyFields | "state"> & {
      state: DesktopPresenceEvent["state"];
    }
  ): void {
    if (event.state !== this.lastPresenceState) {
      gatewayLog.debug("cloud-socket", `Sending presence: state=${event.state}`);
      this.lastPresenceState = event.state;
    }
    this.emit("desktop.presence", event);
  }

  replayEvents(commandId: string, events: readonly CommandEventRecord[], fromSequence: number): void {
    for (const event of events) {
      if (event.sequence <= fromSequence) {
        continue;
      }
      this.sendCommandEvent({
        commandId,
        sequence: event.sequence,
        eventType: event.eventType,
        data: event.data
      });
    }
  }

  private connect(
    apiKey: string,
    relayOrigin: string,
    relayValidationPopHeaders?: DesktopPopHeaders,
  ): void {
    const socket = io(`${relayOrigin}/desktop-gateway`, {
      transports: ["websocket"],
      reconnection: false,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
      timeout: 10_000,
      autoConnect: false,
      auth: {
        apiKey
      },
      ...(relayValidationPopHeaders ? { extraHeaders: relayValidationPopHeaders } : {})
    });
    this.socket = socket;

    socket.on("connect", () => {
      if (this.stopped) {
        return;
      }
      this.clearReconnectTimer();
      gatewayLog.info("cloud-socket", "Connected to relay, sending hello handshake");
      this.awaitingHelloAck = true;
      this.emitHello();
      this.scheduleHelloAckTimeout();
    });

    socket.on("connect_error", (error) => {
      if (this.stopped) {
        return;
      }
      this.awaitingHelloAck = false;
      this.clearHelloAckTimer();
      const message = error instanceof Error ? error.message : "connection failed";
      if (!this.hadSuccessfulConnection && looksLikeAuthError(error)) {
        gatewayLog.error("cloud-socket", "Authentication failed on connect");
        this.notifyStatus({
          state: "degraded",
          error: "Authentication failed -- verify your API key in Settings"
        });
      } else {
        gatewayLog.error("cloud-socket", `Connection error: ${message}`);
        this.notifyStatus({ state: "degraded", error: `Cloud socket connection failed: ${message}` });
      }
      this.degradedSince ??= Date.now();
      this.scheduleSocketReconnect(socket);
    });

    socket.on("disconnect", (reason) => {
      if (this.stopped) {
        return;
      }
      gatewayLog.warn("cloud-socket", `Disconnected: ${reason}`);
      this.awaitingHelloAck = false;
      this.clearHelloAckTimer();
      this.notifyStatus({ state: "degraded", error: `Cloud socket disconnected: ${reason}` });
      this.degradedSince ??= Date.now();
      this.options.onDisconnect?.(reason);
      this.scheduleSocketReconnect(socket);
    });

    socket.on("desktop.hello.ack", (payload: unknown) => {
      const event = asObject(payload);
      const ackEvent = parseDesktopHelloAck(payload);
      if (!ackEvent) {
        gatewayLog.warn("cloud-socket", "hello.ack missing computeTargetId, ignoring");
        return;
      }

      this.targetId = ackEvent.computeTargetId;
      this.awaitingHelloAck = false;
      this.hadSuccessfulConnection = true;
      this.degradedSince = null;
      this.clearHelloAckTimer();
      const rawServerCapabilities = asObject(event.serverCapabilities);
      const parsedServerCapabilities = parseServerCapabilities(
        event.serverCapabilities,
      );
      const rawComputeTargetSigning =
        rawServerCapabilities.computeTargetSigning;
      const rawAgentSessionSync = rawServerCapabilities.agentSessionSync;
      gatewayLog.info(
        "cloud-socket",
        `Hello ack received, targetId=${ackEvent.computeTargetId}, serverCapabilityKeys=${formatObjectKeysForLog(rawServerCapabilities)}, computeTargetSigning=${formatPrimitiveForLog(rawComputeTargetSigning)}, parsedComputeTargetSigning=${parsedServerCapabilities?.computeTargetSigning === true}, agentSessionSync=${formatPrimitiveForLog(rawAgentSessionSync)}, parsedAgentSessionSync=${parsedServerCapabilities?.agentSessionSync === true}`,
      );
      this.options.onHelloAck?.(ackEvent);
      this.notifyStatus({ state: "online", targetId: ackEvent.computeTargetId });
      this.sendPresence({
        state: "online"
      });
      this.drainAnalyticsQueue();
    });

    socket.on("desktop.command", (payload: unknown) => {
      const parsed = parseDesktopCommand(payload);
      if (!parsed) {
        const rawPath = asNonEmptyString(asObject(payload).path);
        if (rawPath?.startsWith("/api/engineer/")) {
          gatewayLog.warn("cloud-socket", `Received legacy /api/engineer/ command (${rawPath}), ignoring — desktop only accepts /api/gateway/ commands`);
        } else {
          gatewayLog.warn("cloud-socket", "Received unparseable desktop.command, ignoring");
        }
        return;
      }
      gatewayLog.debug("cloud-socket", `Command received: ${parsed.operationId} ${parsed.method} ${parsed.path} (commandId=${parsed.commandId})`);
      this.options.onCommand?.(parsed);
    });

    socket.on("desktop.cancel", (payload: unknown) => {
      const event = asObject(payload);
      const commandId = asNonEmptyString(event.commandId);
      if (!commandId) {
        return;
      }
      this.options.onCancel?.({
        ...createEnvelope(),
        commandId,
        reason: asNonEmptyString(event.reason) ?? undefined
      });
    });

    socket.on("desktop.command.event.ack", (payload: unknown) => {
      const event = asObject(payload);
      const commandId = asNonEmptyString(event.commandId);
      const sequence = asFiniteInteger(event.sequence);
      if (!commandId || sequence === null) {
        return;
      }
      this.options.onCommandEventAck?.({
        ...createEnvelope(),
        commandId,
        sequence
      });
    });

    socket.connect();
    this.startRecoveryTimer();
  }

  private emitHello(): void {
    const gatewayId = this.options.getGatewayId?.() ?? undefined;
    const hello: DesktopHelloEvent = {
      ...createEnvelope(),
      computeTargetId: this.targetId ?? undefined,
      gatewayId,
      ...(gatewayId ? { desktopSecurityUpgradeProtocolVersion: 1 as const } : {}),
      machineName: this.options.machineName,
      platform: process.platform,
      pluginVersion: this.options.pluginVersion,
      desktopClientVersion: this.options.desktopClientVersion,
      gatewayProtocolVersion: this.options.gatewayProtocolVersion,
      supportedOperations: this.options.getEnabledOperations(),
      maxInFlightCommands: Math.max(1, this.options.getMaxInFlightCommands()),
      allowedDirectoriesHash: hashAllowedDirectories(this.options.getAllowedDirectories()),
      ...(this.options.getCapabilities
        ? { capabilities: this.options.getCapabilities() }
        : {})
    };
    this.socket?.emit("desktop.hello", hello);
  }

  private emit(name: string, event: Record<string, unknown>): void {
    if (!this.socket || !this.socket.connected) {
      return;
    }
    this.socket.emit(name, {
      ...createEnvelope(),
      ...event
    });
  }

  private isRelayReady(): boolean {
    return Boolean(
      this.socket?.connected &&
        this.targetId &&
        !this.awaitingHelloAck &&
        !this.stopped,
    );
  }

  private queueAnalyticsEvent(
    event: Omit<DesktopAnalyticsEvent, keyof EnvelopeOnlyFields>,
  ): void {
    const now = Date.now();
    this.analyticsQueue = this.analyticsQueue.filter(
      (entry) => entry.expiresAt > now,
    );
    while (this.analyticsQueue.length >= ANALYTICS_QUEUE_MAX) {
      this.analyticsQueue.shift();
    }
    this.analyticsQueue.push({
      event,
      expiresAt: now + ANALYTICS_QUEUE_TTL_MS,
    });
  }

  private drainAnalyticsQueue(): void {
    if (!this.isRelayReady() || this.analyticsDisabledForSession) {
      return;
    }
    const now = Date.now();
    const ready = this.analyticsQueue.filter((entry) => entry.expiresAt > now);
    this.analyticsQueue = [];
    for (const entry of ready) {
      if (this.analyticsDisabledForSession || !this.isRelayReady()) {
        this.queueAnalyticsEvent(entry.event);
        continue;
      }
      this.trackAnalyticsSend(this.sendAnalyticsNow(entry.event));
    }
  }

  private sendAnalyticsNow(
    event: Omit<DesktopAnalyticsEvent, keyof EnvelopeOnlyFields>,
  ): Promise<void> {
    const socket = this.socket;
    if (!socket?.connected) {
      this.queueAnalyticsEvent(event);
      return Promise.resolve();
    }
    const payload = {
      ...createEnvelope(),
      ...event,
    };
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        gatewayLog.debug(
          "cloud-socket",
          "desktop.analytics ack timed out; dropping best-effort event",
        );
        resolve();
      }, ANALYTICS_ACK_TIMEOUT_MS);

      socket.emit(DESKTOP_ANALYTICS_SOCKET_EVENT, payload, (ack: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.handleAnalyticsAck(parseDesktopAnalyticsAck(ack));
        resolve();
      });
    });
  }

  private handleAnalyticsAck(ack: DesktopAnalyticsAck): void {
    if (ack.accepted) {
      return;
    }
    if (ack.reason === DesktopAnalyticsAckReason.FeatureDisabled) {
      this.analyticsDisabledForSession = true;
      this.analyticsQueue = [];
      return;
    }
    gatewayLog.debug(
      "cloud-socket",
      `desktop.analytics rejected: reason=${ack.reason}`,
    );
  }

  private trackAnalyticsSend(send: Promise<void>): void {
    this.analyticsInFlight.add(send);
    void send.finally(() => {
      this.analyticsInFlight.delete(send);
    });
  }

  private disconnectSocket(): void {
    if (!this.socket) {
      return;
    }
    this.awaitingHelloAck = false;
    this.clearHelloAckTimer();
    this.clearReconnectTimer();

    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
  }

  private scheduleSocketReconnect(socket: Socket): void {
    if (this.reconnectTimer || this.stopped) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnectSocket(socket);
    }, RECONNECT_DELAY_MS);
  }

  private async reconnectSocket(socket: Socket): Promise<void> {
    if (this.stopped || this.socket !== socket) {
      return;
    }
    await refreshRelayValidationPopHeadersForSocket(
      socket,
      this.options.getApiKeyProvenance?.() ?? "USER_CREATED",
      this.options.signDesktopRequest,
      this.options.onDesktopPopUnavailable,
    );
    if (this.stopped || this.socket !== socket) {
      return;
    }
    socket.connect();
  }

  private scheduleHelloAckTimeout(): void {
    this.clearHelloAckTimer();
    this.helloAckTimer = setTimeout(() => {
      if (this.stopped || !this.awaitingHelloAck) {
        return;
      }
      gatewayLog.warn("cloud-socket", "Hello ack timeout -- retrying handshake");
      this.notifyStatus({
        state: "degraded",
        error: "Connected to cloud socket but did not receive desktop.hello.ack"
      });
      if (this.socket?.connected) {
        this.emitHello();
        this.scheduleHelloAckTimeout();
      }
    }, HELLO_ACK_TIMEOUT_MS);
  }

  private clearHelloAckTimer(): void {
    if (!this.helloAckTimer) {
      return;
    }
    clearTimeout(this.helloAckTimer);
    this.helloAckTimer = null;
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) {
      return;
    }
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private startRecoveryTimer(): void {
    this.clearRecoveryTimer();
    this.recoveryTimer = setInterval(() => {
      if (this.stopped || !this.degradedSince) {
        return;
      }
      const elapsed = Date.now() - this.degradedSince;
      if (elapsed >= RECOVERY_TIMEOUT_MS) {
        gatewayLog.warn("cloud-socket", `Degraded for ${Math.round(elapsed / 1000)}s, forcing reconnect`);
        this.restart();
      }
    }, RECOVERY_CHECK_INTERVAL_MS);
  }

  private clearRecoveryTimer(): void {
    if (!this.recoveryTimer) {
      return;
    }
    clearInterval(this.recoveryTimer);
    this.recoveryTimer = null;
  }

  private notifyStatus(status: CloudSocketStatus): void {
    this.options.onStatusChange?.(status);
  }
}

/**
 * Builds PoP headers for the relay's API-key verification request only when using a managed key.
 */
export async function buildRelayValidationPopHeaders(
  apiKeyProvenance: ApiKeyProvenance,
  signDesktopRequest?: DesktopPopSigner,
  onUnavailable?: DesktopPopUnavailableReporter,
): Promise<DesktopPopHeaders | undefined> {
  return buildManagedDesktopPopHeaders({
    apiKeyProvenance,
    signDesktopRequest,
    request: {
      method: "POST",
      pathname: RELAY_API_KEY_VERIFY_PATH,
    },
    surface: RELAY_API_KEY_VERIFY_PATH,
    unavailableMessage: "PoP signing unavailable for relay validation; continuing bearer-only compatibility mode",
    onUnavailable,
  });
}

/**
 * Refreshes Socket.IO Engine extraHeaders before a manual reconnect attempt.
 */
export async function refreshRelayValidationPopHeadersForSocket(
  socket: Socket,
  apiKeyProvenance: ApiKeyProvenance,
  signDesktopRequest?: DesktopPopSigner,
  onUnavailable?: DesktopPopUnavailableReporter,
): Promise<void> {
  const headers = await buildRelayValidationPopHeaders(
    apiKeyProvenance,
    signDesktopRequest,
    onUnavailable,
  );
  if (headers) {
    socket.io.opts.extraHeaders = headers;
  } else {
    delete socket.io.opts.extraHeaders;
  }
}

type EnvelopeOnlyFields = ProtocolEnvelope;

const HELLO_ACK_TIMEOUT_MS = 10_000;
const RECONNECT_DELAY_MS = 1_000;
const RECOVERY_TIMEOUT_MS = 2 * 60_000;
const RECOVERY_CHECK_INTERVAL_MS = 30_000;
const ANALYTICS_QUEUE_MAX = 200;
const ANALYTICS_QUEUE_TTL_MS = 15 * 60_000;
const ANALYTICS_ACK_TIMEOUT_MS = 1_500;
const AGENT_SESSIONS_ACK_TIMEOUT_MS = 30_000;

type QueuedAnalyticsEvent = {
  event: Omit<DesktopAnalyticsEvent, keyof EnvelopeOnlyFields>;
  expiresAt: number;
};

function createEnvelope() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    messageId: randomUUID(),
    timestamp: new Date().toISOString()
  };
}

function hashAllowedDirectories(directories: string[]): string {
  const canonical = [...directories].sort();
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function parseDesktopCommand(payload: unknown): DesktopCommandEvent | null {
  const event = asObject(payload);
  const commandId = asNonEmptyString(event.commandId);
  const operationId = asNonEmptyString(event.operationId);
  const method = asMethod(event.method);
  const path = asNonEmptyString(event.path);
  if (!commandId || !operationId || !method || !path || !path.startsWith("/api/gateway/")) {
    return null;
  }

  return {
    ...createEnvelope(),
    commandId,
    operationId,
    method,
    path,
    headers: asStringRecord(event.headers) ?? undefined,
    query: asQueryRecord(event.query) ?? undefined,
    body: event.body,
    timeoutMs: asFiniteInteger(event.timeoutMs) ?? undefined,
    queuedAt: asNonEmptyString(event.queuedAt) ?? undefined,
    lockKey: asNonEmptyString(event.lockKey) ?? undefined,
    requiresApproval: Boolean(event.requiresApproval),
    approvalReason: asNonEmptyString(event.approvalReason) ?? undefined,
    ...(asNonEmptyString(event.signature)
      ? { signature: asNonEmptyString(event.signature)! }
      : {}),
    ...(asNonEmptyString(event.signaturePayload)
      ? { signaturePayload: asNonEmptyString(event.signaturePayload)! }
      : {}),
    ...(asNonEmptyString(event.publicKeyFingerprint)
      ? {
          publicKeyFingerprint:
            asNonEmptyString(event.publicKeyFingerprint)!,
        }
      : {})
  };
}

/**
 * Parses server-advertised Desktop capabilities. Only an explicit boolean true
 * enables command-signing enforcement; missing, false, or malformed values
 * preserve legacy unsigned command compatibility.
 */
export function parseServerCapabilities(value: unknown):
  | { computeTargetSigning?: boolean; agentSessionSync?: boolean }
  | undefined {
  const record = asObject(value);
  const parsed: {
    computeTargetSigning?: boolean;
    agentSessionSync?: boolean;
  } = {};
  if (record.computeTargetSigning === true) {
    parsed.computeTargetSigning = true;
  }
  if (record.agentSessionSync === true) {
    parsed.agentSessionSync = true;
  }
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

export function parseDesktopHelloAck(
  payload: unknown,
): DesktopHelloAckEvent | null {
  const event = asObject(payload);
  const computeTargetId = asNonEmptyString(event.computeTargetId);
  if (!computeTargetId) {
    return null;
  }
  const parsedServerCapabilities = parseServerCapabilities(
    event.serverCapabilities,
  );

  return {
    ...createEnvelope(),
    computeTargetId,
    sessionId: asNonEmptyString(event.sessionId) ?? "",
    serverTime: asNonEmptyString(event.serverTime) ?? new Date().toISOString(),
    ...(parsedServerCapabilities
      ? { serverCapabilities: parsedServerCapabilities }
      : {}),
    resumeFromSequence:
      event.resumeFromSequence && typeof event.resumeFromSequence === "object"
        ? (event.resumeFromSequence as Record<string, number>)
        : undefined
  };
}

export function parseDesktopAnalyticsAck(
  payload: unknown,
): DesktopAnalyticsAck {
  const event = asObject(payload);
  if (event.accepted === true) {
    return { accepted: true };
  }
  if (
    event.reason === DesktopAnalyticsAckReason.FeatureDisabled ||
    event.reason === DesktopAnalyticsAckReason.RateLimited ||
    event.reason === DesktopAnalyticsAckReason.ValidationFailed
  ) {
    return { accepted: false, reason: event.reason };
  }
  return {
    accepted: false,
    reason: DesktopAnalyticsAckReason.ValidationFailed,
  };
}

export function parseDesktopAgentSessionsAck(
  payload: unknown,
): DesktopAgentSessionsAck {
  const event = asObject(payload);
  if (event.accepted === true) {
    return { accepted: true };
  }
  if (
    event.reason === DesktopAgentSessionsAckReason.FeatureDisabled ||
    event.reason === DesktopAgentSessionsAckReason.RateLimited ||
    event.reason === DesktopAgentSessionsAckReason.ValidationFailed
  ) {
    return { accepted: false, reason: event.reason };
  }
  return {
    accepted: false,
    reason: DesktopAgentSessionsAckReason.RateLimited,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formatObjectKeysForLog(value: Record<string, unknown>): string {
  const keys = Object.keys(value).sort();
  return keys.length > 0 ? keys.join(",") : "none";
}

function formatPrimitiveForLog(value: unknown): string {
  if (
    value === null ||
    ["boolean", "number", "string", "undefined"].includes(typeof value)
  ) {
    return String(value);
  }
  return typeof value;
}

function asFiniteInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.trunc(value);
  return rounded >= 0 ? rounded : null;
}

function asMethod(value: unknown): DesktopCommandEvent["method"] | null {
  if (typeof value !== "string") {
    return null;
  }
  const method = value.toUpperCase();
  if (
    method === "GET" ||
    method === "POST" ||
    method === "PUT" ||
    method === "PATCH" ||
    method === "DELETE"
  ) {
    return method;
  }
  return null;
}

function asStringRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      out[key] = entry;
    }
  }
  return out;
}

function asQueryRecord(value: unknown): Record<string, string | string[]> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const out: Record<string, string | string[]> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      out[key] = entry;
      continue;
    }
    if (Array.isArray(entry) && entry.every((item) => typeof item === "string")) {
      out[key] = [...entry];
    }
  }
  return out;
}

const AUTH_ERROR_MESSAGE_PATTERN = /\b(unauthorized|forbidden)\b/i;

function looksLikeAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const data = (error as Error & { data?: unknown }).data;
  // Structured status codes from the server are the most reliable signal
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const statusCode =
      typeof record.statusCode === "number"
        ? record.statusCode
        : typeof record.status === "number"
          ? record.status
          : 0;
    if (statusCode === 401 || statusCode === 403) {
      return true;
    }
  }
  // Fall back to message matching, but only for explicit auth keywords
  // (excludes "token" which appears in engine.io transport messages)
  if (AUTH_ERROR_MESSAGE_PATTERN.test(error.message)) {
    return true;
  }
  if (typeof data === "string" && AUTH_ERROR_MESSAGE_PATTERN.test(data)) {
    return true;
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
