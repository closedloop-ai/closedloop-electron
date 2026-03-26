/**
 * Tests for split-root migration findings:
 * - symphony-utils.ts cpSync destination-precedence merge (settings.local.json)
 * - symphony-loop.ts SIGTERM/SIGKILL for legacy jobs (dead PID variant)
 * - learnings.ts legacy pending migration (directory resolution)
 *
 * All tests are CI-compatible: mkdtempSync for temp dirs, no real process
 * signals (only dead PID checks), node:test (not vitest).
 */
import assert from "node:assert/strict";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  findFirstExisting,
  isProcessRunning,
  migrateWorkDirIfNeeded,
} from "../src/server/operations/symphony-utils.js";

const tempPaths: string[] = [];

afterEach(() => {
  for (const p of tempPaths.splice(0)) {
    rmSync(p, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "split-root-mig-test-"));
  tempPaths.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Inline re-implementations of the private worktree state save/restore logic
// from symphony-utils.ts (addWorktree helper functions).
// ---------------------------------------------------------------------------

type SavedWorktreeState = {
  savedClaudeDir: string | null;
  savedClosedloopDir: string | null;
};

function saveWorktreeState(
  worktreeDir: string,
  scratchDir: string
): SavedWorktreeState {
  const claudeDir = path.join(worktreeDir, ".claude");
  const closedloopDir = path.join(worktreeDir, ".closedloop-ai");
  const ts = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  let savedClaudeDir: string | null = null;
  if (existsSync(claudeDir)) {
    savedClaudeDir = path.join(scratchDir, `saved-claude-${ts}`);
    renameSync(claudeDir, savedClaudeDir);
  }

  let savedClosedloopDir: string | null = null;
  if (existsSync(closedloopDir)) {
    savedClosedloopDir = path.join(scratchDir, `saved-closedloop-${ts}`);
    renameSync(closedloopDir, savedClosedloopDir);
  }

  return { savedClaudeDir, savedClosedloopDir };
}

function restoreWorktreeState(
  saved: SavedWorktreeState,
  worktreeDir: string
): void {
  const { savedClaudeDir, savedClosedloopDir } = saved;

  if (savedClaudeDir) {
    const destClaude = path.join(worktreeDir, ".claude");
    if (!existsSync(destClaude)) {
      renameSync(savedClaudeDir, destClaude);
    } else {
      // Destination-precedence merge: only restore children absent in destination
      for (const child of readdirSync(savedClaudeDir)) {
        const savedChild = path.join(savedClaudeDir, child);
        const destChild = path.join(destClaude, child);
        if (!existsSync(destChild)) {
          const st = statSync(savedChild);
          if (st.isDirectory()) {
            cpSync(savedChild, destChild, { recursive: true });
          } else {
            copyFileSync(savedChild, destChild);
          }
        }
      }
      rmSync(savedClaudeDir, { recursive: true, force: true });
    }
  }

  if (savedClosedloopDir) {
    const destClosedloop = path.join(worktreeDir, ".closedloop-ai");
    mkdirSync(destClosedloop, { recursive: true });
    cpSync(savedClosedloopDir, destClosedloop, { recursive: true });
    rmSync(savedClosedloopDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// symphony-utils.ts cpSync destination-precedence merge
// ---------------------------------------------------------------------------

describe("symphony-utils cpSync destination-precedence merge", () => {
  test("saved settings.local.json restored when .claude/ already has git-tracked settings.json", () => {
    const dir = makeTempDir();

    // Pre-existing worktree has settings.local.json (user-local) and settings.json
    const claudeDir = path.join(dir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      path.join(claudeDir, "settings.local.json"),
      JSON.stringify({ local: true })
    );
    writeFileSync(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({ old: true })
    );

    // Save state
    const saved = saveWorktreeState(dir, dir);
    assert.ok(saved.savedClaudeDir !== null);
    assert.ok(!existsSync(claudeDir));

    // Simulate git worktree add: recreates .claude/ with a new settings.json
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({ tracked: "new" })
    );

    // Restore
    restoreWorktreeState(saved, dir);

    // settings.local.json was absent in the fresh checkout -> restored
    assert.ok(
      existsSync(path.join(claudeDir, "settings.local.json")),
      "settings.local.json should be restored"
    );
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(claudeDir, "settings.local.json"), "utf-8")),
      { local: true }
    );

    // settings.json already existed in destination -> NOT overwritten
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(claudeDir, "settings.json"), "utf-8")),
      { tracked: "new" },
      "git-tracked settings.json should NOT be overwritten"
    );
  });

  test("settings.json NOT overwritten by saved value when git checkout already wrote it", () => {
    const dir = makeTempDir();
    const claudeDir = path.join(dir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({ saved: "old" })
    );

    const saved = saveWorktreeState(dir, dir);

    // Git checkout recreates settings.json with new value
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({ tracked: "new" })
    );

    restoreWorktreeState(saved, dir);

    const content = JSON.parse(
      readFileSync(path.join(claudeDir, "settings.json"), "utf-8")
    );
    assert.deepEqual(content, { tracked: "new" });
  });
});

// ---------------------------------------------------------------------------
// symphony-loop.ts SIGTERM/SIGKILL for legacy jobs
// ---------------------------------------------------------------------------

