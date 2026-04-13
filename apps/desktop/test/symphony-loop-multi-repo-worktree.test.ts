/**
 * Worktree lifecycle tests for multi-repo PLAN requests.
 *
 * T-7.3: Verify that the worktree provider lifecycle methods are called
 * correctly for PLAN commands with additionalRepos:
 *
 * 1. checkoutWorktree called per additional repo before spawn with correct branch
 * 2. removeWorktree called for all additional worktree dirs after successful run
 * 3. removeWorktree called on process failure (run-loop.sh exits 1)
 * 4. checkoutWorktree throws — assert HTTP 400/500 and error event posted
 * 5. assertPathAllowed triggered — worktreeDirs placed outside allowedDirs result in HTTP 403
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { DesktopGatewayServer } from "../src/server/server.js";
import { EMPTY_CAPABILITIES } from "../src/shared/contracts.js";
import type { WorktreeProvider } from "../src/server/operations/symphony-loop.js";
import { resetShellPathCache, setShellPathForTest } from "../src/server/shell-path.js";
import {
  createFakeRunLoopScript,
  restoreEnv,
  saveEnv,
  startMockApiServer,
  waitForCompletedEvent,
  waitForTerminalEvent,
} from "./symphony-test-utils.js";

// ---------------------------------------------------------------------------
// Call-recording fake worktree provider
// ---------------------------------------------------------------------------

/**
 * Build a call-recording WorktreeProvider. Each test should create its own
 * instance so recorded calls don't bleed across tests.
 */
function makeRecordingWorktreeProvider(): {
  provider: WorktreeProvider;
  checkoutCalls: Array<{ repoPath: string; worktreeDir: string; branch: string }>;
  removeCalls: Array<{ worktreeDir: string }>;
} {
  const checkoutCalls: Array<{ repoPath: string; worktreeDir: string; branch: string }> = [];
  const removeCalls: Array<{ worktreeDir: string }> = [];

  const provider: WorktreeProvider = {
    async ensureWorktree(_repoPath, worktreeDir) {
      await fs.mkdir(worktreeDir, { recursive: true });
    },
    findWorktreeForBranch() {
      return null;
    },
    async removeWorktree(worktreeDir) {
      removeCalls.push({ worktreeDir });
      await fs.rm(worktreeDir, { recursive: true, force: true });
    },
    getCurrentBranch() {
      return "symphony/worktree-lifecycle-test";
    },
    async checkoutWorktree(repoPath, worktreeDir, branch) {
      checkoutCalls.push({ repoPath, worktreeDir, branch });
      await fs.mkdir(worktreeDir, { recursive: true });
    },
    branchExists: async () => true,
  };

  return { provider, checkoutCalls, removeCalls };
}

// ---------------------------------------------------------------------------
// Shared state and cleanup
// ---------------------------------------------------------------------------

const serversToClose: DesktopGatewayServer[] = [];
const mockServersToClose: http.Server[] = [];
const tempPathsToClean: string[] = [];
const savedEnv = saveEnv();

afterEach(async () => {
  restoreEnv(savedEnv);
  resetShellPathCache();
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

/** Create a gateway server with a mock API backend and a given worktree provider. */
async function createTestGateway(
  tmpDir: string,
  mockPort: number,
  worktreeProvider: WorktreeProvider,
  allowedDirs?: string[],
) {
  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => allowedDirs ?? [tmpDir],
    machineName: "worktree-lifecycle-test",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    worktreeProvider,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getApiOrigin: () => `http://127.0.0.1:${mockPort}`,
  });
  serversToClose.push(server);
  await server.start();
  return server;
}

// ---------------------------------------------------------------------------
// Test 1: checkoutWorktree called per additional repo before spawn
// ---------------------------------------------------------------------------

