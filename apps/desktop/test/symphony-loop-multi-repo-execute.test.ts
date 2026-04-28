/**
 * Integration tests for multi-repo EXECUTE requests.
 *
 * T-6.1: EXECUTE multi-repo gate tests
 *   (a) POST /api/gateway/symphony/loop with command: 'EXECUTE' and additionalRepos populated → HTTP 200
 *   (b) ensureWorktree called per additional repo
 *   (c) --add-dir args in spawned process (check spawn-args.txt)
 *   (d) Invalid/duplicate additional repo returns HTTP 400
 *
 * T-6.3: Failure-cleanup test
 *   (b) After failed EXECUTE, additional worktrees are removed
 *
 * Per-repo finalization (T-6.2) is covered by direct unit tests on
 * runExecuteFinalization elsewhere in the suite. Selective cleanup (T-6.3(a))
 * is covered by direct unit tests in boot-recovery.test.ts.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, test } from "node:test";
import type { WorktreeProvider } from "../src/server/operations/symphony-loop.js";
import { setShellPathForTest } from "../src/server/shell-path.js";
import {
  createFakeRunLoopScript,
  makeFakeWorktreeProvider,
  makeMultiRepoGateway,
  makeMultiRepoTestHarness,
  startMockApiServer,
  waitForTerminalEvent,
} from "./symphony-test-utils.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const fakeWorktreeProvider = makeFakeWorktreeProvider("symphony/multi-repo-execute-test");

const { serversToClose, mockServersToClose, tempPathsToClean, cleanup } =
  makeMultiRepoTestHarness();
afterEach(cleanup);

/** Create a gateway server backed by a mock API and the given worktree provider. */
function createTestGateway(
  tmpDir: string,
  mockPort: number,
  worktreeProvider?: WorktreeProvider,
) {
  return makeMultiRepoGateway({
    tmpDir,
    mockPort,
    machineName: "multi-repo-execute-test",
    worktreeProvider: worktreeProvider ?? fakeWorktreeProvider,
    serversToClose,
  });
}

// ---------------------------------------------------------------------------
// Call-recording WorktreeProvider
// ---------------------------------------------------------------------------

function makeRecordingWorktreeProvider(): {
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
      return "symphony/multi-repo-execute-test";
    },
    branchExists: async () => true,
  };

  return { provider, ensureWorktreeCalls, removeCalls };
}

// ---------------------------------------------------------------------------
// Helper: find a file recursively under a directory
// ---------------------------------------------------------------------------

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

async function findSpawnArgsFile(searchRoot: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await findFileRecursive(searchRoot, "spawn-args.txt");
    if (found !== null) {
      return found;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Timed out waiting for spawn-args.txt under ${searchRoot} after ${timeoutMs}ms`,
  );
}

// ---------------------------------------------------------------------------
// T-6.1(a): EXECUTE with additionalRepos → HTTP 200
// T-6.1(b): ensureWorktree called per additional repo
// ---------------------------------------------------------------------------

test("T-6.1(a,b): EXECUTE with additionalRepos returns HTTP 200 and calls ensureWorktree per additional repo", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-execute-gate-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const additionalRepo1 = path.join(tmpDir, "additional-repo-1");
  const additionalRepo2 = path.join(tmpDir, "additional-repo-2");
  await fs.mkdir(additionalRepo1, { recursive: true });
  await fs.mkdir(additionalRepo2, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  await createFakeRunLoopScript(tmpDir, "#!/bin/sh\nexit 0\n");

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  // git: status returns empty (no changes from the run-loop)
  const fakeGitScript = [
    "#!/bin/sh",
    "if [ \"$1\" = status ]; then exit 0; fi",
    "exit 0",
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });

  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const { provider, ensureWorktreeCalls } = makeRecordingWorktreeProvider();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port, provider);

  const loopId = "00000000-0000-0000-0000-000000008001";
  // EXECUTE requires either a prompt or artifacts (requiresPromptOrArtifacts: true)
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "EXECUTE",
        closedLoopAuthToken: "tok",
        prompt: "Execute the implementation plan",
        artifacts: [],
        repo: {
          fullName: `execute-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        additionalRepos: [
          { localRepoPath: additionalRepo1, branch: "feature-a" },
          { localRepoPath: additionalRepo2, branch: "feature-b" },
        ],
      }),
    },
  );

  assert.equal(response.status, 200, `Expected HTTP 200, got ${response.status}`);

  // Wait for the terminal event so ensureWorktree calls are fully captured
  await waitForTerminalEvent(mock.requests, loopId);

  // Additional repo ensureWorktree calls only
  const additionalCalls = ensureWorktreeCalls.filter(
    (c) => c.repoPath !== primaryRepo,
  );

  assert.equal(
    additionalCalls.length,
    2,
    `Expected ensureWorktree called 2 times for additional repos, got ${additionalCalls.length}`,
  );

  for (const [repoPath, expectedBaseBranch] of [
    [additionalRepo1, "feature-a"],
    [additionalRepo2, "feature-b"],
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
      "Scratch branch must differ from baseBranch",
    );
  }
});

