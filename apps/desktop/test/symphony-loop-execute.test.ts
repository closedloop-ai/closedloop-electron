/**
 * Integration tests for the EXECUTE loop command, specifically:
 *
 * T-5.1: No-changes paths
 *   - executeGitOperations returns null when git status --porcelain is empty
 *   - attemptLlmCommit returns null when claude exits 0 without writing execution-result.json
 *
 * T-5.2: Existing-PR paths
 *   - executeGitOperations returns existing PR URL when gh pr view succeeds (no gh pr create)
 *   - handleProcessCompletion returns PR URL from pre-written execution-result.json
 *     without calling executeGitOperations
 *
 * Tests go through the HTTP gateway, not direct function calls.
 * Fake binaries (run-loop.sh, claude, git, gh) are placed in a temp fake-bin/ dir
 * prepended to PATH. CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE=1 disables the
 * stream_formatter pipeline so the fake claude can emit simple output.
 * Uses a fake WorktreeProvider (no real git) so no real git repos are needed.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { JobStore, LoopErrorCode } from "../src/main/job-store.js";
import type { WorktreeProvider } from "../src/server/operations/symphony-loop.js";
import { resetResolvedClaudePath } from "../src/server/operations/symphony-loop.js";
import { DesktopGatewayServer } from "../src/server/server.js";
import { resetShellPathCache, setShellPathForTest } from "../src/server/shell-path.js";
import { EMPTY_CAPABILITIES } from "../src/shared/contracts.js";
import {
  createFakeRunLoopScript,
  initGitRepo,
  restoreEnv,
  saveEnv,
  startMockApiServer,
  waitForCompletedEvent,
  waitForTerminalEvent,
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
    return "symphony/execute-test";
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

// ---------------------------------------------------------------------------
// Test 1: No-changes → executeGitOperations returns null (no PR URL in upload)
// ---------------------------------------------------------------------------

test("EXECUTE: no PR URL in upload when worktree has no changes (git status empty)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "execute-nochange-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-nochange");
  await fs.mkdir(repoPath, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  // Redirect HOME so getPluginCacheRoot() returns a path we control
  process.env.HOME = tmpDir;

  // fake run-loop.sh: exits 0 without making any changes
  await createFakeRunLoopScript(tmpDir, "#!/bin/sh\nexit 0\n");

  // fake-bin: claude that exits 0 without writing execution-result.json
  //   (simulates attemptLlmCommit finding no result file → returns null)
  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });

  // fake git: status returns empty (no changes); all other commands succeed
  const fakeGitScript = [
    "#!/bin/sh",
    'if [ "$1" = status ]; then exit 0; fi',
    'if [ "$1" = push ]; then exit 0; fi',
    'if [ "$1" = add ]; then exit 0; fi',
    'if [ "$1" = commit ]; then exit 0; fi',
    'if [ "$1" = fetch ]; then exit 0; fi',
    'if [ "$1" = "rev-parse" ]; then',
    '  if [ "$2" = "--abbrev-ref" ]; then echo "symphony/execute-test"; exit 0; fi',
    "  exit 0",
    "fi",
    "exit 0",
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });

  // Disable stream_formatter pipeline — fake claude output is not a real stream
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "execute-nochange-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    worktreeProvider: fakeWorktreeProvider,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getApiOrigin: () => `http://127.0.0.1:${mock.port}`,
  });
  serversToClose.push(server);
  await server.start();

  const loopId = "00000000-0000-0000-0000-000000000100";
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
        repo: {
          fullName: `nochange/${path.basename(repoPath)}`,
          branch: "main",
        },
      }),
    },
  );

  assert.equal(
    response.status,
    200,
    `Expected 200 but got ${response.status}: ${await response.text().catch(() => "")}`,
  );

  // Wait for the upload call that signals process completion
  const uploadReq = await mock.waitForRequest("upload-artifacts");
  const uploadBody = JSON.parse(uploadReq.body) as {
    artifacts: {
      executionResult?: {
        pr_url?: string;
        has_changes?: boolean;
      };
    };
    metadata: Record<string, unknown>;
  };

  // No changes → no PR URL in execution result
  assert.equal(
    uploadBody.artifacts.executionResult?.pr_url,
    undefined,
    `Expected no pr_url when there are no changes, got: ${uploadBody.artifacts.executionResult?.pr_url}`,
  );
  assert.equal(
    uploadBody.artifacts.executionResult?.has_changes,
    undefined,
    "Expected has_changes to be absent when there are no changes",
  );

  // Also check the completed event does NOT contain GIT_PUSH_FAILED in warnings.
  // The completed event is posted after upload-artifacts, so poll until it appears.
  const completedEvent = await waitForCompletedEvent(mock.requests, loopId);
  assert.ok(
    !(completedEvent.warnings as string[] | undefined)?.includes(
      "GIT_PUSH_FAILED",
    ),
    `Expected no GIT_PUSH_FAILED warning in completed event for no-changes path, got warnings: ${JSON.stringify(completedEvent.warnings)}`,
  );
});

// ---------------------------------------------------------------------------
// Test 2: Pre-written execution-result.json (LLM path) → PR URL without
//         calling executeGitOperations
// ---------------------------------------------------------------------------

test("EXECUTE: handleProcessCompletion reads pre-written execution-result.json and returns PR URL", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "execute-llmresult-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-llmresult");
  await fs.mkdir(repoPath, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;

  // fake run-loop.sh: exits 0 without making any changes
  // (attemptLlmCommit is called after this exits)
  await createFakeRunLoopScript(tmpDir, "#!/bin/sh\nexit 0\n");

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });

  // fake claude for attemptLlmCommit: writes a valid execution-result.json to $CLOSEDLOOP_WORKDIR
  // Then exits 0. attemptLlmCommit reads the file and returns the result.
  // Because execution-result.json is present and valid, executeGitOperations is never called.
  //
  // The worktree dir is the cwd when attemptLlmCommit spawns claude.
  // execution-result.json is expected at path.join(worktreeDir, "execution-result.json").
  const expectedPrUrl = "https://github.com/org/repo-llmresult/pull/77";
  const executionResultContent = JSON.stringify({
    prUrl: expectedPrUrl,
    prNumber: 77,
    branchName: "symphony/loop-test-branch",
    commitSha: "aabbccdd1122334455667788990011223344556677",
  });
  const claudeScript = [
    "#!/bin/sh",
    // Write execution-result.json relative to cwd (which is worktreeDir for attemptLlmCommit)
    `printf '%s' ${JSON.stringify(executionResultContent).replace(/'/g, String.raw`'\''`)} > execution-result.json`,
    "exit 0",
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "claude"), claudeScript, {
    mode: 0o755,
  });

  // fake git that stubs all commands (so executeGitOperations wouldn't fail if accidentally called)
  // We verify via upload payload that git ops were NOT needed.
  const fakeGitScript = [
    "#!/bin/sh",
    'if [ "$1" = push ]; then exit 0; fi',
    'if [ "$1" = status ]; then exit 0; fi',
    'if [ "$1" = add ]; then exit 0; fi',
    'if [ "$1" = commit ]; then exit 0; fi',
    'if [ "$1" = fetch ]; then exit 0; fi',
    'if [ "$1" = "rev-parse" ]; then',
    '  if [ "$2" = "--abbrev-ref" ]; then echo "symphony/execute-test"; exit 0; fi',
    "  exit 0",
    "fi",
    "exit 0",
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });

  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "execute-llmresult-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    worktreeProvider: fakeWorktreeProvider,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getApiOrigin: () => `http://127.0.0.1:${mock.port}`,
  });
  serversToClose.push(server);
  await server.start();

  const loopId = "00000000-0000-0000-0000-000000000200";
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
        repo: {
          fullName: `llmresult/${path.basename(repoPath)}`,
          branch: "main",
        },
      }),
    },
  );

  assert.equal(
    response.status,
    200,
    `Expected 200 but got ${response.status}: ${await response.text().catch(() => "")}`,
  );

  // Wait for upload — signals process completion including attemptLlmCommit
  const uploadReq = await mock.waitForRequest("upload-artifacts");
  const uploadBody = JSON.parse(uploadReq.body) as {
    artifacts: {
      executionResult?: Record<string, unknown>;
    };
    metadata: Record<string, unknown>;
  };

  // The LLM wrote execution-result.json, so the PR URL should appear in the upload
  assert.equal(
    uploadBody.artifacts.executionResult?.pr_url,
    expectedPrUrl,
    `Expected pr_url=${expectedPrUrl} from pre-written execution-result.json, got: ${String(uploadBody.artifacts.executionResult?.pr_url)}`,
  );
  assert.equal(
    uploadBody.artifacts.executionResult?.pr_number,
    77,
    "Expected pr_number=77 from pre-written execution-result.json",
  );
  assert.equal(
    uploadBody.artifacts.executionResult?.has_changes,
    true,
    "Expected has_changes=true when execution-result.json was written",
  );
});

// ---------------------------------------------------------------------------
// Test 3: Existing PR via gh pr view → no gh pr create called
// ---------------------------------------------------------------------------

test("EXECUTE: uses existing PR URL from gh pr view without calling gh pr create", async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "execute-existingpr-"),
  );
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-existingpr");
  await fs.mkdir(repoPath, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;

  // fake run-loop.sh: writes a file so the worktree has changes for git status
  await createFakeRunLoopScript(
    tmpDir,
    [
      "#!/bin/sh",
      // Write a file to create an uncommitted change
      "echo 'implement feature' > feature-output.txt",
      "exit 0",
    ].join("\n"),
  );

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });

  // fake claude for attemptLlmCommit: exits 0 without writing execution-result.json
  // → attemptLlmCommit returns null → falls through to executeGitOperations
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });

  // Capture file to record whether gh pr create was called
  const captureFile = path.join(tmpDir, "gh-calls.txt");

  // fake gh: pr view returns existing PR JSON; pr create records a call and exits 1
  const fakeGhScript = [
    "#!/bin/sh",
    'if [ "$1" = pr ] && [ "$2" = view ]; then',
    '  printf \'{"url":"https://github.com/org/repo-existingpr/pull/42","number":42}\\n\'',
    "  exit 0",
    "fi",
    'if [ "$1" = pr ] && [ "$2" = create ]; then',
    `  echo "gh pr create was called (should not happen)" >> ${JSON.stringify(captureFile)}`,
    "  exit 1",
    "fi",
    "exit 0",
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "gh"), fakeGhScript, { mode: 0o755 });

  // fake git: stubs all commands without falling back to real git
  const fakeGitScript = [
    "#!/bin/sh",
    'if [ "$1" = push ]; then exit 0; fi',
    'if [ "$1" = status ]; then printf "M feature-output.txt\\n"; exit 0; fi',
    'if [ "$1" = add ]; then exit 0; fi',
    'if [ "$1" = commit ]; then exit 0; fi',
    'if [ "$1" = fetch ]; then exit 0; fi',
    'if [ "$1" = "rev-parse" ]; then',
    '  if [ "$2" = "--abbrev-ref" ]; then echo "symphony/execute-test"; exit 0; fi',
    "  exit 0",
    "fi",
    "exit 0",
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });

  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "execute-existingpr-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    worktreeProvider: fakeWorktreeProvider,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getApiOrigin: () => `http://127.0.0.1:${mock.port}`,
  });
  serversToClose.push(server);
  await server.start();

  const loopId = "00000000-0000-0000-0000-000000000300";
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
        repo: {
          fullName: `existingpr/${path.basename(repoPath)}`,
          branch: "main",
        },
      }),
    },
  );

  assert.equal(
    response.status,
    200,
    `Expected 200 but got ${response.status}: ${await response.text().catch(() => "")}`,
  );

  // Wait for upload — signals that git ops + PR lookup completed
  const uploadReq = await mock.waitForRequest("upload-artifacts");
  const uploadBody = JSON.parse(uploadReq.body) as {
    artifacts: {
      executionResult?: Record<string, unknown>;
    };
    metadata: Record<string, unknown>;
  };

  // Existing PR URL should appear in the execution result
  assert.equal(
    uploadBody.artifacts.executionResult?.pr_url,
    "https://github.com/org/repo-existingpr/pull/42",
    `Expected existing PR URL in pr_url, got: ${String(uploadBody.artifacts.executionResult?.pr_url)}`,
  );
  assert.equal(
    uploadBody.artifacts.executionResult?.pr_number,
    42,
    "Expected pr_number=42 from gh pr view",
  );

  // gh pr create must NOT have been called
  const ghCalls = await fs.readFile(captureFile, "utf-8").catch(() => "");
  assert.equal(
    ghCalls.trim(),
    "",
    `gh pr create should not have been called, but capture file contains: ${ghCalls}`,
  );
});

// ---------------------------------------------------------------------------
// Test 4: git status exits 1 → executeGitOperations returns 'error' →
//         completed event warnings contains 'GIT_PUSH_FAILED'
// ---------------------------------------------------------------------------

test("EXECUTE: git status failure sets GIT_PUSH_FAILED in completed event warnings", async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "execute-gitstatus-fail-"),
  );
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-gitstatus-fail");
  await fs.mkdir(repoPath, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;

  // fake run-loop.sh: exits 0 (loop runs successfully, no LLM commits)
  await createFakeRunLoopScript(tmpDir, "#!/bin/sh\nexit 0\n");

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });

  // fake claude: exits 0 without writing execution-result.json
  // → attemptLlmCommit returns null → falls through to executeGitOperations
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });

  // fake git: exits 1 for 'git status --porcelain' to simulate a git status failure.
  // This causes executeGitOperations to return { status: 'error' }, which adds
  // GIT_PUSH_FAILED to the warnings array posted in the completed event.
  // All other commands succeed without falling back to real git.
  const fakeGitScript = [
    "#!/bin/sh",
    'if [ "$1" = status ]; then exit 1; fi',
    'if [ "$1" = push ]; then exit 0; fi',
    'if [ "$1" = add ]; then exit 0; fi',
    'if [ "$1" = commit ]; then exit 0; fi',
    'if [ "$1" = fetch ]; then exit 0; fi',
    'if [ "$1" = "rev-parse" ]; then',
    '  if [ "$2" = "--abbrev-ref" ]; then echo "symphony/execute-test"; exit 0; fi',
    "  exit 0",
    "fi",
    "exit 0",
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });

  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "execute-gitstatus-fail-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    worktreeProvider: fakeWorktreeProvider,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getApiOrigin: () => `http://127.0.0.1:${mock.port}`,
  });
  serversToClose.push(server);
  await server.start();

  const loopId = "00000000-0000-0000-0000-000000000400";
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
        repo: {
          fullName: `gitstatus-fail/${path.basename(repoPath)}`,
          branch: "main",
        },
      }),
    },
  );

  assert.equal(
    response.status,
    200,
    `Expected 200 but got ${response.status}: ${await response.text().catch(() => "")}`,
  );

  // Wait for the completed event and assert GIT_PUSH_FAILED is in warnings.
  // The loop posts upload-artifacts first, then the completed event.
  await mock.waitForRequest("upload-artifacts");
  const completedEvent = await waitForCompletedEvent(mock.requests, loopId);
  const warnings = completedEvent.warnings as string[] | undefined;
  assert.ok(
    Array.isArray(warnings) && warnings.includes("GIT_PUSH_FAILED"),
    `Expected GIT_PUSH_FAILED in completed event warnings when git status exits 1, got warnings: ${JSON.stringify(warnings)}`,
  );
});

// ---------------------------------------------------------------------------
// Cancellation gate helpers
// ---------------------------------------------------------------------------

/**
 * Poll a JobStore until the job for the given loopId reaches a terminal status,
 * or until the timeout elapses.
 */
