import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { LoopTokenStore } from "../src/main/loop-token-store.js";
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
