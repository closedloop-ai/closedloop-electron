import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import type { DesktopAnalyticsEvent } from "../src/main/cloud-protocol.js";
import { Observability } from "../src/main/observability.js";
import type { EnrichedTelemetryEvent } from "../src/main/telemetry-service.js";
import type { TelemetryCategory } from "../src/main/telemetry-protocol.js";

type AnalyticsEvent = Omit<
  DesktopAnalyticsEvent,
  "protocolVersion" | "messageId" | "timestamp"
>;

const _queueStatsCategoryCheck: TelemetryCategory = "queue.stats_changed";
const _desktopPopUnavailableCategoryCheck: TelemetryCategory =
  "desktop_pop.unavailable";
const _outboundNetworkDecisionCategoryCheck: TelemetryCategory =
  "desktop.outbound_network_decision";
const _jobPlanSourceResolvedCategoryCheck: TelemetryCategory =
  "job.plan_source_resolved";
const _jobDecisionTableVerificationCategoryCheck: TelemetryCategory =
  "job.decision_table_verification";

afterEach(async () => {
  await Observability.shutdown();
  Observability.reset();
  mock.restoreAll();
});

describe("Observability", () => {
  test("static facade methods call telemetry backend", () => {
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
    });

    Observability.commandTimedOut("cmd-1", "GENERATE_PRD");

    assert.equal(telemetryEvents.length, 1);
    assert.equal(telemetryEvents[0].category, "command.timeout");
    assert.equal(telemetryEvents[0].severity, "error");
    assert.equal(telemetryEvents[0].trace?.commandId, "cmd-1");
    assert.equal(telemetryEvents[0].trace?.operationId, "GENERATE_PRD");
  });

  test("product analytics events use the socket transport with common desktop properties", () => {
    const analyticsEvents: AnalyticsEvent[] = [];
    Observability.init({
      telemetrySend: () => {},
      analytics: {
        send: (event) => analyticsEvents.push(event),
        flush: async () => {},
      },
      desktopClientVersion: "0.15.3",
    });

    Observability.setTargetId("target-123");
    Observability.commandCompleted("cmd-1", "GENERATE_PRD", 1234);

    assert.equal(analyticsEvents.length, 1);
    assert.equal(analyticsEvents[0].event, "command_completed");
    assert.equal(analyticsEvents[0].properties?.command_id, "cmd-1");
    assert.equal(analyticsEvents[0].properties?.operation_type, "GENERATE_PRD");
    assert.equal(analyticsEvents[0].properties?.latency_ms, 1234);
    assert.equal(analyticsEvents[0].properties?.desktop_client_version, "0.15.3");
    assert.equal(analyticsEvents[0].properties?.platform, process.platform);
    assert.equal("compute_target_id" in (analyticsEvents[0].properties ?? {}), false);
    assert.equal("organization_id" in (analyticsEvents[0].properties ?? {}), false);
  });

  test("job lifecycle events only go to telemetry", () => {
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    const analyticsEvents: AnalyticsEvent[] = [];
    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
      analytics: {
        send: (event) => analyticsEvents.push(event),
        flush: async () => {},
      },
    });

    Observability.jobStarted("cmd-1", "GENERATE_PRD", "loop-1", 12345);

    assert.equal(telemetryEvents.length, 1);
    assert.equal(telemetryEvents[0].category, "job.started");
    assert.equal(analyticsEvents.length, 0);
  });

  test("connection lifecycle emits telemetry and server-relayed analytics", () => {
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    const analyticsEvents: AnalyticsEvent[] = [];
    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
      analytics: {
        send: (event) => analyticsEvents.push(event),
        flush: async () => {},
      },
      desktopClientVersion: "0.15.3",
    });

    Observability.connectionEstablished("target-1", "0.15.3", "production");
    Observability.reconnectionResumed("relay_resumed", 2);
    Observability.connectionDegraded("temporary relay error");
    Observability.connectionLost();

    assert.deepEqual(
      telemetryEvents.map((event) => event.category),
      [
        "connection.established",
        "connection.reconnection_resumed",
        "connection.degraded",
        "connection.lost",
      ],
    );
    assert.deepEqual(
      analyticsEvents.map((event) => event.event),
      [
        "desktop_connection_established",
        "desktop_reconnection_resumed",
        "desktop_connection_degraded",
        "desktop_connection_lost",
      ],
    );
    assert.equal(analyticsEvents[0].properties?.version, "0.15.3");
    assert.equal(analyticsEvents[0].properties?.environment, "production");
    assert.deepEqual(analyticsEvents[0].properties, {
      version: "0.15.3",
      environment: "production",
      desktop_client_version: "0.15.3",
      platform: process.platform,
    });
  });

  test("approval, plugin, sandbox, and health check events use product analytics only where expected", () => {
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    const analyticsEvents: AnalyticsEvent[] = [];
    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
      analytics: {
        send: (event) => analyticsEvents.push(event),
        flush: async () => {},
      },
    });

    Observability.approvalRequested("GENERATE_PRD", "cmd-1");
    Observability.approvalResolved("GENERATE_PRD", "granted", 5000, "cmd-1");
    Observability.pluginUpdateAttempted({
      pluginIds: ["code"],
      versionsBefore: { code: "1.0.0" },
      versionsAfter: { code: "1.0.0" },
      outcomes: { code: "success" },
      durationMs: 200,
      command: "claude plugin update",
      scope: "user",
    });
    Observability.pluginUpdateFailed({
      pluginIds: ["code", "github"],
      versionsBefore: { code: "1.0.0", github: "1.0.0" },
      versionsAfter: { code: "1.0.0", github: "1.0.0" },
      outcomes: { code: "failed", github: "skipped" },
      durationMs: 300,
      command: "claude plugin update",
      scope: "user",
      failureReason: "manifest_unavailable",
    });
    Observability.sandboxBlocked("path_denied");
    Observability.healthCheckResult({
      id: "claude-cli",
      passed: false,
      error: "Not found",
      debug: { errorCode: "missing_binary" },
    });

    assert.deepEqual(
      analyticsEvents.map((event) => event.event),
      [
        "approval_requested",
        "approval_resolved",
        "plugin_update_attempted",
        "plugin_update_failed",
        "sandbox_blocked_operation",
        "healthcheck.failure_detected",
      ],
    );
    assert.equal(telemetryEvents.some((event) => event.category === "plugin_update.failed"), true);
    assert.equal(
      telemetryEvents.some((event) => event.category === "healthcheck.failure_detected"),
      true,
    );
  });

  test("shutdown flushes the analytics transport with a bounded timeout", async () => {
    const flushCalls: Array<{ timeoutMs: number }> = [];
    Observability.init({
      telemetrySend: () => {},
      analytics: {
        send: () => {},
        flush: async (options) => {
          flushCalls.push(options);
        },
      },
    });

    await Observability.shutdown();

    assert.deepEqual(flushCalls, [{ timeoutMs: 1500 }]);
  });

  test("no-op initialization remains safe", () => {
    Observability.initNoOp();

    assert.doesNotThrow(() => Observability.commandInitiated("cmd-1", "GENERATE_PRD"));
    assert.doesNotThrow(() => Observability.commandStarted("cmd-1", "GENERATE_PRD"));
    assert.doesNotThrow(() => Observability.commandCompleted("cmd-1", "GENERATE_PRD", 100));
  });

  test("queue stats remain telemetry-only", () => {
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    const analyticsEvents: AnalyticsEvent[] = [];
    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
      analytics: {
        send: (event) => analyticsEvents.push(event),
        flush: async () => {},
      },
    });

    Observability.queueStatsChanged(3, 7);

    assert.equal(telemetryEvents.length, 1);
    assert.equal(telemetryEvents[0].category, "queue.stats_changed");
    assert.equal(analyticsEvents.length, 0);
  });
});
