import assert from "node:assert/strict";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { GitActivityStore } from "../src/main/git-activity-store.js";
import { SessionLogTailer } from "../src/main/session-log-tailer.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix = "git-activity-tailer-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeStore(): GitActivityStore {
  const dir = makeTempDir("git-activity-tailer-store-");
  const store = new GitActivityStore({ cwd: dir, name: "test-store" });
  store.setEnabled(true);
  return store;
}

function makeTailer(store: GitActivityStore, claudeDir: string, codexDir: string) {
  return new SessionLogTailer({
    store,
    claudeProjectsDir: claudeDir,
    codexSessionsDir: codexDir,
    debounceMs: 50,
    initialScanDays: 365,
  });
}

async function waitForEvents(store: GitActivityStore, expected: number, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (store.list().length >= expected) {
      return;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("SessionLogTailer initial scan", () => {
  test("parses pre-existing files in claude dir within scan window", async () => {
    const claudeDir = makeTempDir("claude-");
    const codexDir = makeTempDir("codex-");
    const projectDir = path.join(claudeDir, "project-a");
    await fsp.mkdir(projectDir, { recursive: true });
    const sessionFile = path.join(projectDir, "abc-123.jsonl");
    const line = JSON.stringify({
      type: "tool_use",
      id: "u1",
      name: "Bash",
      input: { command: "gh pr create" },
    });
    const line2 = JSON.stringify({
      type: "tool_result",
      tool_use_id: "u1",
      content: "https://github.com/real-org/real-repo/pull/100",
    });
    await fsp.writeFile(sessionFile, `${line}\n${line2}\n`);

    const store = makeStore();
    const tailer = makeTailer(store, claudeDir, codexDir);
    await tailer.start();
    await tailer.flushForTesting();

    const events = store.list();
    assert.equal(events.length, 1);
    assert.equal(events[0].prNumber, 100);
    assert.equal(events[0].sourceClient, "claude-code");
    assert.equal(events[0].sourceSessionId, "abc-123");

    await tailer.stop();
  });

  test("does NOT scan files older than the initial scan window", async () => {
    const claudeDir = makeTempDir("claude-old-");
    const codexDir = makeTempDir("codex-old-");
    const projectDir = path.join(claudeDir, "project-old");
    await fsp.mkdir(projectDir, { recursive: true });
    const sessionFile = path.join(projectDir, "old-session.jsonl");
    const line = JSON.stringify({
      type: "tool_result",
      tool_use_id: "x",
      content: "https://github.com/real-org/real-repo/pull/999",
    });
    await fsp.writeFile(sessionFile, `${line}\n`);
    // Backdate the file by 90 days
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    await fsp.utimes(sessionFile, ninetyDaysAgo / 1000, ninetyDaysAgo / 1000);

    const store = makeStore();
    const tailer = new SessionLogTailer({
      store,
      claudeProjectsDir: claudeDir,
      codexSessionsDir: codexDir,
      debounceMs: 50,
      initialScanDays: 30, // window narrower than file age
    });
    await tailer.start();
    await tailer.flushForTesting();

    assert.equal(store.list().length, 0);
    await tailer.stop();
  });

  test("parses codex aggregated_output URLs from rollout files", async () => {
    const claudeDir = makeTempDir("claude-c-");
    const codexDir = makeTempDir("codex-c-");
    const sessionFile = path.join(codexDir, "rollout-abc.jsonl");
    const line = JSON.stringify({
      type: "exec_command_end",
      command: ["git", "push", "origin", "feature/x"],
      aggregated_output: "https://github.com/real-org/real-repo/pull/250",
    });
    await fsp.writeFile(sessionFile, `${line}\n`);

    const store = makeStore();
    const tailer = makeTailer(store, claudeDir, codexDir);
    await tailer.start();
    await tailer.flushForTesting();

    const events = store.list();
    assert.equal(events.length, 1);
    assert.equal(events[0].sourceClient, "codex");
    assert.equal(events[0].branchName, "feature/x");
    assert.equal(events[0].prNumber, 250);

    await tailer.stop();
  });

  test("captures closedloop-loop pr-link events in claude session files", async () => {
    const claudeDir = makeTempDir("claude-loop-");
    const codexDir = makeTempDir("codex-loop-");
    const projectDir = path.join(claudeDir, "project-loop");
    await fsp.mkdir(projectDir, { recursive: true });
    const sessionFile = path.join(projectDir, "loop-session.jsonl");
    const line = JSON.stringify({
      type: "pr-link",
      prUrl: "https://github.com/real-org/real-repo/pull/300",
      prNumber: 300,
      branchName: "feat/from-loop",
      commitSha: "deadbeef",
    });
    await fsp.writeFile(sessionFile, `${line}\n`);

    const store = makeStore();
    const tailer = makeTailer(store, claudeDir, codexDir);
    await tailer.start();
    await tailer.flushForTesting();

    const events = store.list();
    assert.equal(events.length, 1);
    assert.equal(events[0].sourceClient, "closedloop-loop");
    assert.equal(events[0].commitSha, "deadbeef");

    await tailer.stop();
  });
});

describe("SessionLogTailer incremental capture", () => {
  test("captures events appended after start() within debounce window", async () => {
    const claudeDir = makeTempDir("claude-incr-");
    const codexDir = makeTempDir("codex-incr-");
    const projectDir = path.join(claudeDir, "p");
    await fsp.mkdir(projectDir, { recursive: true });
    const sessionFile = path.join(projectDir, "live.jsonl");
    await fsp.writeFile(sessionFile, ""); // start empty

    const store = makeStore();
    const tailer = makeTailer(store, claudeDir, codexDir);
    await tailer.start();
    await tailer.flushForTesting();
    assert.equal(store.list().length, 0);

    // append a complete line
    const line = JSON.stringify({
      type: "tool_result",
      tool_use_id: "n/a",
      content: "https://github.com/real-org/real-repo/pull/77",
    });
    await fsp.appendFile(sessionFile, `${line}\n`);

    await waitForEvents(store, 1, 5000);
    assert.equal(store.list().length, 1);
    assert.equal(store.list()[0].prNumber, 77);

    await tailer.stop();
  });

  test("does not double-count when start() is called twice (idempotent)", async () => {
    const claudeDir = makeTempDir("claude-idem-");
    const codexDir = makeTempDir("codex-idem-");
    const projectDir = path.join(claudeDir, "p");
    await fsp.mkdir(projectDir, { recursive: true });
    const sessionFile = path.join(projectDir, "twice.jsonl");
    const line = JSON.stringify({
      type: "tool_result",
      tool_use_id: "n/a",
      content: "https://github.com/real-org/real-repo/pull/55",
    });
    await fsp.writeFile(sessionFile, `${line}\n`);

    const store = makeStore();
    const tailer = makeTailer(store, claudeDir, codexDir);
    await tailer.start();
    await tailer.start(); // second call is a no-op
    await tailer.flushForTesting();
    assert.equal(store.list().length, 1);

    await tailer.stop();
  });

  test("handles partial lines — does not consume bytes until newline arrives", async () => {
    const claudeDir = makeTempDir("claude-part-");
    const codexDir = makeTempDir("codex-part-");
    const projectDir = path.join(claudeDir, "p");
    await fsp.mkdir(projectDir, { recursive: true });
    const sessionFile = path.join(projectDir, "partial.jsonl");

    const fullLine = JSON.stringify({
      type: "tool_result",
      tool_use_id: "x",
      content: "https://github.com/real-org/real-repo/pull/88",
    });
    const half = fullLine.slice(0, Math.floor(fullLine.length / 2));

    const store = makeStore();
    const tailer = makeTailer(store, claudeDir, codexDir);
    await tailer.start();

    // write half a line, no newline
    await fsp.writeFile(sessionFile, half);
    await new Promise((r) => setTimeout(r, 200));
    await tailer.flushForTesting();
    assert.equal(store.list().length, 0, "must not parse partial lines");

    // now write the rest + newline
    await fsp.appendFile(sessionFile, fullLine.slice(half.length) + "\n");
    await waitForEvents(store, 1, 5000);
    assert.equal(store.list().length, 1);
    assert.equal(store.list()[0].prNumber, 88);

    await tailer.stop();
  });
});

describe("SessionLogTailer privacy (AC6)", () => {
  test("when store is disabled, fs.watch never produces stored events", async () => {
    const claudeDir = makeTempDir("claude-priv-");
    const codexDir = makeTempDir("codex-priv-");
    const projectDir = path.join(claudeDir, "p");
    await fsp.mkdir(projectDir, { recursive: true });
    const sessionFile = path.join(projectDir, "session.jsonl");
    const line = JSON.stringify({
      type: "tool_result",
      tool_use_id: "x",
      content: "https://github.com/real-org/real-repo/pull/1",
    });
    await fsp.writeFile(sessionFile, `${line}\n`);

    // Store is created but NOT enabled. Tailer is started anyway to prove that
    // even if the tailer is wrongly running, the store gates writes.
    const dir = makeTempDir("git-activity-tailer-store-");
    const store = new GitActivityStore({ cwd: dir, name: "test-store" });
    assert.equal(store.isEnabled(), false);

    const tailer = makeTailer(store, claudeDir, codexDir);
    await tailer.start();
    await tailer.flushForTesting();
    assert.equal(store.list().length, 0);

    await tailer.stop();
  });
});

describe("SessionLogTailer error tolerance", () => {
  test("missing watch root does not throw", async () => {
    const store = makeStore();
    const tailer = new SessionLogTailer({
      store,
      claudeProjectsDir: "/tmp/does-not-exist-xyz-abc-123",
      codexSessionsDir: "/tmp/also-does-not-exist-xyz-abc-456",
      debounceMs: 50,
      initialScanDays: 365,
    });
    // should resolve without throwing
    await tailer.start();
    await tailer.stop();
    assert.equal(store.list().length, 0);
  });

  test("malformed JSON lines are skipped, valid lines still parse", async () => {
    const claudeDir = makeTempDir("claude-bad-");
    const codexDir = makeTempDir("codex-bad-");
    const projectDir = path.join(claudeDir, "p");
    await fsp.mkdir(projectDir, { recursive: true });
    const sessionFile = path.join(projectDir, "mix.jsonl");
    const validLine = JSON.stringify({
      type: "tool_result",
      tool_use_id: "x",
      content: "https://github.com/real-org/real-repo/pull/11",
    });
    await fsp.writeFile(
      sessionFile,
      `not json at all\n{"broken: json\n${validLine}\n`,
    );

    const store = makeStore();
    const tailer = makeTailer(store, claudeDir, codexDir);
    await tailer.start();
    await tailer.flushForTesting();
    assert.equal(store.list().length, 1);
    assert.equal(store.list()[0].prNumber, 11);

    await tailer.stop();
  });
});
