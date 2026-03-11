import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildAllowedDirectories } from "../src/shared/sandbox-policy.js";

test("blank sandbox returns empty allowlist", () => {
  assert.deepEqual(buildAllowedDirectories(""), []);
});

test("null sandbox returns empty allowlist", () => {
  assert.deepEqual(buildAllowedDirectories(null), []);
});

test("undefined sandbox returns empty allowlist", () => {
  assert.deepEqual(buildAllowedDirectories(undefined), []);
});

test("whitespace-only sandbox returns empty allowlist", () => {
  assert.deepEqual(buildAllowedDirectories("   "), []);
});

test("normal sandbox returns single-entry list", () => {
  assert.deepEqual(buildAllowedDirectories("/Users/foo/Source"), ["/Users/foo/Source"]);
});

test("tilde expansion resolves to homedir", () => {
  const expected = [path.join(os.homedir(), "Source")];
  assert.deepEqual(buildAllowedDirectories("~/Source"), expected);
});
