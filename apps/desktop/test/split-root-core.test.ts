/**
 * Unit tests for split-root behavior across codex.ts, symphony-kill.ts,
 * deploy.ts, and symphony-sessions.ts.
 *
 * These functions are private to their route modules, so we test the same
 * filesystem logic inline using the identical algorithms.  All tests use
 * mkdtempSync / tmpdir() — no hardcoded paths, no real process signals.
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
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

afterEach(async () => {
  for (const p of tempPaths.splice(0)) {
    rmSync(p, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "split-root-test-"));
  tempPaths.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Inline helpers mirroring the private functions under test
// ---------------------------------------------------------------------------

/** Mirror of resolveProvider() in codex.ts */
function resolveProvider(worktreeDir: string): "claude" | "codex" | null {
  const dirs = [
    path.join(worktreeDir, ".closedloop-ai", "work"),
    path.join(worktreeDir, ".claude", "work"),
  ];
  for (const dir of dirs) {
    if (existsSync(path.join(dir, "codex-review-claude.json"))) return "claude";
    if (existsSync(path.join(dir, "codex-review-codex.json"))) return "codex";
  }
  return null;
}

/** Mirror of getReviewPaths() read logic in codex.ts */
function getReviewReadPaths(
  worktreeDir: string,
  provider: string
): { statePath: string; logPath: string } {
  const newWorkDir = path.join(worktreeDir, ".closedloop-ai", "work");
  const oldWorkDir = path.join(worktreeDir, ".claude", "work");
  const statePath =
    findFirstExisting(
      path.join(newWorkDir, `codex-review-${provider}.json`),
      path.join(oldWorkDir, `codex-review-${provider}.json`)
    ) ?? path.join(newWorkDir, `codex-review-${provider}.json`);
  const logPath =
    findFirstExisting(
      path.join(newWorkDir, `codex-review-${provider}.log`),
      path.join(oldWorkDir, `codex-review-${provider}.log`)
    ) ?? path.join(newWorkDir, `codex-review-${provider}.log`);
  return { statePath, logPath };
}

/** Mirror of getReviewWritePaths() in codex.ts */
function getReviewWritePaths(
  worktreeDir: string,
  provider: string
): { statePath: string; logPath: string; pidPath: string } {
  const workDir = path.join(worktreeDir, ".closedloop-ai", "work");
  return {
    statePath: path.join(workDir, `codex-review-${provider}.json`),
    logPath: path.join(workDir, `codex-review-${provider}.log`),
    pidPath: path.join(workDir, `codex-review-${provider}.pid`),
  };
}

/** Mirror of markStateAsStopped() in symphony-kill.ts */
function markStateAsStopped(worktreeDir: string): void {
  const newStatePath = path.join(
    worktreeDir,
    ".closedloop-ai",
    "work",
    "state.json"
  );
  const oldStatePath = path.join(
    worktreeDir,
    ".claude",
    "work",
    "state.json"
  );
  const readStatePath = existsSync(newStatePath) ? newStatePath : oldStatePath;

  let state: Record<string, unknown> = {};
  if (existsSync(readStatePath)) {
    try {
      state = JSON.parse(readFileSync(readStatePath, "utf-8")) as Record<
        string,
        unknown
      >;
    } catch {
      // ignore
    }
  }
  state.status = "STOPPED";
  mkdirSync(path.dirname(newStatePath), { recursive: true });
  writeFileSync(newStatePath, JSON.stringify(state, null, 2), "utf-8");
}

/** Mirror of clearAgentTypes() in symphony-kill.ts */
function clearAgentTypes(worktreeDir: string): void {
  const dirs = [
    path.join(worktreeDir, ".closedloop-ai", "work", ".agent-types"),
    path.join(worktreeDir, ".claude", "work", ".agent-types"),
  ];
  for (const agentTypesDir of dirs) {
    try {
      if (!existsSync(agentTypesDir)) continue;
      for (const file of readdirSync(agentTypesDir)) {
        unlinkSync(path.join(agentTypesDir, file));
      }
    } catch {
      // Best effort
    }
  }
}

/** Write-handler preflight guard shared by upload, deploy, review-findings */
type PreflightResult =
  | { ok: true; workDir: string }
  | { status: 409; error: string };

function runPreflight(worktreeDir: string): PreflightResult {
  const newWorkDir = path.join(worktreeDir, ".closedloop-ai", "work");
  const oldWorkDir = path.join(worktreeDir, ".claude", "work");

  if (!existsSync(newWorkDir) && existsSync(oldWorkDir)) {
    const legacyPidPath = path.join(oldWorkDir, "process.pid");
    if (existsSync(legacyPidPath)) {
      const rawPid = readFileSync(legacyPidPath, "utf-8").trim();
      const legacyPid = Number.parseInt(rawPid, 10);
      if (!Number.isNaN(legacyPid) && isProcessRunning(legacyPid)) {
        return {
          status: 409,
          error:
            "A job started before the .closedloop-ai migration is still running. Stop it first, then retry.",
        };
      }
    }
    migrateWorkDirIfNeeded(worktreeDir);
  }

  mkdirSync(newWorkDir, { recursive: true });
  return { ok: true, workDir: newWorkDir };
}

// ---------------------------------------------------------------------------
// codex.ts — resolveProvider checks both dirs
// ---------------------------------------------------------------------------