test("checkoutWorktree called for each additional repo with correct branch before spawn", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wt-lifecycle-checkout-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const additionalRepoA = path.join(tmpDir, "additional-repo-a");
  const additionalRepoB = path.join(tmpDir, "additional-repo-b");
  await fs.mkdir(additionalRepoA, { recursive: true });
  await fs.mkdir(additionalRepoB, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  await createFakeRunLoopScript(tmpDir, "#!/bin/sh\nexit 0\n");

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const { provider, checkoutCalls } = makeRecordingWorktreeProvider();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port, provider);

  const loopId = "00000000-0000-0000-0000-000000007001";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "PLAN",
        closedLoopAuthToken: "tok",
        artifacts: [],
        repo: {
          fullName: `wt-lifecycle-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        additionalRepos: [
          { localRepoPath: additionalRepoA, branch: "feature-a" },
          { localRepoPath: additionalRepoB, branch: "feature-b" },
        ],
      }),
    },
  );

  assert.equal(response.status, 200, "PLAN with additionalRepos should return HTTP 200");

  // Wait for the loop to complete so checkoutWorktree calls are captured
  await waitForCompletedEvent(mock.requests, loopId);

  assert.equal(
    checkoutCalls.length,
    2,
    `Expected checkoutWorktree called 2 times (once per additional repo), got ${checkoutCalls.length}`,
  );

  const callForA = checkoutCalls.find((c) => c.repoPath === additionalRepoA);
  assert.ok(callForA, "checkoutWorktree should be called with additionalRepoA path");
  assert.equal(
    callForA.branch,
    "feature-a",
    `Expected branch 'feature-a' for additionalRepoA, got '${callForA.branch}'`,
  );

  const callForB = checkoutCalls.find((c) => c.repoPath === additionalRepoB);
  assert.ok(callForB, "checkoutWorktree should be called with additionalRepoB path");
  assert.equal(
    callForB.branch,
    "feature-b",
    `Expected branch 'feature-b' for additionalRepoB, got '${callForB.branch}'`,
  );
});

// ---------------------------------------------------------------------------
// Test 2: removeWorktree called for all additional worktree dirs after success
// ---------------------------------------------------------------------------

test("removeWorktree called for all additional worktree dirs after successful run", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wt-lifecycle-remove-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const additionalRepoA = path.join(tmpDir, "additional-repo-a");
  const additionalRepoB = path.join(tmpDir, "additional-repo-b");
  await fs.mkdir(additionalRepoA, { recursive: true });
  await fs.mkdir(additionalRepoB, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  await createFakeRunLoopScript(tmpDir, "#!/bin/sh\nexit 0\n");

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  // Track worktree dirs that were checked out so we can verify they are removed
  const checkedOutDirs: string[] = [];
  const { provider: baseProvider, removeCalls } = makeRecordingWorktreeProvider();
  const provider: WorktreeProvider = {
    ...baseProvider,
    async checkoutWorktree(repoPath, worktreeDir, branch) {
      checkedOutDirs.push(worktreeDir);
      await fs.mkdir(worktreeDir, { recursive: true });
      // Also record in the base provider's calls for branch verification
      void repoPath; void branch;
    },
  };

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port, provider);

  const loopId = "00000000-0000-0000-0000-000000007002";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "PLAN",
        closedLoopAuthToken: "tok",
        artifacts: [],
        repo: {
          fullName: `wt-lifecycle-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        additionalRepos: [
          { localRepoPath: additionalRepoA, branch: "main" },
          { localRepoPath: additionalRepoB, branch: "main" },
        ],
      }),
    },
  );

  assert.equal(response.status, 200, "PLAN should return HTTP 200");

  // Wait for the completed event first
  await waitForCompletedEvent(mock.requests, loopId);

  assert.equal(
    checkedOutDirs.length,
    2,
    `Expected 2 additional worktrees to be checked out, got ${checkedOutDirs.length}`,
  );

  // Cleanup of additional worktrees is async and happens after the completed event is posted.
  // Poll until both checked-out dirs appear in removeCalls, or timeout.
  const deadline = Date.now() + 5_000;
  while (
    Date.now() < deadline &&
    !checkedOutDirs.every((dir) => removeCalls.some((c) => c.worktreeDir === dir))
  ) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }

  // Each checked-out additional worktree dir should appear in removeCalls
  for (const dir of checkedOutDirs) {
    const removed = removeCalls.some((c) => c.worktreeDir === dir);
    assert.ok(
      removed,
      `Expected removeWorktree to be called for additional worktree dir: ${dir}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Test 3: removeWorktree called on process failure (run-loop.sh exits 1)
// ---------------------------------------------------------------------------

test("removeWorktree called for additional worktree dirs when process fails", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wt-lifecycle-fail-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const additionalRepo = path.join(tmpDir, "additional-repo");
  await fs.mkdir(additionalRepo, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  // run-loop.sh exits 1 to simulate process failure
  await createFakeRunLoopScript(tmpDir, "#!/bin/sh\nexit 1\n", { skipTokens: true });

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const checkedOutDirs: string[] = [];
  const { provider: baseProvider, removeCalls } = makeRecordingWorktreeProvider();
  const provider: WorktreeProvider = {
    ...baseProvider,
    async checkoutWorktree(repoPath, worktreeDir, branch) {
      checkedOutDirs.push(worktreeDir);
      await fs.mkdir(worktreeDir, { recursive: true });
      void repoPath; void branch;
    },
  };

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port, provider);

  const loopId = "00000000-0000-0000-0000-000000007003";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "PLAN",
        closedLoopAuthToken: "tok",
        artifacts: [],
        repo: {
          fullName: `wt-lifecycle-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        additionalRepos: [
          { localRepoPath: additionalRepo, branch: "feature-branch" },
        ],
      }),
    },
  );

  assert.equal(response.status, 200, "PLAN should return HTTP 200 (process failure is async)");

  // Wait for the terminal event (error from process failure)
  const terminalEvent = await waitForTerminalEvent(mock.requests, loopId);
  assert.equal(
    terminalEvent.type,
    "error",
    `Expected terminal event type 'error', got '${terminalEvent.type}'`,
  );

  assert.equal(
    checkedOutDirs.length,
    1,
    `Expected 1 additional worktree to be checked out, got ${checkedOutDirs.length}`,
  );

  // Cleanup of additional worktrees is async and happens after the error event is posted.
  // Poll until removeWorktree is called for the additional worktree dir, or timeout.
  const expectedDir = checkedOutDirs[0];
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && !removeCalls.some((c) => c.worktreeDir === expectedDir)) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }

  // removeWorktree should still be called for the additional worktree after failure
  const removed = removeCalls.some((c) => c.worktreeDir === expectedDir);
  assert.ok(
    removed,
    `Expected removeWorktree to be called for additional worktree dir ${expectedDir} after process failure`,
  );
});

