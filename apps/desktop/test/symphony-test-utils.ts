/**
 * Shared test helpers for symphony loop integration tests.
 *
 * Extracted from symphony-loop-execute.test.ts,
 * symphony-loop-cloud-failures.test.ts, and the evaluate-* test files
 * to eliminate duplication.
 */

import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DesktopGatewayServer } from "../src/server/server.js";
import { EMPTY_CAPABILITIES } from "../src/shared/contracts.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecordedRequest = { method: string; url: string; body: string };

// ---------------------------------------------------------------------------
// Environment save/restore
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "SYMPHONY_WORKTREE_PARENT_DIR",
  "PATH",
  "HOME",
  "CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE",
] as const;

export function saveEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
  }
  return saved;
}

export function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

export async function initGitRepo(repoPath: string): Promise<void> {
  await execFileAsync("/bin/sh", ["-c", [
    `git init -b main "${repoPath}"`,
    `cd "${repoPath}"`,
    `git config user.email test@test.com`,
    `git config user.name Test`,
    `echo "# initial" > README.md`,
    `git add .`,
    `git commit -m initial`,
  ].join(" && ")]);
}

// ---------------------------------------------------------------------------
// Mock API server
// ---------------------------------------------------------------------------

/**
 * Start a mock API server. When failUrls is provided, any request whose URL
 * contains a key from the map will receive the mapped status code and an error
 * body. All other requests receive HTTP 200.
 */
