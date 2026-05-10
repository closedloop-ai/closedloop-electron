import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const appSource = readFileSync(new URL("../src/main/app.ts", import.meta.url), "utf8");

test("DesktopApplication wires command key reconciliation to signing hello ack", () => {
  assert.match(
    appSource,
    /this\.commandKeyReconciler = new CommandKeyReconciler\(\{[\s\S]*notifyPendingKeys: \(organizationKeys\) =>[\s\S]*this\.notifyPendingCommandSigningKeysForOrganizationKeys\([\s\S]*organizationKeys,[\s\S]*\)/,
  );
  assert.match(
    appSource,
    /if \(this\.serverCommandSigningSupported\) \{[\s\S]*this\.commandKeyReconciler\.start\(\);[\s\S]*this\.commandKeyReconciler\.reconcileNow\("hello_ack"\);[\s\S]*\} else \{[\s\S]*this\.commandKeyReconciler\.stop\(\);/,
  );
  assert.doesNotMatch(
    appSource,
    /onHelloAck: \(event\) => \{[\s\S]*this\.pendingCommandKeyNotifier\.notifyPendingKeys\(\);[\s\S]*this\.commandKeyReconciler\.reconcileNow\("hello_ack"\);/,
  );
});

test("DesktopApplication handles reserved approval request before setup and pause gates", () => {
  assert.match(
    appSource,
    /onCommand: \(command\) => \{[\s\S]*classifyBrowserCommandKeyApprovalRequestCommand\(command\);[\s\S]*this\.handleBrowserCommandKeyApprovalRequestCommand\(command\);[\s\S]*classifyBrowserCommandKeyRevocationCommand\(command\);[\s\S]*if \(!this\.isDesktopSetupComplete\(\)\)[\s\S]*if \(this\.cloudCommandsPaused\)/,
  );
  assert.match(
    appSource,
    /handleReservedBrowserCommandKeyApprovalRequest\(command, \{[\s\S]*onChanged: \(\) => this\.notifyCommandKeysChanged\(\)/,
  );
});

test("DesktopApplication dismisses pending command key notifications after settings approval decisions", () => {
  assert.match(
    appSource,
    /private async approveOrganizationCommandPublicKey\([\s\S]*this\.authorizedCommandKeys\.authorize\([\s\S]*this\.pendingCommandKeyNotifier\.dismiss\(key\.fingerprint\);/,
  );
  assert.match(
    appSource,
    /private async rejectOrganizationCommandPublicKey\([\s\S]*this\.authorizedCommandKeys\.reject\(trimmedFingerprint\);[\s\S]*this\.pendingCommandKeyNotifier\.dismiss\(trimmedFingerprint\);/,
  );
});

test("DesktopApplication stops command key reconciliation on disconnect and shutdown paths", () => {
  assert.match(
    appSource,
    /onDisconnect: \(reason\) => \{[\s\S]*this\.commandKeyReconciler\.stop\(\);/,
  );
  assert.match(
    appSource,
    /async shutdown\(\): Promise<ShutdownResult> \{[\s\S]*this\.commandKeyReconciler\.stop\(\);[\s\S]*return runShutdownSequence/,
  );
  assert.match(
    appSource,
    /private restartCloudSocket\(\): void \{[\s\S]*this\.commandKeyReconciler\.stop\(\);[\s\S]*this\.cloudSocket\.restart\(\);/,
  );
});