// ---------------------------------------------------------------------------
// T-6.1(c): --add-dir args in spawned process
// ---------------------------------------------------------------------------

test("T-6.1(c): EXECUTE with additionalRepos passes --add-dir for each worktree to run-loop.sh", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-execute-spawn-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const additionalRepo1 = path.join(tmpDir, "additional-repo-1");
  const additionalRepo2 = path.join(tmpDir, "additional-repo-2");
  await fs.mkdir(additionalRepo1, { recursive: true });
  await fs.mkdir(additionalRepo2, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  // Fake run-loop.sh writes its arguments to spawn-args.txt in CLOSEDLOOP_WORKDIR
  await createFakeRunLoopScript(
    tmpDir,
    '#!/bin/sh\necho "$@" > "$CLOSEDLOOP_WORKDIR/spawn-args.txt"\nexit 0\n',
  );

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const fakeGitScript = [
    "#!/bin/sh",
    "if [ \"$1\" = status ]; then exit 0; fi",
    "exit 0",
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });

  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port);

  const loopId = "00000000-0000-0000-0000-000000008002";
  // EXECUTE requires either a prompt or artifacts (requiresPromptOrArtifacts: true)
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "EXECUTE",
        closedLoopAuthToken: "tok",
        prompt: "Execute the implementation plan",
        artifacts: [],
        repo: {
          fullName: `execute-spawn-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        additionalRepos: [
          { localRepoPath: additionalRepo1, branch: "main" },
          { localRepoPath: additionalRepo2, branch: "main" },
        ],
      }),
    },
  );

  assert.equal(response.status, 200, `Expected HTTP 200, got ${response.status}`);

  const terminalEvent = await waitForTerminalEvent(mock.requests, loopId);
  assert.equal(
    terminalEvent.type,
    "completed",
    `Expected terminal event 'completed', got '${terminalEvent.type}': ${JSON.stringify(terminalEvent)}`,
  );

  const spawnArgsFile = await findSpawnArgsFile(tmpDir);
  const spawnArgs = (await fs.readFile(spawnArgsFile, "utf-8")).trim();

  assert.ok(
    spawnArgs.includes("--add-dir"),
    `Expected --add-dir in spawn args, got: ${spawnArgs}`,
  );

  const addDirCount = (spawnArgs.match(/--add-dir/g) ?? []).length;
  assert.equal(
    addDirCount,
    2,
    `Expected exactly 2 --add-dir flags, got ${addDirCount}. Args: ${spawnArgs}`,
  );

  const addDirMatches = [...spawnArgs.matchAll(/--add-dir\s+(\S+)/g)].map((m) => m[1]);
  assert.equal(addDirMatches.length, 2, "Should parse 2 --add-dir paths from spawn args");

  for (const addDir of addDirMatches) {
    assert.ok(
      addDir.startsWith(worktreeParent),
      `Expected --add-dir path "${addDir}" to start with worktreeParent "${worktreeParent}"`,
    );
  }
});

// ---------------------------------------------------------------------------
// T-6.1(d): Invalid/duplicate additional repo returns HTTP 400
// ---------------------------------------------------------------------------

describe("T-6.1(d): Invalid or duplicate additionalRepos returns HTTP 400", () => {
  it("nonexistent localRepoPath not in allowed dirs returns HTTP 400", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-execute-invalid-"));
    tempPathsToClean.push(tmpDir);

    const primaryRepo = path.join(tmpDir, "primary-repo");
    await fs.mkdir(primaryRepo, { recursive: true });

    // Path outside tmpDir (not in allowed dirs)
    const outsidePath = path.join(os.tmpdir(), "nonexistent-not-in-allowed-dirs");

    process.env.HOME = tmpDir;
    process.env.SYMPHONY_WORKTREE_PARENT_DIR = path.join(tmpDir, "worktrees");

    const mock = await startMockApiServer();
    mockServersToClose.push(mock.server);
    const server = await createTestGateway(tmpDir, mock.port);

    const loopId = "00000000-0000-0000-0000-000000008010";
    const response = await fetch(
      `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loopId,
          command: "EXECUTE",
          closedLoopAuthToken: "tok",
          prompt: "Execute the plan",
          artifacts: [],
          repo: {
            fullName: `execute-test/${path.basename(primaryRepo)}`,
            branch: "main",
          },
          additionalRepos: [
            { localRepoPath: outsidePath, branch: "main" },
          ],
        }),
      },
    );

    assert.equal(
      response.status,
      400,
      `Expected HTTP 400 for repo outside allowed dirs, got ${response.status}`,
    );
  });

  it("duplicate localRepoPath across additionalRepos returns HTTP 400", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-execute-dup-"));
    tempPathsToClean.push(tmpDir);

    const primaryRepo = path.join(tmpDir, "primary-repo");
    await fs.mkdir(primaryRepo, { recursive: true });

    const additionalRepo = path.join(tmpDir, "additional-repo");
    await fs.mkdir(additionalRepo, { recursive: true });

    process.env.HOME = tmpDir;
    process.env.SYMPHONY_WORKTREE_PARENT_DIR = path.join(tmpDir, "worktrees");

    const mock = await startMockApiServer();
    mockServersToClose.push(mock.server);
    const server = await createTestGateway(tmpDir, mock.port);

    const loopId = "00000000-0000-0000-0000-000000008011";
    const response = await fetch(
      `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loopId,
          command: "EXECUTE",
          closedLoopAuthToken: "tok",
          prompt: "Execute the plan",
          artifacts: [],
          repo: {
            fullName: `execute-dup-test/${path.basename(primaryRepo)}`,
            branch: "main",
          },
          additionalRepos: [
            { localRepoPath: additionalRepo, branch: "main" },
            { localRepoPath: additionalRepo, branch: "feature" },
          ],
        }),
      },
    );

    assert.equal(
      response.status,
      400,
      `Expected HTTP 400 for duplicate additionalRepo path, got ${response.status}`,
    );
  });
});

// ---------------------------------------------------------------------------
// T-6.3(b): Failed EXECUTE → all additional worktrees removed
// ---------------------------------------------------------------------------

describe("T-6.3: Selective additional worktree cleanup", () => {
  it("T-6.3(b): failed EXECUTE (run-loop.sh exits 1) removes all additional worktrees", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-execute-fail-cleanup-"));
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

    // run-loop.sh exits 1 to simulate failure
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

    const loopId = "00000000-0000-0000-0000-000000008030";
    // EXECUTE requires either a prompt or artifacts
    const response = await fetch(
      `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loopId,
          command: "EXECUTE",
          closedLoopAuthToken: "tok",
          prompt: "Execute the implementation plan",
          artifacts: [],
          repo: {
            fullName: `execute-fail-test/${path.basename(primaryRepo)}`,
            branch: "main",
          },
          additionalRepos: [
            { localRepoPath: additionalRepo, branch: "feature-branch" },
          ],
        }),
      },
    );

    assert.equal(response.status, 200, "EXECUTE should return HTTP 200 (process failure is async)");

    // Wait for the terminal event (error from process failure)
    const terminalEvent = await waitForTerminalEvent(mock.requests, loopId);
    assert.equal(
      terminalEvent.type,
      "error",
      `Expected terminal event 'error', got '${terminalEvent.type}'`,
    );

    // Get the additional worktree dirs that were created
    const additionalWorktreeDirs = ensureWorktreeCalls
      .filter((c) => c.repoPath !== primaryRepo)
      .map((c) => c.worktreeDir);

    assert.equal(
      additionalWorktreeDirs.length,
      1,
      `Expected 1 additional worktree created, got ${additionalWorktreeDirs.length}`,
    );

    // Poll until removeWorktree is called for the additional worktree
    const expectedDir = additionalWorktreeDirs[0];
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && !removeCalls.some((c) => c.worktreeDir === expectedDir)) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }

    assert.ok(
      removeCalls.some((c) => c.worktreeDir === expectedDir),
      `Expected removeWorktree called for additional worktree ${expectedDir} after EXECUTE failure`,
    );
  });
});
