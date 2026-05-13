/**
 * Spawn tests for multi-repo PLAN requests: verify that run-loop.sh
 * receives the correct --add-dir arguments when additionalRepos are provided.
 *
 * T-7.2: Add spawn tests in apps/desktop/test/symphony-loop-multi-repo-spawn.test.ts
 *
 * Test cases:
 * 1. PLAN with 2 additionalRepos — assert args contain --add-dir <worktreeDir1>
 *    and --add-dir <worktreeDir2>
 *
 * Strategy: the fake run-loop.sh script writes its arguments to
 * $CLOSEDLOOP_WORKDIR/spawn-args.txt. After waitForTerminalEvent, we search
 * for spawn-args.txt under the tmpDir and assert on the presence or absence of
 * --add-dir args.
 */

import { LoopCommand } from "@closedloop-ai/loops-api/commands";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { setShellPathForTest } from "../src/server/shell-path.js";
import {
  createFakeRunLoopScript,
  findSpawnArgsFile,
  makeFakeWorktreeProvider,
  makeMultiRepoGateway,
  makeMultiRepoTestHarness,
  PRD_PEER_COMMANDS,
  startMockApiServer,
  waitForTerminalEvent,
} from "./symphony-test-utils.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const fakeWorktreeProvider = makeFakeWorktreeProvider("symphony/multi-repo-spawn-test");

const { serversToClose, mockServersToClose, tempPathsToClean, cleanup } =
  makeMultiRepoTestHarness();
afterEach(cleanup);