describe("codex.ts resolveProvider — split-root", () => {
  test("review state at .claude/work/codex-review-codex.json only -> returns 'codex'", () => {
    const dir = makeTempDir();
    const claudeWorkDir = path.join(dir, ".claude", "work");
    mkdirSync(claudeWorkDir, { recursive: true });
    writeFileSync(
      path.join(claudeWorkDir, "codex-review-codex.json"),
      JSON.stringify({ status: "completed" })
    );

    assert.equal(resolveProvider(dir), "codex");
  });

  test("review state at .closedloop-ai/work/codex-review-claude.json only -> returns 'claude'", () => {
    const dir = makeTempDir();
    const newWorkDir = path.join(dir, ".closedloop-ai", "work");
    mkdirSync(newWorkDir, { recursive: true });
    writeFileSync(
      path.join(newWorkDir, "codex-review-claude.json"),
      JSON.stringify({ status: "running" })
    );

    assert.equal(resolveProvider(dir), "claude");
  });

  test("no review state in either dir -> returns null", () => {
    const dir = makeTempDir();
    mkdirSync(path.join(dir, ".closedloop-ai", "work"), { recursive: true });
    mkdirSync(path.join(dir, ".claude", "work"), { recursive: true });

    assert.equal(resolveProvider(dir), null);
  });

  test("review state in both dirs -> prefers .closedloop-ai (new-dir provider wins by search order)", () => {
    const dir = makeTempDir();
    mkdirSync(path.join(dir, ".closedloop-ai", "work"), { recursive: true });
    writeFileSync(
      path.join(dir, ".closedloop-ai", "work", "codex-review-codex.json"),
      JSON.stringify({ status: "completed" })
    );
    mkdirSync(path.join(dir, ".claude", "work"), { recursive: true });
    writeFileSync(
      path.join(dir, ".claude", "work", "codex-review-claude.json"),
      JSON.stringify({ status: "running" })
    );

    // New dir is checked first — codex-review-codex.json is there
    assert.equal(resolveProvider(dir), "codex");
  });
});

// ---------------------------------------------------------------------------
// codex.ts — extract handler per-file resolution
// ---------------------------------------------------------------------------

describe("codex.ts extract handler — per-file log resolution", () => {
  test("log file only at .claude/work while .closedloop-ai/work exists -> found via per-file scan", () => {
    const dir = makeTempDir();
    const claudeWorkDir = path.join(dir, ".claude", "work");
    mkdirSync(claudeWorkDir, { recursive: true });
    writeFileSync(
      path.join(claudeWorkDir, "codex-review-codex.log"),
      "findings output here"
    );

    // .closedloop-ai/work exists but no log file there
    mkdirSync(path.join(dir, ".closedloop-ai", "work"), { recursive: true });

    // Mirror extract handler's per-file scan across both work dirs
    const newWorkDir = path.join(dir, ".closedloop-ai", "work");
    const oldWorkDir = path.join(dir, ".claude", "work");
    const extractWorkDirs = [newWorkDir, oldWorkDir];

    let foundLog = "";
    for (const fileName of ["codex-review-claude.log", "codex-review-codex.log"]) {
      for (const workDir of extractWorkDirs) {
        const candidate = path.join(workDir, fileName);
        if (!existsSync(candidate)) continue;
        foundLog = readFileSync(candidate, "utf-8");
        if (foundLog.trim()) break;
      }
      if (foundLog.trim()) break;
    }

    assert.equal(foundLog.trim(), "findings output here");
  });

  test("log file at .closedloop-ai/work -> found first", () => {
    const dir = makeTempDir();
    const newWorkDir = path.join(dir, ".closedloop-ai", "work");
    mkdirSync(newWorkDir, { recursive: true });
    writeFileSync(
      path.join(newWorkDir, "codex-review-codex.log"),
      "new log content"
    );

    const extractWorkDirs = [newWorkDir, path.join(dir, ".claude", "work")];
    let foundLog = "";
    for (const fileName of ["codex-review-claude.log", "codex-review-codex.log"]) {
      for (const workDir of extractWorkDirs) {
        const candidate = path.join(workDir, fileName);
        if (!existsSync(candidate)) continue;
        foundLog = readFileSync(candidate, "utf-8");
        if (foundLog.trim()) break;
      }
      if (foundLog.trim()) break;
    }

    assert.equal(foundLog.trim(), "new log content");
  });
});

// ---------------------------------------------------------------------------
// codex.ts — write endpoints use new path
// ---------------------------------------------------------------------------