async function waitForJobTerminal(
  jobStore: JobStore,
  loopId: string,
  timeoutMs = 20_000,
): Promise<import("../src/main/job-store.js").LocalJob> {
  const terminalStatuses = new Set([
    "COMPLETED",
    "FAILED",
    "CANCELLED",
    "STOPPED",
    "UNKNOWN",
  ]);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = jobStore.getByLoopId(loopId);
    if (job && terminalStatuses.has(job.status)) {
      return job;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out waiting for terminal job status for loopId=${loopId} after ${timeoutMs}ms`,
  );
}

/**
 * Poll a JobStore until the job for the given loopId has status RUNNING.
 */
async function waitForJobRunning(
  jobStore: JobStore,
  loopId: string,
  timeoutMs = 10_000,
): Promise<import("../src/main/job-store.js").LocalJob> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = jobStore.getByLoopId(loopId);
    if (job && job.status === "RUNNING") {
      return job;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Timed out waiting for RUNNING job for loopId=${loopId} after ${timeoutMs}ms`,
  );
}

// ---------------------------------------------------------------------------
// Test 5: Cancellation gate — cancel before attemptLlmCommit (gate 1)
//         CANCEL_PENDING is set while run-loop.sh is still running.
//         When the process exits, isCancelled() returns true before
//         attemptLlmCommit is called → no upload, no completed event.
// ---------------------------------------------------------------------------

