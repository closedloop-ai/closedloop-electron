/**
 * Contract tests for multi-repo PLAN and EXECUTE requests.
 *
 * 1. PLAN rejects nonexistent branch (branchExists returns false) — HTTP 400 + PreRunValidationFailed event
 * 2. resolveAdditionalRepos rejects > 5 entries
 * 3. additionalRepoDisambiguator distinguishes repos with the same basename
 * 4. EXECUTE accepts additionalRepos in request body and processes them (T-6.1)
 * 5. EXECUTE produces v2 envelope in upload-artifacts payload (T-6.7)
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, test } from "node:test";
import type { WorktreeProvider } from "../src/server/operations/symphony-loop.js";
import {
  additionalRepoDisambiguator,
  AdditionalRepoError,
  resolveAdditionalRepos,
} from "../src/server/operations/symphony-loop.js";
import {
  createFakeRunLoopScript,
  makeFakeWorktreeProvider,
  makeMultiRepoGateway,
  makeMultiRepoTestHarness,
  startMockApiServer,
  waitForCompletedEvent,
  waitForTerminalEvent,
} from "./symphony-test-utils.js";
import { setShellPathForTest } from "../src/server/shell-path.js";

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

// ---------------------------------------------------------------------------
// T-6.1: EXECUTE accepts additionalRepos in request body and processes them
//
// Strategy: post an EXECUTE request with additionalRepos. The fake WorktreeProvider
// returns an existing worktree dir for both the primary and additional repo
// (simulating the state after a preceding PLAN set them up).
// Assert HTTP 200 and a completed event from the mock API.
// ---------------------------------------------------------------------------

test("EXECUTE accepts additionalRepos and returns HTTP 200 (T-6.1)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-execute-t61-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const additionalRepo = path.join(tmpDir, "additional-repo");
  await fs.mkdir(additionalRepo, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  // Pre-create the primary worktree dir so EXECUTE can reuse it
  const primaryWorktreeDir = path.join(worktreeParent, "primary-wt");
  await fs.mkdir(primaryWorktreeDir, { recursive: true });

  // Pre-create the additional repo worktree dir so EXECUTE can find it
  const additionalWorktreeDir = path.join(worktreeParent, "additional-wt");
  await fs.mkdir(additionalWorktreeDir, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  await createFakeRunLoopScript(tmpDir, "#!/bin/sh\nexit 0\n");

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.writeFile(path.join(fakeBin, "git"), [
    "#!/bin/sh",
    'if [ "$1" = status ]; then exit 0; fi',
    'if [ "$1" = "rev-parse" ] && [ "$2" = "--abbrev-ref" ]; then echo "symphony/execute-test"; exit 0; fi',
    "exit 0",
  ].join("\n"), { mode: 0o755 });
  await fs.writeFile(path.join(fakeBin, "gh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  // WorktreeProvider that returns pre-created dirs for findWorktreeForBranch.
  // EXECUTE uses findWorktreeForBranch for both primary and additional repos.
  const executeProvider: WorktreeProvider = {
    ...fakeWorktreeProvider,
    findWorktreeForBranch(_repoPath: string, _branchName: string): string | null {
      if (_repoPath === primaryRepo) {
        return primaryWorktreeDir;
      }
      if (_repoPath === additionalRepo) {
        return additionalWorktreeDir;
      }
      return null;
    },
  };

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await makeMultiRepoGateway({
    tmpDir,
    mockPort: mock.port,
    machineName: "multi-repo-execute-t61",
    worktreeProvider: executeProvider,
    serversToClose,
  });

  const loopId = "00000000-0000-0000-0000-000000003010";
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
          fullName: `execute-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        additionalRepos: [
          {
            localRepoPath: additionalRepo,
            branch: "feature-branch",
          },
        ],
      }),
    },
  );

  assert.equal(
    response.status,
    200,
    `Expected HTTP 200 for EXECUTE with additionalRepos, got ${response.status}: ${await response.text().catch(() => "")}`,
  );

  // Wait for completion — confirms the request was accepted and processed
  const completedEvent = await waitForCompletedEvent(mock.requests, loopId);
  assert.equal(
    completedEvent.type,
    "completed",
    `Expected 'completed' event for EXECUTE with additionalRepos, got: ${JSON.stringify(completedEvent)}`,
  );
});

// ---------------------------------------------------------------------------
// T-6.7: EXECUTE produces v2 envelope in upload-artifacts payload
//
// Strategy: post an EXECUTE where the primary repo has git changes (git status
// returns non-empty output) so executeGitOperations produces a success result.
// Assert the upload-artifacts body contains executionResult with
// schemaVersion: 2 and a results array with the primary repo entry.
// ---------------------------------------------------------------------------

test("EXECUTE produces v2 envelope in upload-artifacts when git changes exist (T-6.7)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-execute-t67-"));
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  const primaryWorktreeDir = path.join(worktreeParent, "primary-wt");
  await fs.mkdir(primaryWorktreeDir, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  // Fake run-loop.sh exits 0; fake claude also exits 0 without execution-result.json
  // so the code falls through to executeGitOperations.
  await createFakeRunLoopScript(tmpDir, "#!/bin/sh\nexit 0\n");

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  const expectedPrUrl = "https://github.com/execute-test/primary-repo/pull/10";

  // fake git: status reports a change, other commands succeed
  const fakeGitScript = [
    "#!/bin/sh",
    'if [ "$1" = status ]; then printf "M changed.txt\\n"; exit 0; fi',
    'if [ "$1" = add ]; then exit 0; fi',
    'if [ "$1" = commit ]; then exit 0; fi',
    'if [ "$1" = push ]; then exit 0; fi',
    'if [ "$1" = fetch ]; then exit 0; fi',
    'if [ "$1" = "rev-parse" ] && [ "$2" = "--abbrev-ref" ]; then echo "symphony/execute-test"; exit 0; fi',
    'if [ "$1" = "rev-parse" ] && [ "$2" = "HEAD" ]; then echo "abcdef1234567890"; exit 0; fi',
    "exit 0",
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });

  // fake gh: pr view returns non-zero (no existing PR) so pr create is called;
  // pr create returns the expected PR URL
  const fakeGhScript = [
    "#!/bin/sh",
    'if [ "$1" = pr ] && [ "$2" = view ] && [ "$3" != "--json" ]; then exit 1; fi',
    'if [ "$1" = pr ] && [ "$2" = view ] && [ "$3" = "--json" ]; then printf \'{"body":""}\\n\'; exit 0; fi',
    'if [ "$1" = pr ] && [ "$2" = create ]; then',
    `  printf '${expectedPrUrl}\\n'`,
    "  exit 0",
    "fi",
    'if [ "$1" = pr ] && [ "$2" = edit ]; then exit 0; fi',
    "exit 0",
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "gh"), fakeGhScript, { mode: 0o755 });

  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  // WorktreeProvider: findWorktreeForBranch returns the pre-created worktree for primary repo
  const executeProvider: WorktreeProvider = {
    ...fakeWorktreeProvider,
    findWorktreeForBranch(_repoPath: string, _branchName: string): string | null {
      if (_repoPath === primaryRepo) {
        return primaryWorktreeDir;
      }
      return null;
    },
  };

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await makeMultiRepoGateway({
    tmpDir,
    mockPort: mock.port,
    machineName: "multi-repo-execute-t67",
    worktreeProvider: executeProvider,
    serversToClose,
  });

  const loopId = "00000000-0000-0000-0000-000000003020";
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
          fullName: `execute-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
      }),
    },
  );

  assert.equal(
    response.status,
    200,
    `Expected HTTP 200, got ${response.status}: ${await response.text().catch(() => "")}`,
  );

  // Wait for the upload-artifacts request
  const uploadReq = await mock.waitForRequest("upload-artifacts");
  const uploadBody = JSON.parse(uploadReq.body) as {
    artifacts: {
      executionResult?: Record<string, unknown>;
    };
    metadata: Record<string, unknown>;
  };

  const envelope = uploadBody.artifacts.executionResult;
  assert.ok(
    envelope !== undefined,
    "Expected executionResult in upload-artifacts payload",
  );
  assert.equal(
    envelope.schemaVersion,
    2,
    `Expected schemaVersion 2 in v2 envelope, got: ${JSON.stringify(envelope.schemaVersion)}`,
  );
  assert.ok(
    Array.isArray(envelope.results),
    `Expected results array in v2 envelope, got: ${JSON.stringify(envelope.results)}`,
  );
  const results = envelope.results as Array<Record<string, unknown>>;
  assert.ok(
    results.length >= 1,
    `Expected at least 1 entry in results array, got ${results.length}`,
  );
  const primaryResult = results[0];
  assert.equal(
    primaryResult.status,
    "success",
    `Expected primary repo result status 'success', got: ${JSON.stringify(primaryResult.status)}`,
  );
  assert.equal(
    primaryResult.pr_url,
    expectedPrUrl,
    `Expected pr_url '${expectedPrUrl}' in primary result, got: ${JSON.stringify(primaryResult.pr_url)}`,
  );
  assert.equal(
    primaryResult.has_changes,
    true,
    "Expected has_changes=true in primary result",
  );
});
