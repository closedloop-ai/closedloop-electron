import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyBrowserCommandKeyApprovalRequestCommand,
  handleBrowserCommandKeyApprovalRequestCommand,
} from "../src/main/browser-command-key-approval-request.js";
import type {
  DesktopCommandAckEvent,
  DesktopCommandEvent,
  DesktopCommandStreamEvent,
} from "../src/main/cloud-protocol.js";
import {
  BROWSER_COMMAND_KEY_APPROVAL_REQUEST_INVALID_REASON,
  BROWSER_COMMAND_KEY_APPROVAL_REQUEST_METHOD,
  BROWSER_COMMAND_KEY_APPROVAL_REQUEST_OPERATION_ID,
  BROWSER_COMMAND_KEY_APPROVAL_REQUEST_PATH,
} from "../src/shared/contracts.js";

test("browser command key approval request uses API protocol literals", () => {
  assert.equal(
    BROWSER_COMMAND_KEY_APPROVAL_REQUEST_OPERATION_ID,
    "browser_key_approval_request",
  );
  assert.equal(
    BROWSER_COMMAND_KEY_APPROVAL_REQUEST_PATH,
    "/api/gateway/internal/browser-key/approval-request",
  );
  assert.equal(BROWSER_COMMAND_KEY_APPROVAL_REQUEST_METHOD, "POST");
});

test("browser command key approval request matcher is exact and reserved", () => {
  assert.equal(
    classifyBrowserCommandKeyApprovalRequestCommand(makeApprovalCommand()),
    "match",
  );
  assert.equal(
    classifyBrowserCommandKeyApprovalRequestCommand(
      makeApprovalCommand({ operationId: "symphony_status" }),
    ),
    "mismatch",
  );
  assert.equal(
    classifyBrowserCommandKeyApprovalRequestCommand(
      makeApprovalCommand({ method: "GET" }),
    ),
    "mismatch",
  );
  assert.equal(
    classifyBrowserCommandKeyApprovalRequestCommand({
      operationId: "symphony_status",
      method: "GET",
      path: "/api/gateway/symphony/status/FEA-1",
    }),
    "not_reserved",
  );
});

test("reserved browser command key approval request acks done and notifies pending flow", async () => {
  const acks: Array<
    Pick<DesktopCommandAckEvent, "commandId" | "accepted" | "state" | "reason">
  > = [];
  const events: Array<
    Pick<DesktopCommandStreamEvent, "commandId" | "sequence" | "eventType" | "data">
  > = [];
  const notifiedFingerprints: string[] = [];
  let changedCount = 0;

  handleBrowserCommandKeyApprovalRequestCommand(
    makeApprovalCommand({ body: { fingerprint: "  cl:abcdefghijklmnopqrstuv  " } }),
    {
      notifyPendingKeys: (fingerprint) => {
        notifiedFingerprints.push(fingerprint);
      },
      sendCommandAck: (event) => acks.push(event),
      sendCommandEvent: (event) => events.push(event),
      onChanged: () => {
        changedCount += 1;
      },
    },
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(acks, [
    {
      commandId: "approval-command",
      accepted: true,
      state: "accepted",
    },
  ]);
  assert.deepEqual(events, [
    {
      commandId: "approval-command",
      sequence: 1,
      eventType: "done",
      data: {
        type: "done",
        fingerprint: "cl:abcdefghijklmnopqrstuv",
      },
    },
  ]);
  assert.equal(changedCount, 1);
  assert.deepEqual(notifiedFingerprints, ["cl:abcdefghijklmnopqrstuv"]);
});

test("malformed browser command key approval request fails without notification", () => {
  const acks: Array<
    Pick<DesktopCommandAckEvent, "commandId" | "accepted" | "state" | "reason">
  > = [];
  const events: Array<
    Pick<DesktopCommandStreamEvent, "commandId" | "sequence" | "eventType" | "data">
  > = [];
  let notifyCount = 0;
  let changedCount = 0;

  handleBrowserCommandKeyApprovalRequestCommand(
    makeApprovalCommand({ body: { fingerprint: "not-a-fingerprint" } }),
    {
      notifyPendingKeys: () => {
        notifyCount += 1;
      },
      sendCommandAck: (event) => acks.push(event),
      sendCommandEvent: (event) => events.push(event),
      onChanged: () => {
        changedCount += 1;
      },
    },
  );

  assert.equal(notifyCount, 0);
  assert.equal(changedCount, 0);
  assert.deepEqual(events, []);
  assert.deepEqual(acks, [
    {
      commandId: "approval-command",
      accepted: false,
      state: "failed",
      reason: BROWSER_COMMAND_KEY_APPROVAL_REQUEST_INVALID_REASON,
    },
  ]);
});

function makeApprovalCommand(
  overrides?: Partial<DesktopCommandEvent>,
): DesktopCommandEvent {
  return {
    protocolVersion: "1",
    messageId: "approval-message",
    timestamp: "2026-05-09T00:00:00.000Z",
    commandId: "approval-command",
    operationId: BROWSER_COMMAND_KEY_APPROVAL_REQUEST_OPERATION_ID,
    method: BROWSER_COMMAND_KEY_APPROVAL_REQUEST_METHOD,
    path: BROWSER_COMMAND_KEY_APPROVAL_REQUEST_PATH,
    body: { fingerprint: "cl:abcdefghijklmnopqrstuv" },
    ...overrides,
  };
}
