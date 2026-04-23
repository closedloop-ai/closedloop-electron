/**
 * Worktree lifecycle tests for multi-repo PLAN requests.
 *
 * 1. ensureWorktree called per additional repo before spawn with correct branch
 *    (scratch-branch invariants only; naming convention covered by unit tests)
 * 2. removeWorktree called on process failure (run-loop.sh exits 1)
 * 3. ensureWorktree throws — assert non-2xx and error event posted
 *
 * Note: the same-basename collision case is covered by a unit test of
 * additionalRepoDisambiguator in symphony-loop-multi-repo-contract.test.ts.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { JobStore } from "../src/main/job-store.js";
import type { WorktreeProvider } from "../src/server/operations/symphony-loop.js";
import { handleProcessCompletion } from "../src/server/operations/symphony-loop.js";
import { setShellPathForTest } from "../src/server/shell-path.js";
import {
  createFakeRunLoopScript,
  makeMultiRepoGateway,
  makeMultiRepoTestHarness,
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
  removeCalls: Array<{ worktreeDir: string; repoPath: string; loopId?: string }>;
} {
  const ensureWorktreeCalls: Array<{ repoPath: string; worktreeDir: string; branchName: string; baseBranch: string }> = [];
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
      return "symphony/worktree-lifecycle-test";
    },
    branchExists: async () => true,
  };

  return { provider, ensureWorktreeCalls, removeCalls };
}

// ---------------------------------------------------------------------------
// Shared state and cleanup
// ---------------------------------------------------------------------------

const { serversToClose, mockServersToClose, tempPathsToClean, cleanup } =
  makeMultiRepoTestHarness();
afterEach(cleanup);

/** Create a gateway server with a mock API backend and a given worktree provider. */
function createTestGateway(
  tmpDir: string,
  mockPort: number,
  worktreeProvider: WorktreeProvider,
) {
  return makeMultiRepoGateway({
    tmpDir,
    mockPort,
    machineName: "worktree-lifecycle-test",
    worktreeProvider,
    serversToClose,
  });
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
    `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
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

  // Filter out the primary repo call — additional repo calls create a scratch
  // branch derived from the user-specified branch so loop work never mutates
  // the user's actual branch. The exact naming convention is an implementation
  // detail; assert only the safety invariants.
  const additionalCalls = ensureWorktreeCalls.filter(
    (c) => c.repoPath !== primaryRepo,
  );

  assert.equal(
    additionalCalls.length,
    2,
    `Expected ensureWorktree called 2 times for additional repos, got ${additionalCalls.length}`,
  );

  for (const [repoPath, expectedBaseBranch] of [
    [additionalRepoA, "feature-a"],
    [additionalRepoB, "feature-b"],
  ] as const) {
    const call = additionalCalls.find((c) => c.repoPath === repoPath);
    assert.ok(call, `ensureWorktree should be called with ${repoPath}`);
    assert.equal(
      call.baseBranch,
      expectedBaseBranch,
      `Expected baseBranch '${expectedBaseBranch}' for ${repoPath}, got '${call.baseBranch}'`,
    );
    assert.ok(
      call.branchName.startsWith("symphony/"),
      `Scratch branch name should be under symphony/ namespace, got '${call.branchName}'`,
    );
    assert.notEqual(
      call.branchName,
      call.baseBranch,
      "Scratch branch name must differ from baseBranch to avoid mutating the user's branch",
    );
  }
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
    `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
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

test("ensureWorktree throws for additional repo — cleans leaked worktree, posts error event, and returns non-200", async () => {
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

  // Provider whose ensureWorktree succeeds for the primary repo but creates
  // then fails the additional repo worktree (simulates checkout failure after
  // git worktree creation, before the dir is tracked for bulk cleanup).
  let primaryCreated = false;
  const {
    provider: baseProvider,
    ensureWorktreeCalls,
    removeCalls,
  } = makeRecordingWorktreeProvider();
  const throwingProvider: WorktreeProvider = {
    ...baseProvider,
    async ensureWorktree(repoPath, worktreeDir, branchName, baseBranch, loopId) {
      if (!primaryCreated) {
        // First call is the primary repo — let it succeed
        primaryCreated = true;
        await fs.mkdir(worktreeDir, { recursive: true });
        return;
      }
      await baseProvider.ensureWorktree(repoPath, worktreeDir, branchName, baseBranch, loopId);
      throw new Error("Simulated ensureWorktree failure");
    },
  };

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port, throwingProvider);

  const loopId = "00000000-0000-0000-0000-000000007004";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
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

  const additionalWorktreeDir = ensureWorktreeCalls.find(
    (call) => call.repoPath === additionalRepo,
  )?.worktreeDir;
  assert.ok(additionalWorktreeDir, "Expected an additional repo worktree dir to be created before failure");

  assert.ok(
    removeCalls.some((call) => call.worktreeDir === additionalWorktreeDir),
    `Expected removeWorktree to be called for leaked additional worktree dir ${additionalWorktreeDir}`,
  );
});

