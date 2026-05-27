import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { parseJwtExpiry } from "../src/main/jwt-utils.js";
import { LoopTokenStore } from "../src/main/loop-token-store.js";
import {
  createTestLoopTokenMeta,
  createTestLoopTokenSafeStorage,
  makeFakeJwt,
} from "./loop-token-test-utils.js";

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
  store.setLoopToken("loop-a", { token: "runner-secret" });
  assert.deepEqual(store.getLoopToken("loop-a"), { token: "runner-secret" });
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
  store.setLoopToken("loop-a", { token: "token-a" });
  store.setLoopToken("loop-b", { token: "token-b" });
  assert.deepEqual(store.listLoopIds().sort(), ["loop-a", "loop-b"]);
  store.deleteLoopToken("loop-a");
  assert.deepEqual(store.listLoopIds(), ["loop-b"]);
});

test("LoopTokenStore roundtrip with full LoopTokenMeta fields", () => {
  const store = new LoopTokenStore({
    cwd: tempRoot,
    name: "lt-meta",
    safeStorage: createTestLoopTokenSafeStorage(),
  });
  const meta = createTestLoopTokenMeta();
  store.setLoopToken("loop-x", meta);
  const result = store.getLoopToken("loop-x");
  assert.deepEqual(result, meta);
  assert.equal(result?.expiresAt, 1_700_000_000_000);
  assert.equal(result?.jti, "test-jti-abc123");
  assert.equal(result?.lastIdempotencyKey, "test-idempotency-key-xyz");
});

test("LoopTokenStore getLoopTokenString returns raw token string", () => {
  const store = new LoopTokenStore({
    cwd: tempRoot,
    name: "lt-str",
    safeStorage: createTestLoopTokenSafeStorage(),
  });
  assert.equal(store.getLoopTokenString("missing"), null);
  store.setLoopToken("loop-s", createTestLoopTokenMeta({ token: "raw-token-value" }));
  assert.equal(store.getLoopTokenString("loop-s"), "raw-token-value");
});

// ---------------------------------------------------------------------------
// Boundary-validation tests (AC-001, AC-002)
// ---------------------------------------------------------------------------