/** Create a gateway server with a mock API backend and the worktreeProvider. */
function createTestGateway(tmpDir: string, mockPort: number) {
  return makeMultiRepoGateway({
    tmpDir,
    mockPort,
    machineName: "multi-repo-spawn-test",
    worktreeProvider: fakeWorktreeProvider,
    serversToClose,
  });
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
    `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: LoopCommand.Plan,
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

  // Wait for the terminal event; assert it is "completed" so an unexpected
  // "error" event surfaces immediately with its payload rather than an
  // opaque 20s timeout.
  const terminalEvent = await waitForTerminalEvent(mock.requests, loopId);
  assert.equal(
    terminalEvent.type,
    "completed",
    `Expected terminal event type 'completed', got '${terminalEvent.type}': ${JSON.stringify(terminalEvent)}`,
  );

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
// PRD spawn matrix: --add-dir, peer-repos.json, and "## Mounted paths" footer
//
// GENERATE_PRD and REQUEST_PRD_CHANGES go through the direct-claude pipeline
// (buildClaudePipeline), not run-loop.sh. We use a fake claude binary that
// captures argv + the contents of the prompt file + peer-repos.json. The
// captured data lets us assert all three peer-wiring outputs at once.
// ---------------------------------------------------------------------------

for (const command of PRD_PEER_COMMANDS) {
  test(`${command} with 2 peers: --add-dir x2, peer-repos.json, and ## Mounted paths footer`, async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `multi-repo-prd-spawn-${command.toLowerCase()}-`),
    );
    tempPathsToClean.push(tmpDir);

    const primaryRepo = path.join(tmpDir, "primary-repo");
    await fs.mkdir(primaryRepo, { recursive: true });
    const peer1 = path.join(tmpDir, "peer-1");
    await fs.mkdir(peer1, { recursive: true });
    const peer2 = path.join(tmpDir, "peer-2");
    await fs.mkdir(peer2, { recursive: true });

    const worktreeParent = path.join(tmpDir, "worktrees");
    await fs.mkdir(worktreeParent, { recursive: true });

    process.env.HOME = tmpDir;
    process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
    process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

    // Dedicated capture files (outside the worktree so they survive cleanup).
    // Multi-line values like the pretty-printed peer-repos.json manifest and
    // the prompt + Mounted-paths footer cannot fit a line-oriented "KEY=value"
    // format — write each to its own file so the test can read them as-is.
    const argvFile = path.join(tmpDir, `capture-argv-${command}.txt`);
    const promptFile = path.join(tmpDir, `capture-prompt-${command}.txt`);
    const manifestFile = path.join(tmpDir, `capture-manifest-${command}.json`);

    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });
    // Read the prompt from stdin (the pipeline pipes via < $promptFile),
    // capture argv + prompt + the peer manifest, then output a JSON line so
    // the pipeline grep/tee step succeeds.
    const spyScript = [
      "#!/bin/sh",
      `cat > ${JSON.stringify(promptFile)}`,
      `printf '%s' "$*" > ${JSON.stringify(argvFile)}`,
      `if [ -f .closedloop-ai/context/peer-repos.json ]; then`,
      `  cp .closedloop-ai/context/peer-repos.json ${JSON.stringify(manifestFile)}`,
      `fi`,
      `echo '{"type":"result"}'`,
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "claude"), spyScript, { mode: 0o755 });

    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
    setShellPathForTest();

    const mock = await startMockApiServer();
    mockServersToClose.push(mock.server);
    const server = await createTestGateway(tmpDir, mock.port);

    const loopId =
      command === LoopCommand.GeneratePrd
        ? "00000000-0000-0000-0000-000000007101"
        : "00000000-0000-0000-0000-000000007102";

    const response = await fetch(
      `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loopId,
          command,
          closedLoopAuthToken: "tok",
          artifacts:
            command === LoopCommand.RequestPrdChanges
              ? [
                  {
                    id: "art-1",
                    type: "prd",
                    title: "Existing PRD",
                    content: "PRD body",
                  },
                ]
              : [],
          prompt: "Generate / amend the PRD",
          repo: {
            fullName: `prd-spawn/${path.basename(primaryRepo)}`,
            branch: "main",
          },
          additionalRepos: [
            { fullName: "org/peer-1", localRepoPath: peer1, branch: "main" },
            {
              fullName: "org/peer-2",
              localRepoPath: peer2,
              branch: "develop",
            },
          ],
        }),
      },
    );

    assert.equal(
      response.status,
      200,
      `Expected 200, got ${response.status}: ${await response.text().catch(() => "")}`,
    );

    const terminalEvent = await waitForTerminalEvent(mock.requests, loopId);
    assert.equal(
      terminalEvent.type,
      "completed",
      `Expected completed, got '${terminalEvent.type}': ${JSON.stringify(terminalEvent)}`,
    );

    // AC-001: --add-dir for each peer; the worktree dirs live under worktreeParent.
    const argv = await fs.readFile(argvFile, "utf-8");
    const addDirCount = (argv.match(/--add-dir/g) ?? []).length;
    assert.equal(
      addDirCount,
      2,
      `${command}: expected exactly 2 --add-dir flags, got ${addDirCount} in: ${argv}`,
    );
    assert.ok(
      argv.includes("--output-format stream-json"),
      `${command}: argv must retain --output-format stream-json; got: ${argv}`,
    );
    assert.ok(
      !argv.includes("Generate / amend the PRD"),
      `${command}: prompt text must stay off argv; got: ${argv}`,
    );

    // peer-repos.json: written by writeArtifactsForGeneratePrd, must enumerate
    // both peers with fullName + branch + localPath matching the worktree dirs.
    // Read the file as-is — it's pretty-printed JSON written by JSON.stringify(_, null, 2).
    const manifestRaw = await fs.readFile(manifestFile, "utf-8").catch(() => {
      throw new Error(`${command}: peer-repos.json must exist in context dir`);
    });
    const manifest = JSON.parse(manifestRaw) as {
      peers: Array<{ fullName: string; branch: string; localPath: string }>;
    };
    assert.equal(
      manifest.peers.length,
      2,
      `${command}: peer-repos.json must list 2 peers; got ${manifest.peers.length}`,
    );
    const peerNames = manifest.peers.map((p) => p.fullName).sort();
    assert.deepEqual(peerNames, ["org/peer-1", "org/peer-2"]);

    // AC-001 + AC-002: the prompt text piped to the spawn includes a
    // "## Mounted paths" footer enumerating each peer with its branch + path.
    // The prompt is multi-line (footer adds \n\n## Mounted paths\n\n…), so we
    // read the captured stdin as-is rather than line-parsing it.
    const prompt = await fs.readFile(promptFile, "utf-8");
    assert.ok(
      prompt.includes("## Mounted paths"),
      `${command}: prompt must contain Mounted paths footer; got: ${prompt}`,
    );
    assert.ok(
      prompt.includes("org/peer-1"),
      `${command}: footer must list peer-1 fullName`,
    );
    assert.ok(
      prompt.includes("develop"),
      `${command}: footer must list peer-2 branch 'develop'`,
    );
  });

  test(`${command} with zero peers: no --add-dir, no peer-repos.json, no footer`, async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `multi-repo-prd-spawn-empty-${command.toLowerCase()}-`),
    );
    tempPathsToClean.push(tmpDir);

    const primaryRepo = path.join(tmpDir, "primary-repo");
    await fs.mkdir(primaryRepo, { recursive: true });
    const worktreeParent = path.join(tmpDir, "worktrees");
    await fs.mkdir(worktreeParent, { recursive: true });

    process.env.HOME = tmpDir;
    process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
    process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

    const argvFile = path.join(tmpDir, `capture-empty-argv-${command}.txt`);
    const promptFile = path.join(tmpDir, `capture-empty-prompt-${command}.txt`);
    const manifestFlagFile = path.join(
      tmpDir,
      `capture-empty-manifest-flag-${command}.txt`,
    );
    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });
    const spyScript = [
      "#!/bin/sh",
      `cat > ${JSON.stringify(promptFile)}`,
      `printf '%s' "$*" > ${JSON.stringify(argvFile)}`,
      `if [ -f .closedloop-ai/context/peer-repos.json ]; then`,
      `  printf yes > ${JSON.stringify(manifestFlagFile)}`,
      `else`,
      `  printf no > ${JSON.stringify(manifestFlagFile)}`,
      `fi`,
      `echo '{"type":"result"}'`,
      "exit 0",
    ].join("\n");
    await fs.writeFile(path.join(fakeBin, "claude"), spyScript, { mode: 0o755 });

    process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
    setShellPathForTest();

    const mock = await startMockApiServer();
    mockServersToClose.push(mock.server);
    const server = await createTestGateway(tmpDir, mock.port);

    const loopId =
      command === LoopCommand.GeneratePrd
        ? "00000000-0000-0000-0000-000000007201"
        : "00000000-0000-0000-0000-000000007202";

    const response = await fetch(
      `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loopId,
          command,
          closedLoopAuthToken: "tok",
          artifacts:
            command === LoopCommand.RequestPrdChanges
              ? [
                  {
                    id: "art-1",
                    type: "prd",
                    title: "Existing PRD",
                    content: "PRD body",
                  },
                ]
              : [],
          prompt: "No peers",
          repo: {
            fullName: `prd-spawn/${path.basename(primaryRepo)}`,
            branch: "main",
          },
        }),
      },
    );

    assert.equal(response.status, 200);
    await waitForTerminalEvent(mock.requests, loopId);

    const argv = await fs.readFile(argvFile, "utf-8");
    assert.ok(
      !argv.includes("--add-dir"),
      `${command}: zero peers must not emit --add-dir; got: ${argv}`,
    );
    assert.ok(
      argv.includes("--output-format stream-json"),
      `${command}: argv must retain --output-format stream-json; got: ${argv}`,
    );
    assert.ok(
      !argv.includes("No peers"),
      `${command}: prompt text must stay off argv; got: ${argv}`,
    );
    const manifestFlag = await fs.readFile(manifestFlagFile, "utf-8");
    assert.equal(
      manifestFlag,
      "no",
      `${command}: peer-repos.json must be absent when no peers supplied`,
    );
    const prompt = await fs.readFile(promptFile, "utf-8");
    assert.ok(
      !prompt.includes("## Mounted paths"),
      `${command}: zero peers must not emit Mounted paths footer; got: ${prompt}`,
    );
  });
}