test("EXECUTE: cancel before attemptLlmCommit ends job as CANCELLED with no upload or completed event", async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "execute-cancel-gate1-"),
  );
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-cancel-gate1");
  await fs.mkdir(repoPath, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;

  // fake run-loop.sh: sleep so the test can set CANCEL_PENDING before exit
  await createFakeRunLoopScript(tmpDir, "#!/bin/sh\nsleep 2\nexit 0\n");

  // fake-bin: claude exits 0 (won't be called — gate 1 catches before attemptLlmCommit)
  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });

  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);

  const jobStore = new JobStore({
    cwd: tmpDir,
    name: "test-jobs-cancel-gate1",
  });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "execute-cancel-gate1-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    worktreeProvider: fakeWorktreeProvider,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getApiOrigin: () => `http://127.0.0.1:${mock.port}`,
    jobStore,
  });
  serversToClose.push(server);
  await server.start();

  const loopId = "00000000-0000-0000-0000-000000000700";
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
        repo: {
          fullName: `cancel-gate1/${path.basename(repoPath)}`,
          branch: "main",
        },
      }),
    },
  );

  assert.equal(
    response.status,
    200,
    `Expected 200 but got ${response.status}: ${await response.text().catch(() => "")}`,
  );

  // Wait for the job to appear as RUNNING, then set CANCEL_PENDING.
  // run-loop.sh is sleeping for 2s, so this fires well before it exits.
  const runningJob = await waitForJobRunning(jobStore, loopId);
  jobStore.upsert({
    ...runningJob,
    status: "CANCEL_PENDING",
    updatedAt: new Date().toISOString(),
  });

  // Wait for the job to reach terminal state (CANCELLED via gate 1)
  const terminalJob = await waitForJobTerminal(jobStore, loopId);
  assert.equal(
    terminalJob.status,
    "CANCELLED",
    `Expected job status CANCELLED, got: ${terminalJob.status}`,
  );

  // Verify no upload-artifacts request was made
  const uploadRequests = mock.requests.filter((r) =>
    r.url.includes("upload-artifacts"),
  );
  assert.equal(
    uploadRequests.length,
    0,
    `Expected no upload-artifacts requests when cancelled before attemptLlmCommit, got ${uploadRequests.length}`,
  );

  // Verify no completed event was posted
  const eventsUrl = `/loops/${loopId}/events`;
  const completedEvents = mock.requests.filter((r) => {
    if (!r.url.includes(eventsUrl)) return false;
    try {
      const body = JSON.parse(r.body) as Record<string, unknown>;
      return body.type === "completed";
    } catch {
      return false;
    }
  });
  assert.equal(
    completedEvents.length,
    0,
    `Expected no completed event when cancelled before attemptLlmCommit, got ${completedEvents.length}`,
  );
});