describe("codex.ts write endpoints use .closedloop-ai/work", () => {
  test("write paths always target .closedloop-ai/work regardless of where read state lives", () => {
    const dir = makeTempDir();

    // Legacy state at .claude/work
    const claudeWorkDir = path.join(dir, ".claude", "work");
    mkdirSync(claudeWorkDir, { recursive: true });
    writeFileSync(
      path.join(claudeWorkDir, "codex-review-codex.json"),
      JSON.stringify({ status: "running", pid: 12345 })
    );
    writeFileSync(
      path.join(claudeWorkDir, "codex-review-codex.log"),
      "old log"
    );

    // Write paths must target new dir
    const writePaths = getReviewWritePaths(dir, "codex");
    assert.ok(writePaths.statePath.includes(".closedloop-ai"));
    assert.ok(writePaths.logPath.includes(".closedloop-ai"));
    assert.ok(writePaths.pidPath.includes(".closedloop-ai"));
  });

  test("stop review: read state from .claude/work, write updated state to .closedloop-ai/work", () => {
    const dir = makeTempDir();
    const claudeWorkDir = path.join(dir, ".claude", "work");
    mkdirSync(claudeWorkDir, { recursive: true });
    const originalState = {
      status: "running",
      pid: 99999,
      provider: "codex",
      startedAt: new Date().toISOString(),
      config: { model: "o4-mini", reasoningEffort: "high", reviewMode: "base", baseBranch: "main" },
    };
    writeFileSync(
      path.join(claudeWorkDir, "codex-review-codex.json"),
      JSON.stringify(originalState)
    );

    // Read from legacy dir (as stop handler does)
    const readPaths = getReviewReadPaths(dir, "codex");
    assert.ok(existsSync(readPaths.statePath), "should find state in .claude/work");
    assert.ok(readPaths.statePath.includes(".claude"));

    const state = JSON.parse(readFileSync(readPaths.statePath, "utf-8")) as Record<string, unknown>;
    assert.equal(state.status, "running");

    // Write update to new canonical path
    const writePaths = getReviewWritePaths(dir, "codex");
    const updatedState = { ...state, status: "stopped", completedAt: new Date().toISOString() };
    mkdirSync(path.dirname(writePaths.statePath), { recursive: true });
    writeFileSync(writePaths.statePath, JSON.stringify(updatedState, null, 2));

    // New dir has updated state
    assert.ok(existsSync(writePaths.statePath));
    const written = JSON.parse(readFileSync(writePaths.statePath, "utf-8")) as Record<string, unknown>;
    assert.equal(written.status, "stopped");

    // Original .claude/work state file remains (not modified)
    const original = JSON.parse(
      readFileSync(path.join(claudeWorkDir, "codex-review-codex.json"), "utf-8")
    ) as Record<string, unknown>;
    assert.equal(original.status, "running");
  });
});

// ---------------------------------------------------------------------------
// symphony-kill.ts — dual clear
// ---------------------------------------------------------------------------

describe("symphony-kill.ts dual clear — clearAgentTypes + markStateAsStopped", () => {
  test(".agent-types cleared from both dirs", () => {
    const dir = makeTempDir();

    const newAgentTypesDir = path.join(
      dir,
      ".closedloop-ai",
      "work",
      ".agent-types"
    );
    const oldAgentTypesDir = path.join(
      dir,
      ".claude",
      "work",
      ".agent-types"
    );
    mkdirSync(newAgentTypesDir, { recursive: true });
    mkdirSync(oldAgentTypesDir, { recursive: true });
    writeFileSync(path.join(newAgentTypesDir, "claude"), "claude");
    writeFileSync(path.join(oldAgentTypesDir, "codex"), "codex");

    clearAgentTypes(dir);

    assert.equal(readdirSync(newAgentTypesDir).length, 0);
    assert.equal(readdirSync(oldAgentTypesDir).length, 0);
  });

  test("STOPPED state written to .closedloop-ai/work/state.json when state is only at .claude/work", () => {
    const dir = makeTempDir();
    const claudeWorkDir = path.join(dir, ".claude", "work");
    mkdirSync(claudeWorkDir, { recursive: true });
    writeFileSync(
      path.join(claudeWorkDir, "state.json"),
      JSON.stringify({ status: "IN_PROGRESS", phase: "Running" })
    );

    // .closedloop-ai/work does not exist yet
    assert.ok(!existsSync(path.join(dir, ".closedloop-ai", "work")));

    markStateAsStopped(dir);

    const newStatePath = path.join(dir, ".closedloop-ai", "work", "state.json");
    assert.ok(existsSync(newStatePath), "STOPPED state written to new path");

    const state = JSON.parse(readFileSync(newStatePath, "utf-8")) as Record<string, unknown>;
    assert.equal(state.status, "STOPPED");
    // Preserves other fields from the source state
    assert.equal(state.phase, "Running");
  });
});

// ---------------------------------------------------------------------------
// symphony-upload.ts / deploy.ts — preflight 409 for legacy jobs
// ---------------------------------------------------------------------------

describe("write-handler preflight — 409 for live legacy job", () => {
  test("upload against live legacy job -> 409", () => {
    const dir = makeTempDir();
    const oldWorkDir = path.join(dir, ".claude", "work");
    mkdirSync(oldWorkDir, { recursive: true });
    // Use our own PID (guaranteed alive)
    writeFileSync(path.join(oldWorkDir, "process.pid"), String(process.pid));

    const result = runPreflight(dir);

    assert.equal("status" in result ? result.status : null, 409);
    // .claude/work must NOT have been migrated
    assert.ok(existsSync(oldWorkDir));
    assert.ok(!existsSync(path.join(dir, ".closedloop-ai", "work")));
  });

  test("legacy job with dead PID -> migrates and proceeds", () => {
    const dir = makeTempDir();
    const oldWorkDir = path.join(dir, ".claude", "work");
    mkdirSync(oldWorkDir, { recursive: true });
    writeFileSync(path.join(oldWorkDir, "process.pid"), "999999999");
    writeFileSync(
      path.join(oldWorkDir, "state.json"),
      JSON.stringify({ status: "STOPPED" })
    );

    const result = runPreflight(dir);

    assert.ok("ok" in result && result.ok);
    // Old dir gone, new dir has state
    assert.ok(!existsSync(oldWorkDir));
    assert.ok(
      existsSync(path.join(dir, ".closedloop-ai", "work", "state.json"))
    );
  });
});

// ---------------------------------------------------------------------------
// deploy.ts — per-file read (deploy.log + deploy-result.json)
// ---------------------------------------------------------------------------

