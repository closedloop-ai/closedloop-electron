/**
 * Integration tests for cloud failure scenarios in the symphony loop:
 *
 * T-4.2: Cloud failure scenarios
 *   - Artifact upload failure sets ARTIFACT_UPLOAD_FAILED in job store warning
 *     and in completed event warnings
 *   - Event post failure is reflected in job store warning (EVENT_POST_FAILED)
 *
 * Tests go through the HTTP gateway, not direct function calls.
 * Fake binaries (run-loop.sh, claude, git, gh) are placed in a temp fake-bin/ dir
 * prepended to PATH. CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE=1 disables the
 * stream_formatter pipeline so the fake claude can emit simple output.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { promisify } from "node:util";
import { JobStore } from "../src/main/job-store.js";
import { DesktopGatewayServer } from "../src/server/server.js";
import { EMPTY_CAPABILITIES, PORT_PROBE_ORDER } from "../src/shared/contracts.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Shared state and cleanup
// ---------------------------------------------------------------------------

const serversToClose: DesktopGatewayServer[] = [];
const mockServersToClose: http.Server[] = [];
const tempPathsToClean: string[] = [];

const savedEnv: Record<string, string | undefined> = {
  SYMPHONY_WORKTREE_PARENT_DIR: process.env.SYMPHONY_WORKTREE_PARENT_DIR,
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE: process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(async () => {
  restoreEnv();

  for (const server of serversToClose.splice(0)) {
    await server.stop();
  }

  for (const ms of mockServersToClose.splice(0)) {
    await new Promise<void>((resolve, reject) => {
      ms.close((err) => (err ? reject(err) : resolve()));
    });
  }

  for (const tempPath of tempPathsToClean.splice(0)) {
    await fs.rm(tempPath, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function initGitRepo(repoPath: string): Promise<void> {
  await execFileAsync("git", ["init", "-b", "main", repoPath]);
  await execFileAsync("git", ["-C", repoPath, "config", "user.email", "test@test.com"]);
  await execFileAsync("git", ["-C", repoPath, "config", "user.name", "Test"]);
  await fs.writeFile(path.join(repoPath, "README.md"), "# initial\n");
  await execFileAsync("git", ["-C", repoPath, "add", "."]);
  await execFileAsync("git", ["-C", repoPath, "commit", "-m", "initial"]);
}

type RecordedRequest = { method: string; url: string; body: string };

/**
 * Start a mock API server. When failUrls is provided, any request whose URL
 * contains a key from the map will receive the mapped status code and an error
 * body. All other requests receive HTTP 200.
 */
async function startMockApiServer(failUrls?: Map<string, number>): Promise<{
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
    })();
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
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Timed out waiting for request matching "${urlSubstring}" after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);
      waiters.push({
        urlSubstring,
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
      });
    });
  }

  return { server, port: address.port, requests, waitForRequest };
}

/**
 * Create the fake plugin cache structure so findPluginScript("code", "run-loop.sh")
 * finds the provided script content.
 */
async function createFakeRunLoopScript(homeDir: string, scriptContent: string): Promise<string> {
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

/**
 * Poll mock.requests until a request to /loops/{loopId}/events with
 * type === "completed" is found, or until the timeout elapses.
 */
async function waitForCompletedEvent(
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
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out waiting for completed event for loopId=${loopId} after ${timeoutMs}ms`
  );
}

/**
 * Poll a JobStore until the job for the given loopId reaches a terminal status,
 * or until the timeout elapses.
 */
async function waitForJobTerminal(
  jobStore: JobStore,
  loopId: string,
  timeoutMs = 20_000
): Promise<import("../src/main/job-store.js").LocalJob> {
  const deadline = Date.now() + timeoutMs;
  const terminalStatuses = new Set(["COMPLETED", "FAILED", "CANCELLED", "STOPPED", "UNKNOWN"]);
  while (Date.now() < deadline) {
    const job = jobStore.getByLoopId(loopId);
    if (job && terminalStatuses.has(job.status)) {
      return job;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out waiting for terminal job status for loopId=${loopId} after ${timeoutMs}ms`
  );
}

// ---------------------------------------------------------------------------
// Test 1: Artifact upload failure sets ARTIFACT_UPLOAD_FAILED in completed event
//         warnings and in the job store warning field
// ---------------------------------------------------------------------------