// ---------------------------------------------------------------------------
// Test 6: Cancellation gate — cancel during attemptLlmCommit (gate 2)
//         run-loop.sh exits immediately (gate 1 passes — not cancelled yet).
//         The fake claude binary sleeps so CANCEL_PENDING can be set while
//         attemptLlmCommit is awaiting. After claude exits, gate 2 fires.
// ---------------------------------------------------------------------------

test("EXECUTE: cancel during attemptLlmCommit ends job as CANCELLED with no completed event", async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "execute-cancel-gate2-"),
  );
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-cancel-gate2");
  await fs.mkdir(repoPath, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;

  // fake run-loop.sh: exits immediately so gate 1 passes (not yet cancelled)
  await createFakeRunLoopScript(tmpDir, "#!/bin/sh\nexit 0\n");

  // fake-bin: claude creates a marker file on entry then sleeps, so the test
  // can poll the marker to detect when attemptLlmCommit has been entered.
  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  const claudeStartedMarker = path.join(tmpDir, "claude-started");
  await fs.writeFile(
    path.join(fakeBin, "claude"),
    `#!/bin/sh\ntouch ${claudeStartedMarker}\nsleep 3\nexit 0\n`,
    { mode: 0o755 },
  );

  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);

  const jobStore = new JobStore({
    cwd: tmpDir,
    name: "test-jobs-cancel-gate2",
  });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "execute-cancel-gate2-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    worktreeProvider: fakeWorktreeProvider,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getApiOrigin: () => `http://127.0.0.1:${mock.port}`,
    jobStore,
  });
  serversToClose.push(server);
  await server.start();

  const loopId = "00000000-0000-0000-0000-000000000800";
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
        repo: {
          fullName: `cancel-gate2/${path.basename(repoPath)}`,
          branch: "main",
        },
      }),
    },
  );

  assert.equal(
    response.status,
    200,
    `Expected 200 but got ${response.status}: ${await response.text().catch(() => "")}`,
  );

  // Wait for the job to appear as RUNNING
  await waitForJobRunning(jobStore, loopId);

  // Wait for the fake claude binary to start (marker file created on entry).
  // This proves gate 1 passed and attemptLlmCommit has been entered.
  const markerDeadline = Date.now() + 15_000;
  while (Date.now() < markerDeadline) {
    try {
      await fs.access(claudeStartedMarker);
      break;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }
  await fs.access(claudeStartedMarker); // throws if still missing

  // Set CANCEL_PENDING now. Gate 1 has already passed.
  // Claude is sleeping for 3s, so gate 2 hasn't run yet.
  const currentJob = jobStore.getByLoopId(loopId)!;
  jobStore.upsert({
    ...currentJob,
    status: "CANCEL_PENDING",
    updatedAt: new Date().toISOString(),
  });

  // Wait for terminal state — gate 2 fires after claude exits
  const terminalJob = await waitForJobTerminal(jobStore, loopId);
  assert.equal(
    terminalJob.status,
    "CANCELLED",
    `Expected job status CANCELLED, got: ${terminalJob.status}`,
  );

  // Verify no completed event was posted
  const eventsUrl = `/loops/${loopId}/events`;
  const completedEvents = mock.requests.filter((r) => {
    if (!r.url.includes(eventsUrl)) return false;
    try {
      const body = JSON.parse(r.body) as Record<string, unknown>;
      return body.type === "completed";
    } catch {
      return false;
    }
  });
  assert.equal(
    completedEvents.length,
    0,
    `Expected no completed event when cancelled during attemptLlmCommit, got ${completedEvents.length}`,
  );
});

// ---------------------------------------------------------------------------
// Test 8 (T-1.3): Artifact links use /implementation-plans/ path in both the
//         SAFETY commit PR body and the LLM commit prompt footer.
//
// The fake gh binary captures --body-file content.
// The fake claude binary captures its -p argument to a file (then exits without
// writing execution-result.json so the code falls through to executeGitOperations).
// Both captures are asserted to contain /implementation-plans/ and not to
// contain /artifact/by-slug/.
// ---------------------------------------------------------------------------

