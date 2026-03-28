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
});
