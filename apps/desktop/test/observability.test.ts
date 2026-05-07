import assert from "node:assert/strict";
import { mock, afterEach, describe, test } from "node:test";
import { Observability } from "../src/main/observability.js";
import { PostHogAnalytics } from "../src/main/posthog-analytics.js";
import type { EnrichedTelemetryEvent } from "../src/main/telemetry-service.js";
import type { TelemetryCategory } from "../src/main/telemetry-protocol.js";

// Compile-time regression guard: fails tsc if "queue.stats_changed" is removed from TelemetryCategory.
const _queueStatsCategoryCheck: TelemetryCategory = "queue.stats_changed";
const _desktopPopUnavailableCategoryCheck: TelemetryCategory = "desktop_pop.unavailable";
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

  test("static facade methods call PostHog backend when configured", () => {
    const captureCalls: Array<{ event: string; properties: Record<string, unknown> }> = [];
    mock.method(PostHogAnalytics.prototype, "capture", (
      _distinctId: string,
      event: string,
      properties: Record<string, unknown>,
    ) => {
      captureCalls.push({ event, properties });
    });

    Observability.init({
      telemetrySend: () => {},
      posthog: { apiKey: "phc_test", host: "https://us.i.posthog.com" },
    });

    Observability.setTargetId("desktop-123");
    Observability.commandTimedOut("cmd-1", "GENERATE_PRD");

    assert.equal(captureCalls.length, 1);
    assert.equal(captureCalls[0].event, "command_failed");
    assert.equal(captureCalls[0].properties.error_class, "timeout");
    assert.equal(captureCalls[0].properties.command_id, "cmd-1");
  });

  test("job lifecycle events only go to telemetry, not PostHog", () => {
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    const captureCalls: Array<{ event: string }> = [];
    mock.method(PostHogAnalytics.prototype, "capture", (
      _distinctId: string,
      event: string,
    ) => {
      captureCalls.push({ event });
    });

    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
      posthog: { apiKey: "phc_test", host: "https://us.i.posthog.com" },
    });

    Observability.jobStarted("cmd-1", "GENERATE_PRD", "loop-1", 12345);

    assert.equal(telemetryEvents.length, 1);
    assert.equal(telemetryEvents[0].category, "job.started");
    assert.equal(captureCalls.length, 0);
  });

  test("outboundNetworkDecision emits descriptor-only telemetry", () => {
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
    });

    Observability.outboundNetworkDecision({
      surface: "loop_attachment_download",
      decision: "denied",
      reason: "attachment_host_not_allowed",
      destinationClass: "external",
      protocol: "https:",
      hostname: "attacker.example.com",
      port: "443",
    });

    assert.equal(telemetryEvents.length, 1);
    assert.equal(
      telemetryEvents[0].category,
      "desktop.outbound_network_decision",
    );
    assert.equal(telemetryEvents[0].severity, "warn");
    assert.deepEqual(telemetryEvents[0].diagnostics?.outboundNetwork, {
      surface: "loop_attachment_download",
      decision: "denied",
      reason: "attachment_host_not_allowed",
      destinationClass: "external",
      protocol: "https:",
      hostname: "attacker.example.com",
      port: "443",
    });

    const serialized = JSON.stringify(telemetryEvents[0]);
    assert.equal(serialized.includes("/private/object.txt"), false);
    assert.equal(serialized.includes("X-Amz-Credential"), false);
    assert.equal(serialized.includes("X-Amz-Signature"), false);
  });

  test("jobPlanSourceResolved emits redacted EXECUTE plan diagnostics", () => {
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
    });

    Observability.jobPlanSourceResolved("cmd-1", "symphony_loop", "loop-1", {
      source: "imported-plan-compat",
      rawPlanPayload: true,
      rawPlanAligned: false,
      localPlanJsonPresent: true,
      localPlanJsonAligned: false,
      importedPlanFileStaged: true,
      closedLoopPlanFileSet: true,
      planArtifactContentLength: 10455,
      rawPlanContentLength: 23906,
      planArtifactContentHash: "abc123def456",
      rawPlanContentHash: "fed654cba321",
    });

    assert.equal(telemetryEvents.length, 1);
    assert.equal(telemetryEvents[0].category, "job.plan_source_resolved");
    assert.equal(telemetryEvents[0].severity, "info");
    assert.equal(telemetryEvents[0].trace?.commandId, "cmd-1");
    assert.equal(telemetryEvents[0].trace?.operationId, "symphony_loop");
    assert.equal(telemetryEvents[0].trace?.loopId, "loop-1");
    assert.deepEqual(telemetryEvents[0].diagnostics?.planSource, {
      source: "imported-plan-compat",
      rawPlanPayload: true,
      rawPlanAligned: false,
      localPlanJsonPresent: true,
      localPlanJsonAligned: false,
      importedPlanFileStaged: true,
      closedLoopPlanFileSet: true,
      planArtifactContentLength: 10455,
      rawPlanContentLength: 23906,
      planArtifactContentHash: "abc123def456",
      rawPlanContentHash: "fed654cba321",
    });
  });

  test("approval events include time-to-resolution", () => {
    const captureCalls: Array<{ event: string; properties: Record<string, unknown> }> = [];
    mock.method(PostHogAnalytics.prototype, "capture", (
      _distinctId: string,
      event: string,
      properties: Record<string, unknown>,
    ) => {
      captureCalls.push({ event, properties });
    });

    Observability.init({
      telemetrySend: () => {},
      posthog: { apiKey: "phc_test", host: "https://us.i.posthog.com" },
    });

    Observability.setTargetId("desktop-123");
    Observability.approvalResolved("GENERATE_PRD", "granted", 5000);

    assert.equal(captureCalls.length, 1);
    assert.equal(captureCalls[0].event, "approval_resolved");
    assert.equal(captureCalls[0].properties.outcome, "granted");
    assert.equal(captureCalls[0].properties.time_to_resolve_ms, 5000);
  });

  test("connectionEstablished captures PostHog event", () => {
    const captureCalls: Array<{ event: string; properties: Record<string, unknown> }> = [];
    mock.method(PostHogAnalytics.prototype, "capture", (
      _distinctId: string,
      event: string,
      properties: Record<string, unknown>,
    ) => {
      captureCalls.push({ event, properties });
    });

    Observability.init({
      telemetrySend: () => {},
      posthog: { apiKey: "phc_test", host: "https://us.i.posthog.com" },
      desktopClientVersion: "0.9.6",
    });

    Observability.connectionEstablished("desktop-1", "0.9.6", "production");

    assert.equal(captureCalls.length, 1);
    assert.equal(captureCalls[0].event, "desktop_connection_established");
    assert.equal(captureCalls[0].properties.desktop_id, "desktop-1");
    assert.equal(captureCalls[0].properties.desktop_client_version, "0.9.6");
  });

  test("desktopPopUnavailable emits redacted telemetry and PostHog diagnostics", () => {
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    const captureCalls: Array<{ event: string; properties: Record<string, unknown> }> = [];
    mock.method(PostHogAnalytics.prototype, "capture", (
      _distinctId: string,
      event: string,
      properties: Record<string, unknown>,
    ) => {
      captureCalls.push({ event, properties });
    });

    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
      posthog: { apiKey: "phc_test", host: "https://us.i.posthog.com" },
    });

    Observability.desktopPopUnavailable("/internal/api-keys/verify", "key_missing");

    assert.equal(telemetryEvents.length, 1);
    assert.equal(telemetryEvents[0].category, "desktop_pop.unavailable");
    assert.equal(telemetryEvents[0].severity, "warn");
    assert.deepEqual(telemetryEvents[0].diagnostics?.extra, {
      surface: "/internal/api-keys/verify",
      reason: "key_missing",
    });
    assert.equal(captureCalls.length, 1);
    assert.equal(captureCalls[0].event, "desktop_pop_unavailable");
    assert.equal(captureCalls[0].properties.surface, "/internal/api-keys/verify");
    assert.equal(captureCalls[0].properties.reason, "key_missing");
  });

  test("setTargetId injects computeTargetId into telemetry events", () => {
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
    });

    Observability.setTargetId("target-abc");
    Observability.commandCancelled("cmd-1", "OP");

    assert.equal(telemetryEvents[0].trace?.computeTargetId, "target-abc");
  });

  test("getTelemetryEmitter emits through the configured telemetry service", () => {
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
    });

    Observability.getTelemetryEmitter().emit({
      severity: "info",
      category: "job.recovery.finalize_replayed",
      message: "Job finalized via boot-recovery",
      trace: { loopId: "loop-1", jobId: "loop-1" },
      diagnostics: {
        logTail: "boot recovered",
        tokenUsage: { inputTokens: 1, outputTokens: 2 },
      },
    });

    assert.equal(telemetryEvents.length, 1);
    assert.equal(telemetryEvents[0].category, "job.recovery.finalize_replayed");
    assert.equal(telemetryEvents[0].trace?.loopId, "loop-1");
    assert.equal(telemetryEvents[0].diagnostics?.tokenUsage?.outputTokens, 2);
  });

  test("connectionEstablished emits telemetry and PostHog", () => {
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    const captureCalls: Array<{ event: string; properties: Record<string, unknown> }> = [];
    mock.method(PostHogAnalytics.prototype, "capture", (
      _distinctId: string,
      event: string,
      properties: Record<string, unknown>,
    ) => {
      captureCalls.push({ event, properties });
    });

    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
      posthog: { apiKey: "phc_test", host: "https://us.i.posthog.com" },
    });

    Observability.connectionEstablished("desktop-1", "0.9.6", "production");

    assert.equal(telemetryEvents.length, 1);
    assert.equal(telemetryEvents[0].category, "connection.established");
    assert.equal(telemetryEvents[0].severity, "info");
    assert.equal(telemetryEvents[0].trace?.computeTargetId, "desktop-1");
    assert.ok(!telemetryEvents[0].trace?.commandId); // no commandId injected
    assert.equal(captureCalls.length, 1);
    assert.equal(captureCalls[0].event, "desktop_connection_established");
  });

  test("reconnectionResumed emits telemetry and PostHog", () => {
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    const captureCalls: Array<{ event: string; properties: Record<string, unknown> }> = [];
    mock.method(PostHogAnalytics.prototype, "capture", (
      _distinctId: string,
      event: string,
      properties: Record<string, unknown>,
    ) => {
      captureCalls.push({ event, properties });
    });

    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
      posthog: { apiKey: "phc_test", host: "https://us.i.posthog.com" },
    });

    Observability.setTargetId("target-x");
    Observability.reconnectionResumed("relay_resumed", 3);

    assert.equal(telemetryEvents.length, 1);
    assert.equal(telemetryEvents[0].category, "connection.reconnection_resumed");
    assert.equal(telemetryEvents[0].severity, "info");
    assert.equal(telemetryEvents[0].diagnostics?.extra?.replayCommandCount, 3);
    assert.ok(!telemetryEvents[0].trace?.commandId); // no commandId injected
    assert.equal(captureCalls.length, 1);
    assert.equal(captureCalls[0].event, "desktop_reconnection_resumed");
    assert.equal(captureCalls[0].properties.reason, "relay_resumed");
    assert.equal(captureCalls[0].properties.replay_command_count, 3);
  });

  test("connectionDegraded emits telemetry and PostHog", () => {
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    const captureCalls: Array<{ event: string; properties: Record<string, unknown> }> = [];
    mock.method(PostHogAnalytics.prototype, "capture", (
      _distinctId: string,
      event: string,
      properties: Record<string, unknown>,
    ) => {
      captureCalls.push({ event, properties });
    });

    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
      posthog: { apiKey: "phc_test", host: "https://us.i.posthog.com" },
    });

    Observability.connectionDegraded("Cloud socket disconnected: transport close");

    assert.equal(telemetryEvents.length, 1);
    assert.equal(telemetryEvents[0].category, "connection.degraded");
    assert.equal(telemetryEvents[0].severity, "warn");
    assert.equal(telemetryEvents[0].message, "Cloud socket disconnected: transport close");
    assert.ok(!telemetryEvents[0].trace?.commandId); // no commandId injected
    assert.equal(captureCalls.length, 1);
    assert.equal(captureCalls[0].event, "desktop_connection_degraded");
  });

  test("connectionLost emits telemetry and PostHog", () => {
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    const captureCalls: Array<{ event: string; properties: Record<string, unknown> }> = [];
    mock.method(PostHogAnalytics.prototype, "capture", (
      _distinctId: string,
      event: string,
      properties: Record<string, unknown>,
    ) => {
      captureCalls.push({ event, properties });
    });

    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
      posthog: { apiKey: "phc_test", host: "https://us.i.posthog.com" },
    });

    Observability.connectionLost("transport close");

    assert.equal(telemetryEvents.length, 1);
    assert.equal(telemetryEvents[0].category, "connection.lost");
    assert.equal(telemetryEvents[0].severity, "warn");
    assert.ok(!telemetryEvents[0].trace?.commandId); // no commandId injected
    assert.equal(captureCalls.length, 1);
    assert.equal(captureCalls[0].event, "desktop_connection_lost");

    // Also test connectionLost with no argument
    telemetryEvents.length = 0;
    captureCalls.length = 0;
    Observability.connectionLost();
    assert.equal(telemetryEvents[0].message, "Connection lost");
  });

  test("connectionDegraded and connectionLost no-op with initNoOp", () => {
    Observability.initNoOp();
    Observability.connectionDegraded("err");
    Observability.connectionLost("reason");
    // Test passes if no errors are thrown
  });

  function initWithDualBackends(): {
    telemetryEvents: EnrichedTelemetryEvent[];
    captureCalls: Array<{ event: string; properties: Record<string, unknown> }>;
  } {
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    const captureCalls: Array<{ event: string; properties: Record<string, unknown> }> = [];
    mock.method(PostHogAnalytics.prototype, "capture", (
      _distinctId: string,
      event: string,
      properties: Record<string, unknown>,
    ) => {
      captureCalls.push({ event, properties });
    });
    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
      posthog: { apiKey: "phc_test", host: "https://us.i.posthog.com" },
    });
    return { telemetryEvents, captureCalls };
  }

  test("commandInitiated emits telemetry and PostHog events", () => {
    const { telemetryEvents, captureCalls } = initWithDualBackends();

    Observability.commandInitiated("cmd-1", "GENERATE_PRD");

    assert.equal(telemetryEvents.length, 1);
    assert.equal(telemetryEvents[0].category, "command.initiated");
    assert.equal(telemetryEvents[0].severity, "info");
    assert.equal(telemetryEvents[0].trace?.commandId, "cmd-1");
    assert.equal(telemetryEvents[0].trace?.operationId, "GENERATE_PRD");
    assert.equal(captureCalls.length, 1);
    assert.equal(captureCalls[0].event, "command_initiated");
    assert.equal(captureCalls[0].properties.command_id, "cmd-1");
    assert.equal(captureCalls[0].properties.operation_type, "GENERATE_PRD");
  });

  test("commandStarted emits telemetry and PostHog events", () => {
    const { telemetryEvents, captureCalls } = initWithDualBackends();

    Observability.commandStarted("cmd-1", "GENERATE_PRD");

    assert.equal(telemetryEvents.length, 1);
    assert.equal(telemetryEvents[0].category, "command.started");
    assert.equal(telemetryEvents[0].severity, "info");
    assert.equal(telemetryEvents[0].trace?.commandId, "cmd-1");
    assert.equal(telemetryEvents[0].trace?.operationId, "GENERATE_PRD");
    assert.equal(captureCalls.length, 1);
    assert.equal(captureCalls[0].event, "command_started");
    assert.equal(captureCalls[0].properties.command_id, "cmd-1");
    assert.equal(captureCalls[0].properties.operation_type, "GENERATE_PRD");
  });

  test("commandCompleted emits telemetry and PostHog events with latencyMs", () => {
    const { telemetryEvents, captureCalls } = initWithDualBackends();

    Observability.commandCompleted("cmd-1", "GENERATE_PRD", 1234);

    assert.equal(telemetryEvents.length, 1);
    assert.equal(telemetryEvents[0].category, "command.completed");
    assert.equal(telemetryEvents[0].severity, "info");
    assert.equal(telemetryEvents[0].trace?.commandId, "cmd-1");
    assert.equal(telemetryEvents[0].trace?.operationId, "GENERATE_PRD");
    assert.equal(telemetryEvents[0].diagnostics?.extra?.latencyMs, 1234);
    assert.equal(captureCalls.length, 1);
    assert.equal(captureCalls[0].event, "command_completed");
    assert.equal(captureCalls[0].properties.command_id, "cmd-1");
    assert.equal(captureCalls[0].properties.operation_type, "GENERATE_PRD");
    assert.equal(captureCalls[0].properties.latency_ms, 1234);
  });

  test("commandCancelled emits warn telemetry", () => {
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
    });

    Observability.commandCancelled("cmd-1", "GENERATE_PRD");

    assert.equal(telemetryEvents.length, 1);
    assert.equal(telemetryEvents[0].category, "command.cancelled");
    assert.equal(telemetryEvents[0].severity, "warn");
    assert.equal(telemetryEvents[0].trace?.commandId, "cmd-1");
    assert.equal(telemetryEvents[0].trace?.operationId, "GENERATE_PRD");
  });

  test("commandFailed emits error telemetry", () => {
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
    });

    Observability.commandFailed("cmd-1", "GENERATE_PRD", "gateway error");

    assert.equal(telemetryEvents.length, 1);
    assert.equal(telemetryEvents[0].category, "command.gateway_error");
    assert.equal(telemetryEvents[0].severity, "error");
    assert.equal(telemetryEvents[0].trace?.commandId, "cmd-1");
  });

  test("telemetry emission never throws even if telemetrySend throws", () => {
    Observability.init({
      telemetrySend: () => { throw new Error("socket disconnected"); },
    });

    assert.doesNotThrow(() => Observability.commandInitiated("cmd-1", "GENERATE_PRD"));
    assert.doesNotThrow(() => Observability.commandStarted("cmd-1", "GENERATE_PRD"));
    assert.doesNotThrow(() => Observability.commandCompleted("cmd-1", "GENERATE_PRD", 100));
  });

  describe("healthCheckResult dedupe state machine", () => {
    function initWithDualBackendsForHealthCheck(): {
      telemetryEvents: EnrichedTelemetryEvent[];
      captureCalls: Array<{ event: string; properties: Record<string, unknown> }>;
    } {
      const telemetryEvents: EnrichedTelemetryEvent[] = [];
      const captureCalls: Array<{ event: string; properties: Record<string, unknown> }> = [];
      mock.method(PostHogAnalytics.prototype, "capture", (
        _distinctId: string,
        event: string,
        properties: Record<string, unknown>,
      ) => {
        captureCalls.push({ event, properties });
      });
      Observability.init({
        telemetrySend: (event) => telemetryEvents.push(event),
        posthog: { apiKey: "phc_test", host: "https://us.i.posthog.com" },
      });
      return { telemetryEvents, captureCalls };
    }

    const failingCheck = {
      id: "claude-cli",
      passed: false,
      error: "Not found",
      debug: { errorCode: "ENOENT", foundAt: [] as string[] },
    };

    const passingCheck = {
      id: "claude-cli",
      passed: true,
    };

    test("first failing call emits failure_detected to both sinks", () => {
      const { telemetryEvents, captureCalls } = initWithDualBackendsForHealthCheck();

      Observability.healthCheckResult(failingCheck);

      assert.equal(telemetryEvents.length, 1);
      assert.equal(telemetryEvents[0].category, "healthcheck.failure_detected");
      assert.equal(telemetryEvents[0].severity, "error");
      assert.equal(telemetryEvents[0].diagnostics?.extra?.check_id, "claude-cli");
      assert.equal(captureCalls.length, 1);
      assert.equal(captureCalls[0].event, "healthcheck.failure_detected");
      assert.equal(captureCalls[0].properties.check_id, "claude-cli");
    });

    test("second identical failing call emits nothing (dedupe)", () => {
      const { telemetryEvents, captureCalls } = initWithDualBackendsForHealthCheck();

      Observability.healthCheckResult(failingCheck);
      telemetryEvents.length = 0;
      captureCalls.length = 0;

      Observability.healthCheckResult(failingCheck);

      assert.equal(telemetryEvents.length, 0);
      assert.equal(captureCalls.length, 0);
    });

    test("recovery after failure emits healthcheck.recovered", () => {
      const { telemetryEvents, captureCalls } = initWithDualBackendsForHealthCheck();

      Observability.healthCheckResult(failingCheck);
      telemetryEvents.length = 0;
      captureCalls.length = 0;

      Observability.healthCheckResult(passingCheck);

      assert.equal(telemetryEvents.length, 1);
      assert.equal(telemetryEvents[0].category, "healthcheck.recovered");
      assert.equal(telemetryEvents[0].severity, "info");
      assert.equal(captureCalls.length, 1);
      assert.equal(captureCalls[0].event, "healthcheck.recovered");
    });

    test("heartbeat after HEARTBEAT_MS emits failure_persistent", () => {
      const { telemetryEvents, captureCalls } = initWithDualBackendsForHealthCheck();

      // Use mock to control Date.now
      let fakeNow = 1000000;
      mock.method(Date, "now", () => fakeNow);

      Observability.healthCheckResult(failingCheck);
      telemetryEvents.length = 0;
      captureCalls.length = 0;

      // Advance time past HEARTBEAT_MS (1 hour = 3600000ms)
      fakeNow += 60 * 60 * 1000 + 1;

      Observability.healthCheckResult(failingCheck);

      assert.equal(telemetryEvents.length, 1);
      assert.equal(telemetryEvents[0].category, "healthcheck.failure_persistent");
      assert.equal(captureCalls.length, 1);
      assert.equal(captureCalls[0].event, "healthcheck.failure_persistent");
    });

    test("error code drift while failing emits new failure_detected", () => {
      const { telemetryEvents, captureCalls } = initWithDualBackendsForHealthCheck();

      Observability.healthCheckResult(failingCheck);
      telemetryEvents.length = 0;
      captureCalls.length = 0;

      // Same id, still failing, but different errorCode
      Observability.healthCheckResult({
        id: "claude-cli",
        passed: false,
        error: "Permission denied",
        debug: { errorCode: "EACCES", foundAt: ["/usr/local/bin/claude"] },
      });

      assert.equal(telemetryEvents.length, 1);
      assert.equal(telemetryEvents[0].category, "healthcheck.failure_detected");
      assert.equal(captureCalls.length, 1);
    });

    test("reset() clears healthcheck dedupe state", () => {
      const { telemetryEvents, captureCalls } = initWithDualBackendsForHealthCheck();

      Observability.healthCheckResult(failingCheck);
      telemetryEvents.length = 0;
      captureCalls.length = 0;

      // Without reset, second call would be deduped
      Observability.reset();
      Observability.init({
        telemetrySend: (event) => telemetryEvents.push(event),
        posthog: { apiKey: "phc_test", host: "https://us.i.posthog.com" },
      });

      Observability.healthCheckResult(failingCheck);

      // Should emit again because state was cleared
      assert.equal(telemetryEvents.length, 1);
      assert.equal(telemetryEvents[0].category, "healthcheck.failure_detected");
    });

    test("init() clears healthcheck dedupe state", () => {
      const telemetryEvents: EnrichedTelemetryEvent[] = [];
      Observability.init({ telemetrySend: (event) => telemetryEvents.push(event) });

      Observability.healthCheckResult(failingCheck);
      telemetryEvents.length = 0;

      // Re-init clears state
      Observability.init({ telemetrySend: (event) => telemetryEvents.push(event) });

      Observability.healthCheckResult(failingCheck);

      assert.equal(telemetryEvents.length, 1);
      assert.equal(telemetryEvents[0].category, "healthcheck.failure_detected");
    });

    test("non-allowlisted check (git) emits nothing", () => {
      const { telemetryEvents, captureCalls } = initWithDualBackendsForHealthCheck();

      Observability.healthCheckResult({ id: "git", passed: false, error: "Not found" });

      assert.equal(telemetryEvents.length, 0);
      assert.equal(captureCalls.length, 0);
    });

    test("non-allowlisted optional check (codex) emits nothing", () => {
      const { telemetryEvents, captureCalls } = initWithDualBackendsForHealthCheck();

      Observability.healthCheckResult({ id: "codex", passed: false, error: "Not found" });

      assert.equal(telemetryEvents.length, 0);
      assert.equal(captureCalls.length, 0);
    });

    test("first passing call for allowlisted check emits nothing", () => {
      const { telemetryEvents, captureCalls } = initWithDualBackendsForHealthCheck();

      Observability.healthCheckResult(passingCheck);

      assert.equal(telemetryEvents.length, 0);
      assert.equal(captureCalls.length, 0);
    });
  });
});

