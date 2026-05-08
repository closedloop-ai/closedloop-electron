import type { ProtocolEnvelope } from "./cloud-protocol.js";

// Constants for log tail collection
export const TELEMETRY_LOG_TAIL_LINES = 50;
export const TELEMETRY_LOG_TAIL_MAX_BYTES = 32_768; // 32 KiB
export const TELEMETRY_MAX_FIELD_BYTES = 4_096; // 4 KiB
export const STDERR_TAIL_MAX_BYTES = 4_096; // 4 KiB
export const STDERR_TAIL_MAX_LINES = 50;

export type TelemetrySeverity = "info" | "warn" | "error";

export type TelemetryCategory =
  | "command.timeout"
  | "command.cancelled"
  | "command.gateway_error"
  | "desktop.outbound_network_decision"
  | "desktop.support_upload"
  | "job.started"
  | "job.plan_source_resolved"
  | "job.decision_table_verification"
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
  | "desktop_pop.unavailable"
  | "command.initiated"
  | "command.started"
  | "command.completed"
  | "queue.stats_changed"
  | "healthcheck.failure_detected"
  | "healthcheck.recovered"
  | "healthcheck.failure_persistent";

export interface TelemetryTraceContext {
  computeTargetId?: string;
  commandId?: string;
  operationId?: string;
  loopId?: string;
  jobId?: string;
  gatewaySessionId?: string;
  loopSessionId?: string;
}

export type ExecutePlanSource =
  | "raw-artifact"
  | "local-plan-json"
  | "imported-plan-compat";

export interface ExecutePlanSourceDiagnostics {
  source: ExecutePlanSource;
  rawPlanPayload: boolean;
  rawPlanAligned: boolean;
  localPlanJsonPresent: boolean;
  localPlanJsonAligned: boolean;
  importedPlanFileStaged: boolean;
  closedLoopPlanFileSet: boolean;
  planArtifactContentLength: number;
  rawPlanContentLength?: number | null;
  planArtifactContentHash?: string | null;
  rawPlanContentHash?: string | null;
}

export type DecisionTableVerificationFinalStatus =
  | "aligned"
  | "aligned_with_clarifications"
  | "verification_failed";

export type DecisionTableVerificationMissingReason =
  | "file_not_found"
  | "empty"
  | "no_current_run_records"
  | "read_error";

export interface DecisionTableVerificationDriftKindCounts {
  codeDrift: number;
  testDrift: number;
  planAmbiguity: number;
}

export interface DecisionTableVerificationRecordDiagnostics {
  telemetryStatus: "reported";
  telemetryFilePath: string;
  lineNumber: number;
  timestamp: string;
  workdir: string;
  decisionTablePath: string;
  finalStatus: DecisionTableVerificationFinalStatus;
  iterations: number;
  driftKindCounts: DecisionTableVerificationDriftKindCounts;
  fixesAttempted: number;
  parseFailures: number;
  verifierInvocations: number;
  phaseDurationMs: number;
}

export interface DecisionTableVerificationMissingDiagnostics {
  telemetryStatus: "missing";
  telemetryFilePath: string;
  filePresent: boolean;
  linesRead: number;
  invalidLines: number;
  missingReason: DecisionTableVerificationMissingReason;
  sinceIso?: string;
  readError?: string;
}

/**
 * Decision-table verifier telemetry extracted from the JSONL file emitted by
 * Phase 5.5 after an EXECUTE loop exits.
 */
export type DecisionTableVerificationTelemetryDiagnostics =
  | DecisionTableVerificationRecordDiagnostics
  | DecisionTableVerificationMissingDiagnostics;

export type OutboundNetworkSurface =
  | "loop_attachment_download"
  | "loop_support_upload"
  | "deploy_health_check";

export type OutboundNetworkDecision = "allowed" | "denied";

export type OutboundNetworkDestinationClass =
  | "external"
  | "invalid"
  | "ip_literal"
  | "link_local"
  | "loopback"
  | "metadata"
  | "private"
  | "s3_path_style"
  | "s3_virtual_hosted";

export type OutboundNetworkDecisionReason =
  | "allowed"
  | "attachment_host_not_allowed"
  | "credentialed_url"
  | "deploy_host_not_allowed"
  | "invalid_url"
  | "ip_literal_not_allowed"
  | "link_local_address_not_allowed"
  | "metadata_address_not_allowed"
  | "path_style_s3_not_allowed"
  | "private_address_not_allowed"
  | "unsupported_protocol";

export interface OutboundNetworkDiagnostics {
  surface: OutboundNetworkSurface;
  decision: OutboundNetworkDecision;
  reason: OutboundNetworkDecisionReason;
  destinationClass: OutboundNetworkDestinationClass;
  protocol?: string;
  hostname?: string;
  port?: string;
  statusCode?: number;
}

export type SupportUploadOutcome = "started" | "skipped" | "succeeded" | "failed";
export type SupportUploadReason =
  | "already_uploaded"
  | "missing_s3_state_key"
  | "no_uploadable_files"
  | "upload_url_http_error"
  | "upload_url_malformed_response"
  | "upload_url_success_false"
  | "upload_url_missing_url"
  | "upload_url_request_failed"
  | "put_url_denied"
  | "put_http_error"
  | "put_request_failed"
  | "event_post_failed";

export interface SupportUploadDiagnostics {
  outcome: SupportUploadOutcome;
  loopId?: string;
  s3StateKeySuffix?: string;
  attemptedLogicalNames?: string[];
  attemptedUploadedNames?: string[];
  reason?: SupportUploadReason;
  uploadedCount?: number;
  durationMs?: number;
}

export interface TelemetryDiagnostics {
  exitCode?: number;
  logTail?: string;
  stderrTail?: string;
  exitSignal?: string;
  elapsedMs?: number;
  stdoutBytes?: number;
  abortReason?: string;
  planSource?: ExecutePlanSourceDiagnostics;
  spawnMeta?: {
    command: string;
    args: string[];
    cwd: string;
    claudeVersion?: string;
    binaryPath: string;
    authFilesExist: boolean;
    envSnapshot: Record<string, string>;
  };
  tokenUsage?: { inputTokens: number; outputTokens: number };
  decisionTableVerification?: DecisionTableVerificationTelemetryDiagnostics;
  outboundNetwork?: OutboundNetworkDiagnostics;
  supportUpload?: SupportUploadDiagnostics;
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
