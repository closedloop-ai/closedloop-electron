/**
 * @file Unit tests for pr-extractor (FEA-1226).
 * Run: node --test apps/desktop/scripts/agent-monitor-pull-requests/__tests__/
 *
 * extractPullRequestsFromSession re-reads a session's raw JSONL and runs the
 * command-gated parsers. It pins every record to the importer's canonical
 * session id so the pull_requests row FK-joins to its sessions row.
 */
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { describe, test } = require("node:test");
const { extractPullRequestsFromSession } = require("../pr-extractor");

const FIXTURES = path.join(__dirname, "fixtures");

describe("extractPullRequestsFromSession", () => {
  test("extracts the 2 command-gated PRs from a Claude Code session file", () => {
    const prs = extractPullRequestsFromSession({
      sessionId: "canonical-session-1",
      sourceLogPath: path.join(FIXTURES, "claude-code-session.jsonl"),
    });
    assert.equal(prs.length, 2);
    for (const pr of prs) {
      assert.equal(pr.harness, "claude-code");
      assert.equal(
        pr.externalSessionId,
        "canonical-session-1",
        "session id must be pinned to the importer's canonical id",
      );
      assert.ok(typeof pr.observedAt === "string" && pr.observedAt.length > 0);
      assert.match(pr.prUrl, /^https:\/\/github\.com\/.+\/pull\/\d+$/);
    }
  });

  test("extracts the 2 command-gated PRs from a Codex rollout file", () => {
    const prs = extractPullRequestsFromSession({
      sessionId: "canonical-codex-1",
      sourceLogPath: path.join(FIXTURES, "codex-session.jsonl"),
    });
    assert.equal(prs.length, 2);
    assert.ok(prs.every((p) => p.harness === "codex"));
    assert.ok(prs.every((p) => p.externalSessionId === "canonical-codex-1"));
  });

  test("captures zero PRs from the negatives fixture (false-positive guard)", () => {
    const prs = extractPullRequestsFromSession({
      sessionId: "neg",
      sourceLogPath: path.join(FIXTURES, "negatives.jsonl"),
    });
    assert.equal(prs.length, 0);
  });

  test("returns [] when sourceLogPath is missing or unreadable", () => {
    assert.deepEqual(extractPullRequestsFromSession({ sessionId: "x" }), []);
    assert.deepEqual(
      extractPullRequestsFromSession({
        sessionId: "x",
        sourceLogPath: "/tmp/fea1226-does-not-exist-zzz.jsonl",
      }),
      [],
    );
    assert.deepEqual(extractPullRequestsFromSession(null), []);
  });
});