describe("queueStatsChanged()", () => {
  test("happy path: emits telemetry with correct fields", () => {
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
    });

    Observability.queueStatsChanged(3, 7);

    assert.strictEqual(telemetryEvents.length, 1);
    assert.strictEqual(telemetryEvents[0].category, "queue.stats_changed");
    assert.strictEqual(telemetryEvents[0].severity, "info");
    assert.strictEqual(telemetryEvents[0].message, "Queue stats changed");
    assert.strictEqual(telemetryEvents[0].diagnostics?.extra?.activeCommands, 3);
    assert.strictEqual(telemetryEvents[0].diagnostics?.extra?.queueDepth, 7);
  });

  test("no PostHog event emitted", () => {
    const captureCalls: Array<{ event: string }> = [];
    mock.method(PostHogAnalytics.prototype, "capture", (
      _distinctId: string,
      event: string,
    ) => {
      captureCalls.push({ event });
    });

    Observability.init({
      telemetrySend: () => {},
      posthog: { apiKey: "phc_test", host: "https://us.i.posthog.com" },
    });

    Observability.queueStatsChanged(3, 7);

    assert.strictEqual(captureCalls.length, 0);
  });

  test("no command scoping injected into trace", () => {
    const telemetryEvents: EnrichedTelemetryEvent[] = [];
    Observability.init({
      telemetrySend: (event) => telemetryEvents.push(event),
    });

    Observability.queueStatsChanged(3, 7);

    assert.ok(!telemetryEvents[0].trace?.commandId);
    assert.ok(!telemetryEvents[0].trace?.operationId);
  });

  test("no-op when uninitialised: does not throw and returns undefined", () => {
    // Do NOT call Observability.init() — telemetry is null (reset by afterEach).
    // Exercises the optional-chain guard: Observability.telemetry?.emit(...).
    let returnValue: unknown = "sentinel";
    assert.doesNotThrow(() => {
      returnValue = Observability.queueStatsChanged(1, 2);
    });
    assert.strictEqual(returnValue, undefined);
  });

  test("table-driven: various active/depth combinations", () => {
    const cases: Array<[number, number]> = [[0, 0], [5, 12], [100, 0]];

    for (const [active, depth] of cases) {
      const telemetryEvents: EnrichedTelemetryEvent[] = [];
      Observability.init({
        telemetrySend: (event) => telemetryEvents.push(event),
      });

      Observability.queueStatsChanged(active, depth);

      assert.strictEqual(telemetryEvents[0].diagnostics?.extra?.activeCommands, active);
      assert.strictEqual(telemetryEvents[0].diagnostics?.extra?.queueDepth, depth);

      Observability.reset();
    }
  });
});
