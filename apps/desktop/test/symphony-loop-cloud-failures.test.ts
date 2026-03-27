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
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { JobStore } from "../src/main/job-store.js";
import { DesktopGatewayServer } from "../src/server/server.js";
import { EMPTY_CAPABILITIES } from "../src/shared/contracts.js";
import type { WorktreeProvider } from "../src/server/operations/symphony-loop.js";
import { resetShellPathCache } from "../src/server/shell-path.js";
import {
  createFakeRunLoopScript,
  restoreEnv,
  saveEnv,
  startMockApiServer,
  waitForCompletedEvent,
} from "./symphony-test-utils.js";

const fakeWorktreeProvider: WorktreeProvider = {
  async ensureWorktree(_repoPath, worktreeDir) {
    await fs.mkdir(worktreeDir, { recursive: true });
  },
  findWorktreeForBranch() {
    return null;
  },
  async removeWorktree(worktreeDir) {
    await fs.rm(worktreeDir, { recursive: true, force: true });
  },
  getCurrentBranch() {
    return "symphony/cloud-failures-test";
  },
};

// ---------------------------------------------------------------------------
// Shared state and cleanup
// ---------------------------------------------------------------------------

const serversToClose: DesktopGatewayServer[] = [];
const mockServersToClose: http.Server[] = [];
const tempPathsToClean: string[] = [];
const savedEnv = saveEnv();

afterEach(async () => {
  restoreEnv(savedEnv);

  for (const server of serversToClose.splice(0)) {
    await server.stop();
  }

  for (const ms of mockServersToClose.splice(0)) {
    await new Promise<void>((resolve, reject) => {
      ms.close((err) => (err ? reject(err) : resolve()));
    });
  }

  for (const tempPath of tempPathsToClean.splice(0)) {
    await fs.rm(tempPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

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
  await fs.mkdir(repoPath, { recursive: true });

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
  resetShellPathCache();

  // Configure mock server to return 500 for upload-artifacts requests
  const failUrls = new Map<string, number>([["upload-artifacts", 500]]);
  const mock = await startMockApiServer(failUrls);
  mockServersToClose.push(mock.server);

  // Provide a real JobStore so we can verify the warning field
  const jobStore = new JobStore({ cwd: tmpDir, name: "test-jobs-upload-fail" });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "cloud-fail-upload-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    worktreeProvider: fakeWorktreeProvider,
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
  await fs.mkdir(repoPath, { recursive: true });

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
  resetShellPathCache();

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
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "cloud-fail-event-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    worktreeProvider: fakeWorktreeProvider,
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
