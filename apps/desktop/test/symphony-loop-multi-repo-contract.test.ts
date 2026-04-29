/**
 * Contract tests for multi-repo PLAN requests.
 *
 * 1. PLAN rejects nonexistent branch (branchExists returns false) — HTTP 400 + PreRunValidationFailed event
 * 2. resolveAdditionalRepos rejects > 5 entries
 * 3. additionalRepoDisambiguator distinguishes repos with the same basename
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import type { WorktreeProvider } from "../src/server/operations/symphony-loop.js";
import {
  additionalRepoDisambiguator,
  AdditionalRepoError,
  resolveAdditionalRepos,
} from "../src/server/operations/symphony-loop.js";
import {
  makeFakeWorktreeProvider,
  makeMultiRepoGateway,
  makeMultiRepoTestHarness,
  startMockApiServer,
  waitForTerminalEvent,
} from "./symphony-test-utils.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const fakeWorktreeProvider = makeFakeWorktreeProvider("symphony/multi-repo-contract-test");

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

/**
 * Shared setup for the "nonexistent branch" tests: creates temp dirs, mock API,
 * a branchNotFound worktreeProvider, and a gateway server. Returns everything
 * needed to issue a loop request and assert on the result.
 */
async function setupNonexistentBranchTest(tmpDirLabel: string) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), tmpDirLabel));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  const additionalRepo = path.join(tmpDir, "additional-repo");
  const worktreeParent = path.join(tmpDir, "worktrees");
  await Promise.all([
    fs.mkdir(primaryRepo, { recursive: true }),
    fs.mkdir(additionalRepo, { recursive: true }),
    fs.mkdir(worktreeParent, { recursive: true }),
  ]);

  process.env.HOME = tmpDir;
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);

  const branchNotFoundProvider: WorktreeProvider = {
    ...fakeWorktreeProvider,
    branchExists: async () => false,
  };
  const server = await createTestGateway(tmpDir, mock.port, branchNotFoundProvider);

  return { primaryRepo, additionalRepo, mock, server };
}

// ---------------------------------------------------------------------------
// PLAN / EXECUTE reject nonexistent branch (branchExists returns false)
//   — assert HTTP 400 and PreRunValidationFailed error event
// ---------------------------------------------------------------------------

for (const { command, loopId, extraBody } of [
  {
    command: "PLAN",
    loopId: "00000000-0000-0000-0000-000000003004",
    extraBody: {},
  },
  {
    command: "EXECUTE",
    loopId: "00000000-0000-0000-0000-000000003005",
    extraBody: { prompt: "Execute the plan" },
  },
] as const) {
  it(`${command} with nonexistent branch in additionalRepo returns HTTP 400 and PreRunValidationFailed event`, async () => {
    const { primaryRepo, additionalRepo, mock, server } =
      await setupNonexistentBranchTest(`multi-repo-${command.toLowerCase()}-nobranch-`);

    const response = await fetch(
      `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loopId,
          command,
          closedLoopAuthToken: "tok",
          artifacts: [],
          ...extraBody,
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
      `${command} with nonexistent branch in additionalRepo should return HTTP 400`,
    );

    const errorEvent = await waitForTerminalEvent(mock.requests, loopId);
    assert.equal(errorEvent.type, "error");
    assert.equal(
      errorEvent.code,
      "PRE_RUN_VALIDATION_FAILED",
      `Expected error code PRE_RUN_VALIDATION_FAILED, got: ${JSON.stringify(errorEvent.code)}`,
    );
    assert.ok(
      typeof errorEvent.message === "string" && errorEvent.message.length > 0,
      `Expected a non-empty message string in the error event, got: ${JSON.stringify(errorEvent.message)}`,
    );
  });
}

// ---------------------------------------------------------------------------
// Unit-style tests for resolveAdditionalRepos
// ---------------------------------------------------------------------------

describe("resolveAdditionalRepos — unit-style", () => {
  it("rejects entries exceeding the maximum of 5 additional repos", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-unit-max-"));
    tempPathsToClean.push(tmpDir);

    const repos = Array.from({ length: 6 }, (_, i) => path.join(tmpDir, `repo-${i}`));
    await Promise.all(repos.map((r) => fs.mkdir(r, { recursive: true })));

    await assert.rejects(
      () =>
        resolveAdditionalRepos(
          repos.map((r) => ({ localRepoPath: r, branch: "main" })),
          [tmpDir],
          fakeWorktreeProvider,
        ),
      (err) =>
        err instanceof AdditionalRepoError &&
        err.message.includes("exceeds maximum"),
    );
  });

  it("accepts exactly one additional repo and returns a single resolved entry", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-single-"));
    tempPathsToClean.push(tmpDir);

    const repoDir = path.join(tmpDir, "single-repo");
    await fs.mkdir(repoDir, { recursive: true });

    const resolved = await resolveAdditionalRepos(
      [{ localRepoPath: repoDir, branch: "main" }],
      [tmpDir],
      fakeWorktreeProvider,
    );

    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].repoPath, path.resolve(repoDir));
  });

  it("returns empty array when additionalRepos is empty", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-empty-"));
    tempPathsToClean.push(tmpDir);

    const resolved = await resolveAdditionalRepos([], [tmpDir], fakeWorktreeProvider);

    assert.deepEqual(resolved, []);
  });
});

// ---------------------------------------------------------------------------
// additionalRepoDisambiguator: pure-function check that two repos sharing a
// basename but differing in absolute path get distinct disambiguators. Replaces
// the prior full-stack integration test for the same invariant.
// ---------------------------------------------------------------------------

describe("additionalRepoDisambiguator", () => {
  it("produces different disambiguators for repos with the same basename in different parents", () => {
    const a = "/tmp/work/api";
    const b = "/tmp/oss/api";

    const hashA = additionalRepoDisambiguator(a);
    const hashB = additionalRepoDisambiguator(b);

    assert.match(hashA, /^[a-f0-9]{8}$/, "disambiguator should be an 8-char hex string");
    assert.match(hashB, /^[a-f0-9]{8}$/, "disambiguator should be an 8-char hex string");
    assert.notEqual(
      hashA,
      hashB,
      "Repos with the same basename but distinct absolute paths must hash differently",
    );
  });

  it("is stable: same path returns the same disambiguator across calls", () => {
    const repoPath = "/tmp/work/api";
    assert.equal(
      additionalRepoDisambiguator(repoPath),
      additionalRepoDisambiguator(repoPath),
    );
  });
});
