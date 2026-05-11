export type CloudSocketStatus =
  | { state: "idle" }
  | { state: "online"; targetId: string }
  | { state: "degraded"; error: string };

export type ProtocolVersion = "1";

export const PROTOCOL_VERSION: ProtocolVersion = "1";

export interface ProtocolEnvelope {
  protocolVersion: ProtocolVersion;
  messageId: string;
  timestamp: string;
}

export interface DesktopHelloEvent extends ProtocolEnvelope {
  computeTargetId?: string;
  gatewayId?: string;
  desktopSecurityUpgradeProtocolVersion?: 1;
  machineName: string;
  platform: NodeJS.Platform;
  pluginVersion: string;
  /** Electron app version (from app.getVersion()), distinct from the gateway wire protocol version. */
  desktopClientVersion: string;
  /**
   * Gateway wire-protocol version (e.g. "0.1.0"), distinct from ProtocolEnvelope.protocolVersion
   * which identifies the Socket.IO envelope schema version ("1", "2", …).
   */
  gatewayProtocolVersion: string;
  supportedOperations: string[];
  maxInFlightCommands: number;
  allowedDirectoriesHash: string;
  capabilities?: Record<string, unknown>;
}

export interface DesktopHelloAckEvent extends ProtocolEnvelope {
  computeTargetId: string;
  sessionId: string;
  serverTime: string;
  /** Gateway-owner Clerk identity supplied by the Desktop hello-ack producer. */
  clerkUserId?: string;
  /** Gateway-owner organization context supplied with `clerkUserId` when known. */
  organizationId?: string;
  resumeFromSequence?: Record<string, number>;
  serverCapabilities?: {
    computeTargetSigning?: boolean;
  };
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface DesktopCommandEvent extends ProtocolEnvelope {
  commandId: string;
  operationId: string;
  method: HttpMethod;
  path: string;
  headers?: Record<string, string>;
  query?: Record<string, string | string[]>;
  body?: unknown;
  timeoutMs?: number;
  queuedAt?: string;
  lockKey?: string;
  requiresApproval?: boolean;
  approvalReason?: string;
  signature?: string;
  signaturePayload?: string;
  publicKeyFingerprint?: string;
}

export interface DesktopCommandAckEvent extends ProtocolEnvelope {
  commandId: string;
  accepted: boolean;
  state?: "accepted" | "failed";
  reason?: string;
}

export type CommandStreamEventType = "status" | "chunk" | "result" | "error" | "done";

export interface DesktopCommandStreamEvent extends ProtocolEnvelope {
  commandId: string;
  sequence: number;
  eventType: CommandStreamEventType;
  data: unknown;
}

export interface DesktopCommandStreamAckEvent extends ProtocolEnvelope {
  commandId: string;
  sequence: number;
}

export interface DesktopCancelEvent extends ProtocolEnvelope {
  commandId: string;
  reason?: string;
}

export interface DesktopPresenceEvent extends ProtocolEnvelope {
  state: "online" | "degraded" | "paused";
  error?: string;
  activeCommands?: number;
  queueDepth?: number;
}

export interface CommandEventRecord {
  sequence: number;
  eventType: CommandStreamEventType;
  data: unknown;
}
