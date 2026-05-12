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
import { gatewayLog } from "../src/main/gateway-logger.js";
import { setShellPathForTest } from "../src/server/shell-path.js";
import {
  createFakeRunLoopScript,
  findFilePolling,
  findFileRecursive,
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
// Test 2: PLAN with 2 additionalRepos — assert multi-repo env vars are set in
//         spawn env (CLOSEDLOOP_ADD_DIRS, CLOSEDLOOP_ADD_DIR_NAMES,
//         CLOSEDLOOP_REPO_MAP) using the captureEnv opt-in parameter.
// ---------------------------------------------------------------------------

test("PLAN with 2 additionalRepos propagates multi-repo env vars to run-loop.sh", async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "multi-repo-spawn-env-"),
  );
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

  // The fake script exits immediately; captureEnv injects the env-capture
  // lines that write multi-repo vars to spawn-env.txt before the body runs.
  await createFakeRunLoopScript(
    tmpDir,
    "#!/bin/sh\nexit 0\n",
    { captureEnv: true },
  );

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });

  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port);

  const loopId = "00000000-0000-0000-0000-000000007002";
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
          fullName: `spawn-env-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
        additionalRepos: [
          {
            fullName: "org/additional-repo-1",
            localRepoPath: additionalRepo1,
            branch: "main",
          },
          {
            fullName: "org/additional-repo-2",
            localRepoPath: additionalRepo2,
            branch: "main",
          },
        ],
      }),
    },
  );

  assert.equal(response.status, 200);

  const terminalEvent = await waitForTerminalEvent(mock.requests, loopId);
  assert.equal(
    terminalEvent.type,
    "completed",
    `Expected terminal event type 'completed', got '${terminalEvent.type}': ${JSON.stringify(terminalEvent)}`,
  );

  // T-1.1 sentinel suppressed: when CLOSEDLOOP_ADD_DIRS is correctly propagated
  // (happy path), the regression sentinel in symphony-loop.ts must NOT fire.
  // Assert no warn entries with "multi_repo_env_missing" were emitted.
  const sentinelEntries = gatewayLog
    .getEntries()
    .filter(
      (e) =>
        e.level === "warn" &&
        e.message.includes("multi_repo_env_missing"),
    );
  assert.equal(
    sentinelEntries.length,
    0,
    `Expected no 'multi_repo_env_missing' warn entries (T-1.1 correctly sets CLOSEDLOOP_ADD_DIRS); got ${sentinelEntries.length}: ${JSON.stringify(sentinelEntries)}`,
  );

  // Use findFilePolling to locate spawn-env.txt written by the captureEnv script.
  const spawnEnvFile = await findFilePolling(tmpDir, "spawn-env.txt", 20_000);
  const spawnEnv = await fs.readFile(spawnEnvFile, "utf-8");

  // (a) CLOSEDLOOP_ADD_DIRS must contain both peer worktree paths joined by `|`.
  // The exact paths are resolved by the server (they include a per-loop hash
  // disambiguator), so we verify structure: two `|`-separated segments each
  // starting under worktreeParent, rather than hardcoding the full paths.
  const addDirsMatch = spawnEnv.match(/^CLOSEDLOOP_ADD_DIRS=(.+)$/m);
  assert.ok(
    addDirsMatch,
    `Expected CLOSEDLOOP_ADD_DIRS in spawn-env.txt; got:\n${spawnEnv}`,
  );
  const addDirsParts = addDirsMatch![1].split("|");
  assert.equal(
    addDirsParts.length,
    2,
    `CLOSEDLOOP_ADD_DIRS must contain exactly 2 pipe-separated paths; got: ${addDirsMatch![1]}`,
  );
  for (const part of addDirsParts) {
    assert.ok(
      part.startsWith(worktreeParent),
      `CLOSEDLOOP_ADD_DIRS entry "${part}" must start with worktreeParent "${worktreeParent}"`,
    );
  }
  const [worktreePath1, worktreePath2] = addDirsParts;

  // (b) CLOSEDLOOP_ADD_DIR_NAMES must contain the short repo names (segment
  // after the last "/" in fullName), NOT the full "org/name" form.
  const addDirNamesMatch = spawnEnv.match(/^CLOSEDLOOP_ADD_DIR_NAMES=(.+)$/m);
  assert.ok(
    addDirNamesMatch,
    `Expected CLOSEDLOOP_ADD_DIR_NAMES in spawn-env.txt; got:\n${spawnEnv}`,
  );
  assert.equal(
    addDirNamesMatch![1],
    "additional-repo-1|additional-repo-2",
    `CLOSEDLOOP_ADD_DIR_NAMES must be short names joined by "|"; got: ${addDirNamesMatch![1]}`,
  );

  // (c) CLOSEDLOOP_REPO_MAP must contain "shortName:path" pairs (pipe-separated)
  // with short names as keys (not "org/name").
  const repoMapMatch = spawnEnv.match(/^CLOSEDLOOP_REPO_MAP=(.+)$/m);
  assert.ok(
    repoMapMatch,
    `Expected CLOSEDLOOP_REPO_MAP in spawn-env.txt; got:\n${spawnEnv}`,
  );
  const expectedRepoMap = `additional-repo-1:${worktreePath1}|additional-repo-2:${worktreePath2}`;
  assert.equal(
    repoMapMatch![1],
    expectedRepoMap,
    `CLOSEDLOOP_REPO_MAP must be "shortName:path" pairs joined by "|"; got: ${repoMapMatch![1]}`,
  );
});

// ---------------------------------------------------------------------------
// Test 3: PLAN with no additionalRepos — strict key absence in spawn env
//
// Asserts that when a single-repo PLAN request is dispatched (no additionalRepos),
// the multi-repo env vars (CLOSEDLOOP_ADD_DIRS, CLOSEDLOOP_ADD_DIR_NAMES,
// CLOSEDLOOP_REPO_MAP) are completely absent from the spawn environment —
// not set to empty strings. The contract is keys absent entirely.
//
// Strategy: use a custom capture script body that writes spawn-env.txt ONLY
// when CLOSEDLOOP_ADD_DIRS is non-empty. For single-repo requests the file
// will not be created. We then assert via findFileRecursive that no
// spawn-env.txt exists under tmpDir and therefore the key is absent.
// ---------------------------------------------------------------------------

test("PLAN with no additionalRepos: CLOSEDLOOP_ADD_DIRS is absent from spawn env (not merely empty)", async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "multi-repo-spawn-single-repo-"),
  );
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  // Custom script body: write spawn-env.txt ONLY when CLOSEDLOOP_ADD_DIRS is
  // non-empty. For a single-repo PLAN (no additionalRepos) the var must be
  // absent from the spawned environment, so the file must NOT be created.
  // Using captureEnv: true is intentionally avoided here because that helper
  // writes `KEY=` (empty value) unconditionally, which would mask key absence.
  const captureEnvScript = [
    "#!/bin/sh",
    `if [ -n "$CLOSEDLOOP_ADD_DIRS" ]; then`,
    `  mkdir -p "$CLOSEDLOOP_WORKDIR" 2>/dev/null`,
    `  printf 'CLOSEDLOOP_ADD_DIRS=%s\\n' "$CLOSEDLOOP_ADD_DIRS" >> "$CLOSEDLOOP_WORKDIR/spawn-env.txt"`,
    `  printf 'CLOSEDLOOP_ADD_DIR_NAMES=%s\\n' "$CLOSEDLOOP_ADD_DIR_NAMES" >> "$CLOSEDLOOP_WORKDIR/spawn-env.txt"`,
    `  printf 'CLOSEDLOOP_REPO_MAP=%s\\n' "$CLOSEDLOOP_REPO_MAP" >> "$CLOSEDLOOP_WORKDIR/spawn-env.txt"`,
    `fi`,
    "exit 0",
  ].join("\n") + "\n";

  await createFakeRunLoopScript(tmpDir, captureEnvScript);

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });

  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port);

  const loopId = "00000000-0000-0000-0000-000000007003";
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
        // No additionalRepos — single-repo PLAN
      }),
    },
  );

  assert.equal(response.status, 200);

  const terminalEvent = await waitForTerminalEvent(mock.requests, loopId);
  assert.equal(
    terminalEvent.type,
    "completed",
    `Expected terminal event type 'completed', got '${terminalEvent.type}': ${JSON.stringify(terminalEvent)}`,
  );

  // Assert strict key absence: spawn-env.txt must not exist (meaning
  // CLOSEDLOOP_ADD_DIRS was absent from the spawn environment, not merely empty).
  const spawnEnvFile = await findFileRecursive(tmpDir, "spawn-env.txt");
  if (spawnEnvFile !== null) {
    const spawnEnv = await fs.readFile(spawnEnvFile, "utf-8");
    assert.ok(
      !spawnEnv.includes("CLOSEDLOOP_ADD_DIRS"),
      `Expected CLOSEDLOOP_ADD_DIRS to be absent from spawn-env.txt for single-repo PLAN, but found it in:\n${spawnEnv}`,
    );
  }
  // If spawnEnvFile is null the file was never written — key is absent, test passes.
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
    // Env vars file: captures CLOSEDLOOP_ADD_DIRS, CLOSEDLOOP_ADD_DIR_NAMES,
    // and CLOSEDLOOP_REPO_MAP in the same KEY=value line format used by the
    // PLAN captureEnv helper, allowing the same assertion logic to apply here.
    const envFile = path.join(tmpDir, `capture-env-${command}.txt`);

    const fakeBin = path.join(tmpDir, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });
    // Read the prompt from stdin (the pipeline pipes via < $promptFile),
    // capture argv + prompt + the peer manifest + multi-repo env vars, then
    // output a JSON line so the pipeline grep/tee step succeeds.
    const spyScript = [
      "#!/bin/sh",
      `cat > ${JSON.stringify(promptFile)}`,
      `printf '%s' "$*" > ${JSON.stringify(argvFile)}`,
      `if [ -f .closedloop-ai/context/peer-repos.json ]; then`,
      `  cp .closedloop-ai/context/peer-repos.json ${JSON.stringify(manifestFile)}`,
      `fi`,
      `printf 'CLOSEDLOOP_ADD_DIRS=%s\\n' "$CLOSEDLOOP_ADD_DIRS" >> ${JSON.stringify(envFile)}`,
      `printf 'CLOSEDLOOP_ADD_DIR_NAMES=%s\\n' "$CLOSEDLOOP_ADD_DIR_NAMES" >> ${JSON.stringify(envFile)}`,
      `printf 'CLOSEDLOOP_REPO_MAP=%s\\n' "$CLOSEDLOOP_REPO_MAP" >> ${JSON.stringify(envFile)}`,
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

    // Multi-repo env vars: the PRD path spawns via buildClaudePipeline and
    // receives the same spawnEnv as run-loop.sh, so CLOSEDLOOP_ADD_DIRS,
    // CLOSEDLOOP_ADD_DIR_NAMES, and CLOSEDLOOP_REPO_MAP must be present and
    // contain the correct values.
    const prdEnv = await fs.readFile(envFile, "utf-8");

    // (a) CLOSEDLOOP_ADD_DIRS: two pipe-separated worktree paths, both under
    // worktreeParent. Extract and reuse for the REPO_MAP check below.
    const prdAddDirsMatch = prdEnv.match(/^CLOSEDLOOP_ADD_DIRS=(.+)$/m);
    assert.ok(
      prdAddDirsMatch,
      `${command}: expected CLOSEDLOOP_ADD_DIRS in captured env; got:\n${prdEnv}`,
    );
    const prdAddDirsParts = prdAddDirsMatch![1].split("|");
    assert.equal(
      prdAddDirsParts.length,
      2,
      `${command}: CLOSEDLOOP_ADD_DIRS must contain exactly 2 pipe-separated paths; got: ${prdAddDirsMatch![1]}`,
    );
    for (const part of prdAddDirsParts) {
      assert.ok(
        part.startsWith(worktreeParent),
        `${command}: CLOSEDLOOP_ADD_DIRS entry "${part}" must start with worktreeParent "${worktreeParent}"`,
      );
    }
    const [prdWorktreePath1, prdWorktreePath2] = prdAddDirsParts;

    // (b) CLOSEDLOOP_ADD_DIR_NAMES: short names only (segment after last "/" in
    // fullName), NOT the full "org/name" form.
    const prdAddDirNamesMatch = prdEnv.match(/^CLOSEDLOOP_ADD_DIR_NAMES=(.+)$/m);
    assert.ok(
      prdAddDirNamesMatch,
      `${command}: expected CLOSEDLOOP_ADD_DIR_NAMES in captured env; got:\n${prdEnv}`,
    );
    assert.equal(
      prdAddDirNamesMatch![1],
      "peer-1|peer-2",
      `${command}: CLOSEDLOOP_ADD_DIR_NAMES must be short names joined by "|"; got: ${prdAddDirNamesMatch![1]}`,
    );

    // (c) CLOSEDLOOP_REPO_MAP: "shortName:path" pairs (pipe-separated).
    const prdRepoMapMatch = prdEnv.match(/^CLOSEDLOOP_REPO_MAP=(.+)$/m);
    assert.ok(
      prdRepoMapMatch,
      `${command}: expected CLOSEDLOOP_REPO_MAP in captured env; got:\n${prdEnv}`,
    );
    const expectedPrdRepoMap = `peer-1:${prdWorktreePath1}|peer-2:${prdWorktreePath2}`;
    assert.equal(
      prdRepoMapMatch![1],
      expectedPrdRepoMap,
      `${command}: CLOSEDLOOP_REPO_MAP must be "shortName:path" pairs joined by "|"; got: ${prdRepoMapMatch![1]}`,
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

// ---------------------------------------------------------------------------
// Sanitized short name: pipe character replaced with underscore
//
// Tests that sanitizedShortName (exercised via buildPeerEnvVars) replaces "|"
// with "_" in the segment after the last "/" in fullName. This guards the pipe
// delimiter invariant used by CLOSEDLOOP_ADD_DIRS, CLOSEDLOOP_ADD_DIR_NAMES,
// and CLOSEDLOOP_REPO_MAP: a literal pipe inside a short name would corrupt
// the delimited format that consumers split on "|".
//
// Strategy: submit a PLAN request with a single additionalRepo whose fullName
// contains a pipe ("org/repo|name"). The captureEnv script writes
// CLOSEDLOOP_ADD_DIR_NAMES to spawn-env.txt; we assert the value is
// "repo_name" (pipe replaced with underscore, segment after the "/").
// ---------------------------------------------------------------------------

test("Pipe character in fullName sanitized: CLOSEDLOOP_ADD_DIR_NAMES contains repo_name", async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "multi-repo-spawn-pipe-sanitize-"),
  );
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  // The additional repo dir must exist so resolveAdditionalRepos can stat it.
  const additionalRepo = path.join(tmpDir, "additional-repo-pipe");
  await fs.mkdir(additionalRepo, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  await createFakeRunLoopScript(
    tmpDir,
    "#!/bin/sh\nexit 0\n",
    { captureEnv: true },
  );

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });

  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port);

  const loopId = "00000000-0000-0000-0000-000000007004";
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
          {
            // Pipe in the segment after "/": sanitizedShortName must replace
            // "|" with "_" to preserve the "|" delimiter invariant.
            fullName: "org/repo|name",
            localRepoPath: additionalRepo,
            branch: "main",
          },
        ],
      }),
    },
  );

  assert.equal(response.status, 200);

  const terminalEvent = await waitForTerminalEvent(mock.requests, loopId);
  assert.equal(
    terminalEvent.type,
    "completed",
    `Expected terminal event type 'completed', got '${terminalEvent.type}': ${JSON.stringify(terminalEvent)}`,
  );

  const spawnEnvFile = await findFilePolling(tmpDir, "spawn-env.txt", 20_000);
  const spawnEnv = await fs.readFile(spawnEnvFile, "utf-8");

  const addDirNamesMatch = spawnEnv.match(/^CLOSEDLOOP_ADD_DIR_NAMES=(.+)$/m);
  assert.ok(
    addDirNamesMatch,
    `Expected CLOSEDLOOP_ADD_DIR_NAMES in spawn-env.txt; got:\n${spawnEnv}`,
  );
  assert.equal(
    addDirNamesMatch![1],
    "repo_name",
    `Expected pipe in fullName segment to be replaced with "_"; got: ${addDirNamesMatch![1]}`,
  );
});

// ---------------------------------------------------------------------------
// Sanitized short name: fullName without org prefix uses name as-is
//
// Tests that sanitizedShortName returns the full string unchanged when the
// fullName contains no "/" (i.e., there is no org prefix to strip). The
// short name derivation must not truncate or alter the bare repo name.
//
// Strategy: submit a PLAN request with a single additionalRepo whose fullName
// is "standalone-repo" (no "/"). The captureEnv script writes
// CLOSEDLOOP_ADD_DIR_NAMES to spawn-env.txt; we assert the value is exactly
// "standalone-repo".
// ---------------------------------------------------------------------------

test("fullName without org prefix uses name as-is: CLOSEDLOOP_ADD_DIR_NAMES contains standalone-repo", async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "multi-repo-spawn-standalone-"),
  );
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });

  const additionalRepo = path.join(tmpDir, "additional-repo-standalone");
  await fs.mkdir(additionalRepo, { recursive: true });

  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  await createFakeRunLoopScript(
    tmpDir,
    "#!/bin/sh\nexit 0\n",
    { captureEnv: true },
  );

  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(fakeBin, "claude"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });

  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port);

  const loopId = "00000000-0000-0000-0000-000000007005";
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
          {
            // No "/" in fullName: sanitizedShortName must return it unchanged.
            fullName: "standalone-repo",
            localRepoPath: additionalRepo,
            branch: "main",
          },
        ],
      }),
    },
  );

  assert.equal(response.status, 200);

  const terminalEvent = await waitForTerminalEvent(mock.requests, loopId);
  assert.equal(
    terminalEvent.type,
    "completed",
    `Expected terminal event type 'completed', got '${terminalEvent.type}': ${JSON.stringify(terminalEvent)}`,
  );

  const spawnEnvFile = await findFilePolling(tmpDir, "spawn-env.txt", 20_000);
  const spawnEnv = await fs.readFile(spawnEnvFile, "utf-8");

  const addDirNamesMatch = spawnEnv.match(/^CLOSEDLOOP_ADD_DIR_NAMES=(.+)$/m);
  assert.ok(
    addDirNamesMatch,
    `Expected CLOSEDLOOP_ADD_DIR_NAMES in spawn-env.txt; got:\n${spawnEnv}`,
  );
  assert.equal(
    addDirNamesMatch![1],
    "standalone-repo",
    `Expected bare fullName (no "/") to be used as-is; got: ${addDirNamesMatch![1]}`,
  );
});