describe("deploy.ts per-file read — split-root artifacts", () => {
  test("deploy.log at .claude/work, deploy-result.json at .closedloop-ai/work -> both found independently", () => {
    const dir = makeTempDir();
    const newWorkDir = path.join(dir, ".closedloop-ai", "work");
    const oldWorkDir = path.join(dir, ".claude", "work");
    mkdirSync(newWorkDir, { recursive: true });
    mkdirSync(oldWorkDir, { recursive: true });

    // Simulate split-root: log at old location, result at new location
    writeFileSync(path.join(oldWorkDir, "deploy.log"), "deploy output");
    writeFileSync(
      path.join(newWorkDir, "deploy-result.json"),
      JSON.stringify({ url: "http://localhost:3000" })
    );

    // Mirror the per-file resolution from deploy.ts
    const logsPath = findFirstExisting(
      path.join(newWorkDir, "deploy.log"),
      path.join(oldWorkDir, "deploy.log")
    );
    const deployResultPath = findFirstExisting(
      path.join(newWorkDir, "deploy-result.json"),
      path.join(oldWorkDir, "deploy-result.json")
    );

    assert.ok(logsPath !== null, "deploy.log should be found");
    assert.ok(logsPath!.includes(".claude"), "deploy.log resolves from .claude/work");

    assert.ok(deployResultPath !== null, "deploy-result.json should be found");
    assert.ok(
      deployResultPath!.includes(".closedloop-ai"),
      "deploy-result.json resolves from .closedloop-ai/work"
    );

    assert.equal(readFileSync(logsPath!, "utf-8"), "deploy output");
    const result = JSON.parse(readFileSync(deployResultPath!, "utf-8")) as Record<string, unknown>;
    assert.equal(result.url, "http://localhost:3000");
  });
});

// ---------------------------------------------------------------------------
// sessions unread-count — per-file chat history resolution
// ---------------------------------------------------------------------------

describe("sessions unread-count — chat history at .claude/work", () => {
  test("chat-history.json at .claude/work while .closedloop-ai/work exists -> still counted", () => {
    const dir = makeTempDir();
    const newWorkDir = path.join(dir, ".closedloop-ai", "work");
    const oldWorkDir = path.join(dir, ".claude", "work");
    mkdirSync(newWorkDir, { recursive: true });
    mkdirSync(oldWorkDir, { recursive: true });

    // Chat history with assistant as last message at legacy location
    const chatHistory = {
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
      ],
    };
    writeFileSync(
      path.join(oldWorkDir, "chat-history.json"),
      JSON.stringify(chatHistory)
    );

    // Mirror unread-count per-file scan: check all candidate filenames across both dirs
    const candidates = ["chat-history.json", "chat-history-claude.json", "chat-history-codex.json"];
    const chatPath = [
      ...candidates.map((f) => path.join(newWorkDir, f)),
      ...candidates.map((f) => path.join(oldWorkDir, f)),
    ].find((p) => existsSync(p));

    assert.ok(chatPath !== undefined, "chat history should be found");
    assert.ok(chatPath!.includes(".claude"), "found in .claude/work");

    const history = JSON.parse(readFileSync(chatPath!, "utf-8")) as { messages?: { role: string }[] };
    assert.equal(history.messages?.at(-1)?.role, "assistant");
  });

  test("chat-history.json at .closedloop-ai/work -> found and counted", () => {
    const dir = makeTempDir();
    const newWorkDir = path.join(dir, ".closedloop-ai", "work");
    mkdirSync(newWorkDir, { recursive: true });

    const chatHistory = {
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "response" },
      ],
    };
    writeFileSync(
      path.join(newWorkDir, "chat-history.json"),
      JSON.stringify(chatHistory)
    );

    const candidates = ["chat-history.json", "chat-history-claude.json", "chat-history-codex.json"];
    const oldWorkDir = path.join(dir, ".claude", "work");
    const chatPath = [
      ...candidates.map((f) => path.join(newWorkDir, f)),
      ...candidates.map((f) => path.join(oldWorkDir, f)),
    ].find((p) => existsSync(p));

    assert.ok(chatPath !== undefined);
    assert.ok(chatPath!.includes(".closedloop-ai"));
  });
});

// ---------------------------------------------------------------------------
// learnings.ts GET process-learnings — per-file processing-status.json
// ---------------------------------------------------------------------------

