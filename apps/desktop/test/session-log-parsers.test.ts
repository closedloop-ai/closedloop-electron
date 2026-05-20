import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createClaudeCodeParserState,
  extractPrUrlsFromText,
  isFixtureOwner,
  parseClaudeCodeLine,
  parseClosedloopLoopLine,
  parseCodexLine,
  safeParseLine,
} from "../src/main/session-log-parsers.js";

describe("extractPrUrlsFromText()", () => {
  test("extracts a single real PR URL", () => {
    const refs = extractPrUrlsFromText(
      "https://github.com/closedloop-ai/closedloop-electron/pull/203",
    );
    assert.equal(refs.length, 1);
    assert.equal(refs[0].prUrl, "https://github.com/closedloop-ai/closedloop-electron/pull/203");
    assert.equal(refs[0].prNumber, 203);
    assert.equal(refs[0].repoFullName, "closedloop-ai/closedloop-electron");
  });

  test("extracts multiple PR URLs from one string", () => {
    const refs = extractPrUrlsFromText(
      "see https://github.com/a-org/repo-x/pull/1 and https://github.com/b-org/repo-y/pull/2 done",
    );
    assert.equal(refs.length, 2);
  });

  test("dedups identical URLs in the same string", () => {
    const refs = extractPrUrlsFromText(
      "https://github.com/x/y/pull/1 ... https://github.com/x/y/pull/1",
    );
    assert.equal(refs.length, 1);
  });

  test("filters out fixture owners (AC7)", () => {
    for (const owner of ["owner", "acme", "example", "test-org", "sample", "fixtures", "placeholder"]) {
      const refs = extractPrUrlsFromText(`https://github.com/${owner}/some-repo/pull/5`);
      assert.equal(refs.length, 0, `expected fixture owner "${owner}" to be filtered`);
    }
  });

  test("fixture owner match is case-insensitive", () => {
    assert.equal(extractPrUrlsFromText("https://github.com/ACME/foo/pull/1").length, 0);
    assert.equal(extractPrUrlsFromText("https://github.com/Example/foo/pull/1").length, 0);
  });

  test("does not match non-PR github URLs", () => {
    assert.equal(extractPrUrlsFromText("https://github.com/x/y/issues/3").length, 0);
    assert.equal(extractPrUrlsFromText("https://github.com/x/y/blob/main/README.md").length, 0);
    assert.equal(extractPrUrlsFromText("https://github.com/x/y").length, 0);
  });

  test("rejects PR numbers that are zero or negative", () => {
    assert.equal(extractPrUrlsFromText("https://github.com/x/y/pull/0").length, 0);
  });

  test("handles non-string/empty input", () => {
    assert.equal(extractPrUrlsFromText("").length, 0);
    // @ts-expect-error testing runtime tolerance
    assert.equal(extractPrUrlsFromText(null).length, 0);
    // @ts-expect-error testing runtime tolerance
    assert.equal(extractPrUrlsFromText(undefined).length, 0);
  });

  test("isFixtureOwner direct check", () => {
    assert.equal(isFixtureOwner("acme"), true);
    assert.equal(isFixtureOwner("ACME"), true);
    assert.equal(isFixtureOwner("closedloop-ai"), false);
  });
});

describe("safeParseLine()", () => {
  test("returns parsed object for valid JSON", () => {
    const v = safeParseLine('{"type":"pr-link","prUrl":"x"}');
    assert.deepEqual(v, { type: "pr-link", prUrl: "x" });
  });
  test("returns null for malformed JSON", () => {
    assert.equal(safeParseLine('{"type":"pr-link'), null);
  });
  test("returns null for non-object lines (arrays, primitives)", () => {
    assert.equal(safeParseLine("[1,2,3]"), null);
    assert.equal(safeParseLine("42"), null);
    assert.equal(safeParseLine(""), null);
    assert.equal(safeParseLine("not json"), null);
  });
});

describe("parseClosedloopLoopLine()", () => {
  test("emits one event for a valid pr-link line", () => {
    const events = parseClosedloopLoopLine(
      {
        type: "pr-link",
        prUrl: "https://github.com/closedloop-ai/closedloop-electron/pull/203",
        prNumber: 203,
        branchName: "feat/foo",
        commitSha: "abcdef1234567890",
      },
      "session-xyz",
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].sourceClient, "closedloop-loop");
    assert.equal(events[0].sourceSessionId, "session-xyz");
    assert.equal(events[0].prNumber, 203);
    assert.equal(events[0].branchName, "feat/foo");
    assert.equal(events[0].commitSha, "abcdef1234567890");
  });

  test("preserves null branchName/commitSha when absent", () => {
    const events = parseClosedloopLoopLine(
      { type: "pr-link", prUrl: "https://github.com/closedloop-ai/cle/pull/1" },
      "s1",
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].branchName, null);
    assert.equal(events[0].commitSha, null);
  });

  test("ignores non-pr-link types", () => {
    assert.equal(parseClosedloopLoopLine({ type: "unrelated" }, "s1").length, 0);
  });

  test("filters fixture URLs", () => {
    const events = parseClosedloopLoopLine(
      { type: "pr-link", prUrl: "https://github.com/acme/test/pull/9" },
      "s1",
    );
    assert.equal(events.length, 0);
  });

  test("ignores non-records", () => {
    assert.equal(parseClosedloopLoopLine(null, "s1").length, 0);
    assert.equal(parseClosedloopLoopLine("string", "s1").length, 0);
    assert.equal(parseClosedloopLoopLine([1, 2], "s1").length, 0);
  });
});

