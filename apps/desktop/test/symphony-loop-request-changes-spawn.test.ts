/**
 * Spawn tests for REQUEST_CHANGES with additionalRepos.
 *
 * T-5.2: Add integration tests for REQUEST_CHANGES with additionalRepos
 *
 * Test cases:
 * (a) REQUEST_CHANGES with valid additionalRepos succeeds (HTTP 200)
 * (b) The captured spawn env contains CLOSEDLOOP_ADD_DIRS set to pipe-separated
 *     additional worktree directory paths (split by '|' yields N non-empty
 *     absolute paths)
 * (c) findWorktreeForBranch returns existing path → ensureWorktree NOT called
 * (d) findWorktreeForBranch returns null → create-new fallback, ensureWorktree called
 * (e) SYMPHONY_WORKTREE_PARENT_DIR outside allowed dirs → HTTP 403 + RepoNotAllowed event
 *
 * REQUEST_CHANGES spawns claude directly (not run-loop.sh), so this file uses
 * setupStubClaude from symphony-test-utils.ts. The stub claude writes its env
 * to $CLOSEDLOOP_WORKDIR/spawn-env.txt so tests can assert on CLOSEDLOOP_ADD_DIRS.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  resetResolvedClaudePath,
} from "../src/server/operations/symphony-loop.js";
import type { WorktreeProvider } from "../src/server/operations/symphony-loop.js";
import { setShellPathForTest } from "../src/server/shell-path.js";
import {
  makeMultiRepoGateway,
  makeMultiRepoTestHarness,
  startMockApiServer,
  waitForTerminalEvent,
} from "./symphony-test-utils.js";

// ---------------------------------------------------------------------------
// Shared state and cleanup
// ---------------------------------------------------------------------------

const { serversToClose, mockServersToClose, tempPathsToClean, cleanup } =
  makeMultiRepoTestHarness();

afterEach(async () => {
  resetResolvedClaudePath();
  await cleanup();
});

/** Create a gateway server with a mock API backend and a given worktree provider. */
function createTestGateway(
  tmpDir: string,
  mockPort: number,
  worktreeProvider: WorktreeProvider,
) {
  return makeMultiRepoGateway({
    tmpDir,
    mockPort,
    machineName: "rc-spawn-test",
    worktreeProvider,
    serversToClose,
  });
}

/**
 * Build a recording WorktreeProvider for REQUEST_CHANGES tests. Records
 * ensureWorktree calls. findWorktreeForBranch returns `existingPath` when
 * provided, or null otherwise (exercises the create-new fallback).
 */
function makeRcRecordingProvider(options?: {
  existingPath?: string;
}): {
  provider: WorktreeProvider;
  ensureWorktreeCalls: Array<{
    repoPath: string;
    worktreeDir: string;
    branchName: string;
    baseBranch: string;
  }>;
} {
  const ensureWorktreeCalls: Array<{
    repoPath: string;
    worktreeDir: string;
    branchName: string;
    baseBranch: string;
  }> = [];

  const provider: WorktreeProvider = {
    async ensureWorktree(repoPath, worktreeDir, branchName, baseBranch) {
      ensureWorktreeCalls.push({ repoPath, worktreeDir, branchName, baseBranch });
      await fs.mkdir(worktreeDir, { recursive: true });
    },
    findWorktreeForBranch() {
      return options?.existingPath ?? null;
    },
    async removeWorktree(worktreeDir) {
      await fs.rm(worktreeDir, { recursive: true, force: true });
    },
    getCurrentBranch() {
      return "symphony/rc-spawn-test";
    },
    branchExists: async () => true,
  };

  return { provider, ensureWorktreeCalls };
}

/**
 * Build a recording WorktreeProvider that also captures removeWorktree calls.
 * findWorktreeForBranch always returns null (forcing ensureWorktree for every
 * worktree, including additional repos). Used by the failure-cleanup test.
 */
function makeRcRecordingProviderWithRemove(): {
  provider: WorktreeProvider;
  ensureWorktreeCalls: Array<{
    repoPath: string;
    worktreeDir: string;
    branchName: string;
    baseBranch: string;
  }>;
  removeCalls: Array<{ worktreeDir: string; repoPath: string; loopId?: string }>;
} {
  const ensureWorktreeCalls: Array<{
    repoPath: string;
    worktreeDir: string;
    branchName: string;
    baseBranch: string;
  }> = [];
  const removeCalls: Array<{ worktreeDir: string; repoPath: string; loopId?: string }> = [];

  const provider: WorktreeProvider = {
    async ensureWorktree(repoPath, worktreeDir, branchName, baseBranch) {
      ensureWorktreeCalls.push({ repoPath, worktreeDir, branchName, baseBranch });
      await fs.mkdir(worktreeDir, { recursive: true });
    },
    findWorktreeForBranch() {
      return null;
    },
    async removeWorktree(worktreeDir, repoPath, loopId) {
      removeCalls.push({ worktreeDir, repoPath, loopId });
      await fs.rm(worktreeDir, { recursive: true, force: true });
    },
    getCurrentBranch() {
      return "symphony/rc-spawn-test";
    },
    branchExists: async () => true,
  };

  return { provider, ensureWorktreeCalls, removeCalls };
}

