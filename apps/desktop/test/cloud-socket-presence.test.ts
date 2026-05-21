import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, describe, test } from "node:test";
import { CloudSocketService, type CloudSocketOptions } from "../src/main/cloud-socket.js";
import { GATEWAY_PROTOCOL_VERSION } from "../src/shared/contracts.js";
import { gatewayLog } from "../src/main/gateway-logger.js";

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
    getEnabledOperations: () => ["test_op"],
    machineName: "test-machine",
    pluginVersion: "1.0.0-test",
    desktopClientVersion: "0.13.9-test",
    gatewayProtocolVersion: "0.1.0",
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
  test("CloudSocketService emits all three version fields in desktop.hello", () => {
    const service = new CloudSocketService(
      createStubOptions({
        desktopClientVersion: "0.13.9-test",
        gatewayProtocolVersion: "0.1.0",
        pluginVersion: "1.0.0-test",
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

    service.stop();
  });
});
