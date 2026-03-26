/**
 * Integration tests for the EXECUTE loop command, specifically:
 *
 * T-5.1: No-changes paths
 *   - executeGitOperations returns null when git status --porcelain is empty
 *   - attemptLlmCommit returns null when claude exits 0 without writing execution-result.json
 *
 * T-5.2: Existing-PR paths
 *   - executeGitOperations returns existing PR URL when gh pr view succeeds (no gh pr create)
 *   - handleProcessCompletion returns PR URL from pre-written execution-result.json
 *     without calling executeGitOperations
 *
 * Tests go through the HTTP gateway, not direct function calls.
 * Fake binaries (run-loop.sh, claude, git, gh) are placed in a temp fake-bin/ dir
 * prepended to PATH. CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE=1 disables the
 * stream_formatter pipeline so the fake claude can emit simple output.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { DesktopGatewayServer } from "../src/server/server.js";
import { EMPTY_CAPABILITIES, PORT_PROBE_ORDER } from "../src/shared/contracts.js";

// ---------------------------------------------------------------------------
// Shared state and cleanup
// ---------------------------------------------------------------------------

const serversToClose: DesktopGatewayServer[] = [];
const mockServersToClose: http.Server[] = [];
const tempPathsToClean: string[] = [];

const originalSymphonyWorktreeParentDir = process.env.SYMPHONY_WORKTREE_PARENT_DIR;
const originalPath = process.env.PATH;
const originalHome = process.env.HOME;
const originalRawPipeline = process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE;

afterEach(async () => {
  if (originalSymphonyWorktreeParentDir === undefined) {
    delete process.env.SYMPHONY_WORKTREE_PARENT_DIR;
  } else {
    process.env.SYMPHONY_WORKTREE_PARENT_DIR = originalSymphonyWorktreeParentDir;
  }

  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }

  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  if (originalRawPipeline === undefined) {
    delete process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE;
  } else {
    process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = originalRawPipeline;
  }

  for (const server of serversToClose.splice(0)) {
    await server.stop();
  }

  for (const ms of mockServersToClose.splice(0)) {
    await new Promise<void>((resolve, reject) => {
      ms.close((err) => (err ? reject(err) : resolve()));
    });
  }

  for (const tempPath of tempPathsToClean.splice(0)) {
    await fs.rm(tempPath, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Shared test helpers — see test/helpers/mock-api-server.ts
import { initGitRepo, startMockApiServer } from "./helpers/mock-api-server.js";

/**
 * Create the fake plugin cache structure so findPluginScript("code", "run-loop.sh")
 * finds the provided script content.
 */
async function createFakeRunLoopScript(homeDir: string, scriptContent: string): Promise<string> {
  const scriptDir = path.join(
    homeDir,
    ".claude",
    "plugins",
    "cache",
    "closedloop-ai",
    "code",
    "1.0.0",
    "scripts"
  );
  await fs.mkdir(scriptDir, { recursive: true });
  const scriptPath = path.join(scriptDir, "run-loop.sh");
  await fs.writeFile(scriptPath, scriptContent, { mode: 0o755 });
  return scriptPath;
}

// ---------------------------------------------------------------------------
// Test 1: No-changes → executeGitOperations returns null (no PR URL in upload)
// ---------------------------------------------------------------------------

