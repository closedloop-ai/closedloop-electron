import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { SettingsStore } from "../src/main/settings-store.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("constructor deletes stale allowedDirectories key from persisted store", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "settings-migration-"));
  tempDirs.push(tmpDir);

  // Pre-seed a JSON file with the stale key
  const storeName = "test-settings";
  fs.writeFileSync(
    path.join(tmpDir, `${storeName}.json`),
    JSON.stringify({ allowedDirectories: ["/old/path"], sandboxBaseDirectory: "/Users/test/Source" })
  );

  const store = new SettingsStore({ cwd: tmpDir, name: storeName });
  const all = store.getAll();

  assert.equal("allowedDirectories" in all, false, "allowedDirectories should be removed from getAll()");
  assert.equal(all.sandboxBaseDirectory, "/Users/test/Source", "other settings should be preserved");
});

test("constructor does not error when allowedDirectories key is absent", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "settings-migration-"));
  tempDirs.push(tmpDir);

  const storeName = "test-settings-clean";
  fs.writeFileSync(
    path.join(tmpDir, `${storeName}.json`),
    JSON.stringify({ sandboxBaseDirectory: "/Users/test/Source" })
  );

  const store = new SettingsStore({ cwd: tmpDir, name: storeName });
  const all = store.getAll();

  assert.equal("allowedDirectories" in all, false);
  assert.equal(all.sandboxBaseDirectory, "/Users/test/Source");
});
