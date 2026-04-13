import type { ProtocolEnvelope } from "./cloud-protocol.js";

// Constants for log tail collection
export const TELEMETRY_LOG_TAIL_LINES = 50;
export const TELEMETRY_LOG_TAIL_MAX_BYTES = 32_768; // 32 KiB
export const TELEMETRY_MAX_FIELD_BYTES = 4_096; // 4 KiB

export type TelemetrySeverity = "info" | "warn" | "error";

export type TelemetryCategory =
  | "command.timeout"
  | "command.cancelled"
  | "command.gateway_error"
  | "job.started"
  | "job.completed"
  | "job.recovery.finalize_replayed"
  | "job.failed"
  | "job.cancelled"
  | "job.auth_challenge"
  | "preflight.binary_not_found"
  | "preflight.script_not_found"
  | "preflight.spawn_failed"
  | "connection.established"
  | "connection.reconnection_resumed"
  | "connection.degraded"
  | "connection.lost"
  | "command.initiated"
  | "command.started"
  | "command.completed"
  | "queue.stats_changed";

export interface TelemetryTraceContext {
  computeTargetId?: string;
  commandId?: string;
  operationId?: string;
  loopId?: string;
  jobId?: string;
  gatewaySessionId?: string;
  loopSessionId?: string;
}

export interface TelemetryDiagnostics {
  exitCode?: number;
  logTail?: string;
  tokenUsage?: { inputTokens: number; outputTokens: number };
  diagnosticsVersion?: number;
  errorStack?: string;
  extra?: Record<string, unknown>;
}

/** Telemetry event payload without protocol envelope fields (added by transport layer). */
export interface TelemetryEventPayload {
  severity: TelemetrySeverity;
  category: TelemetryCategory;
  message: string;
  schemaVersion?: string;
  timestamp?: string;
  trace?: TelemetryTraceContext;
  diagnostics?: TelemetryDiagnostics;
}

export interface TelemetryEmitter {
  emit(event: TelemetryEventPayload): void;
}

/** Full wire-format event including protocol envelope (used by transport layer). */
export interface DesktopTelemetryEvent extends ProtocolEnvelope {
  severity: TelemetrySeverity;
  category: TelemetryCategory;
  message: string;
  schemaVersion: string;
  timestamp: string;
  trace?: TelemetryTraceContext;
  diagnostics?: TelemetryDiagnostics;
}