/**
 * Recursively find the first file named `filename` under `searchRoot`.
 * Polls until found or the timeout elapses.
 */
async function waitForFile(
  searchRoot: string,
  filename: string,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await findFileRecursive(searchRoot, filename);
    if (found !== null) {
      return found;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Timed out waiting for ${filename} under ${searchRoot} after ${timeoutMs}ms`,
  );
}

async function findFileRecursive(dir: string, filename: string): Promise<string | null> {
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === filename) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const result = await findFileRecursive(fullPath, filename);
      if (result !== null) {
        return result;
      }
    }
  }
  return null;
}

/**
 * Create a stub claude binary that:
 * 1. Writes CLOSEDLOOP_ADD_DIRS to $CLOSEDLOOP_WORKDIR/spawn-env.txt
 * 2. Emits one stream-json line so the 0-token guard does NOT fire
 *    (grep '^{' picks this up; the tee writes it to claude-output.jsonl)
 * 3. Exits 0
 *
 * The CLOSEDLOOP_WORKDIR env var is set by the gateway on the spawn env, so the
 * stub writes to the correct claudeWorkDir regardless of cwd.
 */
async function setupStubClaudeWithEnvCapture(tmpDir: string): Promise<void> {
  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });

  const stubScript = [
    "#!/bin/sh",
    // Write CLOSEDLOOP_ADD_DIRS so the test can assert on it
    'echo "$CLOSEDLOOP_ADD_DIRS" > "$CLOSEDLOOP_WORKDIR/spawn-env.txt"',
    // Emit one JSON line so the token usage parser gets non-zero tokens
    'echo \'{"type":"assistant","message":{"usage":{"input_tokens":10,"output_tokens":5}}}\'',
    "exit 0",
  ].join("\n");

  await fs.writeFile(path.join(fakeBin, "claude"), stubScript, { mode: 0o755 });
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();
}

// ---------------------------------------------------------------------------
// Test (a) + (b): REQUEST_CHANGES with 2 additionalRepos → HTTP 200,
//                 CLOSEDLOOP_ADD_DIRS contains 2 pipe-separated abs paths
// ---------------------------------------------------------------------------

test("REQUEST_CHANGES with 2 additionalRepos returns HTTP 200 and sets CLOSEDLOOP_ADD_DIRS", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rc-spawn-adddirs-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const additionalRepo1 = path.join(tmpDir, "additional-repo-1");
  await fs.mkdir(additionalRepo1, { recursive: true });

  const additionalRepo2 = path.join(tmpDir, "additional-repo-2");
  await fs.mkdir(additionalRepo2, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  await setupStubClaudeWithEnvCapture(tmpDir);

  const { provider } = makeRcRecordingProvider();
  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port, provider);

  const loopId = "00000000-0000-0000-0000-000000008010";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "REQUEST_CHANGES",
        closedLoopAuthToken: "tok",
        artifacts: [],
        prompt: "Please amend the plan.",
        localRepoPath: primaryRepo,
        repo: {
          fullName: `rc-spawn-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        additionalRepos: [
          { localRepoPath: additionalRepo1, branch: "main" },
          { localRepoPath: additionalRepo2, branch: "main" },
        ],
      }),
    },
  );

  assert.equal(
    response.status,
    200,
    `Expected HTTP 200, got ${response.status}: ${await response.text()}`,
  );

  // Wait for terminal event so we know the process completed
  const terminalEvent = await waitForTerminalEvent(mock.requests, loopId);
  assert.equal(
    terminalEvent.type,
    "completed",
    `Expected terminal event type 'completed', got '${terminalEvent.type}': ${JSON.stringify(terminalEvent)}`,
  );

  // Find spawn-env.txt written by the stub claude (under claudeWorkDir inside tmpDir)
  const spawnEnvFile = await waitForFile(tmpDir, "spawn-env.txt");
  const addDirsValue = (await fs.readFile(spawnEnvFile, "utf-8")).trim();

  assert.ok(
    addDirsValue.length > 0,
    `Expected CLOSEDLOOP_ADD_DIRS to be non-empty in spawn env, got: '${addDirsValue}'`,
  );

  // Split by '|' — must yield exactly 2 non-empty absolute paths
  const parts = addDirsValue.split("|").filter((p) => p.trim().length > 0);
  assert.equal(
    parts.length,
    2,
    `Expected CLOSEDLOOP_ADD_DIRS split by '|' to yield 2 paths, got ${parts.length}. Value: '${addDirsValue}'`,
  );

  for (const part of parts) {
    assert.ok(
      path.isAbsolute(part),
      `Expected each path in CLOSEDLOOP_ADD_DIRS to be absolute, got: '${part}'`,
    );
    assert.ok(
      part.startsWith(worktreeParent),
      `Expected path '${part}' to start with worktreeParent '${worktreeParent}'`,
    );
  }
});

