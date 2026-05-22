import assert from "node:assert/strict";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, test } from "node:test";
import { GitActivityStore } from "../src/main/git-activity-store.js";
import { SessionLogTailer } from "../src/main/session-log-tailer.js";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "git-activity",
);
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix = "git-activity-tailer-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeStore(enabled = true): GitActivityStore {
  const store = new GitActivityStore({
    cwd: makeTempDir("git-activity-store-"),
    name: "test-store",
  });
  store.setEnabled(enabled);
  return store;
}

function makeTailer(store: GitActivityStore, claudeDir: string, codexDir: string) {
  return new SessionLogTailer({
    store,
    claudeProjectsDir: claudeDir,
    codexSessionsDir: codexDir,
    debounceMs: 50,
    initialScanDays: 3650,
  });
}

function copyFixture(name: string, destDir: string, destName = name): void {
  fs.copyFileSync(path.join(FIXTURES, name), path.join(destDir, destName));
}

async function waitForEvents(
  store: GitActivityStore,
  expected: number,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (store.list().length >= expected) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

const LOOP_LINE = (n: number, sess: string) =>
  JSON.stringify({
    type: "pr-link",
    sessionId: sess,
    prNumber: n,
    prUrl: `https://github.com/loopco/desktop/pull/${n}`,
    prRepository: "loopco/desktop",
    timestamp: "2026-05-20T00:00:00.000Z",
  });

describe("SessionLogTailer — initial scan over real-schema fixtures", () => {
  test("captures exactly the 7 expected events across all fixture files", async () => {
    const claudeDir = makeTempDir("claude-");
    const codexDir = makeTempDir("codex-");
    const projectDir = path.join(claudeDir, "project-a");
    await fsp.mkdir(projectDir, { recursive: true });
    copyFixture("claude-code-session.jsonl", projectDir);
    copyFixture("loop-pr-link.jsonl", projectDir);
    copyFixture("negatives.jsonl", projectDir);
    copyFixture("codex-session.jsonl", codexDir);

    const store = makeStore();
    const tailer = makeTailer(store, claudeDir, codexDir);
    await tailer.start();
    await tailer.flushForTesting();

    const events = store.list();
    assert.equal(events.length, 7, `got: ${events.map((e) => e.prUrl).join(", ")}`);

    const byClient: Record<string, number> = {};
    for (const e of events) byClient[e.harness] = (byClient[e.harness] ?? 0) + 1;
    assert.equal(byClient["claude-code"], 2);
    assert.equal(byClient["codex"], 2);
    assert.equal(byClient["closedloop-loop"], 3);

    await tailer.stop();
  });

  test("the negatives fixture alone yields zero captures", async () => {
    const claudeDir = makeTempDir("claude-neg-");
    const codexDir = makeTempDir("codex-neg-");
    copyFixture("negatives.jsonl", claudeDir);
    const store = makeStore();
    const tailer = makeTailer(store, claudeDir, codexDir);
    await tailer.start();
    await tailer.flushForTesting();
    assert.equal(store.list().length, 0);
    await tailer.stop();
  });

  test("skips files older than the initial-scan window", async () => {
    const claudeDir = makeTempDir("claude-old-");
    const codexDir = makeTempDir("codex-old-");
    copyFixture("loop-pr-link.jsonl", claudeDir);
    const old = Date.now() - 90 * 24 * 60 * 60 * 1000;
    await fsp.utimes(path.join(claudeDir, "loop-pr-link.jsonl"), old / 1000, old / 1000);

    const store = makeStore();
    const tailer = new SessionLogTailer({
      store,
      claudeProjectsDir: claudeDir,
      codexSessionsDir: codexDir,
      debounceMs: 50,
      initialScanDays: 30,
    });
    await tailer.start();
    await tailer.flushForTesting();
    assert.equal(store.list().length, 0);
    await tailer.stop();
  });
});

describe("SessionLogTailer — incremental capture", () => {
  test("captures a pr-link line appended after start()", async () => {
    const claudeDir = makeTempDir("claude-incr-");
    const codexDir = makeTempDir("codex-incr-");
    const file = path.join(claudeDir, "live.jsonl");
    await fsp.writeFile(file, "");

    const store = makeStore();
    const tailer = makeTailer(store, claudeDir, codexDir);
    await tailer.start();
    await tailer.flushForTesting();
    assert.equal(store.list().length, 0);

    await fsp.appendFile(file, LOOP_LINE(777, "live-001") + "\n");
    await waitForEvents(store, 1);
    assert.equal(store.list().length, 1);
    assert.equal(store.list()[0].prNumber, 777);
    await tailer.stop();
  });

  test("defers a partial line until its newline arrives", async () => {
    const claudeDir = makeTempDir("claude-part-");
    const codexDir = makeTempDir("codex-part-");
    const file = path.join(claudeDir, "partial.jsonl");
    const line = LOOP_LINE(888, "live-002");
    const half = line.slice(0, Math.floor(line.length / 2));

    const store = makeStore();
    const tailer = makeTailer(store, claudeDir, codexDir);
    await tailer.start();

    await fsp.writeFile(file, half);
    await new Promise((r) => setTimeout(r, 200));
    await tailer.flushForTesting();
    assert.equal(store.list().length, 0, "must not parse a partial line");

    await fsp.appendFile(file, line.slice(half.length) + "\n");
    await waitForEvents(store, 1);
    assert.equal(store.list().length, 1);
    assert.equal(store.list()[0].prNumber, 888);
    await tailer.stop();
  });

  test("double start() is idempotent — no double counting", async () => {
    const claudeDir = makeTempDir("claude-idem-");
    const codexDir = makeTempDir("codex-idem-");
    await fsp.writeFile(path.join(claudeDir, "s.jsonl"), LOOP_LINE(55, "live-003") + "\n");
    const store = makeStore();
    const tailer = makeTailer(store, claudeDir, codexDir);
    await tailer.start();
    await tailer.start();
    await tailer.flushForTesting();
    assert.equal(store.list().length, 1);
    await tailer.stop();
  });
});

describe("SessionLogTailer — privacy & resilience", () => {
  test("a disabled store records nothing even if the tailer runs (AC6)", async () => {
    const claudeDir = makeTempDir("claude-priv-");
    const codexDir = makeTempDir("codex-priv-");
    copyFixture("loop-pr-link.jsonl", claudeDir);
    const store = makeStore(false);
    assert.equal(store.isEnabled(), false);
    const tailer = makeTailer(store, claudeDir, codexDir);
    await tailer.start();
    await tailer.flushForTesting();
    assert.equal(store.list().length, 0);
    await tailer.stop();
  });

  test("missing watch roots do not throw", async () => {
    const store = makeStore();
    const tailer = new SessionLogTailer({
      store,
      claudeProjectsDir: "/tmp/fea1226-does-not-exist-aaa",
      codexSessionsDir: "/tmp/fea1226-does-not-exist-bbb",
      debounceMs: 50,
      initialScanDays: 3650,
    });
    await tailer.start();
    await tailer.stop();
    assert.equal(store.list().length, 0);
  });

  test("malformed JSON lines are skipped; valid lines still parse", async () => {
    const claudeDir = makeTempDir("claude-bad-");
    const codexDir = makeTempDir("codex-bad-");
    await fsp.writeFile(
      path.join(claudeDir, "mix.jsonl"),
      `not json at all\n{"broken\n${LOOP_LINE(11, "live-004")}\n`,
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