test("EXECUTE: no PR URL in upload when worktree has no changes (git status empty)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "execute-nochange-"));
  tempPathsToClean.push(tmpDir);

  // Use real git to initialise repo before we point HOME at tmpDir
  const repoPath = path.join(tmpDir, "repo-nochange");
  await initGitRepo(repoPath);

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  // Redirect HOME so getPluginCacheRoot() returns a path we control
  process.env.HOME = tmpDir;

  // fake run-loop.sh: exits 0 without making any changes
  await createFakeRunLoopScript(tmpDir, "#!/bin/sh\nexit 0\n");

  // fake-bin: claude that exits 0 without writing execution-result.json
  //   (simulates attemptLlmCommit finding no result file → returns null)
  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(
    path.join(fakeBin, "claude"),
    "#!/bin/sh\nexit 0\n",
    { mode: 0o755 }
  );

  // Disable stream_formatter pipeline — fake claude output is not a real stream
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "execute-nochange-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getApiOrigin: () => `http://127.0.0.1:${mock.port}`,
  });
  serversToClose.push(server);
  await server.start();

  const loopId = "00000000-0000-0000-0000-000000000100";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "EXECUTE",
        closedLoopAuthToken: "tok",
        artifacts: [],
        repo: { fullName: `nochange/${path.basename(repoPath)}`, branch: "main" },
      }),
    }
  );

  assert.equal(
    response.status,
    200,
    `Expected 200 but got ${response.status}: ${await response.text().catch(() => "")}`
  );

  // Wait for the upload call that signals process completion
  const uploadReq = await mock.waitForRequest("upload-artifacts");
  const uploadBody = JSON.parse(uploadReq.body) as {
    artifacts: {
      executionResult?: {
        pr_url?: string;
        has_changes?: boolean;
      };
    };
    metadata: Record<string, unknown>;
  };

  // No changes → no PR URL in execution result
  assert.equal(
    uploadBody.artifacts.executionResult?.pr_url,
    undefined,
    `Expected no pr_url when there are no changes, got: ${uploadBody.artifacts.executionResult?.pr_url}`
  );
  assert.equal(
    uploadBody.artifacts.executionResult?.has_changes,
    undefined,
    "Expected has_changes to be absent when there are no changes"
  );
});

// ---------------------------------------------------------------------------
// Test 2: Pre-written execution-result.json (LLM path) → PR URL without
//         calling executeGitOperations
// ---------------------------------------------------------------------------

test("EXECUTE: handleProcessCompletion reads pre-written execution-result.json and returns PR URL", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "execute-llmresult-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-llmresult");
  await initGitRepo(repoPath);

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;

  // fake run-loop.sh: exits 0 without making any changes
  // (attemptLlmCommit is called after this exits)
  await createFakeRunLoopScript(tmpDir, "#!/bin/sh\nexit 0\n");

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });

  // fake claude for attemptLlmCommit: writes a valid execution-result.json to $CLOSEDLOOP_WORKDIR
  // Then exits 0. attemptLlmCommit reads the file and returns the result.
  // Because execution-result.json is present and valid, executeGitOperations is never called.
  //
  // The worktree dir is the cwd when attemptLlmCommit spawns claude.
  // execution-result.json is expected at path.join(worktreeDir, "execution-result.json").
  const expectedPrUrl = "https://github.com/org/repo-llmresult/pull/77";
  const executionResultContent = JSON.stringify({
    prUrl: expectedPrUrl,
    prNumber: 77,
    branchName: "symphony/loop-test-branch",
    commitSha: "aabbccdd1122334455667788990011223344556677",
  });
  const claudeScript = [
    "#!/bin/sh",
    // Write execution-result.json relative to cwd (which is worktreeDir for attemptLlmCommit)
    `printf '%s' ${JSON.stringify(executionResultContent).replace(/'/g, String.raw`'\''`)} > execution-result.json`,
    "exit 0",
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "claude"), claudeScript, { mode: 0o755 });

  // fake git that stubs push (so executeGitOperations wouldn't fail if accidentally called)
  // We verify via upload payload that git ops were NOT needed.
  const fakeGitScript = [
    "#!/bin/sh",
    "if [ \"$1\" = push ]; then exit 0; fi",
    `exec /usr/bin/git "$@"`,
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });

  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "execute-llmresult-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getApiOrigin: () => `http://127.0.0.1:${mock.port}`,
  });
  serversToClose.push(server);
  await server.start();

  const loopId = "00000000-0000-0000-0000-000000000200";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "EXECUTE",
        closedLoopAuthToken: "tok",
        artifacts: [],
        repo: { fullName: `llmresult/${path.basename(repoPath)}`, branch: "main" },
      }),
    }
  );

  assert.equal(
    response.status,
    200,
    `Expected 200 but got ${response.status}: ${await response.text().catch(() => "")}`
  );

  // Wait for upload — signals process completion including attemptLlmCommit
  const uploadReq = await mock.waitForRequest("upload-artifacts");
  const uploadBody = JSON.parse(uploadReq.body) as {
    artifacts: {
      executionResult?: Record<string, unknown>;
    };
    metadata: Record<string, unknown>;
  };

  // The LLM wrote execution-result.json, so the PR URL should appear in the upload
  assert.equal(
    uploadBody.artifacts.executionResult?.pr_url,
    expectedPrUrl,
    `Expected pr_url=${expectedPrUrl} from pre-written execution-result.json, got: ${String(uploadBody.artifacts.executionResult?.pr_url)}`
  );
  assert.equal(
    uploadBody.artifacts.executionResult?.pr_number,
    77,
    "Expected pr_number=77 from pre-written execution-result.json"
  );
  assert.equal(
    uploadBody.artifacts.executionResult?.has_changes,
    true,
    "Expected has_changes=true when execution-result.json was written"
  );
});