// ---------------------------------------------------------------------------
// Test (c): findWorktreeForBranch returns existing path → ensureWorktree NOT called
//           for the additional repo
// ---------------------------------------------------------------------------

test("REQUEST_CHANGES reuses additional repo worktree when findWorktreeForBranch returns existing path", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rc-spawn-reuse-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const additionalRepo = path.join(tmpDir, "additional-repo");
  await fs.mkdir(additionalRepo, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  // Pre-existing worktree for the additional repo
  const existingWorktreePath = path.join(worktreeParent, "additional-repo-loop-existing");
  await fs.mkdir(existingWorktreePath, { recursive: true });

  // Pre-existing worktree for the primary repo (so findWorktreeForBranch reuse works for both)
  const primaryWorktreePath = path.join(worktreeParent, "primary-repo-loop-existing");
  await fs.mkdir(primaryWorktreePath, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  await setupStubClaudeWithEnvCapture(tmpDir);

  // Provider always returns the pre-existing path so ensureWorktree should never be called
  const ensureWorktreeCalls: Array<{
    repoPath: string;
    worktreeDir: string;
    branchName: string;
    baseBranch: string;
  }> = [];

  const provider: WorktreeProvider = {
    async ensureWorktree(repoPath, worktreeDir, branchName, baseBranch) {
      ensureWorktreeCalls.push({ repoPath, worktreeDir, branchName, baseBranch });
      await fs.mkdir(worktreeDir, { recursive: true });
    },
    findWorktreeForBranch(repoPath) {
      // Return the pre-existing path for both primary and additional repos
      if (repoPath === primaryRepo) {
        return primaryWorktreePath;
      }
      if (repoPath === additionalRepo) {
        return existingWorktreePath;
      }
      return null;
    },
    async removeWorktree(worktreeDir) {
      await fs.rm(worktreeDir, { recursive: true, force: true });
    },
    getCurrentBranch() {
      return "symphony/rc-spawn-reuse-test";
    },
    branchExists: async () => true,
  };

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port, provider);

  const loopId = "00000000-0000-0000-0000-000000008011";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "REQUEST_CHANGES",
        closedLoopAuthToken: "tok",
        artifacts: [],
        prompt: "Please amend the plan.",
        localRepoPath: primaryRepo,
        repo: {
          fullName: `rc-spawn-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        additionalRepos: [
          { localRepoPath: additionalRepo, branch: "main" },
        ],
      }),
    },
  );

  assert.equal(
    response.status,
    200,
    `Expected HTTP 200, got ${response.status}: ${await response.text()}`,
  );

  await waitForTerminalEvent(mock.requests, loopId);

  // ensureWorktree should NOT have been called for the additional repo since
  // findWorktreeForBranch returned the pre-existing path.
  const additionalCalls = ensureWorktreeCalls.filter(
    (c) => c.repoPath === additionalRepo,
  );
  assert.equal(
    additionalCalls.length,
    0,
    `Expected ensureWorktree NOT called for additional repo (reuse path), but got ${additionalCalls.length} call(s)`,
  );
});

// ---------------------------------------------------------------------------
// Test (d): findWorktreeForBranch returns null → create-new fallback,
//           ensureWorktree IS called for the additional repo
// ---------------------------------------------------------------------------

test("REQUEST_CHANGES calls ensureWorktree for additional repo when findWorktreeForBranch returns null", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rc-spawn-createnew-"));
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

  await setupStubClaudeWithEnvCapture(tmpDir);

  // Provider always returns null from findWorktreeForBranch → create-new path
  const { provider, ensureWorktreeCalls } = makeRcRecordingProvider();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port, provider);

  const loopId = "00000000-0000-0000-0000-000000008012";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "REQUEST_CHANGES",
        closedLoopAuthToken: "tok",
        artifacts: [],
        prompt: "Please amend the plan.",
        localRepoPath: primaryRepo,
        repo: {
          fullName: `rc-spawn-test/${path.basename(primaryRepo)}`,
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
    200,
    `Expected HTTP 200 for create-new path, got ${response.status}: ${await response.text()}`,
  );

  await waitForTerminalEvent(mock.requests, loopId);

  // ensureWorktree must have been called for the additional repo
  const additionalCalls = ensureWorktreeCalls.filter(
    (c) => c.repoPath === additionalRepo,
  );
  assert.equal(
    additionalCalls.length,
    1,
    `Expected ensureWorktree called once for additional repo (create-new), got ${additionalCalls.length}`,
  );

  const addCall = additionalCalls[0];
  assert.ok(
    addCall.worktreeDir.startsWith(worktreeParent),
    `Expected ensureWorktree worktreeDir '${addCall.worktreeDir}' to start with worktreeParent '${worktreeParent}'`,
  );
  assert.equal(
    addCall.baseBranch,
    "feature-branch",
    `Expected baseBranch 'feature-branch', got '${addCall.baseBranch}'`,
  );
  assert.ok(
    addCall.branchName.startsWith("symphony/"),
    `Expected branchName to be under symphony/ namespace, got '${addCall.branchName}'`,
  );
});

// ---------------------------------------------------------------------------
// Test T-5.3: REQUEST_CHANGES without additionalRepos → HTTP 200, completed
//             event, and CLOSEDLOOP_ADD_DIRS is NOT set in spawn env
// ---------------------------------------------------------------------------

test("REQUEST_CHANGES without additionalRepos returns HTTP 200, completed event, and does not set CLOSEDLOOP_ADD_DIRS", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rc-spawn-no-addrepos-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  // Use the shared helper which writes the value of CLOSEDLOOP_ADD_DIRS to spawn-env.txt
  await setupStubClaudeWithEnvCapture(tmpDir);

  const { provider } = makeRcRecordingProvider();
  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port, provider);

  const loopId = "00000000-0000-0000-0000-000000008003";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "REQUEST_CHANGES",
        closedLoopAuthToken: "tok",
        artifacts: [],
        prompt: "Please amend the plan.",
        localRepoPath: primaryRepo,
        repo: {
          fullName: `rc-spawn-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        // No additionalRepos field
      }),
    },
  );

  assert.equal(
    response.status,
    200,
    `Expected HTTP 200, got ${response.status}: ${await response.text()}`,
  );

  // Wait for terminal event and assert it is 'completed'
  const terminalEvent = await waitForTerminalEvent(mock.requests, loopId);
  assert.equal(
    terminalEvent.type,
    "completed",
    `Expected terminal event type 'completed', got '${terminalEvent.type}': ${JSON.stringify(terminalEvent)}`,
  );

  // The stub writes the value of CLOSEDLOOP_ADD_DIRS to spawn-env.txt.
  // When additionalRepos is absent, CLOSEDLOOP_ADD_DIRS should not be set,
  // so the file content will be empty.
  const spawnEnvFile = await waitForFile(tmpDir, "spawn-env.txt");
  const contents = (await fs.readFile(spawnEnvFile, "utf-8")).trim();
  assert.ok(
    !contents.includes("CLOSEDLOOP_ADD_DIRS"),
    `Expected CLOSEDLOOP_ADD_DIRS not to appear in env dump, but got: '${contents}'`,
  );
  assert.equal(
    contents,
    "",
    `Expected CLOSEDLOOP_ADD_DIRS value to be empty when no additionalRepos, got: '${contents}'`,
  );
});

