/**
 * Contract tests for multi-repo PLAN requests.
 *
 * 1. PLAN accepts valid additionalRepos — assert HTTP 200
 * 2. PLAN rejects entry missing branch — assert HTTP 400
 * 3. PLAN rejects sandbox-violating path — assert HTTP 400 and RepoNotAllowed error event
 * 4. PLAN rejects nonexistent branch (branchExists returns false) — assert HTTP 400 and RepoNotFound error event
 * 5. Single-repo PLAN unchanged — assert HTTP 200
 * 6. Unit-style tests: resolveAdditionalRepos deduplication logic
 * 7. Unit-style tests: resolveAdditionalRepos primary-repo-removal logic
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { DesktopGatewayServer } from "../src/server/server.js";
import { EMPTY_CAPABILITIES } from "../src/shared/contracts.js";
import type { WorktreeProvider } from "../src/server/operations/symphony-loop.js";
import { resolveAdditionalRepos } from "../src/server/operations/symphony-loop.js";
import { resetShellPathCache, setShellPathForTest } from "../src/server/shell-path.js";
import {
  createFakeRunLoopScript,
  restoreEnv,
  saveEnv,
  startMockApiServer,
  waitForTerminalEvent,
} from "./symphony-test-utils.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/**
 * Extended fakeWorktreeProvider that includes checkoutWorktree (creates dir)
 * and branchExists (always returns true) in addition to the base methods.
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
    return "symphony/multi-repo-contract-test";
  },
  checkoutWorktree: async (_rp, worktreeDir) => {
    await fs.mkdir(worktreeDir, { recursive: true });
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

/** Create a gateway server with a mock API backend and the extended worktreeProvider. */
async function createTestGateway(
  tmpDir: string,
  mockPort: number,
  worktreeProvider?: WorktreeProvider,
) {
  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "multi-repo-contract-test",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    worktreeProvider: worktreeProvider ?? fakeWorktreeProvider,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getApiOrigin: () => `http://127.0.0.1:${mockPort}`,
  });
  serversToClose.push(server);
  await server.start();
  return server;
}

// ---------------------------------------------------------------------------
// Test 1: PLAN accepts valid additionalRepos — assert HTTP 200
// ---------------------------------------------------------------------------

it("PLAN with valid additionalRepos returns HTTP 200", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-valid-"));
  tempPathsToClean.push(tmpDir);

  // Primary repo directory
  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  // Additional repo directory (must be within allowedDirs = [tmpDir])
  const additionalRepo = path.join(tmpDir, "additional-repo");
  await fs.mkdir(additionalRepo, { recursive: true });

  // Worktree parent must also be within tmpDir so worktrees pass assertPathAllowed
  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  // run-loop.sh exits 0 with token output so no 0-token guard fires
  await createFakeRunLoopScript(tmpDir, "#!/bin/sh\nexit 0\n");

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port);

  const loopId = "00000000-0000-0000-0000-000000003001";
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
          fullName: `multi-repo-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        additionalRepos: [
          {
            localRepoPath: additionalRepo,
            branch: "main",
          },
        ],
      }),
    },
  );

  assert.equal(response.status, 200, "PLAN with valid additionalRepos should return HTTP 200");
});

// ---------------------------------------------------------------------------
// Test 2: PLAN rejects entry missing branch — assert HTTP 400
// ---------------------------------------------------------------------------

it("PLAN with additionalRepo missing branch returns HTTP 400", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-nobranch-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const additionalRepo = path.join(tmpDir, "additional-repo");
  await fs.mkdir(additionalRepo, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);

  // Use a worktreeProvider whose branchExists returns false for falsy branches,
  // which is what happens when `branch` is missing from the request entry.
  const missingBranchProvider: WorktreeProvider = {
    ...fakeWorktreeProvider,
    branchExists: async (_repoPath, branch) =>
      typeof branch === "string" && branch.length > 0,
  };
  const server = await createTestGateway(tmpDir, mock.port, missingBranchProvider);

  const loopId = "00000000-0000-0000-0000-000000003002";
  // Send an additionalRepo entry without a branch field (TypeScript cast needed)
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
          fullName: `multi-repo-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        additionalRepos: [
          {
            localRepoPath: additionalRepo,
            // branch intentionally omitted
          },
        ],
      }),
    },
  );

  assert.equal(
    response.status,
    400,
    "PLAN with additionalRepo missing branch should return HTTP 400",
  );
});