describe("learnings.ts GET process-learnings — processing-status.json per-file resolution", () => {
  test("status only at .claude/work/.learnings while .closedloop-ai/work exists -> found, not 'none'", () => {
    const dir = makeTempDir();
    const newWorkDir = path.join(dir, ".closedloop-ai", "work");
    const oldWorkDir = path.join(dir, ".claude", "work");
    // Empty new dir exists (mimics dir existence that previously hid legacy files)
    mkdirSync(newWorkDir, { recursive: true });
    const legacyLearningsDir = path.join(oldWorkDir, ".learnings");
    mkdirSync(legacyLearningsDir, { recursive: true });
    const statusPayload = { status: "completed", processed: 3 };
    writeFileSync(
      path.join(legacyLearningsDir, "processing-status.json"),
      JSON.stringify(statusPayload)
    );

    // Mirror fixed handler: per-file resolution via findFirstExisting
    const statusPath = findFirstExisting(
      path.join(newWorkDir, ".learnings", "processing-status.json"),
      path.join(oldWorkDir, ".learnings", "processing-status.json")
    );

    assert.ok(statusPath !== null, "processing-status.json should be found");
    assert.ok(statusPath!.includes(".claude"), "found in .claude/work");
    const content = JSON.parse(readFileSync(statusPath!, "utf-8")) as { status: string };
    assert.equal(content.status, "completed");
  });

  test("status only at .closedloop-ai/work/.learnings -> found there", () => {
    const dir = makeTempDir();
    const newWorkDir = path.join(dir, ".closedloop-ai", "work");
    const newLearningsDir = path.join(newWorkDir, ".learnings");
    mkdirSync(newLearningsDir, { recursive: true });
    writeFileSync(
      path.join(newLearningsDir, "processing-status.json"),
      JSON.stringify({ status: "processing" })
    );

    const statusPath = findFirstExisting(
      path.join(newWorkDir, ".learnings", "processing-status.json"),
      path.join(dir, ".claude", "work", ".learnings", "processing-status.json")
    );

    assert.ok(statusPath !== null);
    assert.ok(statusPath!.includes(".closedloop-ai"));
  });

  test("status in neither location -> null -> returns 'none'", () => {
    const dir = makeTempDir();
    const newWorkDir = path.join(dir, ".closedloop-ai", "work");
    const oldWorkDir = path.join(dir, ".claude", "work");
    mkdirSync(newWorkDir, { recursive: true });
    mkdirSync(oldWorkDir, { recursive: true });

    const statusPath = findFirstExisting(
      path.join(newWorkDir, ".learnings", "processing-status.json"),
      path.join(oldWorkDir, ".learnings", "processing-status.json")
    );

    assert.equal(statusPath, null);
  });
});

// ---------------------------------------------------------------------------
// learnings.ts GET learnings-status — per-file chat-extraction-status.json
// ---------------------------------------------------------------------------

describe("learnings.ts GET learnings-status — chat-extraction-status.json per-file resolution", () => {
  test("status only at .claude/work/.learnings while .closedloop-ai/work exists -> found, not 'none'", () => {
    const dir = makeTempDir();
    const newWorkDir = path.join(dir, ".closedloop-ai", "work");
    const oldWorkDir = path.join(dir, ".claude", "work");
    mkdirSync(newWorkDir, { recursive: true });
    const legacyLearningsDir = path.join(oldWorkDir, ".learnings");
    mkdirSync(legacyLearningsDir, { recursive: true });
    const statusPayload = { status: "completed", count: 5 };
    writeFileSync(
      path.join(legacyLearningsDir, "chat-extraction-status.json"),
      JSON.stringify(statusPayload)
    );

    const statusPath = findFirstExisting(
      path.join(newWorkDir, ".learnings", "chat-extraction-status.json"),
      path.join(oldWorkDir, ".learnings", "chat-extraction-status.json")
    );

    assert.ok(statusPath !== null, "chat-extraction-status.json should be found");
    assert.ok(statusPath!.includes(".claude"), "found in .claude/work");
    const content = JSON.parse(readFileSync(statusPath!, "utf-8")) as { status: string; count: number };
    assert.equal(content.status, "completed");
    assert.equal(content.count, 5);
  });

  test("status in neither location -> null", () => {
    const dir = makeTempDir();
    const newWorkDir = path.join(dir, ".closedloop-ai", "work");
    mkdirSync(newWorkDir, { recursive: true });

    const statusPath = findFirstExisting(
      path.join(newWorkDir, ".learnings", "chat-extraction-status.json"),
      path.join(dir, ".claude", "work", ".learnings", "chat-extraction-status.json")
    );

    assert.equal(statusPath, null);
  });
});

// ---------------------------------------------------------------------------
// symphony-attachments.ts — per-file attachment resolution
// ---------------------------------------------------------------------------

