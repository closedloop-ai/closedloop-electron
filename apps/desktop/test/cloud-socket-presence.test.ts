import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { CloudSocketService, type CloudSocketOptions } from "../src/main/cloud-socket.js";
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
    machineName: "test-machine",
    pluginVersion: "0.0.1-test",
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
