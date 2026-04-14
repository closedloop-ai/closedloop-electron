/**
 * Contract tests for multi-repo PLAN requests.
 *
 * 1. PLAN rejects entry missing branch — assert HTTP 400
 * 2. PLAN rejects nonexistent branch (branchExists returns false) — assert HTTP 400 and RepoNotFound error event
 * 3. Unit-style tests: resolveAdditionalRepos deduplication logic
 * 4. Unit-style tests: resolveAdditionalRepos primary-repo-removal logic
 * 5. Unit-style tests: resolveAdditionalRepos max entries limit
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
import { resetShellPathCache } from "../src/server/shell-path.js";
import {
  restoreEnv,
  saveEnv,
  startMockApiServer,
  waitForTerminalEvent,
} from "./symphony-test-utils.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/**
 * Extended fakeWorktreeProvider that includes branchExists (always returns
 * true) in addition to the base methods.
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
  branchExists: async () => true,
};

function expectResolvedAdditionalRepos(
  result: Awaited<ReturnType<typeof resolveAdditionalRepos>>,
) {
  if ("error" in result) {
    assert.fail(`Expected resolved additional repos, got error: ${result.error}`);
  }
  return result.repos;
}

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
// Unit-style tests for resolveAdditionalRepos
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

    const result = expectResolvedAdditionalRepos(await resolveAdditionalRepos(
      [
        { localRepoPath: repoA, branch: "main" },
        { localRepoPath: repoA, branch: "feature-branch" }, // same path, different branch
      ],
      null,
      [tmpDir],
      "test-loop-id",
      fakeWorktreeProvider,
    ));

    assert.equal(result.length, 1, "Duplicate paths should be deduplicated to one entry");
    assert.equal(result[0].repoPath, repoA);
    assert.equal(result[0].branch, "main", "First occurrence wins on deduplication");
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

    const result = expectResolvedAdditionalRepos(await resolveAdditionalRepos(
      [
        { localRepoPath: primaryRepo, branch: "main" }, // same as primary — should be removed
        { localRepoPath: secondaryRepo, branch: "main" }, // different — should be kept
      ],
      primaryRepo,
      [tmpDir],
      "test-loop-id",
      fakeWorktreeProvider,
    ));

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
    const result = expectResolvedAdditionalRepos(await resolveAdditionalRepos(
      [{ localRepoPath: primaryRepo + "/", branch: "main" }],
      primaryRepo,
      [tmpDir],
      "test-loop-id",
      fakeWorktreeProvider,
    ));

    assert.equal(
      result.length,
      0,
      "Path with trailing slash matching primary repo should be removed after normalization",
    );
  });

  it("rejects entries exceeding the maximum of 5 additional repos", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-unit-max-"));
    tempPathsToClean.push(tmpDir);

    const repos = Array.from({ length: 6 }, (_, i) => path.join(tmpDir, `repo-${i}`));
    await Promise.all(repos.map((r) => fs.mkdir(r, { recursive: true })));

    const result = await resolveAdditionalRepos(
      repos.map((r) => ({ localRepoPath: r, branch: "main" })),
      null,
      [tmpDir],
      "test-loop-id",
      fakeWorktreeProvider,
    );

    assert.ok("error" in result, "Expected max-entry validation to return an error result");
    assert.ok(
      result.error.includes("exceeds maximum"),
      `Expected 'exceeds maximum' in error message, got: ${result.error}`,
    );
  });
});