// ---------------------------------------------------------------------------
// Test 3: Existing PR via gh pr view → no gh pr create called
// ---------------------------------------------------------------------------

test("EXECUTE: uses existing PR URL from gh pr view without calling gh pr create", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "execute-existingpr-"));
  tempPathsToClean.push(tmpDir);

  const repoPath = path.join(tmpDir, "repo-existingpr");
  await initGitRepo(repoPath);

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;

  // fake run-loop.sh: writes a file so the worktree has changes for git status
  await createFakeRunLoopScript(
    tmpDir,
    [
      "#!/bin/sh",
      // Write a file to create an uncommitted change
      "echo 'implement feature' > feature-output.txt",
      "exit 0",
    ].join("\n")
  );

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });

  // fake claude for attemptLlmCommit: exits 0 without writing execution-result.json
  // → attemptLlmCommit returns null → falls through to executeGitOperations
  await fs.writeFile(
    path.join(fakeBin, "claude"),
    "#!/bin/sh\nexit 0\n",
    { mode: 0o755 }
  );

  // Capture file to record whether gh pr create was called
  const captureFile = path.join(tmpDir, "gh-calls.txt");

  // fake gh: pr view returns existing PR JSON; pr create records a call and exits 1
  const fakeGhScript = [
    "#!/bin/sh",
    "if [ \"$1\" = pr ] && [ \"$2\" = view ]; then",
    "  printf '{\"url\":\"https://github.com/org/repo-existingpr/pull/42\",\"number\":42}\\n'",
    "  exit 0",
    "fi",
    "if [ \"$1\" = pr ] && [ \"$2\" = create ]; then",
    `  echo "gh pr create was called (should not happen)" >> ${JSON.stringify(captureFile)}`,
    "  exit 1",
    "fi",
    `exec /usr/bin/gh "$@" 2>/dev/null`,
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "gh"), fakeGhScript, { mode: 0o755 });

  // fake git: pass through all commands except push (stub push to avoid remote requirement)
  const fakeGitScript = [
    "#!/bin/sh",
    "if [ \"$1\" = push ]; then exit 0; fi",
    `exec /usr/bin/git "$@"`,
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "git"), fakeGitScript, { mode: 0o755 });

  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;
  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);

  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: PORT_PROBE_ORDER[0],
    fallbackPorts: PORT_PROBE_ORDER.slice(1),
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "execute-existingpr-machine",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getApiOrigin: () => `http://127.0.0.1:${mock.port}`,
  });
  serversToClose.push(server);
  await server.start();

  const loopId = "00000000-0000-0000-0000-000000000300";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/engineer/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: "EXECUTE",
        closedLoopAuthToken: "tok",
        artifacts: [],
        repo: { fullName: `existingpr/${path.basename(repoPath)}`, branch: "main" },
      }),
    }
  );

  assert.equal(
    response.status,
    200,
    `Expected 200 but got ${response.status}: ${await response.text().catch(() => "")}`
  );

  // Wait for upload — signals that git ops + PR lookup completed
  const uploadReq = await mock.waitForRequest("upload-artifacts");
  const uploadBody = JSON.parse(uploadReq.body) as {
    artifacts: {
      executionResult?: Record<string, unknown>;
    };
    metadata: Record<string, unknown>;
  };

  // Existing PR URL should appear in the execution result
  assert.equal(
    uploadBody.artifacts.executionResult?.pr_url,
    "https://github.com/org/repo-existingpr/pull/42",
    `Expected existing PR URL in pr_url, got: ${String(uploadBody.artifacts.executionResult?.pr_url)}`
  );
  assert.equal(
    uploadBody.artifacts.executionResult?.pr_number,
    42,
    "Expected pr_number=42 from gh pr view"
  );

  // gh pr create must NOT have been called
  const ghCalls = await fs.readFile(captureFile, "utf-8").catch(() => "");
  assert.equal(
    ghCalls.trim(),
    "",
    `gh pr create should not have been called, but capture file contains: ${ghCalls}`
  );
});