test("EXECUTE: artifact links use /implementation-plans/ in PR body and LLM prompt footer", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "execute-artifactlink-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-artifactlink");
  await initGitRepo(repoPath);

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;

  // fake run-loop.sh: writes a file to create an uncommitted change so that
  // executeGitOperations finds something to commit after attemptLlmCommit falls through.
  await createFakeRunLoopScript(
    tmpDir,
    [
      "#!/bin/sh",
      "echo 'feature output' > feature-output.txt",
      "exit 0",
    ].join("\n")
  );

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });

  // Capture paths
  const claudePromptCapture = path.join(tmpDir, "claude-prompt-capture.txt");
  const ghBodyCapture = path.join(tmpDir, "gh-body-capture.txt");

  // fake claude for attemptLlmCommit: captures the -p argument (the LLM prompt)
  // to a file, then exits 0 without writing execution-result.json so the code
  // falls through to the SAFETY executeGitOperations path.
  const claudeScript = [
    "#!/bin/sh",
    "# Capture the argument following -p",
    "prev=''",
    'for arg in "$@"; do',
    '  if [ "$prev" = "-p" ]; then',
    `    printf '%s' "$arg" > ${JSON.stringify(claudePromptCapture)}`,
    "  fi",
    '  prev="$arg"',
    "done",
    "exit 0",
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "claude"), claudeScript, { mode: 0o755 });

  // fake git: pass through all real git operations; stub push to avoid remote requirement
  const fakeGitScript = [
    "#!/bin/sh",
    "if [ \"$1\" = push ]; then exit 0; fi",
    `exec /usr/bin/git "$@"`,
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });

  // fake gh: capture --body-file content to ghBodyCapture.
  // pr view (existing-PR check) exits non-zero so code proceeds to gh pr create.
  // pr view --json body returns empty body so the metadata-footer update is a no-op.
  const fakeGhScript = [
    "#!/bin/sh",
    "if [ \"$1\" = pr ] && [ \"$2\" = view ] && [ \"$3\" != \"--json\" ]; then",
    "  exit 1",
    "fi",
    "if [ \"$1\" = pr ] && [ \"$2\" = view ] && [ \"$3\" = \"--json\" ]; then",
    "  printf '{\"body\":\"\"}\\n'",
    "  exit 0",
    "fi",
    "if [ \"$1\" = pr ] && [ \"$2\" = create ]; then",
    "  prev=''",
    "  for arg in \"$@\"; do",
    "    if [ \"$prev\" = \"--body-file\" ] && [ -f \"$arg\" ]; then",
    `      cp "$arg" ${JSON.stringify(ghBodyCapture)}`,
    "    fi",
    "    prev=\"$arg\"",
    "  done",
    "  printf 'https://github.com/org/repo-artifactlink/pull/99\\n'",
    "  exit 0",
    "fi",
    "if [ \"$1\" = pr ] && [ \"$2\" = edit ]; then",
    "  exit 0",
    "fi",
    `exec /usr/bin/gh "$@" 2>/dev/null || true`,
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "gh"), fakeGhScript, { mode: 0o755 });

  // Reset cached claude path and shell PATH so this test's fake-bin is used
  resetResolvedClaudePath();
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "execute-artifactlink-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getApiOrigin: () => `http://127.0.0.1:${mock.port}`,
  });
  serversToClose.push(server);
  await server.start();

  const loopId = "00000000-0000-0000-0000-000000001000";
  const artifactSlug = "PLAN-42";
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
        artifactSlug,
        repo: { fullName: `artifactlink/${path.basename(repoPath)}`, branch: "main" },
      }),
    }
  );

  assert.equal(
    response.status,
    200,
    `Expected 200 but got ${response.status}: ${await response.text().catch(() => "")}`
  );

  // Wait for upload to confirm the flow completed
  await mock.waitForRequest("upload-artifacts");

  // Assert the LLM prompt footer contains /implementation-plans/ and not /artifact/by-slug/
  const capturedPrompt = await fs.readFile(claudePromptCapture, "utf-8").catch(() => "");
  assert.ok(
    capturedPrompt.includes("/implementation-plans/"),
    `Expected LLM prompt footer to contain /implementation-plans/, got prompt (tail): ${capturedPrompt.slice(-500)}`
  );
  assert.ok(
    !capturedPrompt.includes("/artifact/by-slug/"),
    `Expected LLM prompt to NOT contain /artifact/by-slug/, but it does. Prompt (tail): ${capturedPrompt.slice(-500)}`
  );

  // Assert the SAFETY commit PR body also contains /implementation-plans/ and not /artifact/by-slug/
  const capturedBody = await fs.readFile(ghBodyCapture, "utf-8").catch(() => "");
  assert.ok(
    capturedBody.includes("/implementation-plans/"),
    `Expected SAFETY PR body to contain /implementation-plans/, got body: ${capturedBody}`
  );
  assert.ok(
    !capturedBody.includes("/artifact/by-slug/"),
    `Expected SAFETY PR body to NOT contain /artifact/by-slug/, but it does. Body: ${capturedBody}`
  );
});

// ---------------------------------------------------------------------------
// Test 9 (T-2.3): SAFETY commit PR title format is
//         "<artifactSlug>: Automated changes from loop <shortId>"
//         and does NOT contain the old 'Symphony: EXECUTE' substring.
// ---------------------------------------------------------------------------

test("EXECUTE: SAFETY commit PR title uses '<slug>: Automated changes from loop <shortId>' format", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "execute-prtitle-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-prtitle");
  await initGitRepo(repoPath);

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;

  // fake run-loop.sh: write a file so there are changes to commit
  await createFakeRunLoopScript(
    tmpDir,
    [
      "#!/bin/sh",
      "echo 'implementation output' > impl.txt",
      "exit 0",
    ].join("\n")
  );

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });

  // fake claude: exits 0 without execution-result.json so code falls through to
  // executeGitOperations (the SAFETY commit path)
  await fs.writeFile(
    path.join(fakeBin, "claude"),
    "#!/bin/sh\nexit 0\n",
    { mode: 0o755 }
  );

  // Capture file for the gh pr create --title argument
  const ghTitleCapture = path.join(tmpDir, "gh-title-capture.txt");

  // fake git: stub push; delegate everything else to real git
  const fakeGitScript = [
    "#!/bin/sh",
    "if [ \"$1\" = push ]; then exit 0; fi",
    `exec /usr/bin/git "$@"`,
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });

  // fake gh: capture --title argument; return a fake PR URL from pr create;
  // return non-zero for pr view (no existing PR) so pr create is called;
  // return empty body for pr view --json body to skip the footer-update step.
  const fakeGhScript = [
    "#!/bin/sh",
    "if [ \"$1\" = pr ] && [ \"$2\" = view ] && [ \"$3\" != \"--json\" ]; then",
    "  exit 1",
    "fi",
    "if [ \"$1\" = pr ] && [ \"$2\" = view ] && [ \"$3\" = \"--json\" ]; then",
    "  printf '{\"body\":\"\"}\\n'",
    "  exit 0",
    "fi",
    "if [ \"$1\" = pr ] && [ \"$2\" = create ]; then",
    "  prev=''",
    "  for arg in \"$@\"; do",
    "    if [ \"$prev\" = \"--title\" ]; then",
    `      printf '%s' "$arg" > ${JSON.stringify(ghTitleCapture)}`,
    "    fi",
    "    prev=\"$arg\"",
    "  done",
    "  printf 'https://github.com/org/repo-prtitle/pull/55\\n'",
    "  exit 0",
    "fi",
    "if [ \"$1\" = pr ] && [ \"$2\" = edit ]; then",
    "  exit 0",
    "fi",
    `exec /usr/bin/gh "$@" 2>/dev/null || true`,
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "gh"), fakeGhScript, { mode: 0o755 });

  resetResolvedClaudePath();
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "execute-prtitle-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getApiOrigin: () => `http://127.0.0.1:${mock.port}`,
  });
  serversToClose.push(server);
  await server.start();

  const loopId = "00000000-0000-0000-0000-000000001100";
  const artifactSlug = "PLAN-55";
  const shortId = loopId.slice(0, 8); // "00000000"

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
        artifactSlug,
        repo: { fullName: `prtitle/${path.basename(repoPath)}`, branch: "main" },
      }),
    }
  );

  assert.equal(
    response.status,
    200,
    `Expected 200 but got ${response.status}: ${await response.text().catch(() => "")}`
  );

  // Wait for the upload to confirm git operations completed
  await mock.waitForRequest("upload-artifacts");

  const capturedTitle = await fs.readFile(ghTitleCapture, "utf-8").catch(() => "");

  // Assert the title matches the expected format:
  // "<artifactSlug>: Automated changes from loop <shortId>"
  const expectedTitle = `${artifactSlug}: Automated changes from loop ${shortId}`;
  assert.equal(
    capturedTitle,
    expectedTitle,
    `Expected PR title "${expectedTitle}", got "${capturedTitle}"`
  );

  // Assert the old 'Symphony: EXECUTE' format is NOT used
  assert.ok(
    !capturedTitle.includes("Symphony: EXECUTE"),
    `PR title must not contain 'Symphony: EXECUTE', got: "${capturedTitle}"`
  );
});

