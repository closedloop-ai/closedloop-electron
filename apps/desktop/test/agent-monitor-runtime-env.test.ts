import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";

const requireFromHere = createRequire(import.meta.url);
const generatedRoot = path.resolve(
  new URL("../.generated/agent-monitor", import.meta.url).pathname,
);
const runtimeFile = path.join(generatedRoot, "server", "closedloop-runtime.js");

test("in-process runtime sanitizes dashboard env for ESM child_process named imports", async (t) => {
  if (!existsSync(runtimeFile)) {
    t.skip("generated Agent Monitor runtime is not built");
    return;
  }

  const runtime = requireFromHere(runtimeFile) as {
    startClosedLoopAgentMonitorRuntime: (options: {
      rootDir: string;
      port: number;
      env: NodeJS.ProcessEnv;
    }) => Promise<{ stop: () => Promise<void> | void }>;
  };

  const tmp = mkdtempSync(path.join(tmpdir(), "closedloop-agent-monitor-env-"));
  const port = await getFreePort();
  const previousEnv = snapshotEnv([
    "DASHBOARD_DB_PATH",
    "DASHBOARD_PORT",
    "CCAM_ENABLE_RUN",
  ]);
  process.env.DASHBOARD_DB_PATH = "host-dashboard.db";
  process.env.DASHBOARD_PORT = "49999";
  process.env.CCAM_ENABLE_RUN = "host-run";
  const hostCwd = process.cwd();

  let handle: { stop: () => Promise<void> | void } | null = null;
  try {
    handle = await runtime.startClosedLoopAgentMonitorRuntime({
      rootDir: generatedRoot,
      port,
      env: {
        NODE_ENV: "production",
        DASHBOARD_DB_PATH: path.join(tmp, "dashboard.db"),
        CCAM_VAPID_KEYS_PATH: path.join(tmp, "vapid-keys.json"),
        CCAM_ENABLE_RUN: "0",
        CCAM_AUTO_INSTALL_HOOKS: "0",
        SANDBOX_BASE_DIRECTORY: tmp,
      },
    });

    assert.equal(process.env.DASHBOARD_DB_PATH, "host-dashboard.db");
    assert.equal(process.env.DASHBOARD_PORT, "49999");
    assert.equal(process.cwd(), hostCwd);

    const overviewResponse = await fetch(
      `http://127.0.0.1:${port}/api/cc-config/overview`,
    );
    assert.equal(overviewResponse.status, 200);
    const overview = await overviewResponse.json() as {
      roots: { projectRoot: string };
    };
    assert.equal(overview.roots.projectRoot, generatedRoot);

    const inheritedResult = spawnSync(
      process.execPath,
      [
        "-e",
        [
          "process.stdout.write(JSON.stringify({",
          "db: process.env.DASHBOARD_DB_PATH ?? null,",
          "port: process.env.DASHBOARD_PORT ?? null,",
          "run: process.env.CCAM_ENABLE_RUN ?? null",
          "}));",
        ].join(""),
      ],
      {
        encoding: "utf8",
        env: { ...process.env },
      },
    );
    assert.equal(inheritedResult.status, 0, inheritedResult.stderr);
    assert.deepEqual(JSON.parse(inheritedResult.stdout), {
      db: "host-dashboard.db",
      port: "49999",
      run: "host-run",
    });

    const explicitResult = spawnSync(
      process.execPath,
      [
        "-e",
        [
          "process.stdout.write(JSON.stringify({",
          "db: process.env.DASHBOARD_DB_PATH ?? null,",
          "port: process.env.DASHBOARD_PORT ?? null,",
          "nodeEnv: process.env.NODE_ENV ?? null",
          "}));",
        ].join(""),
      ],
      {
        encoding: "utf8",
        env: {
          DASHBOARD_DB_PATH: "explicit-child-dashboard.db",
          DASHBOARD_PORT: "12345",
          NODE_ENV: "child-mode",
        },
      },
    );
    assert.equal(explicitResult.status, 0, explicitResult.stderr);
    assert.deepEqual(JSON.parse(explicitResult.stdout), {
      db: "explicit-child-dashboard.db",
      port: "12345",
      nodeEnv: "child-mode",
    });
  } finally {
    if (handle) {
      await handle.stop();
    }
    restoreEnv(previousEnv);
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("in-process runtime rejects an already-aborted startup without installing global state", async (t) => {
  if (!existsSync(runtimeFile)) {
    t.skip("generated Agent Monitor runtime is not built");
    return;
  }

  const runtime = requireFromHere(runtimeFile) as {
    startClosedLoopAgentMonitorRuntime: (options: {
      rootDir: string;
      port: number;
      env: NodeJS.ProcessEnv;
      signal?: AbortSignal;
    }) => Promise<{ stop: () => Promise<void> | void }>;
  };

  const tmp = mkdtempSync(path.join(tmpdir(), "closedloop-agent-monitor-abort-"));
  const port = await getFreePort();
  const hostCwd = process.cwd();
  const previousEnv = snapshotEnv(["DASHBOARD_DB_PATH", "DASHBOARD_PORT", "NODE_ENV"]);
  const controller = new AbortController();
  controller.abort();

  try {
    await assert.rejects(
      runtime.startClosedLoopAgentMonitorRuntime({
        rootDir: generatedRoot,
        port,
        env: {
          NODE_ENV: "production",
          DASHBOARD_DB_PATH: path.join(tmp, "dashboard.db"),
          DASHBOARD_PORT: String(port),
        },
        signal: controller.signal,
      }),
      /aborted|Abort/i,
    );
    assert.equal(process.cwd(), hostCwd);
    for (const [key, value] of previousEnv) {
      assert.equal(process.env[key], value);
    }
  } finally {
    restoreEnv(previousEnv);
    rmSync(tmp, { recursive: true, force: true });
  }
});

function snapshotEnv(keys: string[]): Map<string, string | undefined> {
  const values = new Map<string, string | undefined>();
  for (const key of keys) {
    values.set(
      key,
      Object.prototype.hasOwnProperty.call(process.env, key)
        ? process.env[key]
        : undefined,
    );
  }
  return values;
}

function restoreEnv(values: Map<string, string | undefined>): void {
  for (const [key, value] of values) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("failed to allocate a free local port"));
        }
      });
    });
  });
}
