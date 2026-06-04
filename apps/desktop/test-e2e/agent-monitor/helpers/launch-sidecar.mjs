// Boot the real built Agent Monitor sidecar against a fixture DB on a random
// localhost port, then wait until it answers /api/health. Same code path the
// Electron host uses in production via agent-monitor-sidecar.ts.

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SIDECAR_DIR = join(HERE, "..", "..", "..", ".generated", "agent-monitor");
const SIDECAR_ENTRY = join(SIDECAR_DIR, "server", "index.js");
const DESKTOP_PKG = join(HERE, "..", "..", "..", "package.json");

// Mirror src/main/agent-monitor-sidecar.ts buildRuntimeNodePath(): point at the
// pnpm-managed agent-dashboard package root + its sibling node_modules dir so
// the sidecar can resolve express/cors/ws/etc. without bundling them.
function buildRuntimeNodePath() {
  const require_ = createRequire(DESKTOP_PKG);
  const candidates = [];
  try {
    const pkgJson = require_.resolve("agent-dashboard/package.json");
    const pkgRoot = dirname(realpathSync(pkgJson));
    candidates.push(dirname(pkgRoot)); // pnpm .pnpm/<hash>/node_modules/
    candidates.push(join(pkgRoot, "node_modules"));
  } catch {
    /* fall through; tests will fail with a useful error from the sidecar */
  }
  if (process.env.NODE_PATH) candidates.push(process.env.NODE_PATH);
  return [...new Set(candidates.filter((p) => p && existsSync(p)))].join(
    delimiter,
  );
}

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
      lastErr = new Error(`status ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `sidecar did not become healthy on port ${port}: ${lastErr?.message}`,
  );
}

export async function launchSidecar({ dbPath, env = {} } = {}) {
  if (!dbPath) throw new Error("launchSidecar requires { dbPath }");
  if (!existsSync(SIDECAR_ENTRY)) {
    throw new Error(
      `Agent Monitor sidecar bundle not found at ${SIDECAR_ENTRY}. Run ` +
        `\`pnpm --filter desktop build:agent-monitor\` before invoking the ` +
        `test harness, or use the \`test:contract\`/\`test:e2e\` npm scripts ` +
        `which chain the build automatically.`,
    );
  }
  const port = await pickFreePort();
  const nodePath = buildRuntimeNodePath();
  // The sidecar's startup also ingests sessions/packs from harness home dirs
  // (Claude/Codex/Cursor/Copilot/OpenCode) and refreshes the pack catalog from
  // GitHub. Point every home env var at an empty sandbox dir so tests see ONLY
  // fixture data, and tarpit GitHub with an unroutable proxy so the catalog
  // refresh fails fast and silently (the upserter no-ops on error).
  const sandboxHome = mkdtempSync(join(tmpdir(), "closedloop-e2e-home-"));
  const child = spawn(process.execPath, [SIDECAR_ENTRY], {
    cwd: SIDECAR_DIR,
    env: {
      ...process.env,
      NODE_ENV: "production",
      ...(nodePath ? { NODE_PATH: nodePath } : {}),
      DASHBOARD_PORT: String(port),
      DASHBOARD_DB_PATH: dbPath,
      CCAM_AUTO_INSTALL_HOOKS: "0",
      CCAM_ENABLE_RUN: "0",
      // FEA-1407 sandbox scoping: the hook handler silently drops events
      // whose data.cwd is outside SANDBOX_BASE_DIRECTORY. Tests post
      // synthetic fixture events with cwd="/Users/dev/repo"; widening the
      // sandbox to "/" lets fixture cwds pass without exposing real data
      // (tests run against a temp DB seeded by seed-fixture-db.mjs).
      SANDBOX_BASE_DIRECTORY: "/",
      // Harness ingest sandboxing — every importer reads from these.
      HOME: sandboxHome,
      CLAUDE_HOME: join(sandboxHome, ".claude"),
      CODEX_HOME: join(sandboxHome, ".codex"),
      CURSOR_HOME: join(sandboxHome, ".cursor"),
      COPILOT_HOME: join(sandboxHome, ".copilot"),
      OPENCODE_DATA_DIR: join(sandboxHome, ".local", "share", "opencode"),
      // pack-scanner reads SKIP_CATALOG_DETECTORS to short-circuit detector
      // logic that walks plugin dirs.
      SKIP_CATALOG_DETECTORS: "1",
      // Block outbound HTTPS so catalog-fetcher's GitHub call fails fast.
      // 127.0.0.1:1 is closed; fetch returns a connection error instantly.
      HTTPS_PROXY: "http://127.0.0.1:1",
      HTTP_PROXY: "http://127.0.0.1:1",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs = { stdout: "", stderr: "" };
  child.stdout.on("data", (b) => {
    logs.stdout += b.toString();
  });
  child.stderr.on("data", (b) => {
    logs.stderr += b.toString();
  });

  const exited = new Promise((resolve) => child.once("exit", resolve));

  try {
    await waitForHealth(port);
  } catch (err) {
    child.kill("SIGKILL");
    err.message += `\n--- sidecar stdout ---\n${logs.stdout}\n--- sidecar stderr ---\n${logs.stderr}`;
    throw err;
  }

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    pid: child.pid,
    logs,
    async stop() {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        const killTimer = setTimeout(() => child.kill("SIGKILL"), 3000);
        await exited;
        clearTimeout(killTimer);
      }
      rmSync(sandboxHome, { recursive: true, force: true });
    },
  };
}
