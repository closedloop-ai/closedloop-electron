/**
 * Spawn tests for multi-repo PLAN requests: verify that run-loop.sh
 * receives the correct --add-dir arguments when additionalRepos are provided.
 *
 * T-7.2: Add spawn tests in apps/desktop/test/symphony-loop-multi-repo-spawn.test.ts
 *
 * Test cases:
 * 1. PLAN with 2 additionalRepos — assert args contain --add-dir <worktreeDir1>
 *    and --add-dir <worktreeDir2>
 * 2. Single-repo PLAN — assert no --add-dir in args
 * 3. EXECUTE with additionalRepos in body — assert no --add-dir (EXECUTE doesn't
 *    get additional dirs)
 *
 * Strategy: the fake run-loop.sh script writes its arguments to
 * $CLOSEDLOOP_WORKDIR/spawn-args.txt. After waitForCompletedEvent, we search
 * for spawn-args.txt under the tmpDir and assert on the presence or absence of
 * --add-dir args.
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
} from "./symphony-test-utils.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/**
 * Extended fakeWorktreeProvider with ensureWorktree that creates the
 * worktree directory (simulating what the real impl does) and branchExists
 * that always returns true.
 */
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
    return "symphony/multi-repo-spawn-test";
  },
  branchExists: async () => true,
};

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

/** Create a gateway server with a mock API backend and the worktreeProvider. */
async function createTestGateway(tmpDir: string, mockPort: number) {
  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "multi-repo-spawn-test",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    worktreeProvider: fakeWorktreeProvider,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getApiOrigin: () => `http://127.0.0.1:${mockPort}`,
  });
  serversToClose.push(server);
  await server.start();
  return server;
}

/**
 * Recursively find the first spawn-args.txt under searchRoot.
 * Polls until the file is found or the timeout elapses.
 */
async function findSpawnArgsFile(
  searchRoot: string,
  timeoutMs = 20_000,
): Promise<string> {
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

/** Recursively search for a filename under a directory. Returns the first match or null. */
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

// ---------------------------------------------------------------------------
// Test 1: PLAN with 2 additionalRepos — assert args contain
//         --add-dir <worktreeDir1> and --add-dir <worktreeDir2>
// ---------------------------------------------------------------------------

test("PLAN with 2 additionalRepos passes --add-dir for each worktree to run-loop.sh", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-spawn-plan2-"));
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

  // The fake script writes its args to spawn-args.txt then exits 0.
  await createFakeRunLoopScript(
    tmpDir,
    '#!/bin/sh\necho "$@" > "$CLOSEDLOOP_WORKDIR/spawn-args.txt"\nexit 0\n',
  );

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port);

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
          fullName: `spawn-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        additionalRepos: [
          { localRepoPath: additionalRepo1, branch: "main" },
          { localRepoPath: additionalRepo2, branch: "main" },
        ],
      }),
    },
  );

  assert.equal(response.status, 200);

  // Wait for the loop to complete
  const completedEvent = await waitForCompletedEvent(mock.requests, loopId);
  assert.equal(completedEvent.type, "completed");

  // Find spawn-args.txt under tmpDir (written to $CLOSEDLOOP_WORKDIR by the fake script)
  const spawnArgsFile = await findSpawnArgsFile(tmpDir);
  const spawnArgs = (await fs.readFile(spawnArgsFile, "utf-8")).trim();

  assert.ok(
    spawnArgs.includes("--add-dir"),
    `Expected --add-dir in spawn args, got: ${spawnArgs}`,
  );

  // Count occurrences of --add-dir to confirm both repos got an entry
  const addDirCount = (spawnArgs.match(/--add-dir/g) ?? []).length;
  assert.equal(
    addDirCount,
    2,
    `Expected exactly 2 --add-dir flags in spawn args, got ${addDirCount}. Args: ${spawnArgs}`,
  );

  // Each additional repo worktree should have a dir under worktreeParent
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
// Test 2: Single-repo PLAN — assert no --add-dir in args
// ---------------------------------------------------------------------------

test("single-repo PLAN passes no --add-dir to run-loop.sh", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-spawn-single-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  await createFakeRunLoopScript(
    tmpDir,
    '#!/bin/sh\necho "$@" > "$CLOSEDLOOP_WORKDIR/spawn-args.txt"\nexit 0\n',
  );

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port);

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
          fullName: `spawn-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        // No additionalRepos
      }),
    },
  );

  assert.equal(response.status, 200);

  const completedEvent = await waitForCompletedEvent(mock.requests, loopId);
  assert.equal(completedEvent.type, "completed");

  // Find spawn-args.txt under tmpDir
  const spawnArgsFile = await findSpawnArgsFile(tmpDir);
  const spawnArgs = (await fs.readFile(spawnArgsFile, "utf-8")).trim();

  assert.ok(
    !spawnArgs.includes("--add-dir"),
    `Expected no --add-dir in single-repo PLAN spawn args, got: ${spawnArgs}`,
  );
});

// ---------------------------------------------------------------------------
// Test 3: EXECUTE with additionalRepos in body — assert no --add-dir
//         (EXECUTE doesn't get additional dirs)
// ---------------------------------------------------------------------------

test("EXECUTE with additionalRepos in body passes no --add-dir to run-loop.sh", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-spawn-execute-"));
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

  await createFakeRunLoopScript(
    tmpDir,
    '#!/bin/sh\necho "$@" > "$CLOSEDLOOP_WORKDIR/spawn-args.txt"\nexit 0\n',
  );

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  // fake git: needed for EXECUTE's git status check in handleProcessCompletion
  const fakeGitScript = [
    "#!/bin/sh",
    'if [ "$1" = status ]; then exit 0; fi',
    'if [ "$1" = "rev-parse" ]; then echo "symphony/execute-spawn-test"; exit 0; fi',
    "exit 0",
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });

  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port);

  const loopId = "00000000-0000-0000-0000-000000007003";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "EXECUTE",
        closedLoopAuthToken: "tok",
        prompt: "implement the plan",
        artifacts: [],
        repo: {
          fullName: `spawn-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        // additionalRepos in the body — EXECUTE should ignore these for --add-dir
        additionalRepos: [
          { localRepoPath: additionalRepo, branch: "main" },
        ],
      }),
    },
  );

  assert.equal(response.status, 200);

  const completedEvent = await waitForCompletedEvent(mock.requests, loopId);
  assert.equal(completedEvent.type, "completed");

  // Find spawn-args.txt under tmpDir
  const spawnArgsFile = await findSpawnArgsFile(tmpDir);
  const spawnArgs = (await fs.readFile(spawnArgsFile, "utf-8")).trim();

  assert.ok(
    !spawnArgs.includes("--add-dir"),
    `Expected no --add-dir in EXECUTE spawn args even with additionalRepos in body, got: ${spawnArgs}`,
  );
});
