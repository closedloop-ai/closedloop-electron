import { createHash, randomUUID } from "node:crypto";
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
  type DesktopPresenceEvent
} from "./cloud-protocol.js";
import { normalizeAndValidateApiOrigin } from "./origin-policy.js";

export interface CloudSocketOptions {
  getApiOrigin: () => string;
  getApiKey: () => string | null;
  getAllowedDirectories: () => string[];
  getMaxInFlightCommands: () => number;
  machineName: string;
  pluginVersion: string;
  supportedOperations: string[];
  onStatusChange?: (status: CloudSocketStatus) => void;
  onHelloAck?: (event: DesktopHelloAckEvent) => void;
  onCommand?: (event: DesktopCommandEvent) => void;
  onCancel?: (event: DesktopCancelEvent) => void;
  onCommandEventAck?: (event: DesktopCommandStreamAckEvent) => void;
}

export class CloudSocketService {
  private readonly options: CloudSocketOptions;
  private socket: Socket | null = null;
  private stopped = true;
  private targetId: string | null = null;
  private helloAckTimer: NodeJS.Timeout | null = null;
  private awaitingHelloAck = false;

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

    let apiOrigin: string;
    try {
      apiOrigin = normalizeAndValidateApiOrigin(this.options.getApiOrigin());
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid API origin";
      this.notifyStatus({ state: "degraded", error: message });
      return;
    }

    this.notifyStatus({ state: "idle" });
    this.connect(apiKey, apiOrigin);
  }

  stop(): void {
    this.stopped = true;
    this.targetId = null;
    this.awaitingHelloAck = false;
    this.clearHelloAckTimer();
    this.disconnectSocket();
  }

  restart(): void {
    this.stop();
    void this.start();
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

  private connect(apiKey: string, apiOrigin: string): void {
    const socket = io(`${apiOrigin}/desktop-gateway`, {
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
      this.notifyStatus({ state: "degraded", error: `Cloud socket connection failed: ${message}` });
    });

    socket.on("disconnect", (reason) => {
      if (this.stopped) {
        return;
      }
      this.awaitingHelloAck = false;
      this.clearHelloAckTimer();
      this.notifyStatus({ state: "degraded", error: `Cloud socket disconnected: ${reason}` });
    });

    socket.on("desktop.hello.ack", (payload: unknown) => {
      const event = asObject(payload);
      const computeTargetId = asNonEmptyString(event.computeTargetId);
      if (!computeTargetId) {
        return;
      }

      this.targetId = computeTargetId;
      this.awaitingHelloAck = false;
      this.clearHelloAckTimer();
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
        return;
      }
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
  }

  private emitHello(): void {
    const hello: DesktopHelloEvent = {
      ...createEnvelope(),
      computeTargetId: this.targetId ?? undefined,
      machineName: this.options.machineName,
      platform: process.platform,
      pluginVersion: this.options.pluginVersion,
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

  private notifyStatus(status: CloudSocketStatus): void {
    this.options.onStatusChange?.(status);
  }
}

type EnvelopeOnlyFields = {
  protocolVersion: string;
  messageId: string;
  timestamp: string;
};

const HELLO_ACK_TIMEOUT_MS = 10_000;

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
  if (!commandId || !operationId || !method || !path || !path.startsWith("/api/engineer/")) {
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