// ---------------------------------------------------------------------------
// Test 10 (T-3.3): LLM commit spawn correctness
//   - spawn uses the resolved absolute binary path (not bare 'claude' string)
//   - assertPathAllowed is called before spawn (evidenced by the spawn succeeding
//     when worktreeDir is within allowed directories)
//   - PID is written atomically (process.pid exists and .pid.tmp is cleaned up)
// ---------------------------------------------------------------------------

test("EXECUTE: LLM commit spawns claude via resolved absolute path and writes PID atomically", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "execute-llmspawn-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-llmspawn");
  await initGitRepo(repoPath);

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;

  // fake run-loop.sh: exits 0 immediately so attemptLlmCommit is reached
  await createFakeRunLoopScript(tmpDir, "#!/bin/sh\nexit 0\n");

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });

  // Capture paths
  const claudeArgvCapture = path.join(tmpDir, "claude-argv-capture.txt");
  const claudeBinaryCapture = path.join(tmpDir, "claude-binary-capture.txt");

  // fake claude for attemptLlmCommit:
  // 1. Writes its own invocation path ($0) to claudeBinaryCapture — this is the
  //    path that the OS resolved when spawning the binary.  If spawn used the
  //    absolute path it will start with '/'; if it used bare 'claude' it will
  //    just be 'claude'.
  // 2. Writes all args to claudeArgvCapture for inspection.
  // 3. Exits 0 without writing execution-result.json (falls through to SAFETY path,
  //    which is fine — we only care about proving the spawn happened).
  const claudeScript = [
    "#!/bin/sh",
    `printf '%s' "$0" > ${JSON.stringify(claudeBinaryCapture)}`,
    `printf '%s\\n' "$@" > ${JSON.stringify(claudeArgvCapture)}`,
    "exit 0",
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "claude"), claudeScript, { mode: 0o755 });

  // fake git: stub push; pass everything else to real git
  const fakeGitScript = [
    "#!/bin/sh",
    "if [ \"$1\" = push ]; then exit 0; fi",
    `exec /usr/bin/git "$@"`,
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });

  // fake gh: return non-zero for pr view so SAFETY path tries to create
  // but return non-zero for create too — we don't need a real PR since the test
  // only asserts on the LLM spawn behaviour (claude exits without result file,
  // executeGitOperations runs, git status returns empty because run-loop.sh
  // made no changes, so no-changes path is taken — no gh calls needed).
  await fs.writeFile(
    path.join(fakeBin, "gh"),
    "#!/bin/sh\nexit 1\n",
    { mode: 0o755 }
  );

  resetResolvedClaudePath();
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);

  const jobStore = new JobStore({ cwd: tmpDir, name: "test-jobs-llmspawn" });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "execute-llmspawn-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getApiOrigin: () => `http://127.0.0.1:${mock.port}`,
    jobStore,
  });
  serversToClose.push(server);
  await server.start();

  const loopId = "00000000-0000-0000-0000-000000001200";
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
        repo: { fullName: `llmspawn/${path.basename(repoPath)}`, branch: "main" },
      }),
    }
  );

  assert.equal(
    response.status,
    200,
    `Expected 200 but got ${response.status}: ${await response.text().catch(() => "")}`
  );

  // Wait for the upload to confirm the full post-processing pipeline ran
  await mock.waitForRequest("upload-artifacts");

  // --- Assert 1: claude was spawned with the resolved absolute binary path ---
  // The fake claude writes $0 (its own path as seen by the OS) to claudeBinaryCapture.
  // When spawned via the absolute path the value will be the full path under fakeBin.
  // If the code fell back to bare 'claude' it would just be 'claude'.
  const capturedBinary = await fs.readFile(claudeBinaryCapture, "utf-8").catch(() => "");
  assert.ok(
    capturedBinary.startsWith("/"),
    `Expected claude binary path to be absolute (starts with '/'), got: "${capturedBinary}"`
  );
  assert.ok(
    capturedBinary.includes(fakeBin),
    `Expected claude binary path to be under fakeBin (${fakeBin}), got: "${capturedBinary}"`
  );

  // --- Assert 2: spawn received -p as first argument (correct arg format) ---
  const capturedArgv = await fs.readFile(claudeArgvCapture, "utf-8").catch(() => "");
  assert.ok(
    capturedArgv.startsWith("-p\n"),
    `Expected first captured arg to be '-p', got argv (head): "${capturedArgv.slice(0, 100)}"`
  );

  // --- Assert 3: PID written atomically (process.pid exists, .pid.tmp cleaned up) ---
  // The PID file is written inside claudeWorkDir = worktreeDir/.claude/work
  // We don't know the exact worktreeDir, but we can get it from the job store.
  const job = jobStore.getByLoopId(loopId);
  assert.ok(job, "Expected job to exist in store after completion");

  const claudeWorkDir = job!.claudeWorkDir;
  assert.ok(claudeWorkDir, "Expected claudeWorkDir to be set on job");

  const pidFilePath = path.join(claudeWorkDir!, "process.pid");
  const pidTmpPath = path.join(claudeWorkDir!, "process.pid.tmp");

  // process.pid should exist and contain a numeric PID
  const pidContent = await fs.readFile(pidFilePath, "utf-8").catch(() => "");
  assert.ok(
    /^\d+$/.test(pidContent.trim()),
    `Expected process.pid to contain a numeric PID, got: "${pidContent}"`
  );

  // process.pid.tmp should NOT exist — the atomic rename should have moved it
  let tmpExists = false;
  try {
    await fs.access(pidTmpPath);
    tmpExists = true;
  } catch {
    // Expected: file does not exist
  }
  assert.ok(
    !tmpExists,
    `Expected process.pid.tmp to be cleaned up after atomic rename, but it still exists`
  );
});