test("handleProcessCompletion cleans additional worktrees when PLAN is cancelled during post-processing", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wt-lifecycle-cancel-"));
  tempPathsToClean.push(tmpDir);

  const claudeWorkDir = path.join(tmpDir, "claude-workdir");
  await fs.mkdir(claudeWorkDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeWorkDir, "claude-output.jsonl"),
    JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-test",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    }) + "\n",
  );

  const now = new Date().toISOString();
  const loopId = "00000000-0000-0000-0000-000000007005";
  const jobStore = new JobStore({
    cwd: tmpDir,
    name: "test-jobs-wt-lifecycle-cancel",
  });
  jobStore.upsert({
    id: "job-wt-lifecycle-cancel",
    kind: "SYMPHONY_LOOP",
    loopId,
    command: "PLAN",
    status: "CANCEL_PENDING",
    startedAt: now,
    updatedAt: now,
  });

  const additionalWorktrees = [
    {
      dir: path.join(tmpDir, "worktrees", "repo-a"),
      repoPath: path.join(tmpDir, "repos", "repo-a"),
    },
    {
      dir: path.join(tmpDir, "worktrees", "repo-b"),
      repoPath: path.join(tmpDir, "repos", "repo-b"),
    },
  ];
  await Promise.all(
    additionalWorktrees.map(async ({ dir, repoPath }) => {
      await fs.mkdir(dir, { recursive: true });
      await fs.mkdir(repoPath, { recursive: true });
    }),
  );

  const removeCalls: Array<{
    worktreeDir: string;
    repoPath: string;
    loopId?: string;
  }> = [];
  const worktreeProvider: WorktreeProvider = {
    async ensureWorktree() {},
    findWorktreeForBranch() {
      return null;
    },
    async removeWorktree(worktreeDir, repoPath, removeLoopId) {
      removeCalls.push({ worktreeDir, repoPath, loopId: removeLoopId });
      await fs.rm(worktreeDir, { recursive: true, force: true });
    },
    getCurrentBranch() {
      return "symphony/worktree-lifecycle-test";
    },
    branchExists: async () => true,
  };

  await handleProcessCompletion(
    0,
    {
      loopId,
      command: "PLAN",
      closedLoopAuthToken: "tok",
    } as Parameters<typeof handleProcessCompletion>[1],
    "http://127.0.0.1:9",
    null,
    claudeWorkDir,
    false,
    null,
    () => [tmpDir],
    undefined,
    jobStore,
    undefined,
    undefined,
    undefined,
    worktreeProvider,
    undefined,
    additionalWorktrees,
  );

  assert.deepEqual(
    removeCalls.map((call) => ({
      worktreeDir: call.worktreeDir,
      repoPath: call.repoPath,
      loopId: call.loopId,
    })),
    additionalWorktrees.map(({ dir, repoPath }) => ({
      worktreeDir: dir,
      repoPath,
      loopId,
    })),
    "Expected cancellation gate to clean every additional repo worktree",
  );

  const finalJob = jobStore.getByLoopId(loopId);
  assert.equal(finalJob?.status, "CANCELLED");
});

// ---------------------------------------------------------------------------
// T-6.5: Per-repo commit/push/PR loop using argv (EXECUTE command)
//
// Strategy: post an EXECUTE request where the WorktreeProvider's
// findWorktreeForBranch returns a pre-created additional worktree dir.
// The fake git binary (in the additional worktree) reports a change
// (git status returns non-empty), so executeAdditionalRepoCommitPush
// runs git add/commit/push and gh pr create. A capture file records
// all gh pr create invocations; the test asserts it was called once
// for the additional repo.
//
// The additional worktree is preserved on success (symmetric with primary
// worktree behavior): it carries the pushed branch that backs the PR, so
// the user can inspect/iterate. The next PLAN on the same loop key
// stale-prunes leftovers. This test asserts removeWorktree is NOT called
// for the additional worktree and that the dir still exists on disk.
// ---------------------------------------------------------------------------