/** Mirror of the per-file attachment resolution from symphony-attachments.ts */
function resolveAttachmentPath(
  worktreeDir: string,
  normalizedAttachmentPath: string
): { filePath: string | null; traversalError: boolean } {
  const newAttachmentsDir = path.resolve(
    path.join(worktreeDir, ".closedloop-ai", "work", "attachments")
  );
  const oldAttachmentsDir = path.resolve(
    path.join(worktreeDir, ".claude", "work", "attachments")
  );
  const newFilePath = path.resolve(newAttachmentsDir, normalizedAttachmentPath);
  const oldFilePath = path.resolve(oldAttachmentsDir, normalizedAttachmentPath);

  const isUnderDir = (file: string, dir: string): boolean => {
    const prefix = dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`;
    return file === dir || file.startsWith(prefix);
  };

  if (!isUnderDir(newFilePath, newAttachmentsDir) && !isUnderDir(oldFilePath, oldAttachmentsDir)) {
    return { filePath: null, traversalError: true };
  }

  const filePath = findFirstExisting(newFilePath, oldFilePath);
  return { filePath, traversalError: false };
}

describe("symphony-attachments.ts — per-file attachment path resolution", () => {
  test("attachment only at .claude/work/attachments while .closedloop-ai/work/attachments exists -> found", () => {
    const dir = makeTempDir();
    const newAttachmentsDir = path.join(dir, ".closedloop-ai", "work", "attachments");
    const oldAttachmentsDir = path.join(dir, ".claude", "work", "attachments");
    // Empty new dir exists (previously hid legacy attachments)
    mkdirSync(newAttachmentsDir, { recursive: true });
    mkdirSync(oldAttachmentsDir, { recursive: true });
    writeFileSync(path.join(oldAttachmentsDir, "screenshot.png"), Buffer.from([0x89, 0x50]));

    const { filePath, traversalError } = resolveAttachmentPath(dir, "screenshot.png");

    assert.equal(traversalError, false);
    assert.ok(filePath !== null, "attachment should be found");
    assert.ok(filePath!.includes(".claude"), "found in .claude/work");
    assert.ok(existsSync(filePath!));
  });

  test("attachment at .closedloop-ai/work/attachments -> found there preferentially", () => {
    const dir = makeTempDir();
    const newAttachmentsDir = path.join(dir, ".closedloop-ai", "work", "attachments");
    const oldAttachmentsDir = path.join(dir, ".claude", "work", "attachments");
    mkdirSync(newAttachmentsDir, { recursive: true });
    mkdirSync(oldAttachmentsDir, { recursive: true });
    writeFileSync(path.join(newAttachmentsDir, "image.png"), Buffer.from([0xff, 0xd8]));
    writeFileSync(path.join(oldAttachmentsDir, "image.png"), Buffer.from([0x00, 0x00]));

    const { filePath, traversalError } = resolveAttachmentPath(dir, "image.png");

    assert.equal(traversalError, false);
    assert.ok(filePath !== null);
    assert.ok(filePath!.includes(".closedloop-ai"), "new location takes precedence");
  });

  test("attachment in neither location -> null (404)", () => {
    const dir = makeTempDir();
    mkdirSync(path.join(dir, ".closedloop-ai", "work", "attachments"), { recursive: true });

    const { filePath, traversalError } = resolveAttachmentPath(dir, "missing.png");

    assert.equal(traversalError, false);
    assert.equal(filePath, null);
  });

  test("path traversal attempt -> traversalError true", () => {
    const dir = makeTempDir();
    const { traversalError } = resolveAttachmentPath(dir, "../../../etc/passwd");
    assert.equal(traversalError, true);
  });
});

// ---------------------------------------------------------------------------
// symphony-status.ts readActiveAgents — merge both .agent-types dirs
// ---------------------------------------------------------------------------

/** Mirror of the updated readActiveAgents() from symphony-status.ts */
function readActiveAgentsSync(worktreeDir: string): Array<{ agentId: string; agentType: string }> {
  const agentTypeDirs = [
    path.join(worktreeDir, ".closedloop-ai", "work", ".agent-types"),
    path.join(worktreeDir, ".claude", "work", ".agent-types"),
  ];

  const agentMap = new Map<string, { agentId: string; agentType: string }>();

  for (const agentTypesDir of agentTypeDirs) {
    if (!existsSync(agentTypesDir)) {
      continue;
    }

    let files: string[];
    try {
      files = readdirSync(agentTypesDir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (file.includes("-")) {
        continue;
      }

      if (agentMap.has(file)) {
        continue;
      }

      try {
        const content = readFileSync(path.join(agentTypesDir, file), "utf-8");
        const [agentType, agentName] = content.trim().split("|");
        if (agentType && agentName) {
          agentMap.set(file, { agentId: file, agentType });
        }
      } catch {
        continue;
      }
    }
  }

  return [...agentMap.values()];
}

describe("symphony-status.ts readActiveAgents — merge both .agent-types dirs", () => {
  test("agent-types only at .claude/work while empty .closedloop-ai/work exists -> agents found", () => {
    const dir = makeTempDir();
    const newAgentTypesDir = path.join(dir, ".closedloop-ai", "work", ".agent-types");
    const oldAgentTypesDir = path.join(dir, ".claude", "work", ".agent-types");
    // Empty new dir exists
    mkdirSync(newAgentTypesDir, { recursive: true });
    mkdirSync(oldAgentTypesDir, { recursive: true });
    writeFileSync(path.join(oldAgentTypesDir, "claude"), "planner|Claude Planner|2024-01-01T00:00:00Z");

    const agents = readActiveAgentsSync(dir);

    assert.equal(agents.length, 1);
    assert.equal(agents[0]?.agentId, "claude");
    assert.equal(agents[0]?.agentType, "planner");
  });

  test("agents in both dirs -> merged (deduped by agentId, new dir wins)", () => {
    const dir = makeTempDir();
    const newAgentTypesDir = path.join(dir, ".closedloop-ai", "work", ".agent-types");
    const oldAgentTypesDir = path.join(dir, ".claude", "work", ".agent-types");
    mkdirSync(newAgentTypesDir, { recursive: true });
    mkdirSync(oldAgentTypesDir, { recursive: true });

    // Same agentId in both — new should win (checked first)
    writeFileSync(path.join(newAgentTypesDir, "claude"), "implementer|New Implementer|");
    writeFileSync(path.join(oldAgentTypesDir, "claude"), "planner|Old Planner|");

    // Unique agentId in old dir only
    writeFileSync(path.join(oldAgentTypesDir, "codex"), "reviewer|Codex Reviewer|");

    const agents = readActiveAgentsSync(dir);

    assert.equal(agents.length, 2);
    const claudeAgent = agents.find((a) => a.agentId === "claude");
    assert.ok(claudeAgent, "claude agent should be present");
    assert.equal(claudeAgent!.agentType, "implementer", "new dir entry wins on duplicate");
    const codexAgent = agents.find((a) => a.agentId === "codex");
    assert.ok(codexAgent, "codex agent from legacy dir should be included");
  });

  test("no .agent-types dir in either location -> empty array", () => {
    const dir = makeTempDir();
    const agents = readActiveAgentsSync(dir);
    assert.deepEqual(agents, []);
  });

  test("files with hyphen in name are skipped (not active agents)", () => {
    const dir = makeTempDir();
    const oldAgentTypesDir = path.join(dir, ".claude", "work", ".agent-types");
    mkdirSync(oldAgentTypesDir, { recursive: true });
    writeFileSync(path.join(oldAgentTypesDir, "claude-12345"), "planner|Planner|");
    writeFileSync(path.join(oldAgentTypesDir, "claude"), "planner|Active Planner|");

    const agents = readActiveAgentsSync(dir);

    assert.equal(agents.length, 1);
    assert.equal(agents[0]?.agentId, "claude");
  });
});

// ---------------------------------------------------------------------------
// DELETE dual-root cleanup: codex status, finding-chat, chat-history
// ---------------------------------------------------------------------------

describe("codex.ts DELETE status dual-root cleanup", () => {
  test("deletes review artifacts from both .closedloop-ai/work and .claude/work", () => {
    const dir = makeTempDir();
    const newWork = path.join(dir, ".closedloop-ai", "work");
    const oldWork = path.join(dir, ".claude", "work");
    mkdirSync(newWork, { recursive: true });
    mkdirSync(oldWork, { recursive: true });

    // Simulate dual-copy: same file exists at both roots
    writeFileSync(path.join(newWork, "codex-review-codex.json"), "{}");
    writeFileSync(path.join(oldWork, "codex-review-codex.json"), "{}");
    writeFileSync(path.join(oldWork, "codex-review-codex.log"), "log");
    writeFileSync(path.join(newWork, "codex-review-codex.pid"), "123");

    // Simulate the DELETE handler: collect all paths from both read and write resolvers
    const provider = "codex";
    const files = [
      `codex-review-${provider}.json`,
      `codex-review-${provider}.log`,
      `codex-review-${provider}.pid`,
      `review-findings-${provider}.json`,
    ];
    const allPaths = new Set<string>();
    for (const f of files) {
      allPaths.add(path.join(newWork, f));
      allPaths.add(path.join(oldWork, f));
    }
    for (const p of allPaths) {
      if (existsSync(p)) {
        rmSync(p, { force: true });
      }
    }

    // Verify both roots are clean
    assert.ok(!existsSync(path.join(newWork, "codex-review-codex.json")));
    assert.ok(!existsSync(path.join(oldWork, "codex-review-codex.json")));
    assert.ok(!existsSync(path.join(oldWork, "codex-review-codex.log")));
    assert.ok(!existsSync(path.join(newWork, "codex-review-codex.pid")));
  });

  test("legacy-only copy is deleted even when new root exists but has no file", () => {
    const dir = makeTempDir();
    const newWork = path.join(dir, ".closedloop-ai", "work");
    const oldWork = path.join(dir, ".claude", "work");
    mkdirSync(newWork, { recursive: true });
    mkdirSync(oldWork, { recursive: true });

    // File only at legacy root
    writeFileSync(path.join(oldWork, "codex-review-codex.json"), "{}");

    const allPaths = [
      path.join(newWork, "codex-review-codex.json"),
      path.join(oldWork, "codex-review-codex.json"),
    ];
    for (const p of allPaths) {
      if (existsSync(p)) {
        rmSync(p, { force: true });
      }
    }

    assert.ok(!existsSync(path.join(oldWork, "codex-review-codex.json")));
  });
});

describe("codex.ts finding-chat DELETE dual-root cleanup", () => {
  test("deletes finding history from both roots", () => {
    const dir = makeTempDir();
    const newWork = path.join(dir, ".closedloop-ai", "work", "finding-chats");
    const oldWork = path.join(dir, ".claude", "work", "finding-chats");
    mkdirSync(newWork, { recursive: true });
    mkdirSync(oldWork, { recursive: true });

    writeFileSync(path.join(newWork, "finding-1.json"), "{}");
    writeFileSync(path.join(oldWork, "finding-1.json"), '{"old":true}');

    // Delete from both roots explicitly (as the fixed handler does)
    rmSync(path.join(newWork, "finding-1.json"), { force: true });
    rmSync(path.join(oldWork, "finding-1.json"), { force: true });

    assert.ok(!existsSync(path.join(newWork, "finding-1.json")));
    assert.ok(!existsSync(path.join(oldWork, "finding-1.json")));
  });

  test("legacy-only finding history is deleted when new root exists", () => {
    const dir = makeTempDir();
    const newWork = path.join(dir, ".closedloop-ai", "work", "finding-chats");
    const oldWork = path.join(dir, ".claude", "work", "finding-chats");
    mkdirSync(newWork, { recursive: true });
    mkdirSync(oldWork, { recursive: true });

    writeFileSync(path.join(oldWork, "finding-2.json"), "{}");

    // Delete from both roots explicitly
    rmSync(path.join(newWork, "finding-2.json"), { force: true });
    rmSync(path.join(oldWork, "finding-2.json"), { force: true });

    assert.ok(!existsSync(path.join(oldWork, "finding-2.json")));
  });
});

describe("symphony-chat-history.ts DELETE dual-root cleanup", () => {
  test("full clear deletes transcript from both roots", () => {
    const dir = makeTempDir();
    const newWork = path.join(dir, ".closedloop-ai", "work");
    const oldWork = path.join(dir, ".claude", "work");
    mkdirSync(newWork, { recursive: true });
    mkdirSync(oldWork, { recursive: true });

    writeFileSync(path.join(newWork, "chat-history.json"), "[]");
    writeFileSync(path.join(oldWork, "chat-history.json"), "[{old:true}]");

    // Simulate full clear: delete from both roots
    for (const wd of [newWork, oldWork]) {
      const p = path.join(wd, "chat-history.json");
      if (existsSync(p)) {
        rmSync(p, { force: true });
      }
    }

    assert.ok(!existsSync(path.join(newWork, "chat-history.json")));
    assert.ok(!existsSync(path.join(oldWork, "chat-history.json")));
  });

  test("full clear removes codex state from both roots", () => {
    const dir = makeTempDir();
    const newWork = path.join(dir, ".closedloop-ai", "work");
    const oldWork = path.join(dir, ".claude", "work");
    mkdirSync(newWork, { recursive: true });
    mkdirSync(oldWork, { recursive: true });

    writeFileSync(path.join(newWork, "codex-chat.json"), "{}");
    writeFileSync(path.join(oldWork, "codex-chat-review.json"), "{}");

    // Simulate blanket cleanup from both roots
    for (const wd of [newWork, oldWork]) {
      for (const name of ["codex-chat.json", "codex-chat-review.json"]) {
        const p = path.join(wd, name);
        if (existsSync(p)) {
          rmSync(p, { force: true });
        }
      }
    }

    assert.ok(!existsSync(path.join(newWork, "codex-chat.json")));
    assert.ok(!existsSync(path.join(oldWork, "codex-chat-review.json")));
  });

  test("legacy-only transcript is deleted when new root exists empty", () => {
    const dir = makeTempDir();
    const newWork = path.join(dir, ".closedloop-ai", "work");
    const oldWork = path.join(dir, ".claude", "work");
    mkdirSync(newWork, { recursive: true });
    mkdirSync(oldWork, { recursive: true });

    writeFileSync(path.join(oldWork, "chat-history.json"), "[{old:true}]");

    for (const wd of [newWork, oldWork]) {
      const p = path.join(wd, "chat-history.json");
      if (existsSync(p)) {
        rmSync(p, { force: true });
      }
    }

    assert.ok(!existsSync(path.join(oldWork, "chat-history.json")));
  });
});

// ---------------------------------------------------------------------------
// symphony-interactive.ts — ticket-chat write path convergence
// ---------------------------------------------------------------------------

describe("ticket-chat POST writes to canonical path, not legacy", () => {
  test("read from legacy, write to .closedloop-ai/work", () => {
    const dir = makeTempDir();
    const newWork = path.join(dir, ".closedloop-ai", "work");
    const oldWork = path.join(dir, ".claude", "work");
    mkdirSync(newWork, { recursive: true });
    mkdirSync(oldWork, { recursive: true });

    // History only at legacy path
    writeFileSync(
      path.join(oldWork, "chat-history.json"),
      JSON.stringify({ messages: [{ role: "user", content: "old" }] })
    );

    // Mirror the fixed handler: read from wherever it exists, write to canonical
    const historyFilename = "chat-history.json";
    const readPath = findFirstExisting(
      path.join(newWork, historyFilename),
      path.join(oldWork, historyFilename)
    ) ?? path.join(newWork, historyFilename);
    const writePath = path.join(newWork, historyFilename);

    // Read
    const history = JSON.parse(readFileSync(readPath, "utf-8")) as { messages: { role: string; content: string }[] };
    assert.equal(history.messages.length, 1);

    // Write to canonical path
    history.messages.push({ role: "assistant", content: "new" });
    writeFileSync(writePath, JSON.stringify(history));

    // Verify write landed at canonical path
    assert.ok(existsSync(writePath));
    const saved = JSON.parse(readFileSync(writePath, "utf-8")) as { messages: unknown[] };
    assert.equal(saved.messages.length, 2);
    // Legacy copy is untouched (still has 1 message)
    const legacy = JSON.parse(readFileSync(path.join(oldWork, historyFilename), "utf-8")) as { messages: unknown[] };
    assert.equal(legacy.messages.length, 1);
  });
});

// ---------------------------------------------------------------------------
// symphony-interactive.ts — comment-chat DELETE dual-root cleanup
// ---------------------------------------------------------------------------

describe("comment-chat DELETE clears both roots", () => {
  test("dual-copy: both roots deleted", () => {
    const dir = makeTempDir();
    const newChats = path.join(dir, ".closedloop-ai", "work", "comment-chats");
    const oldChats = path.join(dir, ".claude", "work", "comment-chats");
    mkdirSync(newChats, { recursive: true });
    mkdirSync(oldChats, { recursive: true });

    writeFileSync(path.join(newChats, "IC_123.json"), "{}");
    writeFileSync(path.join(oldChats, "IC_123.json"), '{"stale":true}');

    // Simulate DELETE handler: rm from both roots explicitly
    rmSync(path.join(newChats, "IC_123.json"), { force: true });
    rmSync(path.join(oldChats, "IC_123.json"), { force: true });

    assert.ok(!existsSync(path.join(newChats, "IC_123.json")));
    assert.ok(!existsSync(path.join(oldChats, "IC_123.json")));
  });

  test("legacy-only: old root deleted when new root exists empty", () => {
    const dir = makeTempDir();
    const newChats = path.join(dir, ".closedloop-ai", "work", "comment-chats");
    const oldChats = path.join(dir, ".claude", "work", "comment-chats");
    mkdirSync(newChats, { recursive: true });
    mkdirSync(oldChats, { recursive: true });

    writeFileSync(path.join(oldChats, "IC_456.json"), "{}");

    rmSync(path.join(newChats, "IC_456.json"), { force: true });
    rmSync(path.join(oldChats, "IC_456.json"), { force: true });

    assert.ok(!existsSync(path.join(oldChats, "IC_456.json")));
  });
});
