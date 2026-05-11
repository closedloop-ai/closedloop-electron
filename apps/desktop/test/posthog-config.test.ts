import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { resolvePostHogConfig } from "../src/main/posthog-config.js";

const execFileAsync = promisify(execFile);
const appRoot = fileURLToPath(new URL("..", import.meta.url));
const scriptPath = path.join(appRoot, "scripts", "write-posthog-config.mjs");
const generatedDir = path.join(appRoot, "resources", "generated");
const generatedConfigPath = path.join(generatedDir, "posthog-config.json");

const originalEnv = { ...process.env };

afterEach(async () => {
  process.env = { ...originalEnv };
  await rm(generatedConfigPath, { force: true });
});

describe("resolvePostHogConfig", () => {
  test("prefers valid env key and optional host override", () => {
    const config = resolvePostHogConfig({
      env: {
        CL_POSTHOG_API_KEY: " phc_env ",
        CL_POSTHOG_HOST: " https://example.posthog.test ",
      },
      isPackaged: false,
    });

    assert.deepEqual(config, {
      apiKey: "phc_env",
      host: "https://example.posthog.test",
    });
  });

  test("defaults host for valid env key when host is absent", () => {
    const config = resolvePostHogConfig({
      env: { CL_POSTHOG_API_KEY: "phc_env" },
      isPackaged: false,
    });

    assert.deepEqual(config, {
      apiKey: "phc_env",
      host: "https://us.i.posthog.com",
    });
  });

  test("falls back to packaged config when env key is absent", async () => {
    const resourcesPath = await makePackagedConfig({
      apiKey: "phc_packaged",
      host: "https://packaged.posthog.test",
    });

    const config = resolvePostHogConfig({
      env: {},
      resourcesPath,
    });

    assert.deepEqual(config, {
      apiKey: "phc_packaged",
      host: "https://packaged.posthog.test",
    });
  });

  test("returns undefined when env and packaged config are absent", () => {
    assert.equal(resolvePostHogConfig({ env: {}, isPackaged: false }), undefined);
  });

  test("invalid env key fails closed and does not fall back to packaged config", async () => {
    const resourcesPath = await makePackagedConfig({
      apiKey: "phc_packaged",
      host: "https://packaged.posthog.test",
    });

    const config = resolvePostHogConfig({
      env: { CL_POSTHOG_API_KEY: "pk_wrong" },
      resourcesPath,
    });

    assert.equal(config, undefined);
  });

  test("invalid packaged key is ignored", async () => {
    const resourcesPath = await makePackagedConfig({
      apiKey: "pk_wrong",
      host: "https://packaged.posthog.test",
    });

    assert.equal(resolvePostHogConfig({ env: {}, resourcesPath }), undefined);
  });
});

describe("write-posthog-config.mjs", () => {
  test("writes generated config for a valid key without logging the key", async () => {
    await runWriter({
      CL_POSTHOG_API_KEY: "phc_script",
    });

    assert.equal(existsSync(generatedConfigPath), true);
    const config = resolvePostHogConfig({
      env: {},
      resourcesPath: path.join(appRoot, "resources"),
    });
    assert.deepEqual(config, {
      apiKey: "phc_script",
      host: "https://us.i.posthog.com",
    });
  });

  test("removes stale generated config when key is missing", async () => {
    await writeStaleGeneratedConfig();

    const result = await runWriter({});

    assert.equal(existsSync(generatedConfigPath), false);
    assert.equal(result.stdout.includes("phc_stale"), false);
    assert.equal(result.stderr.includes("phc_stale"), false);
  });

  test("removes stale generated config when key is invalid", async () => {
    await writeStaleGeneratedConfig();

    const result = await runWriter({
      CL_POSTHOG_API_KEY: "pk_invalid",
    });

    assert.equal(existsSync(generatedConfigPath), false);
    assert.equal(result.stdout.includes("pk_invalid"), false);
    assert.equal(result.stderr.includes("pk_invalid"), false);
  });
});

async function makePackagedConfig(config: unknown): Promise<string> {
  const resourcesPath = await mkdtemp(path.join(os.tmpdir(), "posthog-config-"));
  const targetDir = path.join(resourcesPath, "generated");
  await mkdir(targetDir, { recursive: true });
  await writeFile(
    path.join(targetDir, "posthog-config.json"),
    JSON.stringify(config),
  );
  return resourcesPath;
}

async function writeStaleGeneratedConfig(): Promise<void> {
  await mkdir(generatedDir, { recursive: true });
  await writeFile(
    generatedConfigPath,
    JSON.stringify({
      apiKey: "phc_stale",
      host: "https://stale.posthog.test",
    }),
  );
}

async function runWriter(
  overrides: Record<string, string>,
): Promise<{ stdout: string; stderr: string }> {
  const env = { ...process.env, ...overrides };
  if (!("CL_POSTHOG_API_KEY" in overrides)) {
    Reflect.deleteProperty(env, "CL_POSTHOG_API_KEY");
  }
  if (!("CL_POSTHOG_HOST" in overrides)) {
    Reflect.deleteProperty(env, "CL_POSTHOG_HOST");
  }
  return execFileAsync(process.execPath, [scriptPath], {
    cwd: appRoot,
    env,
  });
}
