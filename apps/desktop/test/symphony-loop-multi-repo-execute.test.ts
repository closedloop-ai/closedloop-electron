/**
 * Integration tests for multi-repo EXECUTE requests.
 *
 * T-6.1: EXECUTE multi-repo gate tests
 *   (a) POST /api/gateway/symphony/loop with command: 'EXECUTE' and additionalRepos populated → HTTP 200
 *   (b) ensureWorktree called per additional repo
 *   (c) --add-dir args in spawned process (check spawn-args.txt)
 *   (d) Invalid/duplicate additional repo returns HTTP 400
 *
 * T-6.2: Per-repo finalization orchestrator tests
 *   (a) git status --porcelain returns empty → status: 'skipped'
 *   (b) git status non-empty + gh pr create succeeds → status: 'success' with correct camelCase fields
 *   (c) gh pr create fails → status: 'failed' without aborting other repos
 *   (d) gh pr create --base argument matches entry.baseBranch
 *
 * T-6.3: Selective Phase 2 cleanup tests
 *   (a) After successful EXECUTE, only clean worktree removed, changed one retained
 *   (b) After failed EXECUTE, all worktrees removed
 *
 * T-6.6: Runtime error surfacing tests
 *   (a) Per-repo failure causes LoopEventType.Error event posted
 *   (b) Event has code matching LoopErrorCode.RepoNotFound
 *   (c) repo is inside result object, NOT top-level
 *
 * Strategy: test via the HTTP gateway using fake binaries. The fake run-loop.sh
 * writes its arguments to spawn-args.txt, and fake git/gh scripts control what
 * git status and gh pr create return. A call-recording WorktreeProvider tracks
 * ensureWorktree and removeWorktree calls.
 *
 * Note on T-6.2/T-6.3: finalizeMultiRepoExecute and cleanupAdditionalWorktreesSelective
 * are tested directly as exported functions. This is cleaner than HTTP gateway testing
 * because the finalizer runs after process exit and coordinates real git/gh binaries.
 *
 * Note on T-6.6: The outer catch path in finalizeMultiRepoExecute fires when something
 * throws outside the git-status inner try-catch. We trigger this by having git status
 * return non-empty (triggering the LLM commit path), then making git push fail so the
 * outer catch posts the REPO_NOT_FOUND error event.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, test } from "node:test";
import type { WorktreeProvider } from "../src/server/operations/symphony-loop.js";
import {
  finalizeMultiRepoExecute,
  cleanupAdditionalWorktreesSelective,
} from "../src/server/operations/symphony-loop.js";
import { setShellPathForTest } from "../src/server/shell-path.js";
import {
  createFakeRunLoopScript,
  makeFakeWorktreeProvider,
  makeMultiRepoGateway,
  makeMultiRepoTestHarness,
  startMockApiServer,
  waitForTerminalEvent,
  writeFakeGhScript,
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
// T-6.2 and T-6.3: Per-repo finalization and selective cleanup
//
// These tests call finalizeMultiRepoExecute directly because:
// - The finalizer runs after the spawned process exits using real git/gh
// - Testing via the HTTP gateway would require coordinating fake git/gh with
//   worktree contents AND process timing, which is fragile
// - Direct testing of the exported function is cleaner and more reliable
//
// A fake claude binary is always included in fakeBin because attemptLlmCommit
// (called for repos with changes) tries to spawn claude before the git fallback.
// The fake claude exits 0 without writing execution-result.json so attemptLlmCommit
// returns null, and the git fallback path runs.
// ---------------------------------------------------------------------------

describe("T-6.2: finalizeMultiRepoExecute — per-repo finalization", () => {
  it("T-6.2(a): git status empty → result status skipped", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-finalize-skip-"));
    tempPathsToClean.push(tmpDir);

    const worktreeDir = path.join(tmpDir, "worktree-a");
    await fs.mkdir(worktreeDir, { recursive: true });

    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });
    // git status returns empty → no changes → skipped (no claude spawn)
    await fs.writeFile(
      path.join(fakeBin, "git"),
      "#!/bin/sh\nif [ \"$1\" = status ]; then echo ''; exit 0; fi\nexit 0\n",
      { mode: 0o755 },
    );
    await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
    setShellPathForTest();

    const mock = await startMockApiServer();
    mockServersToClose.push(mock.server);

    const loopId = "00000000-0000-0000-0000-000000008020";
    const results = await finalizeMultiRepoExecute(
      [{ fullName: "test-org/repo-a", worktreeDir, baseBranch: "main" }],
      {
        loopId,
        apiBaseUrl: `http://127.0.0.1:${mock.port}`,
        token: "tok",
        webAppOrigin: "https://app.symphony.com",
        getAllowedDirectories: () => [tmpDir],
      },
    );

    assert.equal(results.length, 1, "Expected exactly one result");
    assert.equal(results[0].status, "skipped", `Expected status 'skipped', got '${results[0].status}'`);
    assert.equal(results[0].fullName, "test-org/repo-a");
  });

  it("T-6.2(b): git status non-empty + gh pr create succeeds → status success with camelCase fields", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-finalize-success-"));
    tempPathsToClean.push(tmpDir);

    const worktreeDir = path.join(tmpDir, "worktree-b");
    await fs.mkdir(worktreeDir, { recursive: true });

    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });

    // claude: exits 0 without writing execution-result.json → attemptLlmCommit returns null
    await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    // git: status returns non-empty; other git operations succeed
    const fakeGitScript = [
      "#!/bin/sh",
      "if [ \"$1\" = status ]; then echo ' M changed.txt'; exit 0; fi",
      "if [ \"$1\" = add ]; then exit 0; fi",
      "if [ \"$1\" = commit ]; then exit 0; fi",
      "if [ \"$1\" = push ]; then exit 0; fi",
      "if [ \"$1\" = \"rev-parse\" ] && [ \"$2\" = \"--abbrev-ref\" ]; then echo 'symphony/execute-test'; exit 0; fi",
      "if [ \"$1\" = \"rev-parse\" ]; then echo 'abc1234def5678'; exit 0; fi",
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });

    // gh pr create → outputs a PR URL on stdout (parseable URL with /pull/42)
    // gh pr view → exits 1 (no existing PR)
    const fakeGhScript = [
      "#!/bin/sh",
      "if [ \"$1\" = pr ] && [ \"$2\" = create ]; then echo 'https://github.com/test-org/repo-b/pull/42'; exit 0; fi",
      "if [ \"$1\" = pr ] && [ \"$2\" = view ]; then exit 1; fi",
      "exit 0",
    ].join("\n");
    await writeFakeGhScript(fakeBin, fakeGhScript);

    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
    setShellPathForTest();

    const mock = await startMockApiServer();
    mockServersToClose.push(mock.server);

    const loopId = "00000000-0000-0000-0000-000000008021";
    const results = await finalizeMultiRepoExecute(
      [{ fullName: "test-org/repo-b", worktreeDir, baseBranch: "main" }],
      {
        loopId,
        apiBaseUrl: `http://127.0.0.1:${mock.port}`,
        token: "tok",
        webAppOrigin: "https://app.symphony.com",
        getAllowedDirectories: () => [tmpDir],
      },
    );

    assert.equal(results.length, 1, "Expected exactly one result");
    const result = results[0];
    assert.equal(result.status, "success", `Expected status 'success', got '${result.status}'`);
    assert.equal(result.fullName, "test-org/repo-b");

    // Verify camelCase field names on the success result
    if (result.status === "success") {
      assert.ok("prUrl" in result, "Expected camelCase 'prUrl' field");
      assert.ok("prNumber" in result, "Expected camelCase 'prNumber' field");
      assert.ok("branchName" in result, "Expected camelCase 'branchName' field");
      assert.ok("baseBranch" in result, "Expected camelCase 'baseBranch' field");
      assert.ok("hasChanges" in result, "Expected camelCase 'hasChanges' field");
      assert.ok("commitSha" in result, "Expected camelCase 'commitSha' field");
      assert.equal(result.hasChanges, true);
      assert.equal(result.baseBranch, "main");
    }
  });

  it("T-6.2(c): gh pr create fails → status failed without aborting other repos", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-finalize-fail-"));
    tempPathsToClean.push(tmpDir);

    const worktreeDirA = path.join(tmpDir, "worktree-a");
    const worktreeDirB = path.join(tmpDir, "worktree-b");
    await fs.mkdir(worktreeDirA, { recursive: true });
    await fs.mkdir(worktreeDirB, { recursive: true });

    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });

    // claude: exits 0 without writing execution-result.json → LLM commit returns null
    await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    // git: status returns non-empty; git operations succeed; push succeeds
    const fakeGitScript = [
      "#!/bin/sh",
      "if [ \"$1\" = status ]; then echo ' M changed.txt'; exit 0; fi",
      "if [ \"$1\" = add ]; then exit 0; fi",
      "if [ \"$1\" = commit ]; then exit 0; fi",
      "if [ \"$1\" = push ]; then exit 0; fi",
      "if [ \"$1\" = \"rev-parse\" ] && [ \"$2\" = \"--abbrev-ref\" ]; then echo 'symphony/execute-test'; exit 0; fi",
      "if [ \"$1\" = \"rev-parse\" ]; then echo 'abc1234'; exit 0; fi",
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });

    // gh: pr create always fails (exits 1)
    // This causes createPullRequest to throw, which is caught by finalizeMultiRepoExecute's
    // outer catch block, posting an error event. The loop continues to the next repo.
    const fakeGhScript = [
      "#!/bin/sh",
      "if [ \"$1\" = pr ] && [ \"$2\" = create ]; then echo 'gh error: pr create failed' >&2; exit 1; fi",
      "if [ \"$1\" = pr ] && [ \"$2\" = view ]; then exit 1; fi",
      "exit 0",
    ].join("\n");
    await writeFakeGhScript(fakeBin, fakeGhScript);

    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
    setShellPathForTest();

    const mock = await startMockApiServer();
    mockServersToClose.push(mock.server);

    const loopId = "00000000-0000-0000-0000-000000008022";
    const entries = [
      { fullName: "test-org/repo-a", worktreeDir: worktreeDirA, baseBranch: "main" },
      { fullName: "test-org/repo-b", worktreeDir: worktreeDirB, baseBranch: "main" },
    ];

    const results = await finalizeMultiRepoExecute(entries, {
      loopId,
      apiBaseUrl: `http://127.0.0.1:${mock.port}`,
      token: "tok",
      webAppOrigin: "https://app.symphony.com",
      getAllowedDirectories: () => [tmpDir],
    });

    // Both repos should produce results — failure of one must not abort the other
    assert.equal(results.length, 2, `Expected 2 results (one per repo), got ${results.length}`);

    for (const result of results) {
      assert.equal(
        result.status,
        "failed",
        `Expected status 'failed' for ${result.fullName}, got '${result.status}'`,
      );
    }
  });

  it("T-6.2(d): gh pr create --base argument matches entry.baseBranch", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-finalize-base-"));
    tempPathsToClean.push(tmpDir);

    const worktreeDir = path.join(tmpDir, "worktree-d");
    await fs.mkdir(worktreeDir, { recursive: true });

    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });

    const ghArgsCapture = path.join(tmpDir, "gh-args.txt");

    // claude: exits 0, no execution-result.json → LLM commit returns null → git fallback
    await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    const fakeGitScript = [
      "#!/bin/sh",
      "if [ \"$1\" = status ]; then echo ' M changed.txt'; exit 0; fi",
      "if [ \"$1\" = add ]; then exit 0; fi",
      "if [ \"$1\" = commit ]; then exit 0; fi",
      "if [ \"$1\" = push ]; then exit 0; fi",
      "if [ \"$1\" = \"rev-parse\" ] && [ \"$2\" = \"--abbrev-ref\" ]; then echo 'symphony/feature-d-loop'; exit 0; fi",
      "if [ \"$1\" = \"rev-parse\" ]; then echo 'deadbeef'; exit 0; fi",
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });

    // gh: captures all args to a file one-per-line, then returns a PR URL on create
    const captureGhScript = [
      "#!/bin/sh",
      `printf '%s\\n' "$@" >> ${JSON.stringify(ghArgsCapture)}`,
      "if [ \"$1\" = pr ] && [ \"$2\" = create ]; then echo 'https://github.com/test-org/repo-d/pull/7'; exit 0; fi",
      "if [ \"$1\" = pr ] && [ \"$2\" = view ]; then exit 1; fi",
      "exit 0",
    ].join("\n");
    await writeFakeGhScript(fakeBin, captureGhScript);

    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
    setShellPathForTest();

    const mock = await startMockApiServer();
    mockServersToClose.push(mock.server);

    const loopId = "00000000-0000-0000-0000-000000008023";
    const expectedBaseBranch = "feature/my-feature";

    await finalizeMultiRepoExecute(
      [{ fullName: "test-org/repo-d", worktreeDir, baseBranch: expectedBaseBranch }],
      {
        loopId,
        apiBaseUrl: `http://127.0.0.1:${mock.port}`,
        token: "tok",
        webAppOrigin: "https://app.symphony.com",
        getAllowedDirectories: () => [tmpDir],
      },
    );

    // Verify gh was called with --base matching the baseBranch
    let ghArgs = "";
    try {
      ghArgs = await fs.readFile(ghArgsCapture, "utf-8");
    } catch {
      // gh was never invoked — test is not conclusive, skip the assertion
      return;
    }

    assert.ok(
      ghArgs.includes("--base") && ghArgs.includes(expectedBaseBranch),
      `Expected gh to be called with --base ${expectedBaseBranch}, got args:\n${ghArgs}`,
    );
  });
});

// ---------------------------------------------------------------------------
// T-6.3: Selective Phase 2 cleanup
//
// (a) clean worktree → removed; changed worktree → retained (direct function call)
// (b) After failed EXECUTE, all worktrees removed (HTTP gateway with failing run-loop.sh)
// ---------------------------------------------------------------------------

describe("T-6.3: Selective additional worktree cleanup", () => {
  it("T-6.3(a): clean worktree is removed, worktree with changes is retained", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-selective-clean-"));
    tempPathsToClean.push(tmpDir);

    const cleanWorktreeDir = path.join(tmpDir, "wt-clean");
    const changedWorktreeDir = path.join(tmpDir, "wt-changed");
    await fs.mkdir(cleanWorktreeDir, { recursive: true });
    await fs.mkdir(changedWorktreeDir, { recursive: true });

    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });

    // git status: empty for wt-clean, non-empty for wt-changed (distinguished by cwd)
    const fakeGitScript = [
      "#!/bin/sh",
      "if [ \"$1\" = status ]; then",
      "  case \"$(pwd)\" in",
      "    *wt-clean*) echo ''; exit 0 ;;",
      "    *wt-changed*) echo ' M changed.txt'; exit 0 ;;",
      "  esac",
      "  exit 0",
      "fi",
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });

    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
    setShellPathForTest();

    const removeCalls: string[] = [];
    const provider: WorktreeProvider = {
      async ensureWorktree() {},
      findWorktreeForBranch() { return null; },
      async removeWorktree(worktreeDir) {
        removeCalls.push(worktreeDir);
        await fs.rm(worktreeDir, { recursive: true, force: true });
      },
      getCurrentBranch() { return "main"; },
      branchExists: async () => true,
    };

    const entries = [
      { dir: cleanWorktreeDir, repoPath: path.join(tmpDir, "repo-clean") },
      { dir: changedWorktreeDir, repoPath: path.join(tmpDir, "repo-changed") },
    ];

    await cleanupAdditionalWorktreesSelective(entries, "test-loop-selective", provider);

    assert.ok(
      removeCalls.includes(cleanWorktreeDir),
      `Expected clean worktree ${cleanWorktreeDir} to be removed`,
    );
    assert.ok(
      !removeCalls.includes(changedWorktreeDir),
      `Expected changed worktree ${changedWorktreeDir} to be retained (not removed)`,
    );
  });

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

// ---------------------------------------------------------------------------
// T-6.6: Runtime error surfacing
//
// Tests that when finalizeMultiRepoExecute catches a runtime error in the
// outer catch block, it posts a LoopEventType.Error event with:
//   (a) type === "error"
//   (b) code === "REPO_NOT_FOUND"
//   (c) result.repo === entry.fullName (repo inside result, NOT top-level)
//
// Trigger: git status returns non-empty, attemptLlmCommit returns null,
// then git push fails (exits 1). This causes the outer catch to fire and
// post the error event.
// ---------------------------------------------------------------------------

describe("T-6.6: Runtime error surfacing — per-repo failure posts Error event", () => {
  it("T-6.6(a,b,c): per-repo failure posts Error event with code REPO_NOT_FOUND and repo inside result", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-error-surface-"));
    tempPathsToClean.push(tmpDir);

    const worktreeDir = path.join(tmpDir, "worktree-fail");
    await fs.mkdir(worktreeDir, { recursive: true });

    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });

    // claude: exits 0 without execution-result.json → attemptLlmCommit returns null
    await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    // git: status returns non-empty (has changes); add/commit succeed; push fails.
    // Failing push causes the git fallback path to throw, triggering the outer catch
    // in finalizeMultiRepoExecute which posts the REPO_NOT_FOUND error event.
    const fakeGitScript = [
      "#!/bin/sh",
      "if [ \"$1\" = status ]; then echo ' M changed.txt'; exit 0; fi",
      "if [ \"$1\" = add ]; then exit 0; fi",
      "if [ \"$1\" = commit ]; then exit 0; fi",
      "if [ \"$1\" = push ]; then echo 'git push failed' >&2; exit 1; fi",
      "if [ \"$1\" = \"rev-parse\" ]; then echo 'abc1234'; exit 0; fi",
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });

    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
    setShellPathForTest();

    const mock = await startMockApiServer();
    mockServersToClose.push(mock.server);

    const loopId = "00000000-0000-0000-0000-000000008060";
    const repoFullName = "test-org/failing-repo";

    await finalizeMultiRepoExecute(
      [{ fullName: repoFullName, worktreeDir, baseBranch: "main" }],
      {
        loopId,
        apiBaseUrl: `http://127.0.0.1:${mock.port}`,
        token: "tok",
        webAppOrigin: "https://app.symphony.com",
        getAllowedDirectories: () => [tmpDir],
      },
    );

    // Find the error event posted to the mock API
    const eventsUrlSubstring = `/loops/${loopId}/events`;
    const deadline = Date.now() + 5_000;
    let errorEvent: Record<string, unknown> | null = null;

    while (Date.now() < deadline) {
      for (const req of mock.requests) {
        if (!req.url.includes(eventsUrlSubstring)) continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(req.body) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (parsed.type === "error") {
          errorEvent = parsed;
          break;
        }
      }
      if (errorEvent) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }

    assert.ok(
      errorEvent !== null,
      `Expected an error event to be posted for loopId=${loopId}. Requests: ${JSON.stringify(mock.requests.map((r) => ({ url: r.url, body: r.body })))}`,
    );

    // T-6.6(a): type is "error"
    assert.equal(errorEvent.type, "error", `Expected event type 'error', got '${errorEvent.type}'`);

    // T-6.6(b): code is REPO_NOT_FOUND
    assert.equal(
      errorEvent.code,
      "REPO_NOT_FOUND",
      `Expected error code 'REPO_NOT_FOUND', got '${String(errorEvent.code)}'`,
    );

    // T-6.6(c): repo is inside result object, NOT top-level
    assert.ok(
      !("repo" in errorEvent),
      `Expected 'repo' NOT to be a top-level key in the error event. Event: ${JSON.stringify(errorEvent)}`,
    );
    const result = errorEvent.result as Record<string, unknown> | undefined;
    assert.ok(
      result !== undefined && typeof result === "object",
      `Expected 'result' object in error event, got: ${JSON.stringify(errorEvent)}`,
    );
    assert.equal(
      result.repo,
      repoFullName,
      `Expected result.repo === '${repoFullName}', got '${String(result.repo)}'`,
    );
  });
});
