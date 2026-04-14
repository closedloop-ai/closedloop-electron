import { TelemetryService, type EnrichedTelemetryEvent } from "./telemetry-service.js";
import { PostHogAnalytics } from "./posthog-analytics.js";
import { gatewayLog } from "./gateway-logger.js";
import type {
  TelemetryCategory,
  TelemetryDiagnostics,
  TelemetryEmitter,
  TelemetrySeverity,
  TelemetryTraceContext,
} from "./telemetry-protocol.js";

export interface ObservabilityOptions {
  telemetrySend: (event: EnrichedTelemetryEvent) => void;
  posthog?: { apiKey: string; host: string };
  releaseVersion?: string;
}

export class Observability {
  private static telemetry: TelemetryService | null = null;
  private static posthog: PostHogAnalytics | null = null;
  private static releaseVersion = "";
  private static desktopId = "";

  static init(options: ObservabilityOptions): void {
    // Shut down any previous PostHog client to avoid leaking flush timers
    Observability.posthog?.shutdown().catch(() => {});

    Observability.telemetry = new TelemetryService({
      sendTelemetry: options.telemetrySend,
    });
    Observability.releaseVersion = options.releaseVersion ?? "";
    Observability.desktopId = "";

    if (options.posthog) {
      Observability.posthog = new PostHogAnalytics(options.posthog);
      gatewayLog.info("observability", "PostHog analytics initialized");
    } else {
      Observability.posthog = null;
    }
  }

  static initNoOp(): void {
    Observability.init({ telemetrySend: () => {} });
  }

  static reset(): void {
    // Shut down PostHog client to avoid leaking flush timers
    Observability.posthog?.shutdown().catch(() => {});
    Observability.telemetry = null;
    Observability.posthog = null;
    Observability.releaseVersion = "";
    Observability.desktopId = "";
  }

  static async shutdown(): Promise<void> {
    await Observability.posthog?.shutdown();
  }

  // --- Context injection ---

  static setTargetId(id: string): void {
    Observability.telemetry?.setTargetId(id);
    Observability.desktopId = id;
  }

  static setGatewaySessionId(id: string): void {
    Observability.telemetry?.setGatewaySessionId(id);
  }

  static getTelemetryEmitter(): TelemetryEmitter {
    return {
      emit(event) {
        Observability.telemetry?.emit(event);
      },
    };
  }

  // --- Command lifecycle ---

  static commandInitiated(commandId: string, operationId: string): void {
    Observability.emitTelemetry("info", "command.initiated", "Command initiated", {
      commandId,
      operationId,
    });
    Observability.capturePostHog("command_initiated", {
      command_id: commandId,
      operation_type: operationId,
    });
  }

  static commandStarted(commandId: string, operationId: string): void {
    Observability.emitTelemetry("info", "command.started", "Command started", {
      commandId,
      operationId,
    });
    Observability.capturePostHog("command_started", {
      command_id: commandId,
      operation_type: operationId,
    });
  }

  static commandCompleted(commandId: string, operationId: string, latencyMs: number): void {
    Observability.emitTelemetry("info", "command.completed", "Command completed", {
      commandId,
      operationId,
    }, { extra: { latencyMs } });
    Observability.capturePostHog("command_completed", {
      command_id: commandId,
      operation_type: operationId,
      latency_ms: latencyMs,
    });
  }

  static commandTimedOut(commandId: string, operationId: string): void {
    Observability.emitTelemetry("error", "command.timeout", "Command timed out", {
      commandId,
      operationId,
    });
    Observability.capturePostHog("command_failed", {
      command_id: commandId,
      operation_type: operationId,
      error_class: "timeout",
    });
  }

  static commandCancelled(commandId: string, operationId: string): void {
    Observability.emitTelemetry("warn", "command.cancelled", "Command cancelled", {
      commandId,
      operationId,
    });
    Observability.capturePostHog("command_failed", {
      command_id: commandId,
      operation_type: operationId,
      error_class: "cancelled",
    });
  }

  static commandFailed(commandId: string, operationId: string, message: string): void {
    Observability.emitTelemetry("error", "command.gateway_error", message, {
      commandId,
      operationId,
    });
    Observability.capturePostHog("command_failed", {
      command_id: commandId,
      operation_type: operationId,
      error_class: "gateway_error",
    });
  }

  // --- Approval lifecycle (PostHog only) ---

  static approvalRequested(operationId: string, commandId?: string): void {
    Observability.capturePostHog("approval_requested", {
      operation_type: operationId,
      ...(commandId ? { command_id: commandId } : {}),
    });
  }

  static approvalResolved(
    operationId: string,
    outcome: "granted" | "denied" | "timed_out",
    timeToResolveMs: number,
    commandId?: string,
  ): void {
    Observability.capturePostHog("approval_resolved", {
      operation_type: operationId,
      outcome,
      time_to_resolve_ms: timeToResolveMs,
      ...(commandId ? { command_id: commandId } : {}),
    });
  }

  // --- Connection lifecycle ---