test("EXECUTE: artifact upload failure sets ARTIFACT_UPLOAD_FAILED in completed event warnings", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-fail-upload-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-upload-fail");
  await initGitRepo(repoPath);

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;

  // fake run-loop.sh: exits 0 without making any changes
  await createFakeRunLoopScript(tmpDir, "#!/bin/sh\nexit 0\n");

  // fake-bin: claude exits 0 without writing execution-result.json
  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(
    path.join(fakeBin, "claude"),
    "#!/bin/sh\nexit 0\n",
    { mode: 0o755 }
  );

  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;

  // Configure mock server to return 500 for upload-artifacts requests
  const failUrls = new Map<string, number>([["upload-artifacts", 500]]);
  const mock = await startMockApiServer(failUrls);
  mockServersToClose.push(mock.server);

  // Provide a real JobStore so we can verify the warning field
  const jobStore = new JobStore({ cwd: tmpDir, name: "test-jobs-upload-fail" });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "cloud-fail-upload-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getApiOrigin: () => `http://127.0.0.1:${mock.port}`,
    jobStore,
  });
  serversToClose.push(server);
  await server.start();

  const loopId = "00000000-0000-0000-0000-000000000500";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "EXECUTE",
        closedLoopAuthToken: "tok",
        artifacts: [],
        repo: { fullName: `upload-fail/${path.basename(repoPath)}`, branch: "main" },
      }),
    }
  );

  assert.equal(
    response.status,
    200,
    `Expected 200 but got ${response.status}: ${await response.text().catch(() => "")}`
  );

  // The completed event is posted after the upload attempt. Wait for it.
  const completedEvent = await waitForCompletedEvent(mock.requests, loopId);

  // Assert ARTIFACT_UPLOAD_FAILED is in the completed event warnings
  const warnings = completedEvent.warnings as string[] | undefined;
  assert.ok(
    Array.isArray(warnings) && warnings.includes("ARTIFACT_UPLOAD_FAILED"),
    `Expected ARTIFACT_UPLOAD_FAILED in completed event warnings, got: ${JSON.stringify(warnings)}`
  );

  // Also verify the job store warning field contains ARTIFACT_UPLOAD_FAILED
  const job = await waitForJobTerminal(jobStore, loopId);
  assert.ok(
    typeof job.warning === "string" && job.warning.includes("ARTIFACT_UPLOAD_FAILED"),
    `Expected job store warning to contain ARTIFACT_UPLOAD_FAILED, got: ${JSON.stringify(job.warning)}`
  );
});

// ---------------------------------------------------------------------------
// Test 2: Event post failure is reflected in job store warning (EVENT_POST_FAILED)
// ---------------------------------------------------------------------------

test("EXECUTE: event post failure logged as warning in job store", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-fail-event-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-event-fail");
  await initGitRepo(repoPath);

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;

  // fake run-loop.sh: exits 0 without making any changes
  await createFakeRunLoopScript(tmpDir, "#!/bin/sh\nexit 0\n");

  // fake-bin: claude exits 0 without writing execution-result.json
  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(
    path.join(fakeBin, "claude"),
    "#!/bin/sh\nexit 0\n",
    { mode: 0o755 }
  );

  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;

  // Configure mock server to return 500 for all /events requests.
  // This causes both the "started" event and the "completed" event to fail.
  // The loop should still complete (not crash) and set EVENT_POST_FAILED in
  // the job store warning field.
  const failUrls = new Map<string, number>([["events", 500]]);
  const mock = await startMockApiServer(failUrls);
  mockServersToClose.push(mock.server);

  // Provide a real JobStore so we can verify the warning field
  const jobStore = new JobStore({ cwd: tmpDir, name: "test-jobs-event-fail" });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "cloud-fail-event-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getApiOrigin: () => `http://127.0.0.1:${mock.port}`,
    jobStore,
  });
  serversToClose.push(server);
  await server.start();

  const loopId = "00000000-0000-0000-0000-000000000600";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "EXECUTE",
        closedLoopAuthToken: "tok",
        artifacts: [],
        repo: { fullName: `event-fail/${path.basename(repoPath)}`, branch: "main" },
      }),
    }
  );

  assert.equal(
    response.status,
    200,
    `Expected 200 but got ${response.status}: ${await response.text().catch(() => "")}`
  );

  // Wait for upload-artifacts to confirm the loop progressed past the run phase.
  // (upload-artifacts is not in failUrls so it succeeds and can be waited on)
  await mock.waitForRequest("upload-artifacts");

  // Wait for the job to reach a terminal state in the job store.
  // Even though the completed event POST fails, the loop still finalizes the job.
  const job = await waitForJobTerminal(jobStore, loopId);

  // The loop completes without crashing (status is COMPLETED, not FAILED)
  assert.equal(
    job.status,
    "COMPLETED",
    `Expected job status COMPLETED after event post failure, got: ${job.status}`
  );

  // EVENT_POST_FAILED should appear in the job store warning field
  assert.ok(
    typeof job.warning === "string" && job.warning.includes("EVENT_POST_FAILED"),
    `Expected job store warning to contain EVENT_POST_FAILED, got: ${JSON.stringify(job.warning)}`
  );
});