test("EXECUTE per-repo commit/push/PR runs git and gh and preserves the additional worktree (T-6.5)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wt-lifecycle-execute-t65-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const additionalRepo = path.join(tmpDir, "additional-repo");
  await fs.mkdir(additionalRepo, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  // Pre-create the primary worktree dir so EXECUTE can reuse it via findWorktreeForBranch
  const primaryWorktreeDir = path.join(worktreeParent, "primary-wt");
  await fs.mkdir(primaryWorktreeDir, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  // fake run-loop.sh: exits 0
  await createFakeRunLoopScript(tmpDir, "#!/bin/sh\nexit 0\n");

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });

  // fake claude: exits 0 without writing execution-result.json
  // → attemptLlmCommit returns null → executeGitOperations is called for primary
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  // Capture file for gh pr create invocations
  const ghCreateCapture = path.join(tmpDir, "gh-pr-create-calls.txt");

  // fake git: for 'git status', return non-empty output (indicating changes) in
  // both the primary and additional worktree dirs. Other commands succeed.
  const fakeGitScript = [
    "#!/bin/sh",
    'if [ "$1" = status ]; then printf "M changed.txt\\n"; exit 0; fi',
    'if [ "$1" = add ]; then exit 0; fi',
    'if [ "$1" = commit ]; then exit 0; fi',
    'if [ "$1" = push ]; then exit 0; fi',
    'if [ "$1" = fetch ]; then exit 0; fi',
    'if [ "$1" = "rev-parse" ] && [ "$2" = "--abbrev-ref" ]; then echo "symphony/execute-test"; exit 0; fi',
    'if [ "$1" = "rev-parse" ] && [ "$2" = "HEAD" ]; then echo "abc1234567890"; exit 0; fi',
    "exit 0",
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });

  // fake gh: record pr create calls; pr view returns non-zero so pr create is called;
  // pr view --json returns empty body to skip footer-update step
  const fakeGhScript = [
    "#!/bin/sh",
    'if [ "$1" = pr ] && [ "$2" = view ] && [ "$3" != "--json" ]; then exit 1; fi',
    'if [ "$1" = pr ] && [ "$2" = view ] && [ "$3" = "--json" ]; then printf \'{"body":""}\\n\'; exit 0; fi',
    'if [ "$1" = pr ] && [ "$2" = create ]; then',
    `  echo "pr-create-called" >> ${JSON.stringify(ghCreateCapture)}`,
    "  printf 'https://github.com/execute-test/additional-repo/pull/1\\n'",
    "  exit 0",
    "fi",
    'if [ "$1" = pr ] && [ "$2" = edit ]; then exit 0; fi',
    "exit 0",
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "gh"), fakeGhScript, { mode: 0o755 });

  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  // WorktreeProvider: primary is reused via findWorktreeForBranch; additional
  // repos always go through ensureWorktree (EXECUTE computes a fresh path
  // rather than consulting findWorktreeForBranch). Record both so we can
  // locate the runtime additional dir and assert on cleanup.
  const ensureCalls: Array<{ repoPath: string; worktreeDir: string }> = [];
  const removeCalls: Array<{ worktreeDir: string; repoPath: string }> = [];
  const executeProvider: WorktreeProvider = {
    async ensureWorktree(repoPath, worktreeDir) {
      ensureCalls.push({ repoPath, worktreeDir });
      await fs.mkdir(worktreeDir, { recursive: true });
    },
    findWorktreeForBranch(_repoPath: string, _branchName: string): string | null {
      if (_repoPath === primaryRepo) {
        return primaryWorktreeDir;
      }
      return null;
    },
    async removeWorktree(worktreeDir, repoPath) {
      removeCalls.push({ worktreeDir, repoPath });
      await fs.rm(worktreeDir, { recursive: true, force: true });
    },
    getCurrentBranch() {
      return "symphony/execute-t65-test";
    },
    branchExists: async () => true,
  };

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port, executeProvider);

  const loopId = "00000000-0000-0000-0000-000000007010";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "EXECUTE",
        closedLoopAuthToken: "tok",
        prompt: "test",
        artifacts: [],
        repo: {
          fullName: `execute-t65-test/${path.basename(primaryRepo)}`,
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
    `Expected HTTP 200 for EXECUTE with additionalRepos, got ${response.status}`,
  );

  // Wait for completion so git ops and additional-repo commit/push/PR runs complete
  await waitForCompletedEvent(mock.requests, loopId);

  // Assert gh pr create was invoked for the additional repo (T-6.5)
  const ghCalls = await fs.readFile(ghCreateCapture, "utf-8").catch(() => "");
  const prCreateCount = ghCalls.split("\n").filter((l) => l.trim() === "pr-create-called").length;
  assert.ok(
    prCreateCount >= 1,
    `Expected gh pr create to be called at least once for the additional repo, got ${prCreateCount} calls`,
  );

  // Locate the runtime additional-repo worktree dir — EXECUTE computes it
  // fresh via ensureWorktree rather than reusing a pre-registered path.
  const additionalEnsure = ensureCalls.find(
    (c) => c.repoPath === additionalRepo,
  );
  assert.ok(
    additionalEnsure !== undefined,
    `Expected ensureWorktree to be called for additional repo ${additionalRepo}, got calls: ${JSON.stringify(ensureCalls)}`,
  );
  const runtimeAdditionalDir = additionalEnsure.worktreeDir;

  // Assert removeWorktree was NOT called for the runtime additional worktree
  // — EXECUTE preserves additional worktrees (symmetric with primary). Give
  // the async post-processing a moment to settle so a late cleanup would be
  // visible.
  await new Promise<void>((resolve) => setTimeout(resolve, 500));
  assert.ok(
    !removeCalls.some((c) => c.worktreeDir === runtimeAdditionalDir),
    `Expected removeWorktree NOT to be called for additional worktree ${runtimeAdditionalDir} after EXECUTE success, got calls: ${JSON.stringify(removeCalls)}`,
  );

  // Positive proof: the worktree dir is still present on disk.
  const stat = await fs.stat(runtimeAdditionalDir).catch(() => null);
  assert.ok(
    stat !== null && stat.isDirectory(),
    `Expected additional worktree dir ${runtimeAdditionalDir} to still exist after EXECUTE success`,
  );
});

