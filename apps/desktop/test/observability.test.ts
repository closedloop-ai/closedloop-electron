import assert from "node:assert/strict";
import { mock, afterEach, describe, test } from "node:test";
import { Observability } from "../src/main/observability.js";
import { PostHogAnalytics } from "../src/main/posthog-analytics.js";
import type { EnrichedTelemetryEvent } from "../src/main/telemetry-service.js";

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
    });

    Observability.connectionEstablished("desktop-1", "0.9.6", "production");

    assert.equal(captureCalls.length, 1);
    assert.equal(captureCalls[0].event, "desktop_connection_established");
    assert.equal(captureCalls[0].properties.desktop_id, "desktop-1");
    assert.equal(captureCalls[0].properties.version, "0.9.6");
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
    Observability.reconnectionResumed("relay_resume", 3);

    assert.equal(telemetryEvents.length, 1);
    assert.equal(telemetryEvents[0].category, "connection.reconnection_resumed");
    assert.equal(telemetryEvents[0].severity, "info");
    assert.equal(telemetryEvents[0].diagnostics?.extra?.replayCommandCount, 3);
    assert.ok(!telemetryEvents[0].trace?.commandId); // no commandId injected
    assert.equal(captureCalls.length, 1);
    assert.equal(captureCalls[0].event, "desktop_reconnection_resume");
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
});