describe("symphony-loop.ts SIGTERM/SIGKILL — legacy job preflight", () => {
  test("legacy PID at .claude/work/process.pid with dead process -> PID file deleted, migration proceeds (no 409)", () => {
    const dir = makeTempDir();
    const legacyWorkDir = path.join(dir, ".claude", "work");
    mkdirSync(legacyWorkDir, { recursive: true });
    // Dead PID (extremely unlikely to exist)
    writeFileSync(path.join(legacyWorkDir, "process.pid"), "999999999");
    writeFileSync(
      path.join(legacyWorkDir, "state.json"),
      JSON.stringify({ status: "IN_PROGRESS" })
    );

    const claudeWorkDir = path.join(dir, ".closedloop-ai", "work");

    // Inline the migration preflight from symphony-loop.ts PLAN handler
    let got409 = false;
    if (!existsSync(claudeWorkDir) && existsSync(legacyWorkDir)) {
      const legacyPidPath = path.join(legacyWorkDir, "process.pid");
      if (existsSync(legacyPidPath)) {
        const rawPid = readFileSync(legacyPidPath, "utf-8").trim();
        const legacyPid = Number.parseInt(rawPid, 10);
        if (!Number.isNaN(legacyPid) && isProcessRunning(legacyPid)) {
          got409 = true;
        }
        // If dead: would send SIGTERM/SIGKILL here — but we just verify
        // the dead-PID path doesn't block migration
      }
      if (!got409) {
        migrateWorkDirIfNeeded(dir);
      }
    }

    assert.equal(got409, false, "dead PID should not trigger 409");
    // Migration happened: .claude/work is gone, .closedloop-ai/work has state
    assert.ok(!existsSync(legacyWorkDir), ".claude/work should be renamed away");
    assert.ok(
      existsSync(path.join(claudeWorkDir, "state.json")),
      "state.json should be at new path after migration"
    );
  });

  test("legacy PID at .claude/work/process.pid with live process -> 409, no migration", () => {
    const dir = makeTempDir();
    const legacyWorkDir = path.join(dir, ".claude", "work");
    mkdirSync(legacyWorkDir, { recursive: true });
    // Use own PID (guaranteed alive)
    writeFileSync(path.join(legacyWorkDir, "process.pid"), String(process.pid));

    const claudeWorkDir = path.join(dir, ".closedloop-ai", "work");

    let got409 = false;
    if (!existsSync(claudeWorkDir) && existsSync(legacyWorkDir)) {
      const legacyPidPath = path.join(legacyWorkDir, "process.pid");
      if (existsSync(legacyPidPath)) {
        const rawPid = readFileSync(legacyPidPath, "utf-8").trim();
        const legacyPid = Number.parseInt(rawPid, 10);
        if (!Number.isNaN(legacyPid) && isProcessRunning(legacyPid)) {
          got409 = true;
        }
      }
      if (!got409) {
        migrateWorkDirIfNeeded(dir);
      }
    }

    assert.equal(got409, true, "live PID should trigger 409");
    // Migration should NOT have happened
    assert.ok(existsSync(legacyWorkDir), ".claude/work should still exist");
    assert.ok(!existsSync(claudeWorkDir), ".closedloop-ai/work should not exist");
  });
});

// ---------------------------------------------------------------------------
// learnings.ts legacy pending migration
// ---------------------------------------------------------------------------

describe("learnings.ts legacy pending migration", () => {
  test("pending learnings only at .claude/work/.learnings/pending/ -> dir can be resolved via per-file fallback", () => {
    const dir = makeTempDir();
    const legacyPendingDir = path.join(
      dir,
      ".claude",
      "work",
      ".learnings",
      "pending"
    );
    mkdirSync(legacyPendingDir, { recursive: true });
    writeFileSync(
      path.join(legacyPendingDir, "learning-001.json"),
      JSON.stringify({ content: "test learning" })
    );

    // .closedloop-ai/work does not exist yet
    const newWorkDir = path.join(dir, ".closedloop-ai", "work");
    assert.ok(!existsSync(newWorkDir));

    // Mirror learnings.ts resolution: check new dir first, fall back to old
    const newLearningsWorkDir = newWorkDir;
    const oldLearningsWorkDir = path.join(dir, ".claude", "work");

    // learnings.ts resolves the pending dir independently via
    // findFirstExisting(pendingDir, legacyPendingDir)
    const pendingCandidateLegacy = path.join(
      oldLearningsWorkDir,
      ".learnings",
      "pending"
    );
    const pendingCandidateNew = path.join(
      newLearningsWorkDir,
      ".learnings",
      "pending"
    );
    const resolvedPendingDir = existsSync(pendingCandidateNew)
      ? pendingCandidateNew
      : existsSync(pendingCandidateLegacy)
        ? pendingCandidateLegacy
        : null;

    assert.ok(
      resolvedPendingDir !== null,
      "pending dir should be found at legacy location"
    );
    assert.ok(resolvedPendingDir!.includes(".claude"));

    const pendingFiles = readdirSync(resolvedPendingDir!);
    assert.equal(pendingFiles.length, 1);
    assert.equal(pendingFiles[0], "learning-001.json");
  });

  test("after migration, pending dir lives at .closedloop-ai/work/.learnings/pending/", () => {
    const dir = makeTempDir();
    const legacyWorkDir = path.join(dir, ".claude", "work");
    const legacyPendingDir = path.join(legacyWorkDir, ".learnings", "pending");
    mkdirSync(legacyPendingDir, { recursive: true });
    writeFileSync(
      path.join(legacyPendingDir, "learning-001.json"),
      JSON.stringify({ content: "test" })
    );

    // Perform migration
    migrateWorkDirIfNeeded(dir);

    const newPendingDir = path.join(
      dir,
      ".closedloop-ai",
      "work",
      ".learnings",
      "pending"
    );
    assert.ok(existsSync(newPendingDir));
    const files = readdirSync(newPendingDir);
    assert.equal(files.length, 1);
    assert.equal(files[0], "learning-001.json");
  });
});