// ---------------------------------------------------------------------------
// Test 3: PLAN rejects sandbox-violating path — assert HTTP 400 and RepoNotAllowed error event
// ---------------------------------------------------------------------------

it("PLAN with sandbox-violating additionalRepo path returns HTTP 400 and RepoNotAllowed event", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-sandbox-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port);

  const loopId = "00000000-0000-0000-0000-000000003003";
  // Use a path clearly outside the allowed directory (tmpDir)
  const sandboxViolatingPath = "/tmp/outside-sandbox-repo";

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
          fullName: `multi-repo-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        additionalRepos: [
          {
            localRepoPath: sandboxViolatingPath,
            branch: "main",
          },
        ],
      }),
    },
  );

  assert.equal(
    response.status,
    400,
    "PLAN with sandbox-violating additionalRepo path should return HTTP 400",
  );

  // The error event with code RepoNotAllowed must be posted to the API
  const errorEvent = await waitForTerminalEvent(mock.requests, loopId);
  assert.equal(errorEvent.type, "error");
  assert.equal(
    errorEvent.code,
    "REPO_NOT_ALLOWED",
    `Expected error code REPO_NOT_ALLOWED, got: ${JSON.stringify(errorEvent.code)}`,
  );
});

// ---------------------------------------------------------------------------
// Test 4: PLAN rejects nonexistent branch (branchExists returns false)
//         — assert HTTP 400 and RepoNotFound error event
// ---------------------------------------------------------------------------

it("PLAN with nonexistent branch in additionalRepo returns HTTP 400 and RepoNotFound event", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-nobranch-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const additionalRepo = path.join(tmpDir, "additional-repo");
  await fs.mkdir(additionalRepo, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);

  // Use a worktreeProvider whose branchExists always returns false
  const branchNotFoundProvider: WorktreeProvider = {
    ...fakeWorktreeProvider,
    branchExists: async () => false,
  };
  const server = await createTestGateway(tmpDir, mock.port, branchNotFoundProvider);

  const loopId = "00000000-0000-0000-0000-000000003004";
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
          fullName: `multi-repo-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        additionalRepos: [
          {
            localRepoPath: additionalRepo,
            branch: "nonexistent-branch",
          },
        ],
      }),
    },
  );

  assert.equal(
    response.status,
    400,
    "PLAN with nonexistent branch in additionalRepo should return HTTP 400",
  );

  // The error event with code RepoNotFound must be posted to the API
  const errorEvent = await waitForTerminalEvent(mock.requests, loopId);
  assert.equal(errorEvent.type, "error");
  assert.equal(
    errorEvent.code,
    "REPO_NOT_FOUND",
    `Expected error code REPO_NOT_FOUND, got: ${JSON.stringify(errorEvent.code)}`,
  );
});

// ---------------------------------------------------------------------------
// Test 5: Single-repo PLAN unchanged — assert HTTP 200
// ---------------------------------------------------------------------------