// ---------------------------------------------------------------------------
// Test (e): SYMPHONY_WORKTREE_PARENT_DIR outside allowed dirs → HTTP 403 + RepoNotAllowed event
// ---------------------------------------------------------------------------

test("REQUEST_CHANGES with SYMPHONY_WORKTREE_PARENT_DIR outside allowed dirs returns HTTP 403 and RepoNotAllowed event", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rc-spawn-403-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const additionalRepo = path.join(tmpDir, "additional-repo");
  await fs.mkdir(additionalRepo, { recursive: true });

  // Point worktree parent dir OUTSIDE allowed tmpDir — use a sibling tmpdir
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "rc-spawn-outside-"));
  tempPathsToClean.push(outsideDir);

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  // Set worktree parent dir to the OUTSIDE directory — not in allowedDirs ([tmpDir])
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = outsideDir;

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(
    path.join(fakeBin, "claude"),
    "#!/bin/sh\nexit 0\n",
    { mode: 0o755 },
  );
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const { provider } = makeRcRecordingProvider();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port, provider);

  const loopId = "00000000-0000-0000-0000-000000008013";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "REQUEST_CHANGES",
        closedLoopAuthToken: "tok",
        artifacts: [],
        prompt: "Please amend the plan.",
        localRepoPath: primaryRepo,
        repo: {
          fullName: `rc-spawn-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        additionalRepos: [
          { localRepoPath: additionalRepo, branch: "main" },
        ],
      }),
    },
  );

  assert.equal(
    response.status,
    403,
    `Expected HTTP 403 when worktree parent is outside allowed dirs, got ${response.status}`,
  );

  // A RepoNotAllowed error event must be posted
  const errorEvent = await waitForTerminalEvent(mock.requests, loopId);
  assert.equal(
    errorEvent.type,
    "error",
    `Expected error event type, got '${errorEvent.type}': ${JSON.stringify(errorEvent)}`,
  );
  assert.equal(
    errorEvent.code,
    "REPO_NOT_ALLOWED",
    `Expected error code 'REPO_NOT_ALLOWED', got '${errorEvent.code}': ${JSON.stringify(errorEvent)}`,
  );
});

// ---------------------------------------------------------------------------
// Test (f): REQUEST_CHANGES with additionalRepos + claude exits 1 →
//           removeWorktree called for additional worktree, NOT primary
// ---------------------------------------------------------------------------

test("REQUEST_CHANGES with additionalRepos calls removeWorktree for additional worktree on failure, not primary", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rc-spawn-cleanup-"));
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

  // Stub claude that exits 1 to simulate process failure
  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(
    path.join(fakeBin, "claude"),
    "#!/bin/sh\nexit 1\n",
    { mode: 0o755 },
  );
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const { provider, ensureWorktreeCalls, removeCalls } = makeRcRecordingProviderWithRemove();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port, provider);

  const loopId = "00000000-0000-0000-0000-000000008014";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "REQUEST_CHANGES",
        closedLoopAuthToken: "tok",
        artifacts: [],
        prompt: "Please amend the plan.",
        localRepoPath: primaryRepo,
        repo: {
          fullName: `rc-spawn-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        additionalRepos: [
          { localRepoPath: additionalRepo, branch: "main" },
        ],
      }),
    },
  );

  assert.equal(
    response.status,
    200,
    `Expected HTTP 200 (process failure is async), got ${response.status}: ${await response.text()}`,
  );

  // Wait for the terminal event indicating error/failure
  const terminalEvent = await waitForTerminalEvent(mock.requests, loopId);
  assert.ok(
    terminalEvent.type === "error" || terminalEvent.type === "completed",
    `Expected terminal event type 'error' or 'completed', got '${terminalEvent.type}': ${JSON.stringify(terminalEvent)}`,
  );

  // Determine the additional worktree dir from ensureWorktree calls
  const additionalEnsureCall = ensureWorktreeCalls.find(
    (c) => c.repoPath === additionalRepo,
  );
  assert.ok(
    additionalEnsureCall,
    "Expected ensureWorktree to have been called for the additional repo",
  );
  const additionalWorktreeDir = additionalEnsureCall.worktreeDir;

  // Determine the primary worktree dir from ensureWorktree calls
  const primaryEnsureCall = ensureWorktreeCalls.find(
    (c) => c.repoPath === primaryRepo,
  );
  assert.ok(
    primaryEnsureCall,
    "Expected ensureWorktree to have been called for the primary repo",
  );
  const primaryWorktreeDir = primaryEnsureCall.worktreeDir;

  // Poll up to 5 seconds at 50ms intervals until removeCalls contains the
  // additional worktree dir (cleanup is async after the error event is posted)
  const deadline = Date.now() + 5_000;
  while (
    Date.now() < deadline &&
    !removeCalls.some((c) => c.worktreeDir === additionalWorktreeDir)
  ) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }

  // removeWorktree should have been called for the additional worktree dir
  assert.ok(
    removeCalls.some((c) => c.worktreeDir === additionalWorktreeDir),
    `Expected removeWorktree to be called for additional worktree dir ${additionalWorktreeDir} after process failure`,
  );

  // The primary worktree dir must NOT appear in removeCalls — REQUEST_CHANGES
  // reuses the primary worktree and must not remove it on failure
  assert.ok(
    removeCalls.every((c) => c.worktreeDir !== primaryWorktreeDir),
    `Expected removeWorktree NOT to be called for primary worktree dir ${primaryWorktreeDir}, but it was. removeCalls: ${JSON.stringify(removeCalls)}`,
  );
});