// ---------------------------------------------------------------------------
// T-6.6: Failed additional repo records warning in completed event (EXECUTE)
//
// Strategy: post an EXECUTE where the WorktreeProvider's findWorktreeForBranch
// returns a pre-created additional worktree dir. The fake git binary reports
// changes for the additional worktree but then fails 'git commit'. The
// production code calls executeAdditionalRepoCommitPush which returns
// { status: "error" }; the handler adds ADDITIONAL_REPO_GIT_FAILED:<fullName>
// to the warnings array and posts a completed event containing those warnings.
// The test asserts that warning is present and that the additional worktree
// is preserved for inspection (symmetric with primary-on-failure behavior).
// ---------------------------------------------------------------------------

test("EXECUTE records ADDITIONAL_REPO_GIT_FAILED warning when additional repo commit fails (T-6.6)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wt-lifecycle-execute-t66-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const additionalRepo = path.join(tmpDir, "additional-repo");
  await fs.mkdir(additionalRepo, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  const primaryWorktreeDir = path.join(worktreeParent, "primary-wt");
  await fs.mkdir(primaryWorktreeDir, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  await createFakeRunLoopScript(tmpDir, "#!/bin/sh\nexit 0\n");

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });

  // fake claude: exits 0 without execution-result.json
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  // fake git:
  //   - primary worktree (cwd = primaryWorktreeDir): git status returns empty
  //     (no-changes path for primary).
  //   - additional worktree: EXECUTE creates a fresh dir whose path contains
  //     the base-branch slug ("feature-branch"), which the primary worktree
  //     path does not. Match on that slug to inject commit failure only for
  //     the additional repo. This makes executeAdditionalRepoCommitPush return
  //     { status: "error" } for the additional repo, adding a warning to the
  //     completed event.
  const fakeGitScript = [
    "#!/bin/sh",
    "CWD=$(pwd)",
    `if echo "$CWD" | grep -q "feature-branch"; then`,
    '  if [ "$1" = status ]; then printf "M changed.txt\\n"; exit 0; fi',
    '  if [ "$1" = add ]; then exit 0; fi',
    '  if [ "$1" = commit ]; then echo "simulated commit failure" >&2; exit 1; fi',
    "fi",
    'if [ "$1" = status ]; then exit 0; fi',
    'if [ "$1" = "rev-parse" ] && [ "$2" = "--abbrev-ref" ]; then echo "symphony/execute-t66-test"; exit 0; fi',
    "exit 0",
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });

  await fs.writeFile(path.join(fakeBin, "gh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const additionalFullName = `execute-t66-test/${path.basename(additionalRepo)}`;

  const ensureCalls: Array<{ repoPath: string; worktreeDir: string }> = [];
  const removeCalls: Array<{ worktreeDir: string; repoPath: string }> = [];
  const executeProvider: WorktreeProvider = {
    async ensureWorktree(repoPath, worktreeDir) {
      ensureCalls.push({ repoPath, worktreeDir });
      await fs.mkdir(worktreeDir, { recursive: true });
    },
    findWorktreeForBranch(_repoPath: string, _branchName: string): string | null {
      if (_repoPath === primaryRepo) {
        return primaryWorktreeDir;
      }
      // Additional-repo worktrees are not located via findWorktreeForBranch —
      // EXECUTE always creates a fresh one via ensureWorktree. Returning null
      // here causes the runtime-generated path to be used, which the fake
      // git script detects via the "feature-branch" slug.
      return null;
    },
    async removeWorktree(worktreeDir, repoPath) {
      removeCalls.push({ worktreeDir, repoPath });
      await fs.rm(worktreeDir, { recursive: true, force: true });
    },
    getCurrentBranch() {
      return "symphony/execute-t66-test";
    },
    branchExists: async () => true,
  };

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port, executeProvider);

  const loopId = "00000000-0000-0000-0000-000000007020";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "EXECUTE",
        closedLoopAuthToken: "tok",
        prompt: "test",
        artifacts: [],
        repo: {
          fullName: `execute-t66-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        additionalRepos: [
          {
            localRepoPath: additionalRepo,
            fullName: additionalFullName,
            branch: "feature-branch",
          },
        ],
      }),
    },
  );

  assert.equal(
    response.status,
    200,
    `Expected HTTP 200, got ${response.status}`,
  );

  // Wait for the completed event which carries the warnings array
  const completedEvent = await waitForCompletedEvent(mock.requests, loopId);

  // Assert the ADDITIONAL_REPO_GIT_FAILED warning is present (T-6.6)
  const warnings = completedEvent.warnings as string[] | undefined;
  const expectedWarning = `ADDITIONAL_REPO_GIT_FAILED:${additionalFullName}`;
  assert.ok(
    Array.isArray(warnings) && warnings.includes(expectedWarning),
    `Expected '${expectedWarning}' in completed event warnings, got: ${JSON.stringify(warnings)}`,
  );

  // Locate the runtime additional-repo worktree dir (EXECUTE creates a fresh
  // path via ensureWorktree rather than reusing anything from findWorktreeForBranch).
  const additionalEnsure = ensureCalls.find(
    (c) => c.repoPath === additionalRepo,
  );
  assert.ok(
    additionalEnsure !== undefined,
    `Expected ensureWorktree to be called for additional repo ${additionalRepo}, got calls: ${JSON.stringify(ensureCalls)}`,
  );
  const runtimeAdditionalDir = additionalEnsure.worktreeDir;

  // Assert the runtime additional worktree was preserved after the per-repo
  // commit failure — symmetric with the primary-worktree-on-failure contract.
  // The user inspects the dirty worktree to understand why commit failed.
  await new Promise<void>((resolve) => setTimeout(resolve, 500));
  assert.ok(
    !removeCalls.some((c) => c.worktreeDir === runtimeAdditionalDir),
    `Expected removeWorktree NOT to be called for additional worktree ${runtimeAdditionalDir} after git op failure, got calls: ${JSON.stringify(removeCalls)}`,
  );
  const stat = await fs.stat(runtimeAdditionalDir).catch(() => null);
  assert.ok(
    stat !== null && stat.isDirectory(),
    `Expected additional worktree dir ${runtimeAdditionalDir} to still exist after git op failure`,
  );
});
