import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import type { WorktreeProvider } from "../src/server/operations/symphony-loop.js";
import { setShellPathForTest } from "../src/server/shell-path.js";
import {
  createFakeRunLoopScript,
  makeMultiRepoGateway,
  makeMultiRepoTestHarness,
  startMockApiServer,
} from "./symphony-test-utils.js";

const { serversToClose, mockServersToClose, tempPathsToClean, cleanup } =
  makeMultiRepoTestHarness();
afterEach(cleanup);

function createTestGateway(
  tmpDir: string,
  mockPort: number,
  worktreeProvider: WorktreeProvider,
) {
  return makeMultiRepoGateway({
    tmpDir,
    mockPort,
    machineName: "multi-repo-execute-test",
    worktreeProvider,
    serversToClose,
  });
}

function makeRecordingWorktreeProvider(): {
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
      execFileSync("git", ["init", "-q", "-b", "main"], {
        cwd: worktreeDir,
        stdio: "pipe",
      });
      execFileSync("git", ["config", "user.email", "test@test.com"], {
        cwd: worktreeDir,
        stdio: "pipe",
      });
      execFileSync("git", ["config", "user.name", "Test"], {
        cwd: worktreeDir,
        stdio: "pipe",
      });
      execFileSync("git", ["commit", "--allow-empty", "-m", "initial"], {
        cwd: worktreeDir,
        stdio: "pipe",
      });
    },
    findWorktreeForBranch() {
      return null;
    },
    async removeWorktree(worktreeDir) {
      await fs.rm(worktreeDir, { recursive: true, force: true });
    },
    getCurrentBranch() {
      return "symphony/multi-repo-execute-test";
    },
    branchExists: async () => true,
  };

  return { provider, ensureWorktreeCalls };
}

async function findFileRecursive(
  dir: string,
  filename: string,
): Promise<string | null> {
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === filename) return fullPath;
    if (entry.isDirectory()) {
      const result = await findFileRecursive(fullPath, filename);
      if (result !== null) return result;
    }
  }
  return null;
}

async function findSpawnArgsFile(searchRoot: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const found = await findFileRecursive(searchRoot, "spawn-args.txt");
    if (found !== null) return found;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for spawn-args.txt under ${searchRoot}`);
}

test("EXECUTE with additionalRepos provisions additionals, passes --add-dir, and uploads V2 repo results", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-execute-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  const additionalRepo1 = path.join(tmpDir, "additional-repo-1");
  const additionalRepo2 = path.join(tmpDir, "additional-repo-2");
  const worktreeParent = path.join(tmpDir, "worktrees");
  await Promise.all(
    [primaryRepo, additionalRepo1, additionalRepo2, worktreeParent].map((dir) =>
      fs.mkdir(dir, { recursive: true }),
    ),
  );

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  await createFakeRunLoopScript(
    tmpDir,
    '#!/bin/sh\necho "$@" > "$CLOSEDLOOP_WORKDIR/spawn-args.txt"\nexit 0\n',
  );

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  await fs.writeFile(
    path.join(fakeBin, "git"),
    [
      "#!/bin/sh",
      'if [ "$1" = status ]; then exit 0; fi',
      'if [ "$1" = "rev-parse" ] && [ "$2" = "--abbrev-ref" ]; then echo "symphony/execute-test"; exit 0; fi',
      'if [ "$1" = "rev-parse" ]; then echo "abc123"; exit 0; fi',
      'if [ "$1" = "for-each-ref" ]; then exit 0; fi',
      'if [ "$1" = "rev-list" ]; then exit 0; fi',
      "exit 0",
    ].join("\n"),
    { mode: 0o755 },
  );
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const { provider, ensureWorktreeCalls } = makeRecordingWorktreeProvider();
  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port, provider);

  const loopId = "00000000-0000-0000-0000-000000008001";
  const primaryFullName = `execute-test/${path.basename(primaryRepo)}`;
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
        repo: { fullName: primaryFullName, branch: "main" },
        additionalRepos: [
          { localRepoPath: additionalRepo1, fullName: "acme/add-one", branch: "feature-a" },
          { localRepoPath: additionalRepo2, fullName: "acme/add-two", branch: "feature-b" },
        ],
      }),
    },
  );

  assert.equal(response.status, 200);

  const uploadReq = await mock.waitForRequest("upload-artifacts");
  const uploadBody = JSON.parse(uploadReq.body) as {
    artifacts?: {
      executionResult?: {
        schemaVersion?: number;
        results?: Array<{ fullName?: string; status?: string }>;
      };
    };
  };

  const additionalCalls = ensureWorktreeCalls.filter(
    (call) => call.repoPath !== primaryRepo,
  );
  assert.equal(additionalCalls.length, 2);
  assert.deepEqual(
    additionalCalls.map((call) => call.baseBranch).sort(),
    ["feature-a", "feature-b"],
  );
  assert.ok(
    additionalCalls.every(
      (call) =>
        call.branchName.startsWith("symphony/") &&
        call.branchName !== call.baseBranch,
    ),
  );

  const spawnArgsFile = await findSpawnArgsFile(tmpDir);
  const spawnArgs = (await fs.readFile(spawnArgsFile, "utf-8")).trim();
  const addDirMatches = [...spawnArgs.matchAll(/--add-dir\s+(\S+)/g)].map(
    (match) => match[1],
  );
  assert.equal(addDirMatches.length, 2);
  assert.ok(addDirMatches.every((addDir) => addDir.startsWith(worktreeParent)));

  const executionResult = uploadBody.artifacts?.executionResult;
  assert.equal(executionResult?.schemaVersion, 2);
  assert.deepEqual(
    executionResult?.results?.map((result) => result.fullName),
    [primaryFullName, "acme/add-one", "acme/add-two"],
  );
  assert.ok(
    executionResult?.results?.every((result) => result.status === "skipped"),
  );
});