test("LoopTokenStore getLoopToken returns null for valid JSON missing string token", () => {
  // Regression: PR #237 removed the parsed-object guard; a corrupt entry that
  // parses to JSON but lacks a string `token` must resolve to null, not a
  // LoopTokenMeta with undefined .token.
  const corruptPayloads = [
    "{}",
    '{"token":123}',
    '{"token":null}',
    '{"other":"field"}',
    '"just-a-string"',
    "42",
  ];
  for (const payload of corruptPayloads) {
    const store = new LoopTokenStore({
      cwd: tempRoot,
      name: `lt-corrupt-${Buffer.from(payload).toString("hex")}`,
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => Buffer.from(`stub:${s}`, "utf-8"),
        decryptString: () => payload,
      },
    });
    store.setLoopToken("loop-corrupt", { token: "placeholder" });
    assert.equal(
      store.getLoopToken("loop-corrupt"),
      null,
      `expected null for payload: ${payload}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Cloud session token (encrypted, separate from runner token)
// ---------------------------------------------------------------------------

test("LoopTokenStore cloud session token roundtrip and null-when-absent", () => {
  const store = new LoopTokenStore({
    cwd: tempRoot,
    name: "lt-session",
    safeStorage: createTestLoopTokenSafeStorage(),
  });
  assert.equal(store.getCloudSessionToken("loop-a"), null);
  store.setCloudSessionToken("loop-a", "session-jwt-secret");
  assert.equal(store.getCloudSessionToken("loop-a"), "session-jwt-secret");
});

test("LoopTokenStore cloud session token is encrypted at rest (not plaintext on disk)", () => {
  const store = new LoopTokenStore({
    cwd: tempRoot,
    name: "lt-session-enc",
    safeStorage: createTestLoopTokenSafeStorage(),
  });
  store.setCloudSessionToken("loop-a", "session-jwt-secret");
  // The persisted value is base64 of the encrypted blob, never the raw token.
  const onDisk = JSON.stringify(
    (store as unknown as { store: { store: unknown } }).store.store,
  );
  assert.equal(
    onDisk.includes("session-jwt-secret"),
    false,
    "raw session token must not appear in the persisted store",
  );
});

test("LoopTokenStore runner-token rotation does NOT clobber the cloud session token", () => {
  // This is the core invariant of storing the session token in a separate map:
  // refresh/revival rewrite the runner-token meta wholesale, and must not drop
  // the long-lived session token.
  const store = new LoopTokenStore({
    cwd: tempRoot,
    name: "lt-no-clobber",
    safeStorage: createTestLoopTokenSafeStorage(),
  });
  store.setLoopToken("loop-a", { token: "runner-v1" });
  store.setCloudSessionToken("loop-a", "session-secret");

  // Simulate a refresh/revival that replaces the runner meta entirely.
  store.setLoopToken("loop-a", { token: "runner-v2", jti: "new-jti" });

  assert.equal(store.getLoopTokenString("loop-a"), "runner-v2");
  assert.equal(
    store.getCloudSessionToken("loop-a"),
    "session-secret",
    "session token must survive runner-token rotation",
  );
});

test("LoopTokenStore deleteLoopToken removes both runner and session tokens", () => {
  const store = new LoopTokenStore({
    cwd: tempRoot,
    name: "lt-session-del",
    safeStorage: createTestLoopTokenSafeStorage(),
  });
  store.setLoopToken("loop-a", { token: "runner" });
  store.setCloudSessionToken("loop-a", "session");
  store.deleteLoopToken("loop-a");
  assert.equal(store.getLoopToken("loop-a"), null);
  assert.equal(store.getCloudSessionToken("loop-a"), null);
});

test("LoopTokenStore getCloudSessionToken returns null when safeStorage unavailable", () => {
  const store = new LoopTokenStore({
    cwd: tempRoot,
    name: "lt-session-unavailable",
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(`stub:${s}`, "utf-8"),
      decryptString: (b: Buffer) => {
        const s = b.toString("utf-8");
        return s.startsWith("stub:") ? s.slice(5) : s;
      },
    },
  });
  store.setCloudSessionToken("loop-a", "session-secret");
  assert.equal(store.getCloudSessionToken("loop-a"), "session-secret");

  // A store pointed at the same data but with encryption unavailable must
  // gracefully return null rather than throw.
  const unavailable = new LoopTokenStore({
    cwd: tempRoot,
    name: "lt-session-unavailable",
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.from(""),
      decryptString: () => "",
    },
  });
  assert.equal(unavailable.getCloudSessionToken("loop-a"), null);
});

// ---------------------------------------------------------------------------
// parseJwtExpiry tests
// ---------------------------------------------------------------------------

test("parseJwtExpiry extracts numeric exp claim", () => {
  const token = makeFakeJwt({ sub: "user", exp: 1_700_000_000 });
  assert.equal(parseJwtExpiry(token), 1_700_000_000);
});

test("parseJwtExpiry returns null for missing exp claim", () => {
  const token = makeFakeJwt({ sub: "user" });
  assert.equal(parseJwtExpiry(token), null);
});

test("parseJwtExpiry returns null for non-numeric exp", () => {
  const token = makeFakeJwt({ exp: "not-a-number" });
  assert.equal(parseJwtExpiry(token), null);
});

test("parseJwtExpiry returns null for malformed token (wrong number of parts)", () => {
  assert.equal(parseJwtExpiry("only.two"), null);
  assert.equal(parseJwtExpiry("no-dots-at-all"), null);
});

test("parseJwtExpiry returns null for invalid base64url payload", () => {
  // Construct a token with a payload that is not valid base64url JSON.
  assert.equal(parseJwtExpiry("header.!!!invalid!!!.sig"), null);
});

test("parseJwtExpiry returns null for non-object JSON payload", () => {
  const header = Buffer.from("{}").toString("base64url");
  const arrayPayload = Buffer.from(JSON.stringify([1, 2, 3])).toString("base64url");
  assert.equal(parseJwtExpiry(`${header}.${arrayPayload}.sig`), null);
});
