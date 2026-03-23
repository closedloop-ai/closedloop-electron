import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldAutoApprove, OPERATION_RISK_TIERS, riskTierOrder } from "../src/main/approval-policy.js";
import { SUPPORTED_OPERATION_IDS, resolveOperationId } from "../src/main/approval-operations.js";

// --- riskTierOrder ---

test("riskTierOrder returns correct numeric ordering", () => {
  assert.ok(riskTierOrder("low") < riskTierOrder("medium"));
  assert.ok(riskTierOrder("medium") < riskTierOrder("high"));
});

// --- shouldAutoApprove threshold boundary cases ---

test("policy low: auto-approves low-risk, blocks medium and high", () => {
  assert.equal(shouldAutoApprove("health_check", "low", false), true);
  assert.equal(shouldAutoApprove("symphony_loop", "low", false), false);
  assert.equal(shouldAutoApprove("deploy", "low", false), false);
});

test("policy medium: auto-approves low and medium, blocks high", () => {
  assert.equal(shouldAutoApprove("health_check", "medium", false), true);
  assert.equal(shouldAutoApprove("symphony_loop", "medium", false), true);
  assert.equal(shouldAutoApprove("deploy", "medium", false), false);
});

test("policy high: auto-approves all mapped operations", () => {
  assert.equal(shouldAutoApprove("health_check", "high", false), true);
  assert.equal(shouldAutoApprove("symphony_loop", "high", false), true);
  assert.equal(shouldAutoApprove("deploy", "high", false), true);
});

test("forceApproval overrides threshold", () => {
  assert.equal(shouldAutoApprove("health_check", "low", true), false);
});

// --- Unknown operation defaults to high ---

test("unknown operation defaults to high risk", () => {
  assert.equal(shouldAutoApprove("unknown_op", "low", false), false);
  assert.equal(shouldAutoApprove("unknown_op", "medium", false), false);
  assert.equal(shouldAutoApprove("unknown_op", "high", false), true);
});

// --- Map sync ---

test("OPERATION_RISK_TIERS keys exactly match SUPPORTED_OPERATION_IDS", () => {
  assert.deepEqual(
    Object.keys(OPERATION_RISK_TIERS).sort(),
    SUPPORTED_OPERATION_IDS.slice().sort()
  );
});

// --- resolveOperationId routing ---

test("resolveOperationId maps known paths correctly", () => {
  assert.equal(resolveOperationId("/api/engineer/health-check"), "health_check");
  assert.equal(resolveOperationId("/api/engineer/symphony/launch"), "symphony_launch");
  assert.equal(resolveOperationId("/api/engineer/deploy/anything"), "deploy");
});

test("resolveOperationId maps previously unmapped routes", () => {
  assert.equal(resolveOperationId("/api/engineer/version"), "health_check");
  assert.equal(resolveOperationId("/api/engineer/symphony/status"), "symphony_status");
  assert.equal(resolveOperationId("/api/engineer/symphony/status/FEAT-1"), "symphony_status");
  assert.equal(resolveOperationId("/api/engineer/symphony/attachments/FEAT-1/img.png"), "filesystem");
  assert.equal(resolveOperationId("/api/engineer/symphony/upload/FEAT-1"), "filesystem");
});

test("resolveOperationId returns null for truly unknown engineer paths", () => {
  assert.equal(resolveOperationId("/api/engineer/does-not-exist"), null);
});

test("resolveOperationId returns null for paths outside /api/engineer/", () => {
  assert.equal(resolveOperationId("/health"), null);
});
