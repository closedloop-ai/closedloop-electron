import { createHash, randomUUID } from "node:crypto";
import { gatewayLog } from "./gateway-logger.js";
import { io, type Socket } from "socket.io-client";
import {
  PROTOCOL_VERSION,
  type CloudSocketStatus,
  type CommandEventRecord,
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
import type { DesktopTelemetryEvent } from "./telemetry-protocol.js";

export interface CloudSocketOptions {
  getRelayOrigin: () => string;
  getApiKey: () => string | null;
  getAllowedDirectories: () => string[];
  getMaxInFlightCommands: () => number;
  machineName: string;
  pluginVersion: string;
  desktopClientVersion: string;
  gatewayProtocolVersion: string;
  supportedOperations: string[];
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
  private awaitingHelloAck = false;
  private lastPresenceState: string | null = null;
  private hadSuccessfulConnection = false;
  private degradedSince: number | null = null;
  private recoveryTimer: NodeJS.Timeout | null = null;

  constructor(options: CloudSocketOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.targetId = null;
    this.awaitingHelloAck = false;
    this.disconnectSocket();
    this.clearHelloAckTimer();

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
    this.connect(apiKey, relayOrigin);
  }

  stop(): void {
    this.stopped = true;
    this.targetId = null;
    this.awaitingHelloAck = false;
    this.lastPresenceState = null;
    this.hadSuccessfulConnection = false;
    this.degradedSince = null;
    this.clearHelloAckTimer();
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

  private connect(apiKey: string, relayOrigin: string): void {
    const socket = io(`${relayOrigin}/desktop-gateway`, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
      timeout: 10_000,
      autoConnect: false,
      auth: {
        apiKey
      }
    });
    this.socket = socket;

    socket.on("connect", () => {
      if (this.stopped) {
        return;
      }
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
    });

    socket.on("desktop.hello.ack", (payload: unknown) => {
      const event = asObject(payload);
      const computeTargetId = asNonEmptyString(event.computeTargetId);
      if (!computeTargetId) {
        gatewayLog.warn("cloud-socket", "hello.ack missing computeTargetId, ignoring");
        return;
      }

      this.targetId = computeTargetId;
      this.awaitingHelloAck = false;
      this.hadSuccessfulConnection = true;
      this.degradedSince = null;
      this.clearHelloAckTimer();
      gatewayLog.info("cloud-socket", `Hello ack received, targetId=${computeTargetId}`);
      const ackEvent: DesktopHelloAckEvent = {
        ...createEnvelope(),
        computeTargetId,
        sessionId: asNonEmptyString(event.sessionId) ?? "",
        serverTime: asNonEmptyString(event.serverTime) ?? new Date().toISOString(),
        resumeFromSequence:
          event.resumeFromSequence && typeof event.resumeFromSequence === "object"
            ? (event.resumeFromSequence as Record<string, number>)
            : undefined
      };
      this.options.onHelloAck?.(ackEvent);
      this.notifyStatus({ state: "online", targetId: computeTargetId });
      this.sendPresence({
        state: "online"
      });
    });

    socket.on("desktop.command", (payload: unknown) => {
      const parsed = parseDesktopCommand(payload);
      if (!parsed) {
        gatewayLog.warn("cloud-socket", "Received unparseable desktop.command, ignoring");
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
    const hello: DesktopHelloEvent = {
      ...createEnvelope(),
      computeTargetId: this.targetId ?? undefined,
      machineName: this.options.machineName,
      platform: process.platform,
      pluginVersion: this.options.pluginVersion,
      desktopClientVersion: this.options.desktopClientVersion,
      gatewayProtocolVersion: this.options.gatewayProtocolVersion,
      supportedOperations: this.options.supportedOperations,
      maxInFlightCommands: Math.max(1, this.options.getMaxInFlightCommands()),
      allowedDirectoriesHash: hashAllowedDirectories(this.options.getAllowedDirectories())
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

  private disconnectSocket(): void {
    if (!this.socket) {
      return;
    }
    this.awaitingHelloAck = false;
    this.clearHelloAckTimer();

    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
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

type EnvelopeOnlyFields = ProtocolEnvelope;

const HELLO_ACK_TIMEOUT_MS = 10_000;
const RECOVERY_TIMEOUT_MS = 2 * 60_000;
const RECOVERY_CHECK_INTERVAL_MS = 30_000;

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
    approvalReason: asNonEmptyString(event.approvalReason) ?? undefined
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