describe("parseCodexLine()", () => {
  test("extracts URLs from aggregated_output", () => {
    const events = parseCodexLine(
      {
        type: "exec_command_end",
        command: ["gh", "pr", "create"],
        aggregated_output:
          "Creating pull request for feature/foo into main in closedloop-ai/closedloop-electron\nhttps://github.com/closedloop-ai/closedloop-electron/pull/200\n",
      },
      "rollout-1",
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].sourceClient, "codex");
    assert.equal(events[0].prNumber, 200);
    assert.equal(events[0].sourceSessionId, "rollout-1");
  });

  test("extracts branch name from a git push command", () => {
    const events = parseCodexLine(
      {
        type: "exec_command_end",
        command: ["git", "push", "origin", "feature/my-branch"],
        aggregated_output:
          "To github.com:closedloop-ai/closedloop-electron.git\nremote: ... Create a pull request for 'feature/my-branch' on GitHub by visiting:\nremote:      https://github.com/closedloop-ai/closedloop-electron/pull/new/feature/my-branch\nhttps://github.com/closedloop-ai/closedloop-electron/pull/250",
      },
      "rollout-2",
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].branchName, "feature/my-branch");
    assert.equal(events[0].prNumber, 250);
  });

  test("ignores lines without aggregated_output", () => {
    assert.equal(parseCodexLine({ type: "exec_command_end" }, "s").length, 0);
  });

  test("ignores other types", () => {
    assert.equal(
      parseCodexLine({ type: "exec_command_begin", command: ["x"] }, "s").length,
      0,
    );
  });

  test("filters fixture URLs in output", () => {
    const events = parseCodexLine(
      {
        type: "exec_command_end",
        command: [],
        aggregated_output: "https://github.com/example/sample/pull/1",
      },
      "s",
    );
    assert.equal(events.length, 0);
  });
});

describe("parseClaudeCodeLine()", () => {
  test("captures URL from a tool_result that follows a Bash tool_use", () => {
    const state = createClaudeCodeParserState();
    const tu = parseClaudeCodeLine(
      {
        type: "tool_use",
        id: "use-1",
        name: "Bash",
        input: { command: "gh pr create --title foo" },
      },
      "claude-session",
      state,
    );
    assert.equal(tu.length, 0, "tool_use never emits events directly");

    const tr = parseClaudeCodeLine(
      {
        type: "tool_result",
        tool_use_id: "use-1",
        content:
          "https://github.com/closedloop-ai/closedloop-electron/pull/175",
      },
      "claude-session",
      state,
    );
    assert.equal(tr.length, 1);
    assert.equal(tr[0].prNumber, 175);
    assert.equal(tr[0].sourceClient, "claude-code");
    assert.equal(tr[0].sourceSessionId, "claude-session");
  });

  test("extracts branch from the paired tool_use's command", () => {
    const state = createClaudeCodeParserState();
    parseClaudeCodeLine(
      {
        type: "tool_use",
        id: "use-2",
        name: "Bash",
        input: { command: "git push -u origin feature/abc" },
      },
      "s",
      state,
    );
    const events = parseClaudeCodeLine(
      {
        type: "tool_result",
        tool_use_id: "use-2",
        content: "https://github.com/x-org/y-repo/pull/9",
      },
      "s",
      state,
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].branchName, "feature/abc");
  });

  test("handles tool_result.content as an array of blocks", () => {
    const state = createClaudeCodeParserState();
    parseClaudeCodeLine(
      { type: "tool_use", id: "use-3", name: "Bash", input: { command: "" } },
      "s",
      state,
    );
    const events = parseClaudeCodeLine(
      {
        type: "tool_result",
        tool_use_id: "use-3",
        content: [
          { type: "text", text: "Pushed feature/x" },
          { type: "text", text: "https://github.com/real-org/real-repo/pull/12" },
        ],
      },
      "s",
      state,
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].prNumber, 12);
  });

  test("emits with null branch when there is no paired tool_use", () => {
    const state = createClaudeCodeParserState();
    const events = parseClaudeCodeLine(
      {
        type: "tool_result",
        tool_use_id: "missing",
        content: "https://github.com/real-org/real-repo/pull/4",
      },
      "s",
      state,
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].branchName, null);
  });

  test("ignores non-Bash tool_use lines", () => {
    const state = createClaudeCodeParserState();
    parseClaudeCodeLine(
      { type: "tool_use", id: "use-4", name: "Read", input: { file_path: "/x" } },
      "s",
      state,
    );
    assert.equal(state.pendingToolUses.size, 0);
  });

  test("emits zero events for tool_result containing no PR URLs", () => {
    const state = createClaudeCodeParserState();
    parseClaudeCodeLine(
      { type: "tool_use", id: "use-5", name: "Bash", input: { command: "ls" } },
      "s",
      state,
    );
    const events = parseClaudeCodeLine(
      { type: "tool_result", tool_use_id: "use-5", content: "file1\nfile2" },
      "s",
      state,
    );
    assert.equal(events.length, 0);
  });

  test("filters fixture URLs in tool_result content", () => {
    const state = createClaudeCodeParserState();
    const events = parseClaudeCodeLine(
      {
        type: "tool_result",
        tool_use_id: "x",
        content: "https://github.com/acme/sandbox/pull/1",
      },
      "s",
      state,
    );
    assert.equal(events.length, 0);
  });

  test("bounds pendingToolUses map to prevent unbounded growth", () => {
    const state = createClaudeCodeParserState();
    for (let i = 0; i < 500; i++) {
      parseClaudeCodeLine(
        { type: "tool_use", id: `use-${i}`, name: "Bash", input: { command: "ls" } },
        "s",
        state,
      );
    }
    assert.ok(state.pendingToolUses.size <= 256);
  });
});