// ---------------------------------------------------------------------------
// Test 7: Non-zero exit with CANCEL_PENDING — PROCESS_FAILED event skipped
//         run-loop.sh sleeps then exits with code 1. CANCEL_PENDING is set
//         while it sleeps. The non-zero exit path detects wasCancelled and
//         skips the PROCESS_FAILED error event. Job ends as CANCELLED.
// ---------------------------------------------------------------------------

test("EXECUTE: non-zero exit with CANCEL_PENDING skips PROCESS_FAILED and ends as CANCELLED", async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "execute-cancel-nonzero-"),
  );
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-cancel-nonzero");
  await fs.mkdir(repoPath, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;

  // fake run-loop.sh: sleep then exit with non-zero code
  await createFakeRunLoopScript(tmpDir, "#!/bin/sh\nsleep 2\nexit 1\n");

  // fake-bin: claude exits 0 (won't be called — non-zero exit path skips attemptLlmCommit)
  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });

  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);

  const jobStore = new JobStore({
    cwd: tmpDir,
    name: "test-jobs-cancel-nonzero",
  });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "execute-cancel-nonzero-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    worktreeProvider: fakeWorktreeProvider,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getApiOrigin: () => `http://127.0.0.1:${mock.port}`,
    jobStore,
  });
  serversToClose.push(server);
  await server.start();

  const loopId = "00000000-0000-0000-0000-000000000900";
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
        repo: {
          fullName: `cancel-nonzero/${path.basename(repoPath)}`,
          branch: "main",
        },
      }),
    },
  );

  assert.equal(
    response.status,
    200,
    `Expected 200 but got ${response.status}: ${await response.text().catch(() => "")}`,
  );

  // Wait for the job to appear as RUNNING, then set CANCEL_PENDING.
  // run-loop.sh is sleeping for 2s, so this fires well before it exits.
  const runningJob = await waitForJobRunning(jobStore, loopId);
  jobStore.upsert({
    ...runningJob,
    status: "CANCEL_PENDING",
    updatedAt: new Date().toISOString(),
  });

  // Wait for the job to reach terminal state
  const terminalJob = await waitForJobTerminal(jobStore, loopId);
  assert.equal(
    terminalJob.status,
    "CANCELLED",
    `Expected job status CANCELLED (not FAILED), got: ${terminalJob.status}`,
  );

  // Verify no PROCESS_FAILED error event was posted
  const eventsUrl = `/loops/${loopId}/events`;
  const errorEvents = mock.requests.filter((r) => {
    if (!r.url.includes(eventsUrl)) return false;
    try {
      const body = JSON.parse(r.body) as Record<string, unknown>;
      return body.type === "error" && body.code === LoopErrorCode.PROCESS_FAILED;
    } catch {
      return false;
    }
  });
  assert.equal(
    errorEvents.length,
    0,
    `Expected no PROCESS_FAILED event when cancelled, got ${errorEvents.length}`,
  );
});

async function runPlanErrorScenario(scenario: {
  name: string;
  tmpPrefix: string;
  repoOwner: string;
  machineName: string;
  loopId: string;
  errorMessage: string;
  exitCode: number;
  expectedCode: LoopErrorCode;
  expectedMessageIncludes?: string;
  unexpectedCode?: LoopErrorCode;
}): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), scenario.tmpPrefix));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, `repo-${scenario.name}`);
  await fs.mkdir(repoPath, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;

  const errorJsonl = JSON.stringify({
    type: "result",
    subtype: "error",
    result: scenario.errorMessage,
    is_error: true,
  });
  const scriptBody = [
    "#!/bin/sh",
    `mkdir -p "$CLOSEDLOOP_WORKDIR"`,
    `echo '${errorJsonl}' >> "$CLOSEDLOOP_WORKDIR/claude-output.jsonl"`,
    `exit ${scenario.exitCode}`,
  ].join("\n");
  await createFakeRunLoopScript(tmpDir, scriptBody, { skipTokens: true });

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: scenario.machineName,
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    worktreeProvider: fakeWorktreeProvider,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getApiOrigin: () => `http://127.0.0.1:${mock.port}`,
  });
  serversToClose.push(server);
  await server.start();

  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId: scenario.loopId,
        command: "PLAN",
        closedLoopAuthToken: "tok",
        artifacts: [],
        repo: {
          fullName: `${scenario.repoOwner}/${path.basename(repoPath)}`,
          branch: "main",
        },
      }),
    },
  );

  assert.equal(
    response.status,
    200,
    `Expected 200 but got ${response.status}: ${await response.text().catch(() => "")}`,
  );

  const terminalEvent = await waitForTerminalEvent(mock.requests, scenario.loopId);
  assert.equal(
    terminalEvent.type,
    "error",
    `Expected event type 'error', got: ${String(terminalEvent.type)}`,
  );
  assert.equal(
    terminalEvent.code,
    scenario.expectedCode,
    `Expected error code ${scenario.expectedCode}, got: ${String(terminalEvent.code)}`,
  );

  if (scenario.expectedMessageIncludes) {
    assert.ok(
      typeof terminalEvent.message === "string" &&
        terminalEvent.message.includes(scenario.expectedMessageIncludes),
      `Expected message to include "${scenario.expectedMessageIncludes}", got: ${String(terminalEvent.message)}`,
    );
  }

  if (scenario.unexpectedCode) {
    const eventsUrl = `/loops/${scenario.loopId}/events`;
    const matchingEvents = mock.requests.filter((r) => {
      if (!r.url.includes(eventsUrl)) return false;
      try {
        const body = JSON.parse(r.body) as Record<string, unknown>;
        return body.code === scenario.unexpectedCode;
      } catch {
        return false;
      }
    });
    assert.equal(
      matchingEvents.length,
      0,
      `Expected no ${scenario.unexpectedCode} events, got ${matchingEvents.length}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tests T-4.3a/b/c: REQUEST_CHANGES --resume suppression
//
// The REQUEST_CHANGES command should suppress --resume <parentSessionId> when
// the previous job for that loopId failed with an error code that should start
// a fresh Claude session.
//
// Three cases:
//   T-4.3a: lastErrorCode === 'AUTH_CHALLENGE' → --resume OMITTED
//   T-4.3b: lastErrorCode === 'CONTEXT_LIMIT_EXCEEDED' → --resume OMITTED
//   T-4.3c: lastErrorCode is undefined (field absent) → --resume INCLUDED
// ---------------------------------------------------------------------------

/**
 * Helper: creates the shared infrastructure for a REQUEST_CHANGES --resume test.
 * Returns the server port, mock, jobStore, and the path to the claude args capture file.
 */
async function setupRequestChangesTest(opts: {
  tmpDir: string;
  loopId: string;
  machineName: string;
}): Promise<{
  mock: Awaited<ReturnType<typeof startMockApiServer>>;
  server: DesktopGatewayServer;
  jobStore: JobStore;
  claudeArgvCapture: string;
  repoPath: string;
}> {
  const { tmpDir, loopId, machineName } = opts;

  process.env.HOME = tmpDir;

  const repoPath = path.join(tmpDir, "repo-rc");
  await fs.mkdir(repoPath, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });

  const claudeArgvCapture = path.join(tmpDir, "claude-argv-capture.txt");

  // Fake claude: writes all args (one per line) to capture file, then exits 0.
  // Must also write a minimal JSONL result to prevent NO_WORK_PRODUCED guard.
  const tokenJsonl = JSON.stringify({
    type: "assistant",
    message: { usage: { input_tokens: 10, output_tokens: 5 } },
  });
  const claudeScript = [
    "#!/bin/sh",
    `printf '%s\n' "$@" > ${JSON.stringify(claudeArgvCapture)}`,
    // Write a result record so the loop does not fire the 0-token guard
    `mkdir -p "$CLOSEDLOOP_WORKDIR" 2>/dev/null`,
    `echo '${tokenJsonl}' >> "$CLOSEDLOOP_WORKDIR/claude-output.jsonl"`,
    `echo '{"type":"result","subtype":"success","result":"","is_error":false}' >> "$CLOSEDLOOP_WORKDIR/claude-output.jsonl"`,
    "exit 0",
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "claude"), claudeScript, { mode: 0o755 });

  resetResolvedClaudePath();
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);

  const jobStore = new JobStore({ cwd: tmpDir, name: `test-jobs-rc-${loopId.slice(-4)}` });

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName,
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    worktreeProvider: fakeWorktreeProvider,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getApiOrigin: () => `http://127.0.0.1:${mock.port}`,
    jobStore,
  });
  serversToClose.push(server);
  await server.start();

  return { mock, server, jobStore, claudeArgvCapture, repoPath };
}

