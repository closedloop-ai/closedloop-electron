/**
 * Single-root contract tests: verify that all handlers read exclusively
 * from .closedloop-ai/work and ignore legacy .claude/work.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { DesktopGatewayServer } from "../src/server/server.js";
import { EMPTY_CAPABILITIES } from "../src/shared/contracts.js";
import { sanitizeTicketId } from "../src/server/operations/symphony-utils.js";

const serversToClose: DesktopGatewayServer[] = [];
const tempPathsToClean: string[] = [];

afterEach(async () => {
  for (const server of serversToClose.splice(0)) {
    await server.stop();
  }
  for (const tempPath of tempPathsToClean.splice(0)) {
    await fs.rm(tempPath, { recursive: true, force: true });
  }
});

// --- Helpers ---

async function makeTmpDir(label: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `single-root-${label}-`));
  tempPathsToClean.push(dir);
  return dir;
}

async function startServer(
  tmpDir: string,
  symphonyDir?: string
): Promise<{ server: DesktopGatewayServer; baseUrl: string }> {
  const server = new DesktopGatewayServer({
    host: "127.0.0.1",
    preferredPort: 0,
    fallbackPorts: [0],
    webAppOrigin: "https://app.symphony.com",
    getAllowedDirectories: () => [tmpDir],
    machineName: "single-root-test",
    version: "0.1.0-test",
    capabilities: EMPTY_CAPABILITIES,
    discoveryFilePath: path.join(tmpDir, "electron-port"),
    getSymphonyDir: () => symphonyDir ?? path.join(tmpDir, ".closedloop-ai"),
  });
  serversToClose.push(server);
  await server.start();
  return { server, baseUrl: `http://127.0.0.1:${server.getActivePort()}` };
}

function setupWorktree(
  tmpDir: string,
  repoName: string,
  ticketId: string
): { repoPath: string; worktreeDir: string } {
  const repoPath = path.join(tmpDir, repoName);
  const sanitized = sanitizeTicketId(ticketId);
  const worktreeDir = path.join(tmpDir, `${repoName}-${sanitized}`);
  mkdirSync(repoPath, { recursive: true });
  mkdirSync(worktreeDir, { recursive: true });
  return { repoPath, worktreeDir };
}

function writeToCanonical(worktreeDir: string, relPath: string, content: string): void {
  const fullPath = path.join(worktreeDir, ".closedloop-ai", "work", relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

function writeToLegacy(worktreeDir: string, relPath: string, content: string): void {
  const fullPath = path.join(worktreeDir, ".claude", "work", relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

// --- symphony-status ---

describe("single-root: symphony-status", () => {
  test("reads state.json from .closedloop-ai/work, ignores .claude/work", async () => {
    const tmpDir = await makeTmpDir("status");
    const { repoPath, worktreeDir } = setupWorktree(tmpDir, "repo", "SR-1");

    writeToCanonical(worktreeDir, "state.json", JSON.stringify({
      status: "COMPLETED",
      phase: "Done",
      timestamp: new Date().toISOString()
    }));
    writeToLegacy(worktreeDir, "state.json", JSON.stringify({
      status: "IN_PROGRESS",
      phase: "Legacy should be ignored",
      timestamp: new Date().toISOString()
    }));

    const { baseUrl } = await startServer(tmpDir);
    const response = await fetch(
      `${baseUrl}/api/engineer/symphony/status/SR-1?repo=${encodeURIComponent(repoPath)}`
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { status: string; phase: string };
    assert.equal(body.status, "COMPLETED");
    assert.equal(body.phase, "Done");
  });

  test("returns STARTING when only .claude/work/state.json exists (no fallback)", async () => {
    const tmpDir = await makeTmpDir("status-no-fb");
    const { repoPath, worktreeDir } = setupWorktree(tmpDir, "repo", "SR-2");

    writeToLegacy(worktreeDir, "state.json", JSON.stringify({
      status: "IN_PROGRESS",
      phase: "Legacy",
      timestamp: new Date().toISOString()
    }));

    const { baseUrl } = await startServer(tmpDir);
    const response = await fetch(
      `${baseUrl}/api/engineer/symphony/status/SR-2?repo=${encodeURIComponent(repoPath)}`
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { stateExists: boolean; status: string };
    assert.equal(body.stateExists, false);
    assert.equal(body.status, "STARTING");
  });
});

// --- symphony-kill ---

describe("single-root: symphony-kill", () => {
  test("resolves PID from .closedloop-ai/work only", async () => {
    const tmpDir = await makeTmpDir("kill");
    const { repoPath, worktreeDir } = setupWorktree(tmpDir, "repo", "SR-3");

    // Write PID to legacy only -- should NOT find it
    writeToLegacy(worktreeDir, "process.pid", "99999");

    const { baseUrl } = await startServer(tmpDir);
    const response = await fetch(`${baseUrl}/api/engineer/symphony/kill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: "SR-3", repoPath })
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { message: string };
    assert.ok(body.message.includes("No process to kill"));
  });

  test("marks state as STOPPED in .closedloop-ai/work", async () => {
    const tmpDir = await makeTmpDir("kill-state");
    const { repoPath, worktreeDir } = setupWorktree(tmpDir, "repo", "SR-4");

    const { baseUrl } = await startServer(tmpDir);
    await fetch(`${baseUrl}/api/engineer/symphony/kill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: "SR-4", repoPath })
    });

    const stateContent = await fs.readFile(
      path.join(worktreeDir, ".closedloop-ai", "work", "state.json"),
      "utf-8"
    );
    const state = JSON.parse(stateContent) as { status: string };
    assert.equal(state.status, "STOPPED");
  });
});

// --- deploy status ---

describe("single-root: deploy", () => {
  test("reads deploy artifacts from .closedloop-ai/work, ignores .claude/work", async () => {
    const tmpDir = await makeTmpDir("deploy");
    const { repoPath, worktreeDir } = setupWorktree(tmpDir, "repo", "SR-5");

    writeToCanonical(worktreeDir, "deploy.log", "canonical deploy log");
    writeToLegacy(worktreeDir, "deploy.log", "legacy deploy log");

    const { baseUrl } = await startServer(tmpDir);
    const response = await fetch(
      `${baseUrl}/api/engineer/deploy/status/SR-5?repo=${encodeURIComponent(repoPath)}&worktree=${encodeURIComponent(worktreeDir)}`
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { logs?: string };
    if (body.logs) {
      assert.ok(body.logs.includes("canonical deploy log"));
      assert.ok(!body.logs.includes("legacy deploy log"));
    }
  });
});

// --- symphony-sessions unread-count ---

describe("single-root: symphony-sessions", () => {
  test("counts unread from .closedloop-ai/work only", async () => {
    const tmpDir = await makeTmpDir("sessions");
    const symphonyDir = path.join(tmpDir, ".closedloop-ai");
    const worktreeDir = path.join(tmpDir, "my-wt");
    mkdirSync(worktreeDir, { recursive: true });

    // Write session pointing to worktreeDir
    mkdirSync(symphonyDir, { recursive: true });
    writeFileSync(
      path.join(symphonyDir, "sessions.json"),
      JSON.stringify({
        sessions: [{
          ticketId: "SR-6",
          repoPath: tmpDir,
          worktreePath: worktreeDir,
          startedAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString()
        }]
      }),
      "utf-8"
    );

    // Write chat history to legacy only -- should NOT count
    writeToLegacy(worktreeDir, "chat-history.json", JSON.stringify({
      messages: [{ role: "assistant", content: "hello" }]
    }));

    const { baseUrl } = await startServer(tmpDir, symphonyDir);
    const response = await fetch(`${baseUrl}/api/engineer/symphony/sessions/unread-count`);
    assert.equal(response.status, 200);
    const body = await response.json() as { count: number };
    assert.equal(body.count, 0);
  });
});

// --- learnings ---

describe("single-root: learnings", () => {
  test("process-learnings returns none when only legacy status exists", async () => {
    const tmpDir = await makeTmpDir("learnings");
    const { repoPath, worktreeDir } = setupWorktree(tmpDir, "repo", "SR-7");

    writeToLegacy(worktreeDir, ".learnings/processing-status.json", JSON.stringify({
      status: "completed"
    }));

    const { baseUrl } = await startServer(tmpDir);
    const response = await fetch(
      `${baseUrl}/api/engineer/symphony/process-learnings?ticketId=SR-7&repo=${encodeURIComponent(repoPath)}`
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { status: string };
    assert.equal(body.status, "none");
  });

  test("learnings-status returns none when only legacy extraction exists", async () => {
    const tmpDir = await makeTmpDir("learn-status");
    const { repoPath, worktreeDir } = setupWorktree(tmpDir, "repo", "SR-8");

    writeToLegacy(worktreeDir, ".learnings/chat-extraction-status.json", JSON.stringify({
      status: "completed", count: 5
    }));

    const { baseUrl } = await startServer(tmpDir);
    const response = await fetch(
      `${baseUrl}/api/engineer/symphony/learnings-status/SR-8?repo=${encodeURIComponent(repoPath)}`
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { status: string };
    assert.equal(body.status, "none");
  });
});

// --- symphony-attachments ---

describe("single-root: symphony-attachments", () => {
  test("serves attachments from .closedloop-ai/work only", async () => {
    const tmpDir = await makeTmpDir("attachments");
    const { repoPath, worktreeDir } = setupWorktree(tmpDir, "repo", "SR-9");

    writeToCanonical(worktreeDir, "attachments/screenshot.png", "canonical-png");
    writeToLegacy(worktreeDir, "attachments/screenshot.png", "legacy-png");

    const { baseUrl } = await startServer(tmpDir);
    const response = await fetch(
      `${baseUrl}/api/engineer/symphony/attachments/SR-9/screenshot.png?repo=${encodeURIComponent(repoPath)}`
    );
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.equal(body, "canonical-png");
  });

  test("returns 404 when attachment only exists in .claude/work", async () => {
    const tmpDir = await makeTmpDir("attach-legacy");
    const { repoPath, worktreeDir } = setupWorktree(tmpDir, "repo", "SR-10");

    writeToLegacy(worktreeDir, "attachments/old.png", "legacy-only");

    const { baseUrl } = await startServer(tmpDir);
    const response = await fetch(
      `${baseUrl}/api/engineer/symphony/attachments/SR-10/old.png?repo=${encodeURIComponent(repoPath)}`
    );
    assert.equal(response.status, 404);
  });
});

// --- symphony-chat-history ---

describe("single-root: symphony-chat-history", () => {
  test("reads chat history from .closedloop-ai/work, ignores legacy", async () => {
    const tmpDir = await makeTmpDir("chat-hist");
    const { repoPath, worktreeDir } = setupWorktree(tmpDir, "repo", "SR-11");

    writeToCanonical(worktreeDir, "chat-history.json", JSON.stringify({
      messages: [{ id: "1", role: "user", content: "canonical", timestamp: new Date().toISOString() }],
      ticketId: "SR-11",
      repoPath
    }));
    writeToLegacy(worktreeDir, "chat-history.json", JSON.stringify({
      messages: [{ id: "2", role: "user", content: "legacy", timestamp: new Date().toISOString() }],
      ticketId: "SR-11",
      repoPath
    }));

    const { baseUrl } = await startServer(tmpDir);
    const response = await fetch(
      `${baseUrl}/api/engineer/symphony/chat-history/SR-11?repo=${encodeURIComponent(repoPath)}`
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { messages: Array<{ content: string }> };
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].content, "canonical");
  });
});

// --- symphony-logs ---

describe("single-root: symphony-logs", () => {
  test("reads logs from .closedloop-ai/work, ignores .claude/work", async () => {
    const tmpDir = await makeTmpDir("logs");
    const { repoPath, worktreeDir } = setupWorktree(tmpDir, "repo", "SR-12");

    writeToCanonical(worktreeDir, "claude-output.jsonl", '{"type":"test","text":"canonical"}\n');
    writeToLegacy(worktreeDir, "claude-output.jsonl", '{"type":"test","text":"legacy"}\n');

    const { baseUrl } = await startServer(tmpDir);
    const response = await fetch(
      `${baseUrl}/api/engineer/symphony/logs/SR-12?repo=${encodeURIComponent(repoPath)}`
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { exists: boolean; format: string; lines: string[] };
    assert.equal(body.exists, true);
    assert.equal(body.format, "jsonl");
    assert.ok(body.lines[0].includes("canonical"));
  });
});

// --- symphony-plan ---

describe("single-root: symphony-plan", () => {
  test("reads plan from .closedloop-ai/work, ignores .claude/work", async () => {
    const tmpDir = await makeTmpDir("plan");
    const { repoPath, worktreeDir } = setupWorktree(tmpDir, "repo", "SR-13");

    writeToCanonical(worktreeDir, "plan.json", JSON.stringify({
      title: "Canonical Plan",
      tasks: [{ id: "1", title: "Task 1", description: "desc" }],
      content: "# Canonical Plan\\nContent here"
    }));
    writeToLegacy(worktreeDir, "plan.json", JSON.stringify({
      title: "Legacy Plan",
      tasks: [{ id: "1", title: "Legacy Task", description: "desc" }],
      content: "# Legacy Plan"
    }));

    const { baseUrl } = await startServer(tmpDir);
    const response = await fetch(
      `${baseUrl}/api/engineer/symphony/plan/SR-13?repo=${encodeURIComponent(repoPath)}`
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { raw: { title: string } };
    assert.equal(body.raw.title, "Canonical Plan");
  });

  test("returns 404 when plan only exists in .claude/work", async () => {
    const tmpDir = await makeTmpDir("plan-legacy");
    const { repoPath, worktreeDir } = setupWorktree(tmpDir, "repo", "SR-14");

    writeToLegacy(worktreeDir, "plan.json", JSON.stringify({
      title: "Legacy Plan"
    }));

    const { baseUrl } = await startServer(tmpDir);
    const response = await fetch(
      `${baseUrl}/api/engineer/symphony/plan/SR-14?repo=${encodeURIComponent(repoPath)}`
    );
    assert.equal(response.status, 404);
  });
});

// --- metadata-routes (aggregate status) ---

describe("single-root: metadata-routes", () => {
  test("reads state.json from .closedloop-ai/work, ignores .claude/work", async () => {
    const tmpDir = await makeTmpDir("metadata");
    const workDir = path.join(tmpDir, "my-worktree");
    mkdirSync(workDir, { recursive: true });

    writeToCanonical(workDir, "state.json", JSON.stringify({
      status: "COMPLETED",
      phase: "Done"
    }));
    writeToLegacy(workDir, "state.json", JSON.stringify({
      status: "IN_PROGRESS",
      phase: "Legacy running"
    }));

    const { baseUrl } = await startServer(tmpDir);
    const response = await fetch(
      `${baseUrl}/api/engineer/symphony/status?workDir=${encodeURIComponent(workDir)}`
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { isRunning: boolean; status: string };
    assert.equal(body.isRunning, false);
    assert.equal(body.status, "COMPLETED");
  });

  test("returns not-running when only .claude/work/state.json exists", async () => {
    const tmpDir = await makeTmpDir("meta-legacy");
    const workDir = path.join(tmpDir, "my-worktree");
    mkdirSync(workDir, { recursive: true });

    writeToLegacy(workDir, "state.json", JSON.stringify({
      status: "IN_PROGRESS",
      phase: "Legacy"
    }));

    const { baseUrl } = await startServer(tmpDir);
    const response = await fetch(
      `${baseUrl}/api/engineer/symphony/status?workDir=${encodeURIComponent(workDir)}`
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { isRunning: boolean; reason: string };
    assert.equal(body.isRunning, false);
    assert.ok(body.reason.includes("not found"));
  });
});

// --- symphony-judges ---

describe("single-root: symphony-judges", () => {
  test("reads judges.json from .closedloop-ai/work, ignores .claude/work", async () => {
    const tmpDir = await makeTmpDir("judges");
    const { repoPath, worktreeDir } = setupWorktree(tmpDir, "repo", "SR-15");

    writeToCanonical(worktreeDir, "judges.json", JSON.stringify({
      verdict: "approved",
      source: "canonical"
    }));
    writeToLegacy(worktreeDir, "judges.json", JSON.stringify({
      verdict: "rejected",
      source: "legacy"
    }));

    const { baseUrl } = await startServer(tmpDir);
    const response = await fetch(
      `${baseUrl}/api/engineer/symphony/judges/SR-15?repo=${encodeURIComponent(repoPath)}`
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { exists: boolean; data: { source: string } };
    assert.equal(body.exists, true);
    assert.equal(body.data.source, "canonical");
  });

  test("returns not-exists when judges only in .claude/work", async () => {
    const tmpDir = await makeTmpDir("judges-legacy");
    const { repoPath, worktreeDir } = setupWorktree(tmpDir, "repo", "SR-16");

    writeToLegacy(worktreeDir, "judges.json", JSON.stringify({ verdict: "legacy" }));

    const { baseUrl } = await startServer(tmpDir);
    const response = await fetch(
      `${baseUrl}/api/engineer/symphony/judges/SR-16?repo=${encodeURIComponent(repoPath)}`
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { exists: boolean };
    assert.equal(body.exists, false);
  });
});

// --- codex provider resolution ---

describe("single-root: codex", () => {
  test("codex status resolves provider from .closedloop-ai/work only", async () => {
    const tmpDir = await makeTmpDir("codex");
    const { repoPath, worktreeDir } = setupWorktree(tmpDir, "repo", "SR-17");

    // Write provider state to legacy only -- should NOT find it
    writeToLegacy(worktreeDir, "codex-review-claude.json", JSON.stringify({
      status: "IN_PROGRESS"
    }));

    const { baseUrl } = await startServer(tmpDir);
    const response = await fetch(
      `${baseUrl}/api/engineer/codex/status/SR-17?repo=${encodeURIComponent(repoPath)}`
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { hasReview: boolean };
    assert.equal(body.hasReview, false);
  });

  test("codex status reads from .closedloop-ai/work", async () => {
    const tmpDir = await makeTmpDir("codex-canon");
    const { repoPath, worktreeDir } = setupWorktree(tmpDir, "repo", "SR-18");

    writeToCanonical(worktreeDir, "codex-review-codex.json", JSON.stringify({
      status: "IN_PROGRESS",
      provider: "codex"
    }));

    const { baseUrl } = await startServer(tmpDir);
    const response = await fetch(
      `${baseUrl}/api/engineer/codex/status/SR-18?repo=${encodeURIComponent(repoPath)}`
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { hasReview: boolean; provider: string };
    assert.equal(body.hasReview, true);
    assert.equal(body.provider, "codex");
  });
});

// --- symphony-interactive (chat history read) ---

describe("single-root: symphony-interactive", () => {
  test("comment-chat DELETE only removes from .closedloop-ai/work", async () => {
    const tmpDir = await makeTmpDir("interactive");
    const { repoPath, worktreeDir } = setupWorktree(tmpDir, "repo", "SR-19");

    writeToCanonical(worktreeDir, "comment-chats/comment_1.json", JSON.stringify({
      messages: [{ id: "1", role: "user", content: "test", timestamp: new Date().toISOString() }]
    }));
    writeToLegacy(worktreeDir, "comment-chats/comment_1.json", JSON.stringify({
      messages: [{ id: "2", role: "user", content: "legacy", timestamp: new Date().toISOString() }]
    }));

    const { baseUrl } = await startServer(tmpDir);
    const response = await fetch(
      `${baseUrl}/api/engineer/symphony/comment-chat/comment_1?ticketId=SR-19&repo=${encodeURIComponent(repoPath)}`,
      { method: "DELETE" }
    );
    assert.equal(response.status, 200);

    // Legacy file should still exist (not cleaned up)
    const legacyPath = path.join(worktreeDir, ".claude", "work", "comment-chats", "comment_1.json");
    const legacyExists = await fs.stat(legacyPath).then(() => true).catch(() => false);
    assert.equal(legacyExists, true, "Legacy file should NOT be deleted by single-root handler");
  });
});
