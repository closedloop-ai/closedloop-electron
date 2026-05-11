/**
 * Spawn-env tests for run-loop.sh: verify the desktop propagates the
 * websocket-derived LoopCommand to the harness via CLOSEDLOOP_COMMAND so
 * loop.perf.* events and runs.log rows are attributed to the actual
 * slash-command (PLAN, EXECUTE, …), not the run-loop.sh "interactive" /
 * write_runs_log_entry "self_learning" / "plan_execute" fallbacks.
 *
 * Companion to PRD-254 §FR-1 / §FR-5 and the claude-plugins-side change
 * that gives env-var precedence over --prompt at run-loop.sh:1504.
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
  findFilePolling,
  makeFakeWorktreeProvider,
  makeMultiRepoGateway,
  makeMultiRepoTestHarness,
  startMockApiServer,
  waitForTerminalEvent,
} from "./symphony-test-utils.js";

const fakeWorktreeProvider = makeFakeWorktreeProvider(
  "symphony/closedloop-command-env-test",
);

const { serversToClose, mockServersToClose, tempPathsToClean, cleanup } =
  makeMultiRepoTestHarness();
afterEach(cleanup);

function createTestGateway(tmpDir: string, mockPort: number) {
  return makeMultiRepoGateway({
    tmpDir,
    mockPort,
    machineName: "closedloop-command-env-test",
    worktreeProvider: fakeWorktreeProvider,
    serversToClose,
  });
}

// ---------------------------------------------------------------------------
// Parameterized: each command that spawns run-loop.sh must propagate as
// CLOSEDLOOP_COMMAND with the canonical uppercase string value.
// ---------------------------------------------------------------------------

// Both run-loop.sh-spawning commands share the same spawnEnv construction
// site (apps/desktop/src/server/operations/symphony-loop.ts:6108), so PLAN
// is sufficient to verify the propagation mechanism. EXECUTE additionally
// requires a prompt-or-artifacts payload which is orthogonal to this test.
const RUN_LOOP_COMMANDS: ReadonlyArray<{
  enum: LoopCommand;
  expected: string;
  loopId: string;
}> = [
  {
    enum: LoopCommand.Plan,
    expected: "PLAN",
    loopId: "00000000-0000-4000-8000-000000007301",
  },
];

for (const { enum: cmd, expected, loopId } of RUN_LOOP_COMMANDS) {
  test(`${expected} loop propagates CLOSEDLOOP_COMMAND=${expected} to run-loop.sh`, async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `closedloop-command-env-${expected.toLowerCase()}-`),
    );
    tempPathsToClean.push(tmpDir);

    const primaryRepo = path.join(tmpDir, "primary-repo");
    await fs.mkdir(primaryRepo, { recursive: true });

    const worktreeParent = path.join(tmpDir, "worktrees");
    await fs.mkdir(worktreeParent, { recursive: true });

    process.env.HOME = tmpDir;
    process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
    process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

    // Fake script captures CLOSEDLOOP_COMMAND from its env into a file in
    // the workdir, so we can assert on the propagated value.
    await createFakeRunLoopScript(
      tmpDir,
      `#!/bin/sh\nprintf '%s' "$CLOSEDLOOP_COMMAND" > "$CLOSEDLOOP_WORKDIR/captured-env.txt"\nexit 0\n`,
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

    const response = await fetch(
      `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loopId,
          command: cmd,
          closedLoopAuthToken: "tok",
          artifacts: [],
          repo: {
            fullName: `cmdenv-test/${path.basename(primaryRepo)}`,
            branch: "main",
          },
        }),
      },
    );

    if (response.status !== 200) {
      const errorBody = await response.text();
      throw new Error(
        `POST /symphony/loop returned ${response.status}: ${errorBody}`,
      );
    }

    const terminalEvent = await waitForTerminalEvent(mock.requests, loopId);
    assert.equal(
      terminalEvent.type,
      "completed",
      `Expected terminal event 'completed', got '${terminalEvent.type}': ${JSON.stringify(terminalEvent)}`,
    );

    const capturedPath = await findFilePolling(tmpDir, "captured-env.txt");
    const captured = (await fs.readFile(capturedPath, "utf-8")).trim();
    assert.equal(
      captured,
      expected,
      `Expected CLOSEDLOOP_COMMAND="${expected}" in spawn env, got "${captured}". ` +
        `If empty, the desktop dropped the env var on the spawn site. If non-empty ` +
        `but wrong, the propagation is mis-mapped.`,
    );
  });
}

// ---------------------------------------------------------------------------
// DECOMPOSE — different spawn branch (raw-claude pipeline, not run-loop.sh).
// The spawnEnv is constructed at the same site (line 6110) for all branches,
// but a future per-command override would silently regress non-run-loop paths
// if PLAN were the only coverage. Codex round-2 finding.
// ---------------------------------------------------------------------------

test("DECOMPOSE loop propagates CLOSEDLOOP_COMMAND=DECOMPOSE to the raw-claude pipeline", async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "closedloop-command-env-decompose-"),
  );
  tempPathsToClean.push(tmpDir);

  const primaryRepo = path.join(tmpDir, "primary-repo");
  await fs.mkdir(primaryRepo, { recursive: true });
  const worktreeParent = path.join(tmpDir, "worktrees");
  await fs.mkdir(worktreeParent, { recursive: true });

  process.env.HOME = tmpDir;
  process.env.CLOSEDLOOP_SYMPHONY_TEST_RAW_CLAUDE_PIPELINE = "1";
  process.env.SYMPHONY_WORKTREE_PARENT_DIR = worktreeParent;

  // DECOMPOSE doesn't spawn run-loop.sh; it spawns the raw-claude pipeline
  // directly. The fake `claude` binary captures CLOSEDLOOP_COMMAND from its
  // env into a dedicated capture file outside the worktree (so it survives
  // cleanup and is locatable without scanning per-loop workdirs). The
  // pipeline pipes the prompt via stdin and expects a JSON `result` line on
  // stdout for completion.
  const captureFile = path.join(tmpDir, "captured-decompose-env.txt");
  const fakeBin = path.join(tmpDir, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  const spyScript = [
    "#!/bin/sh",
    `printf '%s' "$CLOSEDLOOP_COMMAND" > ${JSON.stringify(captureFile)}`,
    // Drain stdin so the pipeline doesn't SIGPIPE.
    "cat > /dev/null",
    `echo '{"type":"result"}'`,
    "exit 0",
  ].join("\n");
  await fs.writeFile(path.join(fakeBin, "claude"), spyScript, { mode: 0o755 });

  process.env.PATH = `${fakeBin}:/usr/bin:/bin`;
  setShellPathForTest();

  const mock = await startMockApiServer();
  mockServersToClose.push(mock.server);
  const server = await createTestGateway(tmpDir, mock.port);

  const loopId = "00000000-0000-4000-8000-000000007303";
  const response = await fetch(
    `http://127.0.0.1:${server.getActivePort()}/api/gateway/symphony/loop`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loopId,
        command: LoopCommand.Decompose,
        closedLoopAuthToken: "tok",
        artifacts: [
          {
            id: "art-prd-1",
            type: "prd",
            title: "Test PRD",
            content: "A small PRD for decomposition.",
          },
        ],
        prompt: "Decompose the PRD into features.",
        repo: {
          fullName: `cmdenv-test/${path.basename(primaryRepo)}`,
          branch: "main",
        },
      }),
    },
  );

  if (response.status !== 200) {
    const errorBody = await response.text();
    throw new Error(
      `POST /symphony/loop returned ${response.status}: ${errorBody}`,
    );
  }

  const terminalEvent = await waitForTerminalEvent(mock.requests, loopId);
  assert.equal(
    terminalEvent.type,
    "completed",
    `Expected terminal event 'completed', got '${terminalEvent.type}': ${JSON.stringify(terminalEvent)}`,
  );

  const captured = (await fs.readFile(captureFile, "utf-8")).trim();
  assert.equal(
    captured,
    "DECOMPOSE",
    `Expected CLOSEDLOOP_COMMAND="DECOMPOSE" in raw-claude pipeline env, got "${captured}". ` +
      `A non-run-loop spawn branch is dropping the env var.`,
  );
});
