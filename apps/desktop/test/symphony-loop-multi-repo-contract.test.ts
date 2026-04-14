/**
 * Contract tests for multi-repo PLAN requests.
 *
 * 1. PLAN rejects nonexistent branch (branchExists returns false) — HTTP 400 + RepoNotFound event
 * 2. resolveAdditionalRepos deduplicates on resolved path
 * 3. resolveAdditionalRepos removes entries matching the primary repo
 * 4. resolveAdditionalRepos rejects > 5 entries
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import type { WorktreeProvider } from "../src/server/operations/symphony-loop.js";
import {
  AdditionalRepoError,
  resolveAdditionalRepos,
} from "../src/server/operations/symphony-loop.js";
import {
  makeMultiRepoGateway,
  makeMultiRepoTestHarness,
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

const { serversToClose, mockServersToClose, tempPathsToClean, cleanup } =
  makeMultiRepoTestHarness();
afterEach(cleanup);

/** Create a gateway server with a mock API backend and the extended worktreeProvider. */
function createTestGateway(
  tmpDir: string,
  mockPort: number,
  worktreeProvider?: WorktreeProvider,
) {
  return makeMultiRepoGateway({
    tmpDir,
    mockPort,
    machineName: "multi-repo-contract-test",
    worktreeProvider: worktreeProvider ?? fakeWorktreeProvider,
    serversToClose,
  });
}

// ---------------------------------------------------------------------------
// PLAN rejects nonexistent branch (branchExists returns false)
//   — assert HTTP 400 and RepoNotFound error event
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

  it("removes an additionalRepo entry that matches the primary repo path", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-unit-primary-"));
    tempPathsToClean.push(tmpDir);

    const primaryRepo = path.join(tmpDir, "primary-repo");
    await fs.mkdir(primaryRepo, { recursive: true });

    const secondaryRepo = path.join(tmpDir, "secondary-repo");
    await fs.mkdir(secondaryRepo, { recursive: true });

    const result = await resolveAdditionalRepos(
      [
        { localRepoPath: primaryRepo, branch: "main" },
        { localRepoPath: secondaryRepo, branch: "main" },
      ],
      primaryRepo,
      [tmpDir],
      "test-loop-id",
      fakeWorktreeProvider,
    );

    assert.equal(result.length, 1, "Entry matching primary repo path should be removed");
    assert.equal(result[0].repoPath, secondaryRepo);
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
      (err) =>
        err instanceof AdditionalRepoError &&
        err.message.includes("exceeds maximum"),
    );
  });
});
