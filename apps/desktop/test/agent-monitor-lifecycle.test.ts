import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openAgentDatabase } from "../src/main/database/index.js";
import { createLifecycle, type HookData } from "../src/main/database/lifecycle.js";
import type { TranscriptExtract } from "../src/main/database/transcript.js";

function makeHarness(transcript?: TranscriptExtract | null) {
  const dir = mkdtempSync(path.join(tmpdir(), "cl-lifecycle-"));
  const db = openAgentDatabase(path.join(dir, "agent-dashboard.sqlite"));
  const lifecycle = createLifecycle(db.connection, {
    tokenUsage: db.tokenUsage,
    detectBillingMode: () => "api",
    extractTranscript: () => transcript ?? null,
  });
  return {
    db,
    lifecycle,
    sessionStatus(id: string): string | undefined {
      return (db.connection.prepare("SELECT status FROM sessions WHERE id = ?").get(id) as { status: string } | undefined)?.status;
    },
    agent(id: string) {
      return db.connection.prepare("SELECT * FROM agents WHERE id = ?").get(id) as
        | { status: string; current_tool: string | null; awaiting_input_since: string | null; type: string }
        | undefined;
    },
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("lifecycle: SessionStart creates session + main agent with harness and billing_mode", () => {
  const h = makeHarness();
  try {
    h.lifecycle.processEvent("SessionStart", { session_id: "s1", cwd: "/work" } as HookData, "claude");
    const session = h.db.sessions.getById("s1");
    assert.ok(session, "session created");
    assert.equal(session!.status, "active");
    assert.equal(session!.harness, "claude");
    assert.equal(session!.billingMode, "api");
    const main = h.agent("s1-main");
    assert.ok(main, "main agent created");
    assert.equal(main!.type, "main");
    assert.ok(main!.awaiting_input_since, "fresh session awaits the first prompt");
  } finally {
    h.cleanup();
  }
});

test("lifecycle: SessionStart -> PreToolUse -> Stop -> SessionEnd status sequence", () => {
  const h = makeHarness();
  try {
    h.lifecycle.processEvent("SessionStart", { session_id: "s1", cwd: "/work" } as HookData, "claude");
    assert.equal(h.sessionStatus("s1"), "active");

    h.lifecycle.processEvent("UserPromptSubmit", { session_id: "s1" } as HookData, "claude");
    let main = h.agent("s1-main")!;
    assert.equal(main.status, "working", "prompt submit resumes work");
    assert.equal(main.awaiting_input_since, null, "awaiting cleared on user activity");

    h.lifecycle.processEvent("PreToolUse", { session_id: "s1", tool_name: "Bash" } as HookData, "claude");
    main = h.agent("s1-main")!;
    assert.equal(main.current_tool, "Bash");
    assert.equal(main.status, "working");

    h.lifecycle.processEvent("PostToolUse", { session_id: "s1", tool_name: "Bash" } as HookData, "claude");
    main = h.agent("s1-main")!;
    assert.equal(main.current_tool, null, "tool cleared after use");

    h.lifecycle.processEvent("Stop", { session_id: "s1" } as HookData, "claude");
    main = h.agent("s1-main")!;
    assert.equal(main.status, "waiting", "turn end -> waiting");
    assert.ok(main.awaiting_input_since, "awaiting stamped on turn end");
    assert.equal(h.sessionStatus("s1"), "active", "session stays active between turns");

    h.lifecycle.processEvent("SessionEnd", { session_id: "s1" } as HookData, "claude");
    assert.equal(h.sessionStatus("s1"), "completed");
    assert.equal(h.agent("s1-main")!.status, "completed");
  } finally {
    h.cleanup();
  }
});

test("lifecycle: Stop with error marks session and main as error", () => {
  const h = makeHarness();
  try {
    h.lifecycle.processEvent("SessionStart", { session_id: "s1", cwd: "/work" } as HookData, "claude");
    h.lifecycle.processEvent("Stop", { session_id: "s1", stop_reason: "error" } as HookData, "claude");
    assert.equal(h.sessionStatus("s1"), "error");
    assert.equal(h.agent("s1-main")!.status, "error");
  } finally {
    h.cleanup();
  }
});

test("lifecycle: subagent spawn on Task tool, completed on SubagentStop", () => {
  const h = makeHarness();
  try {
    h.lifecycle.processEvent("SessionStart", { session_id: "s1", cwd: "/work" } as HookData, "claude");
    h.lifecycle.processEvent("UserPromptSubmit", { session_id: "s1" } as HookData, "claude");
    h.lifecycle.processEvent(
      "PreToolUse",
      { session_id: "s1", tool_name: "Task", tool_input: { subagent_type: "explorer", prompt: "explore the repo" } } as HookData,
      "claude",
    );
    const subs = h.db.agents.getBySession("s1").filter((a) => a.type === "subagent");
    assert.equal(subs.length, 1, "one subagent spawned");
    assert.equal(subs[0].subagentType, "explorer");
    assert.equal(subs[0].status, "working");

    h.lifecycle.processEvent("SubagentStop", { session_id: "s1", agent_type: "explorer" } as HookData, "claude");
    const after = h.db.agents.getBySession("s1").filter((a) => a.type === "subagent");
    assert.equal(after[0].status, "completed", "matched subagent completed");
  } finally {
    h.cleanup();
  }
});

test("lifecycle: transcript token usage is written and session model synced", () => {
  const transcript: TranscriptExtract = {
    tokensByModel: new Map([["claude-sonnet-4-6", { input: 1200, output: 340, cacheRead: 50, cacheWrite: 10 }]]),
    latestModel: "claude-sonnet-4-6",
    compactionCount: 0,
  };
  const h = makeHarness(transcript);
  try {
    h.lifecycle.processEvent("SessionStart", { session_id: "s1", cwd: "/work" } as HookData, "claude");
    h.lifecycle.processEvent("Stop", { session_id: "s1", transcript_path: "/tmp/x.jsonl" } as HookData, "claude");
    const rows = h.db.tokenUsage.getBySession("s1");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].inputTokens, 1200);
    assert.equal(rows[0].model, "claude-sonnet-4-6");
    assert.equal(h.db.sessions.getById("s1")!.model, "claude-sonnet-4-6", "session model synced from transcript");
  } finally {
    h.cleanup();
  }
});

test("lifecycle: ignores events without a session_id and never throws", () => {
  const h = makeHarness();
  try {
    assert.equal(h.lifecycle.processEvent("Stop", {} as HookData, "claude"), false);
    assert.equal(h.db.sessions.getAll().length, 0);
  } finally {
    h.cleanup();
  }
});
