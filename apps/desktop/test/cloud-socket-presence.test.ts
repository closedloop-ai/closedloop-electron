import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, describe, test } from "node:test";
import {
  CloudSocketService,
  buildRelayValidationPopHeaders,
  parseDesktopHelloAck,
  parseServerCapabilities,
  refreshRelayValidationPopHeadersForSocket,
  type CloudSocketOptions,
} from "../src/main/cloud-socket.js";
import { GATEWAY_PROTOCOL_VERSION } from "../src/shared/contracts.js";
import { buildCommandSigningCapabilities } from "../src/shared/command-signing-policy.js";
import { gatewayLog } from "../src/main/gateway-logger.js";
import {
  DesktopPopUnavailableError,
  DESKTOP_POP_GATEWAY_ID_HEADER,
  DESKTOP_POP_SIGNATURE_HEADER,
  DESKTOP_POP_TIMESTAMP_HEADER,
  RELAY_API_KEY_VERIFY_PATH,
} from "../src/main/desktop-pop.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createStubOptions(
  overrides?: Partial<CloudSocketOptions>,
): CloudSocketOptions {
  return {
    getRelayOrigin: () => "https://relay.example.com",
    getApiKey: () => "test-key",
    getAllowedDirectories: () => ["/tmp"],
    getMaxInFlightCommands: () => 5,
    machineName: "test-machine",
    pluginVersion: "1.0.0-test",
    desktopClientVersion: "0.13.9-test",
    gatewayProtocolVersion: "0.1.0",
    supportedOperations: ["test_op"],
    ...overrides,
  };
}

afterEach(() => {
  gatewayLog.clear();
  gatewayLog.setVerbose(false);
});

// ---------------------------------------------------------------------------
// T-6.1: Presence state log deduplication
// ---------------------------------------------------------------------------

describe("T-6.1: Presence state log deduplication", () => {
  test("(a) sendPresence logs only on state transitions", () => {
    gatewayLog.setVerbose(true);
    gatewayLog.clear(); // clear the "Verbose logging enabled" entry

    const service = new CloudSocketService(createStubOptions());

    // First call with "online" — should log
    service.sendPresence({ state: "online", activeCommands: 0, queueDepth: 0 });
    const afterFirst = gatewayLog.getEntries().filter(
      (e) => e.tag === "cloud-socket" && e.message.includes("Sending presence:"),
    );
    assert.equal(afterFirst.length, 1, "First presence call should log");

    // Repeated "online" — should NOT produce a new log entry
    service.sendPresence({ state: "online", activeCommands: 1, queueDepth: 0 });
    const afterRepeat = gatewayLog.getEntries().filter(
      (e) => e.tag === "cloud-socket" && e.message.includes("Sending presence:"),
    );
    assert.equal(afterRepeat.length, 1, "Repeated same state should not log again");

    // Transition to degraded — should log
    service.sendPresence({ state: "degraded", error: "test error" });
    const afterDegraded = gatewayLog.getEntries().filter(
      (e) => e.tag === "cloud-socket" && e.message.includes("Sending presence:"),
    );
    assert.equal(afterDegraded.length, 2, "State transition should produce new log");

    // Repeated degraded — should NOT log
    service.sendPresence({ state: "degraded", error: "different error" });
    const afterRepeatDegraded = gatewayLog.getEntries().filter(
      (e) => e.tag === "cloud-socket" && e.message.includes("Sending presence:"),
    );
    assert.equal(afterRepeatDegraded.length, 2, "Repeated degraded should not log");

    // Back to online — should log
    service.sendPresence({ state: "online", activeCommands: 0, queueDepth: 0 });
    const afterBackOnline = gatewayLog.getEntries().filter(
      (e) => e.tag === "cloud-socket" && e.message.includes("Sending presence:"),
    );
    assert.equal(afterBackOnline.length, 3, "Transition back to online should log");
  });
});

