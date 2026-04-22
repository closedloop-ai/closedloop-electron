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

// ---------------------------------------------------------------------------
// PLAN rejects nonexistent branch (branchExists returns false)
//   — assert HTTP 400 and PreRunValidationFailed error event
// ---------------------------------------------------------------------------

it("PLAN with nonexistent branch in additionalRepo returns HTTP 400 and PreRunValidationFailed event", async () => {
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

  // The error event with code PRE_RUN_VALIDATION_FAILED must be posted to the API
  const errorEvent = await waitForTerminalEvent(mock.requests, loopId);
  assert.equal(errorEvent.type, "error");
  assert.equal(
    errorEvent.code,
    "PRE_RUN_VALIDATION_FAILED",
    `Expected error code PRE_RUN_VALIDATION_FAILED, got: ${JSON.stringify(errorEvent.code)}`,
  );
});

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
});

// ---------------------------------------------------------------------------
// REQUEST_CHANGES rejects nonexistent branch (branchExists returns false)
//   — assert HTTP 400 and PreRunValidationFailed error event
// ---------------------------------------------------------------------------

it("REQUEST_CHANGES with nonexistent branch in additionalRepo returns HTTP 400 and PreRunValidationFailed event", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-rc-nobranch-"));
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

  const loopId = "00000000-0000-0000-0000-000000008001";
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
        prompt: "Please apply the requested changes.",
        localRepoPath: primaryRepo,
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
    "REQUEST_CHANGES with nonexistent branch in additionalRepo should return HTTP 400",
  );

  // The error event with code PRE_RUN_VALIDATION_FAILED must be posted to the API
  const errorEvent = await waitForTerminalEvent(mock.requests, loopId);
  assert.equal(errorEvent.type, "error");
  assert.equal(
    errorEvent.code,
    "PRE_RUN_VALIDATION_FAILED",
    `Expected error code PRE_RUN_VALIDATION_FAILED, got: ${JSON.stringify(errorEvent.code)}`,
  );
});

// ---------------------------------------------------------------------------
// REQUEST_CHANGES rejects > 5 additionalRepos entries — assert HTTP 400
// ---------------------------------------------------------------------------

it("REQUEST_CHANGES with 6 additionalRepos entries returns HTTP 400 with max-exceeded error", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-rc-max-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  // Create 6 additional repos (exceeds the maximum of 5)
  const additionalRepos = Array.from({ length: 6 }, (_, i) =>
    path.join(tmpDir, `additional-repo-${i}`),
  );
  await Promise.all(additionalRepos.map((r) => fs.mkdir(r, { recursive: true })));

  process.env.HOME = tmpDir;
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);

  const server = await createTestGateway(tmpDir, mock.port);

  const loopId = "00000000-0000-0000-0000-000000008002";
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
        prompt: "Please apply the requested changes.",
        localRepoPath: primaryRepo,
        repo: {
          fullName: `multi-repo-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        additionalRepos: additionalRepos.map((r) => ({
          localRepoPath: r,
          branch: "main",
        })),
      }),
    },
  );

  assert.equal(
    response.status,
    400,
    "REQUEST_CHANGES with 6 additionalRepos should return HTTP 400",
  );

  const body = (await response.json()) as Record<string, unknown>;
  assert.match(
    String(body.error ?? ""),
    /exceeds maximum/i,
    `Expected error message to mention 'exceeds maximum', got: ${JSON.stringify(body.error)}`,
  );
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