it("single-repo PLAN (no additionalRepos) continues to return HTTP 200", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-single-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

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

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port);

  const loopId = "00000000-0000-0000-0000-000000003005";
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
          fullName: `single-repo-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        // No additionalRepos field
      }),
    },
  );

  assert.equal(
    response.status,
    200,
    "Single-repo PLAN without additionalRepos should still return HTTP 200",
  );
});

// ---------------------------------------------------------------------------
// Tests 6 & 7: Unit-style tests for resolveAdditionalRepos
// ---------------------------------------------------------------------------

describe("resolveAdditionalRepos — unit-style", () => {
  // ---------------------------------------------------------------------------
  // Test 6: Deduplication logic
  // ---------------------------------------------------------------------------

  it("deduplicates entries that resolve to the same local path (first occurrence wins)", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-unit-dedup-"));
    tempPathsToClean.push(tmpDir);

    const repoA = path.join(tmpDir, "repo-a");
    await fs.mkdir(repoA, { recursive: true });

    const result = await resolveAdditionalRepos(
      [
        { localRepoPath: repoA, branch: "main" },
        { localRepoPath: repoA, branch: "feature-branch" }, // same path, different branch
      ],
      null,
      [tmpDir],
      "test-loop-id",
      fakeWorktreeProvider,
    );

    assert.equal(result.length, 1, "Duplicate paths should be deduplicated to one entry");
    assert.equal(result[0].repoPath, repoA);
    assert.equal(result[0].branch, "main", "First occurrence wins on deduplication");
  });

  it("returns an empty array when additionalRepos is empty", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-unit-empty-"));
    tempPathsToClean.push(tmpDir);

    const result = await resolveAdditionalRepos(
      [],
      null,
      [tmpDir],
      "test-loop-id",
      fakeWorktreeProvider,
    );

    assert.equal(result.length, 0, "Empty additionalRepos should return empty array");
  });

  it("includes slugifiedBranch field derived from branch name", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-unit-slug-"));
    tempPathsToClean.push(tmpDir);

    const repoA = path.join(tmpDir, "repo-a");
    await fs.mkdir(repoA, { recursive: true });

    const result = await resolveAdditionalRepos(
      [{ localRepoPath: repoA, branch: "feature/my-feature" }],
      null,
      [tmpDir],
      "test-loop-id",
      fakeWorktreeProvider,
    );

    assert.equal(result.length, 1);
    assert.equal(result[0].branch, "feature/my-feature", "Raw branch name preserved");
    assert.equal(
      result[0].slugifiedBranch,
      "feature-my-feature",
      "slugifiedBranch should replace / with -",
    );
  });

  // ---------------------------------------------------------------------------
  // Test 7: Primary-repo-removal logic
  // ---------------------------------------------------------------------------

  it("removes an additionalRepo entry that matches the primary repo path", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-unit-primary-"));
    tempPathsToClean.push(tmpDir);

    const primaryRepo = path.join(tmpDir, "primary-repo");
    await fs.mkdir(primaryRepo, { recursive: true });

    const secondaryRepo = path.join(tmpDir, "secondary-repo");
    await fs.mkdir(secondaryRepo, { recursive: true });

    const result = await resolveAdditionalRepos(
      [
        { localRepoPath: primaryRepo, branch: "main" }, // same as primary — should be removed
        { localRepoPath: secondaryRepo, branch: "main" }, // different — should be kept
      ],
      primaryRepo,
      [tmpDir],
      "test-loop-id",
      fakeWorktreeProvider,
    );

    assert.equal(result.length, 1, "Entry matching primary repo path should be removed");
    assert.equal(
      result[0].repoPath,
      secondaryRepo,
      "Only the non-primary entry should remain",
    );
  });

  it("normalizes paths before comparing with primary repo path", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-unit-normalize-"));
    tempPathsToClean.push(tmpDir);

    const primaryRepo = path.join(tmpDir, "primary-repo");
    await fs.mkdir(primaryRepo, { recursive: true });

    // Use a trailing slash variant — path.resolve should normalize both sides
    const result = await resolveAdditionalRepos(
      [{ localRepoPath: primaryRepo + "/", branch: "main" }],
      primaryRepo,
      [tmpDir],
      "test-loop-id",
      fakeWorktreeProvider,
    );

    assert.equal(
      result.length,
      0,
      "Path with trailing slash matching primary repo should be removed after normalization",
    );
  });

  it("keeps all entries when none matches the primary repo path", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-unit-keep-"));
    tempPathsToClean.push(tmpDir);

    const primaryRepo = path.join(tmpDir, "primary-repo");
    await fs.mkdir(primaryRepo, { recursive: true });

    const repoA = path.join(tmpDir, "repo-a");
    const repoB = path.join(tmpDir, "repo-b");
    await fs.mkdir(repoA, { recursive: true });
    await fs.mkdir(repoB, { recursive: true });

    const result = await resolveAdditionalRepos(
      [
        { localRepoPath: repoA, branch: "main" },
        { localRepoPath: repoB, branch: "main" },
      ],
      primaryRepo,
      [tmpDir],
      "test-loop-id",
      fakeWorktreeProvider,
    );

    assert.equal(result.length, 2, "All entries not matching primary should be kept");
  });

  it("rejects entries exceeding the maximum of 5 additional repos", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-unit-max-"));
    tempPathsToClean.push(tmpDir);

    const repos = Array.from({ length: 6 }, (_, i) => path.join(tmpDir, `repo-${i}`));
    await Promise.all(repos.map((r) => fs.mkdir(r, { recursive: true })));

    await assert.rejects(
      () =>
        resolveAdditionalRepos(
          repos.map((r) => ({ localRepoPath: r, branch: "main" })),
          null,
          [tmpDir],
          "test-loop-id",
          fakeWorktreeProvider,
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error, "Should throw an Error");
        assert.ok(
          err.message.includes("exceeds maximum"),
          `Expected 'exceeds maximum' in error message, got: ${err.message}`,
        );
        return true;
      },
    );
  });
});
