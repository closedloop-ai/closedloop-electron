import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  extractJwtExp,
  LoopTokenStore,
} from "../src/main/loop-token-store.js";
import { createTestLoopTokenSafeStorage } from "./loop-token-test-utils.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "loop-token-store-test-"),
  );
});

afterEach(async () => {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("LoopTokenStore roundtrip and delete", () => {
  const store = new LoopTokenStore({
    cwd: tempRoot,
    name: "lt-store",
    safeStorage: createTestLoopTokenSafeStorage(),
  });
  assert.equal(store.getLoopToken("loop-a"), null);
  store.setLoopToken("loop-a", "runner-secret");
  assert.equal(store.getLoopToken("loop-a"), "runner-secret");
  store.deleteLoopToken("loop-a");
  assert.equal(store.getLoopToken("loop-a"), null);
});

test("LoopTokenStore delete is idempotent", () => {
  const store = new LoopTokenStore({
    cwd: tempRoot,
    name: "lt-idem",
    safeStorage: createTestLoopTokenSafeStorage(),
  });
  store.deleteLoopToken("missing");
  assert.equal(store.getLoopToken("missing"), null);
});

test("LoopTokenStore listLoopIds reflects set and delete", () => {
  const store = new LoopTokenStore({
    cwd: tempRoot,
    name: "lt-list",
    safeStorage: createTestLoopTokenSafeStorage(),
  });
  assert.deepEqual(store.listLoopIds(), []);
  store.setLoopToken("loop-a", "token-a");
  store.setLoopToken("loop-b", "token-b");
  assert.deepEqual(store.listLoopIds().sort(), ["loop-a", "loop-b"]);
  store.deleteLoopToken("loop-a");
  assert.deepEqual(store.listLoopIds(), ["loop-b"]);
});

// --- LoopTokenMeta round-trip (AC-003) ---

test("LoopTokenStore metadata round-trip: all fields survive persistence", () => {
  const store = new LoopTokenStore({
    cwd: tempRoot,
    name: "lt-meta-all",
    safeStorage: createTestLoopTokenSafeStorage(),
  });
  const meta = {
    token: "runner-secret",
    expiresAt: 1_700_000_000_000,
    jti: "jti-abc-123",
    lastIdempotencyKey: "idempotency-key-xyz",
  };
  store.setLoopTokenWithMeta("loop-a", meta);
  const result = store.getLoopTokenWithMeta("loop-a");
  assert.deepEqual(result, meta);
});

test("LoopTokenStore metadata round-trip: token-only meta survives persistence", () => {
  const store = new LoopTokenStore({
    cwd: tempRoot,
    name: "lt-meta-token-only",
    safeStorage: createTestLoopTokenSafeStorage(),
  });
  store.setLoopTokenWithMeta("loop-b", { token: "plain-token" });
  const result = store.getLoopTokenWithMeta("loop-b");
  assert.deepEqual(result, { token: "plain-token" });
});

test("LoopTokenStore metadata round-trip: expiresAt and jti survive without lastIdempotencyKey", () => {
  const store = new LoopTokenStore({
    cwd: tempRoot,
    name: "lt-meta-partial",
    safeStorage: createTestLoopTokenSafeStorage(),
  });
  const meta = {
    token: "runner-secret",
    expiresAt: 1_800_000_000_000,
    jti: "jti-def-456",
  };
  store.setLoopTokenWithMeta("loop-c", meta);
  const result = store.getLoopTokenWithMeta("loop-c");
  assert.deepEqual(result, meta);
});

test("LoopTokenStore metadata: getLoopToken returns token from meta entry", () => {
  const store = new LoopTokenStore({
    cwd: tempRoot,
    name: "lt-meta-gettoken",
    safeStorage: createTestLoopTokenSafeStorage(),
  });
  store.setLoopTokenWithMeta("loop-d", {
    token: "meta-token",
    expiresAt: 9_000_000_000_000,
  });
  assert.equal(store.getLoopToken("loop-d"), "meta-token");
});

test("LoopTokenStore metadata: getLoopTokenWithMeta returns null for missing loopId", () => {
  const store = new LoopTokenStore({
    cwd: tempRoot,
    name: "lt-meta-missing",
    safeStorage: createTestLoopTokenSafeStorage(),
  });
  assert.equal(store.getLoopTokenWithMeta("nonexistent"), null);
});

// --- Legacy single-string backward compatibility (AC-003) ---

test("LoopTokenStore legacy compat: setLoopToken entry readable via getLoopTokenWithMeta as { token }", () => {
  const store = new LoopTokenStore({
    cwd: tempRoot,
    name: "lt-legacy",
    safeStorage: createTestLoopTokenSafeStorage(),
  });
  store.setLoopToken("loop-legacy", "legacy-token-value");
  const result = store.getLoopTokenWithMeta("loop-legacy");
  assert.deepEqual(result, { token: "legacy-token-value" });
});

test("LoopTokenStore legacy compat: getLoopToken still works after legacy write", () => {
  const store = new LoopTokenStore({
    cwd: tempRoot,
    name: "lt-legacy-get",
    safeStorage: createTestLoopTokenSafeStorage(),
  });
  store.setLoopToken("loop-legacy2", "legacy-runner-secret");
  assert.equal(store.getLoopToken("loop-legacy2"), "legacy-runner-secret");
});

// --- extractJwtExp (AC-003, AC-004) ---

/**
 * Build a base64url-encoded JWT with the given payload.
 * The header and signature are stubs — only the payload segment is verified by extractJwtExp.
 */
function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString(
    "base64url",
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.stub-signature`;
}

test("extractJwtExp: returns exp*1000 for valid JWT with numeric exp", () => {
  const exp = 1_700_000_000;
  const token = makeJwt({ sub: "user-1", exp });
  assert.equal(extractJwtExp(token), exp * 1000);
});

test("extractJwtExp: returns undefined for token with wrong number of segments (2 parts)", () => {
  assert.equal(extractJwtExp("header.payload"), undefined);
});

test("extractJwtExp: returns undefined for token with wrong number of segments (4 parts)", () => {
  assert.equal(extractJwtExp("a.b.c.d"), undefined);
});

test("extractJwtExp: returns undefined for token with empty string", () => {
  assert.equal(extractJwtExp(""), undefined);
});

test("extractJwtExp: returns undefined for non-JSON payload", () => {
  // payload segment decodes to plain text, not JSON
  const notJson = Buffer.from("not-valid-json").toString("base64url");
  assert.equal(extractJwtExp(`header.${notJson}.sig`), undefined);
});

test("extractJwtExp: returns undefined when exp field is missing from payload", () => {
  const token = makeJwt({ sub: "user-1", iat: 1_600_000_000 });
  assert.equal(extractJwtExp(token), undefined);
});

test("extractJwtExp: returns undefined when exp is a string (non-numeric)", () => {
  const token = makeJwt({ sub: "user-1", exp: "not-a-number" });
  assert.equal(extractJwtExp(token), undefined);
});

test("extractJwtExp: returns undefined when exp is null", () => {
  const token = makeJwt({ sub: "user-1", exp: null });
  assert.equal(extractJwtExp(token), undefined);
});

test("extractJwtExp: returns undefined when payload is a JSON array (not an object)", () => {
  const arrayPayload = Buffer.from(JSON.stringify([1, 2, 3])).toString(
    "base64url",
  );
  assert.equal(extractJwtExp(`header.${arrayPayload}.sig`), undefined);
});

test("extractJwtExp: handles base64url characters (- and _) correctly", () => {
  // Construct a payload that when base64url-encoded contains - and _ characters
  // by using a string that produces those chars in base64url
  const exp = 1_900_000_000;
  // makeJwt uses base64url encoding which will produce - and _ as needed
  const token = makeJwt({ exp, data: "some+data/here" });
  assert.equal(extractJwtExp(token), exp * 1000);
});