  static connectionEstablished(desktopId: string, version: string, environment: string): void {
    Observability.emitTelemetry("info", "connection.established", "Connection established", { computeTargetId: desktopId });
    Observability.capturePostHog("desktop_connection_established", {
      desktop_id: desktopId,
      version,
      environment,
    });
  }

  static reconnectionResumed(reason: string, replayCommandCount: number): void {
    Observability.emitTelemetry("info", "connection.reconnection_resumed", "Reconnection resumed", {}, { extra: { reason, replayCommandCount } });
    Observability.capturePostHog("desktop_reconnection_resumed", {
      reason,
      replay_command_count: replayCommandCount,
    });
  }

  static connectionDegraded(error: string): void {
    Observability.emitTelemetry("warn", "connection.degraded", error, {});
    Observability.capturePostHog("desktop_connection_degraded", { error });
  }

  static connectionLost(reason?: string): void {
    Observability.emitTelemetry("warn", "connection.lost", reason ?? "Connection lost", {});
    Observability.capturePostHog("desktop_connection_lost", { reason });
  }

  // --- Sandbox (PostHog only) ---

  static sandboxBlocked(operationClass: string): void {
    Observability.capturePostHog("sandbox_blocked_operation", {
      operation_class: operationClass,
    });
  }

  // --- Job lifecycle (telemetry only) ---

  static jobStarted(commandId: string | undefined, operationId: string | undefined, loopId: string, pid: number): void {
    Observability.emitTelemetry("info", "job.started", `Job started with pid=${pid}`, {
      commandId,
      operationId,
      loopId,
      jobId: loopId,
    });
  }

  static jobCompleted(
    commandId: string | undefined,
    operationId: string | undefined,
    loopId: string,
    diagnostics?: TelemetryDiagnostics,
    loopSessionId?: string,
  ): void {
    Observability.emitTelemetry("info", "job.completed", "Job completed successfully", {
      commandId,
      operationId,
      loopId,
      jobId: loopId,
      loopSessionId,
    }, diagnostics);
  }

  static jobFailed(
    commandId: string | undefined,
    operationId: string | undefined,
    loopId: string,
    exitCode: number,
    diagnostics?: TelemetryDiagnostics,
    loopSessionId?: string,
  ): void {
    Observability.emitTelemetry(
      "error",
      "job.failed",
      `Process exited with code ${exitCode}`,
      { commandId, operationId, loopId, jobId: loopId, loopSessionId },
      diagnostics ? { ...diagnostics, exitCode } : { exitCode },
    );
  }

  static jobCancelled(
    commandId: string | undefined,
    operationId: string | undefined,
    loopId: string,
    exitCode: number,
    diagnostics?: TelemetryDiagnostics,
    loopSessionId?: string,
  ): void {
    Observability.emitTelemetry(
      "info",
      "job.cancelled",
      `Process cancelled (exit code ${exitCode})`,
      { commandId, operationId, loopId, jobId: loopId, loopSessionId },
      diagnostics ? { ...diagnostics, exitCode } : { exitCode },
    );
  }

  static jobAuthChallenge(
    commandId: string | undefined,
    operationId: string | undefined,
    loopId: string,
    exitCode: number,
    diagnostics?: TelemetryDiagnostics,
    loopSessionId?: string,
  ): void {
    Observability.emitTelemetry(
      "error",
      "job.auth_challenge",
      `Auth challenge detected (exit code ${exitCode})`,
      { commandId, operationId, loopId, jobId: loopId, loopSessionId },
      diagnostics ? { ...diagnostics, exitCode } : { exitCode },
    );
  }

  // --- Preflight (telemetry only) ---

  static preflightBinaryNotFound(commandId: string | undefined, operationId: string | undefined, loopId: string): void {
    Observability.emitTelemetry("error", "preflight.binary_not_found", "claude CLI not found in PATH", {
      commandId,
      operationId,
      loopId,
    });
  }

  static preflightScriptNotFound(commandId: string | undefined, operationId: string | undefined, loopId: string): void {
    Observability.emitTelemetry("error", "preflight.script_not_found", "run-loop.sh not found in plugin cache", {
      commandId,
      operationId,
      loopId,
    });
  }

  static preflightSpawnFailed(commandId: string | undefined, operationId: string | undefined, loopId: string, message: string): void {
    Observability.emitTelemetry("error", "preflight.spawn_failed", message, {
      commandId,
      operationId,
      loopId,
    });
  }

  // --- Internal helpers ---

  // commandId is a log/event attribute for correlation only — must not be promoted to a Datadog metric tag dimension
  private static emitTelemetry(
    severity: TelemetrySeverity,
    category: TelemetryCategory,
    message: string,
    trace: TelemetryTraceContext,
    diagnostics?: TelemetryDiagnostics,
  ): void {
    Observability.telemetry?.emit({
      severity,
      category,
      message,
      trace,
      diagnostics,
    });
  }

  private static capturePostHog(event: string, properties: Record<string, unknown>): void {
    Observability.posthog?.capture(Observability.desktopId || "unknown", event, {
      ...properties,
      release_version: Observability.releaseVersion,
    });
  }
}
