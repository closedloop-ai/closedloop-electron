/**
 * Worktree lifecycle tests for multi-repo PLAN requests.
 *
 * 1. ensureWorktree called per additional repo before spawn with correct branch
 * 2. removeWorktree called on process failure (run-loop.sh exits 1)
 * 3. ensureWorktree throws — assert non-2xx and error event posted
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
 *
 * Records all ensureWorktree calls. For additional-repo tests, filter by
 * repoPath to distinguish primary from additional repo calls.
 */
function makeRecordingWorktreeProvider(): {
  provider: WorktreeProvider;
  ensureWorktreeCalls: Array<{ repoPath: string; worktreeDir: string; branchName: string; baseBranch: string }>;
  removeCalls: Array<{ worktreeDir: string }>;
} {
  const ensureWorktreeCalls: Array<{ repoPath: string; worktreeDir: string; branchName: string; baseBranch: string }> = [];
  const removeCalls: Array<{ worktreeDir: string }> = [];

  const provider: WorktreeProvider = {
    async ensureWorktree(repoPath, worktreeDir, branchName, baseBranch) {
      ensureWorktreeCalls.push({ repoPath, worktreeDir, branchName, baseBranch });
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
    branchExists: async () => true,
  };

  return { provider, ensureWorktreeCalls, removeCalls };
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
) {
  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
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
// Test 1: ensureWorktree called per additional repo before spawn
// ---------------------------------------------------------------------------

test("ensureWorktree called for each additional repo with correct branch before spawn", async () => {
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

  const { provider, ensureWorktreeCalls } = makeRecordingWorktreeProvider();

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

  // Wait for the loop to complete so ensureWorktree calls are captured
  await waitForCompletedEvent(mock.requests, loopId);

  // Filter out the primary repo call — additional repo calls use a scratch
  // branch (symphony/<worktreeKey>-<addRepoSlug>) based on the user-specified
  // branch, mirroring the primary-repo pattern.
  const additionalCalls = ensureWorktreeCalls.filter(
    (c) => c.repoPath !== primaryRepo,
  );

  assert.equal(
    additionalCalls.length,
    2,
    `Expected ensureWorktree called 2 times for additional repos, got ${additionalCalls.length}`,
  );

  const callForA = additionalCalls.find((c) => c.repoPath === additionalRepoA);
  assert.ok(callForA, "ensureWorktree should be called with additionalRepoA path");
  assert.equal(
    callForA.baseBranch,
    "feature-a",
    `Expected baseBranch 'feature-a' for additionalRepoA, got '${callForA.baseBranch}'`,
  );
  assert.match(
    callForA.branchName,
    /^symphony\/.+-feature-a$/,
    `Expected scratch branch name 'symphony/<slug>-feature-a' for additionalRepoA, got '${callForA.branchName}'`,
  );
  assert.notEqual(
    callForA.branchName,
    callForA.baseBranch,
    "Scratch branch name must differ from baseBranch to avoid mutating the user's branch",
  );

  const callForB = additionalCalls.find((c) => c.repoPath === additionalRepoB);
  assert.ok(callForB, "ensureWorktree should be called with additionalRepoB path");
  assert.equal(
    callForB.baseBranch,
    "feature-b",
    `Expected baseBranch 'feature-b' for additionalRepoB, got '${callForB.baseBranch}'`,
  );
  assert.match(
    callForB.branchName,
    /^symphony\/.+-feature-b$/,
    `Expected scratch branch name 'symphony/<slug>-feature-b' for additionalRepoB, got '${callForB.branchName}'`,
  );
  assert.notEqual(
    callForB.branchName,
    callForB.baseBranch,
    "Scratch branch name must differ from baseBranch to avoid mutating the user's branch",
  );
});

// ---------------------------------------------------------------------------
// Test 2: removeWorktree called on process failure (run-loop.sh exits 1)
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

  const { provider, ensureWorktreeCalls, removeCalls } = makeRecordingWorktreeProvider();

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

  // Additional repo worktree dirs (filter out the primary repo call)
  const additionalWorktreeDirs = ensureWorktreeCalls
    .filter((c) => c.repoPath !== primaryRepo)
    .map((c) => c.worktreeDir);

  assert.equal(
    additionalWorktreeDirs.length,
    1,
    `Expected 1 additional worktree to be created, got ${additionalWorktreeDirs.length}`,
  );

  // Cleanup of additional worktrees is async and happens after the error event is posted.
  // Poll until removeWorktree is called for the additional worktree dir, or timeout.
  const expectedDir = additionalWorktreeDirs[0];
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
// Test 3: ensureWorktree throws for additional repo — assert HTTP 400/500 and error event posted
// ---------------------------------------------------------------------------

test("ensureWorktree throws for additional repo — error event posted and request returns non-200", async () => {
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

  // Provider whose ensureWorktree succeeds for the primary repo but throws
  // for additional repos (simulates checkout failure on a secondary repo).
  let primaryCreated = false;
  const { provider: baseProvider } = makeRecordingWorktreeProvider();
  const throwingProvider: WorktreeProvider = {
    ...baseProvider,
    async ensureWorktree(repoPath, worktreeDir, branchName, baseBranch) {
      if (!primaryCreated) {
        // First call is the primary repo — let it succeed
        primaryCreated = true;
        await fs.mkdir(worktreeDir, { recursive: true });
        return;
      }
      throw new Error("Simulated ensureWorktree failure");
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

  // The server should return a non-200 status (400 or 500) when ensureWorktree throws
  assert.ok(
    response.status >= 400,
    `Expected non-200 status when ensureWorktree throws, got ${response.status}`,
  );

  // An error event should be posted to the API
  const errorEvent = await waitForTerminalEvent(mock.requests, loopId);
  assert.equal(
    errorEvent.type,
    "error",
    `Expected error event type, got '${errorEvent.type}'`,
  );
});