// ---------------------------------------------------------------------------
// Test 4: checkoutWorktree throws — assert HTTP 400/500 and error event posted
// ---------------------------------------------------------------------------

test("checkoutWorktree throws — error event posted and request returns non-200", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wt-lifecycle-throw-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const additionalRepo = path.join(tmpDir, "additional-repo");
  await fs.mkdir(additionalRepo, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  // Provider whose checkoutWorktree always throws
  const { provider: baseProvider } = makeRecordingWorktreeProvider();
  const throwingProvider: WorktreeProvider = {
    ...baseProvider,
    checkoutWorktree: async () => {
      throw new Error("Simulated checkoutWorktree failure");
    },
  };

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port, throwingProvider);

  const loopId = "00000000-0000-0000-0000-000000007004";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "PLAN",
        closedLoopAuthToken: "tok",
        artifacts: [],
        repo: {
          fullName: `wt-lifecycle-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        additionalRepos: [
          { localRepoPath: additionalRepo, branch: "feature-branch" },
        ],
      }),
    },
  );

  // The server should return a non-200 status (400 or 500) when checkoutWorktree throws
  assert.ok(
    response.status >= 400,
    `Expected non-200 status when checkoutWorktree throws, got ${response.status}`,
  );

  // An error event should be posted to the API
  const errorEvent = await waitForTerminalEvent(mock.requests, loopId);
  assert.equal(
    errorEvent.type,
    "error",
    `Expected error event type, got '${errorEvent.type}'`,
  );
});

// ---------------------------------------------------------------------------
// Test 5: assertPathAllowed triggered — worktreeDirs placed outside allowedDirs → HTTP 403
// ---------------------------------------------------------------------------

test("worktreeDirs placed outside allowedDirs result in HTTP 403", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wt-lifecycle-403-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const additionalRepo = path.join(tmpDir, "additional-repo");
  await fs.mkdir(additionalRepo, { recursive: true });

  // Place the worktrees outside the allowed directory so assertPathAllowed fires.
  // We create a separate dir that is NOT in allowedDirs.
  const outsideWorktreeParent = await fs.mkdtemp(path.join(os.tmpdir(), "wt-outside-"));
  tempPathsToClean.push(outsideWorktreeParent);

  process.env.HOME = tmpDir;
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = outsideWorktreeParent;

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  // The recording provider creates worktree dirs inside outsideWorktreeParent
  // (because checkoutWorktree uses the dir param passed by the loop handler,
  // which is derived from resolveLoopWorktreeDir → SYMPHONY_WORKTREE_PARENT_DIR).
  const { provider } = makeRecordingWorktreeProvider();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);

  // allowedDirs only includes tmpDir, not outsideWorktreeParent
  const server = await createTestGateway(tmpDir, mock.port, provider, [tmpDir]);

  const loopId = "00000000-0000-0000-0000-000000007005";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "PLAN",
        closedLoopAuthToken: "tok",
        artifacts: [],
        repo: {
          fullName: `wt-lifecycle-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        additionalRepos: [
          { localRepoPath: additionalRepo, branch: "feature-branch" },
        ],
      }),
    },
  );

  assert.equal(
    response.status,
    403,
    `Expected HTTP 403 when worktreeDir is outside allowedDirs, got ${response.status}`,
  );
});