describe("relay validation PoP headers", () => {
  test("managed keys sign the relay API-key verification path", async () => {
    let capturedRequest: unknown;
    const headers = await buildRelayValidationPopHeaders(
      "DESKTOP_MANAGED",
      (request) => {
        capturedRequest = request;
        return {
          [DESKTOP_POP_GATEWAY_ID_HEADER]: "gateway-1",
          [DESKTOP_POP_TIMESTAMP_HEADER]: "1713984000",
          [DESKTOP_POP_SIGNATURE_HEADER]: "signature",
        };
      },
    );

    assert.deepEqual(capturedRequest, {
      method: "POST",
      pathname: RELAY_API_KEY_VERIFY_PATH,
    });
    assert.deepEqual(headers, {
      [DESKTOP_POP_GATEWAY_ID_HEADER]: "gateway-1",
      [DESKTOP_POP_TIMESTAMP_HEADER]: "1713984000",
      [DESKTOP_POP_SIGNATURE_HEADER]: "signature",
    });
  });

  test("manual keys omit relay PoP headers and do not call signer", async () => {
    let signerCalled = false;
    const headers = await buildRelayValidationPopHeaders(
      "USER_CREATED",
      () => {
        signerCalled = true;
        return null;
      },
    );

    assert.equal(headers, undefined);
    assert.equal(signerCalled, false);
  });

  test("managed signing unavailable falls back to bearer-only compatibility", async () => {
    const unavailableReports: Array<{ surface: string; reason: string }> = [];
    const headers = await buildRelayValidationPopHeaders(
      "DESKTOP_MANAGED",
      () => null,
      (surface, reason) => unavailableReports.push({ surface, reason }),
    );

    assert.equal(headers, undefined);
    assert.deepEqual(unavailableReports, [{
      surface: RELAY_API_KEY_VERIFY_PATH,
      reason: "sign_failed_or_null",
    }]);
    assert.equal(
      gatewayLog.getEntries().some(
        (entry) =>
          entry.tag === "desktop-pop" &&
          entry.message.includes("continuing bearer-only compatibility mode"),
      ),
      true,
    );
  });

  test("managed signing reports precise redacted unavailable reasons", async () => {
    const unavailableReports: Array<{ surface: string; reason: string }> = [];

    const headers = await buildRelayValidationPopHeaders(
      "DESKTOP_MANAGED",
      () => {
        throw new DesktopPopUnavailableError("safe_storage_unavailable");
      },
      (surface, reason) => unavailableReports.push({ surface, reason }),
    );

    assert.equal(headers, undefined);
    assert.deepEqual(unavailableReports, [{
      surface: RELAY_API_KEY_VERIFY_PATH,
      reason: "safe_storage_unavailable",
    }]);
  });

  test("manual reconnect refreshes stale relay PoP extraHeaders", async () => {
    const socket = {
      io: {
        opts: {
          extraHeaders: {
            [DESKTOP_POP_GATEWAY_ID_HEADER]: "gateway-1",
            [DESKTOP_POP_TIMESTAMP_HEADER]: "1713984000",
            [DESKTOP_POP_SIGNATURE_HEADER]: "old-signature",
          },
        },
      },
    };

    await refreshRelayValidationPopHeadersForSocket(
      socket as unknown as Parameters<typeof refreshRelayValidationPopHeadersForSocket>[0],
      "DESKTOP_MANAGED",
      () => ({
        [DESKTOP_POP_GATEWAY_ID_HEADER]: "gateway-1",
        [DESKTOP_POP_TIMESTAMP_HEADER]: "1713984060",
        [DESKTOP_POP_SIGNATURE_HEADER]: "new-signature",
      }),
    );

    assert.deepEqual(socket.io.opts.extraHeaders, {
      [DESKTOP_POP_GATEWAY_ID_HEADER]: "gateway-1",
      [DESKTOP_POP_TIMESTAMP_HEADER]: "1713984060",
      [DESKTOP_POP_SIGNATURE_HEADER]: "new-signature",
    });
  });
});

// ---------------------------------------------------------------------------
// T-3.1: GATEWAY_PROTOCOL_VERSION constant value
// ---------------------------------------------------------------------------

describe("T-3.1: GATEWAY_PROTOCOL_VERSION constant", () => {
  test("GATEWAY_PROTOCOL_VERSION is '0.1.0'", () => {
    assert.equal(GATEWAY_PROTOCOL_VERSION, "0.1.0");
  });
});

// ---------------------------------------------------------------------------
// T-3.1: desktop.hello payload version fields
// ---------------------------------------------------------------------------

/**
 * Minimal fake socket that records events emitted via socket.emit().
 * We inject this into the CloudSocketService's private `socket` field
 * so we can capture the desktop.hello payload without a real Socket.IO
 * server connection.
 */
class FakeSocket extends EventEmitter {
  connected = true;
  readonly emittedEvents: Array<{ name: string; payload: unknown }> = [];

  emit(name: string, ...args: unknown[]): boolean {
    this.emittedEvents.push({ name, payload: args[0] });
    return super.emit(name, ...args);
  }

  disconnect(): this {
    this.connected = false;
    return this;
  }

  removeAllListeners(event?: string): this {
    super.removeAllListeners(event);
    return this;
  }
}