const requestChangesResumeSuppressionScenarios = [
  {
    name: "AUTH_CHALLENGE",
    tmpPrefix: "rc-resume-auth-",
    loopId: "00000000-0000-0000-0000-000000001600",
    machineName: "rc-resume-auth-machine",
    previousJobId: "rc-resume-auth-seed",
    previousErrorCode: LoopErrorCode.AUTH_CHALLENGE,
    parentSessionId: "session-abc-123",
    artifactSlug: "PLAN-160",
    repoOwner: "rc-auth",
    expectResume: false,
  },
  {
    name: "CONTEXT_LIMIT_EXCEEDED",
    tmpPrefix: "rc-resume-ctx-",
    loopId: "00000000-0000-0000-0000-000000001700",
    machineName: "rc-resume-ctx-machine",
    previousJobId: "rc-resume-ctx-seed",
    previousErrorCode: LoopErrorCode.CONTEXT_LIMIT_EXCEEDED,
    parentSessionId: "session-ctx-456",
    artifactSlug: "PLAN-170",
    repoOwner: "rc-ctx",
    expectResume: false,
  },
  {
    name: "no previous job",
    tmpPrefix: "rc-resume-nojob-",
    loopId: "00000000-0000-0000-0000-000000001800",
    machineName: "rc-resume-nojob-machine",
    previousJobId: undefined,
    previousErrorCode: undefined,
    parentSessionId: "session-nojob-789",
    artifactSlug: "PLAN-180",
    repoOwner: "rc-nojob",
    expectResume: true,
  },
] as const;

for (const scenario of requestChangesResumeSuppressionScenarios) {
  test(
    `REQUEST_CHANGES: ${scenario.expectResume ? "includes" : "omits"} --resume for ${scenario.name}`,
    async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), scenario.tmpPrefix));
      tempPathsToClean.push(tmpDir);

      const { mock, server, jobStore, claudeArgvCapture, repoPath } = await setupRequestChangesTest({
        tmpDir,
        loopId: scenario.loopId,
        machineName: scenario.machineName,
      });

      if (scenario.previousJobId && scenario.previousErrorCode) {
        jobStore.upsert({
          id: scenario.previousJobId,
          kind: "SYMPHONY_LOOP",
          loopId: scenario.loopId,
          command: "REQUEST_CHANGES",
          status: "FAILED",
          lastErrorCode: scenario.previousErrorCode,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      const response = await fetch(
        `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/loop`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            loopId: scenario.loopId,
            command: "REQUEST_CHANGES",
            closedLoopAuthToken: "tok",
            artifacts: [],
            artifactSlug: scenario.artifactSlug,
            parentSessionId: scenario.parentSessionId,
            repo: {
              fullName: `${scenario.repoOwner}/${path.basename(repoPath)}`,
              branch: "main",
            },
          }),
        }
      );

      assert.equal(
        response.status,
        200,
        `Expected 200 but got ${response.status}: ${await response.text().catch(() => "")}`
      );

      await waitForCompletedEvent(mock.requests, scenario.loopId);

      const capturedArgv = await fs.readFile(claudeArgvCapture, "utf-8").catch(() => "");
      const argLines = capturedArgv.split("\n").filter(Boolean);

      assert.ok(
        argLines.includes("--resume") === scenario.expectResume,
        `Expected --resume presence=${String(scenario.expectResume)} for ${scenario.name}, but got args: ${argLines.join(" ")}`
      );
      assert.ok(
        argLines.includes(scenario.parentSessionId) === scenario.expectResume,
        `Expected parentSessionId presence=${String(scenario.expectResume)} for ${scenario.name}, but got args: ${argLines.join(" ")}`
      );
    }
  );
}