export async function startMockApiServer(failUrls?: Map<string, number>): Promise<{
  server: http.Server;
  port: number;
  requests: RecordedRequest[];
  waitForRequest: (urlSubstring: string, timeoutMs?: number) => Promise<RecordedRequest>;
}> {
  const requests: RecordedRequest[] = [];
  const waiters: Array<{ urlSubstring: string; resolve: (r: RecordedRequest) => void }> = [];

  const server = http.createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const recorded: RecordedRequest = {
        method: req.method ?? "",
        url: req.url ?? "",
        body: Buffer.concat(chunks).toString("utf-8"),
      };
      requests.push(recorded);

      for (let i = waiters.length - 1; i >= 0; i--) {
        if (recorded.url.includes(waiters[i].urlSubstring)) {
          waiters[i].resolve(recorded);
          waiters.splice(i, 1);
        }
      }

      // Check if this request should fail
      let failStatus: number | undefined;
      if (failUrls) {
        for (const [urlSubstring, status] of failUrls) {
          if (recorded.url.includes(urlSubstring)) {
            failStatus = status;
            break;
          }
        }
      }

      if (failStatus !== undefined) {
        res.statusCode = failStatus;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "injected failure" }));
      } else {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ success: true }));
      }
    })().catch((err) => {
      console.error("Mock server handler error:", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind mock API server");
  }

  function waitForRequest(urlSubstring: string, timeoutMs = 20_000): Promise<RecordedRequest> {
    const existing = requests.find((r) => r.url.includes(urlSubstring));
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise<RecordedRequest>((resolve, reject) => {
      const entry = {
        urlSubstring,
        resolve: (r: RecordedRequest) => {
          clearTimeout(timer);
          resolve(r);
        },
      };
      const timer = setTimeout(() => {
        const idx = waiters.indexOf(entry);
        if (idx !== -1) waiters.splice(idx, 1);
        reject(
          new Error(
            `Timed out waiting for request matching "${urlSubstring}" after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);
      waiters.push(entry);
    });
  }

  return { server, port: address.port, requests, waitForRequest };
}

// ---------------------------------------------------------------------------
// Fake plugin script
// ---------------------------------------------------------------------------

/**
 * Create the fake plugin cache structure so findPluginScript("code", "run-loop.sh")
 * finds the provided script content.
 */
export async function createFakeRunLoopScript(
  homeDir: string,
  scriptContent: string
): Promise<string> {
  const scriptDir = path.join(
    homeDir,
    ".claude",
    "plugins",
    "cache",
    "closedloop-ai",
    "code",
    "1.0.0",
    "scripts"
  );
  await fs.mkdir(scriptDir, { recursive: true });
  const scriptPath = path.join(scriptDir, "run-loop.sh");
  await fs.writeFile(scriptPath, scriptContent, { mode: 0o755 });
  return scriptPath;
}

// ---------------------------------------------------------------------------
// Polling helpers
// ---------------------------------------------------------------------------

/**
 * Poll mock.requests until a request to /loops/{loopId}/events with
 * type === "completed" is found, or until the timeout elapses.
 */
export async function waitForCompletedEvent(
  requests: RecordedRequest[],
  loopId: string,
  timeoutMs = 20_000
): Promise<Record<string, unknown>> {
  const eventsUrlSubstring = `/loops/${loopId}/events`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const req of requests) {
      if (!req.url.includes(eventsUrlSubstring)) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(req.body) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (parsed.type === "completed") {
        return parsed;
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for completed event for loopId=${loopId} after ${timeoutMs}ms`
  );
}

// ---------------------------------------------------------------------------
// Shared stub helpers
// ---------------------------------------------------------------------------

/** Create a fake `claude` binary in tmpDir/fake-bin and prepend it to PATH. */
export async function setupStubClaude(tmpDir: string, scriptLines?: string[]): Promise<void> {
  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  const stubScript = (scriptLines ?? [
    "#!/bin/sh",
    'echo \'{"type":"result","subtype":"success","result":"","is_error":false}\'',
    "exit 0",
  ]).join("\n");
  await fs.writeFile(path.join(fakeBin, "claude"), stubScript, { mode: 0o755 });
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
}

// ---------------------------------------------------------------------------
// Evaluate-test infrastructure (shared by evaluate-plan, evaluate-code, etc.)
// ---------------------------------------------------------------------------

/**
 * Cleanup tracker for evaluate-style integration tests.
 * Call `createEvaluateTestHarness()` at module scope, then use the returned
 * `makeTempDir`, `makeGatewayServer`, and `startEventServer` helpers.
 * Register `harness.beforeEach` and `harness.afterEach` with the test runner.
 */
export interface EvaluateTestHarness {
  /** Create a temp directory that will be cleaned up in afterEach. */
  makeTempDir: (label: string) => string;
  /** Create a gateway server pre-configured for testing. */
  makeGatewayServer: (options?: {
    allowedDirs?: string[];
    tmpDir?: string;
    getApiOrigin?: () => string;
  }) => DesktopGatewayServer;
  /** Start an event-capture HTTP server for asserting on posted loop events. */
  startEventServer: () => Promise<{
    port: number;
    waitForEvent: (
      predicate: (body: Record<string, unknown>) => boolean,
      timeoutMs?: number
    ) => Promise<Record<string, unknown>>;
    cancelWaiters: () => void;
  }>;
  /** Call from node:test beforeEach. Sets CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE=1. */
  beforeEach: () => void;
  /** Call from node:test afterEach. Restores env, stops servers, removes temp dirs. */
  afterEach: () => Promise<void>;
}

export function createEvaluateTestHarness(machineName: string): EvaluateTestHarness {
  const tempPathsToClean: string[] = [];
  const serversToClose: DesktopGatewayServer[] = [];
  const eventServersToClose: http.Server[] = [];
  const eventServerCancellers: Array<() => void> = [];
  const originalPath = process.env.PATH;
  const originalRawPipeline = process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE;

  function makeTempDir(label: string): string {
    const dir = path.join(
      os.tmpdir(),
      `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(dir, { recursive: true });
    tempPathsToClean.push(dir);
    return dir;
  }

  function makeGatewayServer(options?: {
    allowedDirs?: string[];
    tmpDir?: string;
    getApiOrigin?: () => string;
  }): DesktopGatewayServer {
    const tmpDir = options?.tmpDir ?? makeTempDir(machineName);
    const server = new DesktopGatewayServer({
      host: "127.0.0.1",
      preferredPort: 0,
      fallbackPorts: [0],
      webAppOrigin: "https://app.symphony.com",
      getGatewayAuthToken: () => "test-token",
      getApiOrigin: options?.getApiOrigin ?? (() => "http://127.0.0.1:49152"),
      getAllowedDirectories: () => options?.allowedDirs ?? [os.tmpdir()],
      machineName,
      version: "0.1.0-test",
      capabilities: EMPTY_CAPABILITIES,
      discoveryFilePath: path.join(tmpDir, "electron-port"),
    });
    serversToClose.push(server);
    return server;
  }

  async function startEventServer(): Promise<{
    port: number;
    waitForEvent: (
      predicate: (body: Record<string, unknown>) => boolean,
      timeoutMs?: number
    ) => Promise<Record<string, unknown>>;
    cancelWaiters: () => void;
  }> {
    const collected: Array<Record<string, unknown>> = [];
    const waiters: Array<{
      predicate: (b: Record<string, unknown>) => boolean;
      resolve: (b: Record<string, unknown>) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }> = [];

    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString();
      });
      req.on("end", () => {
        res.statusCode = 200;
        res.end("{}");
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          body = {};
        }
        collected.push(body);
        for (let i = waiters.length - 1; i >= 0; i--) {
          const waiter = waiters[i];
          if (waiter.predicate(body)) {
            waiters.splice(i, 1);
            waiter.resolve(body);
          }
        }
      });
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("Could not get server address"));
          return;
        }
        resolve(addr.port);
      });
      server.once("error", reject);
    });

    eventServersToClose.push(server);
    eventServerCancellers.push(() => {
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("waitForEvent cancelled during teardown"));
      }
    });

    function waitForEvent(
      predicate: (b: Record<string, unknown>) => boolean,
      timeoutMs = 10_000
    ): Promise<Record<string, unknown>> {
      const existing = collected.find(predicate);
      if (existing) {
        return Promise.resolve(existing);
      }
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.indexOf(waiter);
          if (idx !== -1) {
            waiters.splice(idx, 1);
          }
          reject(new Error(`waitForEvent timed out after ${timeoutMs}ms. Collected so far: ${JSON.stringify(collected)}`));
        }, timeoutMs);

        const waiter = {
          predicate,
          resolve: (b: Record<string, unknown>) => {
            clearTimeout(timer);
            resolve(b);
          },
          reject,
          timer,
        };

        waiters.push(waiter);
      });
    }

    function cancelWaiters(): void {
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("waitForEvent cancelled during teardown"));
      }
    }

    return { port, waitForEvent, cancelWaiters };
  }

  return {
    makeTempDir,
    makeGatewayServer,
    startEventServer,
    beforeEach() {
      process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
    },
    async afterEach() {
      if (originalRawPipeline === undefined) {
        delete process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE;
      } else {
        process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = originalRawPipeline;
      }

      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }

      for (const server of serversToClose.splice(0)) {
        await server.stop();
      }

      for (const cancel of eventServerCancellers.splice(0)) {
        cancel();
      }

      for (const srv of eventServersToClose.splice(0)) {
        await new Promise<void>((resolve, reject) => {
          srv.close((err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
      }

      for (const p of tempPathsToClean.splice(0)) {
        await fs.rm(p, { recursive: true, force: true });
      }
    },
  };
}
