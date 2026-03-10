import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  compareSemverDescending,
  findPluginScript,
  findPluginVersions,
  getPluginCacheRoot,
  isPluginInstalled
} from "../src/server/operations/plugin-cache.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-cache-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("getPluginCacheRoot", () => {
  test("returns homedir-based path by default", () => {
    const result = getPluginCacheRoot();
    assert.equal(
      result,
      path.join(os.homedir(), ".claude", "plugins", "cache", "closedloop-ai")
    );
  });

  test("returns override when provided", () => {
    const override = "/custom/cache/root";
    assert.equal(getPluginCacheRoot(override), override);
  });
});

describe("compareSemverDescending", () => {
  test("sorts higher version first", () => {
    assert.ok(compareSemverDescending("2.0.0", "1.0.0") < 0);
  });

  test("sorts lower version last", () => {
    assert.ok(compareSemverDescending("1.0.0", "2.0.0") > 0);
  });

  test("returns 0 for equal versions", () => {
    assert.equal(compareSemverDescending("1.2.3", "1.2.3"), 0);
  });

  test("compares minor versions", () => {
    assert.ok(compareSemverDescending("1.1.0", "1.2.0") > 0);
  });

  test("compares patch versions", () => {
    assert.ok(compareSemverDescending("1.0.2", "1.0.1") < 0);
  });
});

describe("findPluginVersions", () => {
  test("returns semver directories sorted descending", async () => {
    const dir = await makeTempDir();
    await fs.mkdir(path.join(dir, "1.0.0"));
    await fs.mkdir(path.join(dir, "2.1.0"));
    await fs.mkdir(path.join(dir, "1.5.3"));

    const versions = findPluginVersions(dir);
    assert.deepEqual(versions, ["2.1.0", "1.5.3", "1.0.0"]);
  });

  test("returns empty array for missing directory", () => {
    const versions = findPluginVersions("/nonexistent/path");
    assert.deepEqual(versions, []);
  });

  test("excludes non-semver names", async () => {
    const dir = await makeTempDir();
    await fs.mkdir(path.join(dir, "1.0.0"));
    await fs.mkdir(path.join(dir, "latest"));
    await fs.mkdir(path.join(dir, ".hidden"));
    await fs.writeFile(path.join(dir, "readme.txt"), "");

    const versions = findPluginVersions(dir);
    assert.deepEqual(versions, ["1.0.0"]);
  });

  test("handles empty directory", async () => {
    const dir = await makeTempDir();
    const versions = findPluginVersions(dir);
    assert.deepEqual(versions, []);
  });
});

describe("findPluginScript", () => {
  test("returns script from highest version", async () => {
    const cacheRoot = await makeTempDir();
    const scriptsDir1 = path.join(cacheRoot, "code", "1.0.0", "scripts");
    const scriptsDir2 = path.join(cacheRoot, "code", "2.0.0", "scripts");
    await fs.mkdir(scriptsDir1, { recursive: true });
    await fs.mkdir(scriptsDir2, { recursive: true });
    await fs.writeFile(path.join(scriptsDir1, "run-loop.sh"), "#!/bin/bash");
    await fs.writeFile(path.join(scriptsDir2, "run-loop.sh"), "#!/bin/bash");

    const result = findPluginScript("code", "run-loop.sh", cacheRoot);
    assert.equal(result, path.join(scriptsDir2, "run-loop.sh"));
  });

  test("skips versions missing the script", async () => {
    const cacheRoot = await makeTempDir();
    const scriptsDir1 = path.join(cacheRoot, "code", "1.0.0", "scripts");
    const scriptsDir2 = path.join(cacheRoot, "code", "2.0.0", "scripts");
    await fs.mkdir(scriptsDir1, { recursive: true });
    await fs.mkdir(scriptsDir2, { recursive: true });
    await fs.writeFile(path.join(scriptsDir1, "run-loop.sh"), "#!/bin/bash");
    // 2.0.0 does NOT have run-loop.sh

    const result = findPluginScript("code", "run-loop.sh", cacheRoot);
    assert.equal(result, path.join(scriptsDir1, "run-loop.sh"));
  });

  test("returns null when plugin directory missing", async () => {
    const cacheRoot = await makeTempDir();
    const result = findPluginScript("nonexistent", "run-loop.sh", cacheRoot);
    assert.equal(result, null);
  });

  test("returns null when no version has the script", async () => {
    const cacheRoot = await makeTempDir();
    const scriptsDir = path.join(cacheRoot, "code", "1.0.0", "scripts");
    await fs.mkdir(scriptsDir, { recursive: true });
    // No run-loop.sh anywhere

    const result = findPluginScript("code", "run-loop.sh", cacheRoot);
    assert.equal(result, null);
  });
});

describe("isPluginInstalled", () => {
  test("returns true when plugin is registered and install path exists", async () => {
    const tmpDir = await makeTempDir();
    const installPath = path.join(tmpDir, "cache", "closedloop-ai", "code", "1.0.0");
    await fs.mkdir(installPath, { recursive: true });

    const registry = {
      version: 2,
      plugins: {
        "code@closedloop-ai": [{ installPath, version: "1.0.0" }]
      }
    };
    const registryPath = path.join(tmpDir, "installed_plugins.json");
    await fs.writeFile(registryPath, JSON.stringify(registry));

    assert.equal(isPluginInstalled("code", registryPath), true);
  });

  test("returns false when plugin is registered but install path missing", async () => {
    const tmpDir = await makeTempDir();
    const registry = {
      version: 2,
      plugins: {
        "code@closedloop-ai": [{ installPath: path.join(tmpDir, "nonexistent"), version: "1.0.0" }]
      }
    };
    const registryPath = path.join(tmpDir, "installed_plugins.json");
    await fs.writeFile(registryPath, JSON.stringify(registry));

    assert.equal(isPluginInstalled("code", registryPath), false);
  });

  test("returns false when plugin is not in registry", async () => {
    const tmpDir = await makeTempDir();
    const registry = { version: 2, plugins: {} };
    const registryPath = path.join(tmpDir, "installed_plugins.json");
    await fs.writeFile(registryPath, JSON.stringify(registry));

    assert.equal(isPluginInstalled("code", registryPath), false);
  });

  test("returns false when registry file does not exist", async () => {
    const tmpDir = await makeTempDir();
    assert.equal(isPluginInstalled("code", path.join(tmpDir, "missing.json")), false);
  });
});
