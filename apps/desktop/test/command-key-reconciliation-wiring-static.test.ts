import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const appSource = readFileSync(new URL("../src/main/app.ts", import.meta.url), "utf8");
const cloudSocketSource = readFileSync(
  new URL("../src/main/cloud-socket.ts", import.meta.url),
  "utf8",
);

test("DesktopApplication wires command key reconciliation to signing hello ack", () => {
  assert.match(
    appSource,
    /this\.commandKeyReconciler = new CommandKeyReconciler\(\{[\s\S]*notifyPendingKeys: \(organizationKeys\) =>[\s\S]*this\.notifyPendingCommandSigningKeysForOrganizationKeys\([\s\S]*organizationKeys,[\s\S]*\)/,
  );
  assert.match(
    appSource,
    /if \(this\.serverCommandSigningSupported\) \{[\s\S]*this\.commandKeyReconciler\.start\(\);[\s\S]*this\.commandKeyReconciler\.reconcileNow\("hello_ack"\);[\s\S]*\} else \{[\s\S]*this\.commandKeyReconciler\.stop\(\);/,
  );
  assert.match(
    appSource,
    /onHelloAck: \(event\) => \{[\s\S]*this\.serverCommandSigningSupported =[\s\S]*this\.notifyCommandKeysChanged\(\);/,
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

test("DesktopApplication hides command key state from settings when server support is absent", () => {
  const unsupportedBlock = appSource.slice(
    appSource.indexOf("if (!this.serverCommandSigningSupported)"),
    appSource.indexOf("const authorizedFingerprints = new Set"),
  );
  assert.match(
    appSource,
    /private async listCommandSigningKeys\(\): Promise<[\s\S]*if \(!this\.serverCommandSigningSupported\) \{[\s\S]*available: \[\],[\s\S]*authorized: \[\],[\s\S]*rejectedFingerprints: \[\],[\s\S]*serverSupported: false,[\s\S]*enforcementEnabled: this\.settingsStore\.getCommandSigningEnforcementEnabled\(\),[\s\S]*\};[\s\S]*\}[\s\S]*const authorizedFingerprints = new Set/,
  );
  assert.equal(
    unsupportedBlock.includes("this.fetchAvailableCommandSigningKeys("),
    false,
  );
  assert.match(
    unsupportedBlock,
    /List browser command keys skipped; server support is disabled/,
  );
});

test("DesktopApplication logs command-signing support decisions from hello ack", () => {
  assert.match(
    appSource,
    /Server support from hello ack: computeTargetId=\$\{event\.computeTargetId\}, computeTargetSigning=\$\{event\.serverCapabilities\?\.computeTargetSigning === true\}/,
  );
  assert.match(
    cloudSocketSource,
    /Hello ack received, targetId=\$\{computeTargetId\}, serverCapabilityKeys=\$\{formatObjectKeysForLog\(rawServerCapabilities\)\}, computeTargetSigning=\$\{formatPrimitiveForLog\(rawComputeTargetSigning\)\}, parsedComputeTargetSigning=\$\{parsedServerCapabilities\?\.computeTargetSigning === true\}/,
  );
});

test("DesktopApplication stops command key reconciliation on disconnect and shutdown paths", () => {
  assert.match(
    appSource,
    /onDisconnect: \(reason\) => \{[\s\S]*this\.commandKeyReconciler\.stop\(\);[\s\S]*this\.notifyCommandKeysChanged\(\);/,
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