describe("T-3.1: hello payload version fields", () => {
  test("CloudSocketService emits version fields and local capabilities in desktop.hello", () => {
    const service = new CloudSocketService(
      createStubOptions({
        desktopClientVersion: "0.13.9-test",
        gatewayProtocolVersion: "0.1.0",
        pluginVersion: "1.0.0-test",
        getCapabilities: () => ({ commandSigning: true }),
      }),
    );

    // Inject a fake socket so we can capture what emitHello emits without
    // establishing a real Socket.IO connection.
    const fakeSocket = new FakeSocket();
    (service as unknown as Record<string, unknown>)["socket"] = fakeSocket;

    // Call the private emitHello method directly via prototype access.
    // This exercises the same code path triggered on connect, building the
    // DesktopHelloEvent from options and emitting it on the socket.
    const proto = Object.getPrototypeOf(service) as Record<string, (...args: unknown[]) => void>;
    proto["emitHello"].call(service);

    // Verify the desktop.hello event was emitted with all three version fields
    const helloEvents = fakeSocket.emittedEvents.filter((e) => e.name === "desktop.hello");
    assert.equal(helloEvents.length, 1, "Expected exactly one desktop.hello emission");

    const hello = helloEvents[0].payload as Record<string, unknown>;
    assert.equal(hello["desktopClientVersion"], "0.13.9-test", "desktopClientVersion must match");
    assert.equal(hello["gatewayProtocolVersion"], "0.1.0", "gatewayProtocolVersion must match");
    assert.equal(hello["pluginVersion"], "1.0.0-test", "pluginVersion must match");
    assert.deepEqual(hello["capabilities"], { commandSigning: true });

    service.stop();
  });

  test("CloudSocketService omits commandSigningRequired until enforcement opt-in is enabled", () => {
    const service = new CloudSocketService(
      createStubOptions({
        getCapabilities: () =>
          buildCommandSigningCapabilities({
            commandSigningEnforcementEnabled: false,
          }),
      }),
    );
    const fakeSocket = new FakeSocket();
    (service as unknown as Record<string, unknown>)["socket"] = fakeSocket;

    const proto = Object.getPrototypeOf(service) as Record<string, (...args: unknown[]) => void>;
    proto["emitHello"].call(service);

    const hello = fakeSocket.emittedEvents.find((e) => e.name === "desktop.hello")
      ?.payload as Record<string, unknown>;
    assert.deepEqual(hello["capabilities"], {
      tools: {
        claude: false,
        codex: false,
        git: false,
        gh: false,
        python3: false,
      },
      versions: {},
      commandSigning: true,
    });

    service.stop();
  });

  test("CloudSocketService includes commandSigningRequired when enforcement opt-in is enabled", () => {
    const service = new CloudSocketService(
      createStubOptions({
        getCapabilities: () =>
          buildCommandSigningCapabilities({
            commandSigningEnforcementEnabled: true,
          }),
      }),
    );
    const fakeSocket = new FakeSocket();
    (service as unknown as Record<string, unknown>)["socket"] = fakeSocket;

    const proto = Object.getPrototypeOf(service) as Record<string, (...args: unknown[]) => void>;
    proto["emitHello"].call(service);

    const hello = fakeSocket.emittedEvents.find((e) => e.name === "desktop.hello")
      ?.payload as Record<string, unknown>;
    assert.equal(
      (hello["capabilities"] as Record<string, unknown>).commandSigningRequired,
      true,
    );

    service.stop();
  });

  test("parseServerCapabilities requires explicit computeTargetSigning true", () => {
    assert.deepEqual(parseServerCapabilities({ computeTargetSigning: true }), {
      computeTargetSigning: true,
    });
    assert.equal(
      parseServerCapabilities({ computeTargetSigning: false }),
      undefined,
    );
    assert.equal(
      parseServerCapabilities({ computeTargetSigning: "true" }),
      undefined,
    );
    assert.equal(parseServerCapabilities(undefined), undefined);
  });

  test("parseDesktopHelloAck passes through gateway-owner identity and ignores userId", () => {
    const ack = parseDesktopHelloAck({
      computeTargetId: "target-1",
      sessionId: "session-1",
      serverTime: "2026-05-11T00:00:00.000Z",
      clerkUserId: " clerk_user_1 ",
      organizationId: " org-1 ",
      userId: "user_db_1",
      serverCapabilities: { computeTargetSigning: true },
      resumeFromSequence: { "cmd-1": 2 },
    });

    assert.ok(ack);
    assert.equal(ack.computeTargetId, "target-1");
    assert.equal(ack.clerkUserId, "clerk_user_1");
    assert.equal(ack.organizationId, "org-1");
    assert.equal(
      (ack as unknown as Record<string, unknown>).userId,
      undefined,
    );
    assert.deepEqual(ack.serverCapabilities, { computeTargetSigning: true });
    assert.deepEqual(ack.resumeFromSequence, { "cmd-1": 2 });
  });

  test("parseDesktopHelloAck accepts older ack payloads without identity", () => {
    const ack = parseDesktopHelloAck({
      computeTargetId: "target-1",
      sessionId: "session-1",
      serverTime: "2026-05-11T00:00:00.000Z",
    });

    assert.ok(ack);
    assert.equal(ack.computeTargetId, "target-1");
    assert.equal(ack.clerkUserId, undefined);
    assert.equal(ack.organizationId, undefined);
  });
});
