import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import {
  createSessionParserState,
  extractPrUrlsFromText,
  isFixtureOwner,
  isPrCreateCommand,
  parseSessionLine,
  safeParseLine,
} from "../src/main/session-log-parsers.js";
import type { GitActivityEventInput } from "../src/shared/git-activity-types.js";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "git-activity",
);

/** Parse a fixture file end-to-end exactly as the tailer would. */
function parseFixture(name: string): GitActivityEventInput[] {
  const text = fs.readFileSync(path.join(FIXTURES, name), "utf-8");
  const state = createSessionParserState();
  const fallbackId = name.replace(/\.jsonl$/, "");
  const events: GitActivityEventInput[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const parsed = safeParseLine(line);
    if (!parsed) continue;
    events.push(...parseSessionLine(parsed, fallbackId, state));
  }
  return events;
}

function eventKey(e: {
  harness: string;
  externalSessionId: string;
  prUrl: string;
  prNumber: number;
  repoFullName: string;
  branchName: string | null;
}): string {
  return [
    e.harness,
    e.externalSessionId,
    e.prUrl,
    e.prNumber,
    e.repoFullName,
    e.branchName ?? "—",
  ].join("|");
}

const expected = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, "expected-events.json"), "utf-8"),
) as Record<string, Array<Record<string, unknown>>>;

// ─── Golden-master: every fixture file vs expected-events.json ───────────────

describe("parseSessionLine — golden master against real-schema fixtures", () => {
  for (const fixtureFile of Object.keys(expected)) {
    if (fixtureFile.startsWith("_")) continue;
    test(`${fixtureFile} yields exactly its expected events`, () => {
      const actual = parseFixture(fixtureFile);
      const actualKeys = new Set(actual.map(eventKey));
      const expectedKeys = new Set(
        expected[fixtureFile].map((e) => eventKey(e as never)),
      );
      assert.equal(
        actual.length,
        expected[fixtureFile].length,
        `${fixtureFile}: expected ${expected[fixtureFile].length} events, got ${actual.length} -> ${[...actualKeys].join(", ")}`,
      );
      for (const k of expectedKeys) {
        assert.ok(actualKeys.has(k), `${fixtureFile}: missing expected event ${k}`);
      }
      for (const k of actualKeys) {
        assert.ok(expectedKeys.has(k), `${fixtureFile}: unexpected event ${k}`);
      }
    });
  }

  test("negatives.jsonl produces ZERO captures (the 53%-noise guard)", () => {
    assert.equal(parseFixture("negatives.jsonl").length, 0);
  });

  test("every captured event carries a real (not fallback) session id", () => {
    for (const f of ["claude-code-session.jsonl", "codex-session.jsonl", "loop-pr-link.jsonl"]) {
      for (const e of parseFixture(f)) {
        assert.match(e.externalSessionId, /^fixture-(cc|codex|loop)-\d+$/);
      }
    }
  });
});

// ─── Command gate ────────────────────────────────────────────────────────────

describe("isPrCreateCommand — command gate", () => {
  test("accepts gh pr create in all real positions", () => {
    assert.ok(isPrCreateCommand("gh pr create --fill"));
    assert.ok(isPrCreateCommand("git push -u origin HEAD && gh pr create --base main"));
    assert.ok(isPrCreateCommand("gh pr create"));
  });
  test("rejects every non-creating gh pr / gh api subcommand", () => {
    for (const c of [
      "gh pr view 88 --json url",
      "gh pr edit 88 --body-file -",
      "gh pr list --state open",
      "gh pr checks 88",
      "gh pr status",
      "gh api repos/x/y/pulls/88/comments -X POST",
    ]) {
      assert.equal(isPrCreateCommand(c), false, `must reject: ${c}`);
    }
  });
  test("rejects inspection commands", () => {
    for (const c of ["git diff origin/main...HEAD", "rg -n externalUrl test/", "cat pr.md", ""]) {
      assert.equal(isPrCreateCommand(c), false);
    }
  });
  test("rejects gh pr create appearing only as an argument to another binary", () => {
    for (const c of [
      "echo gh pr create --fill",
      "echo 'next step: gh pr create'",
      "cat pr-log.txt | grep gh pr create",
      "printf 'gh pr create\\n'",
    ]) {
      assert.equal(isPrCreateCommand(c), false, `must reject: ${c}`);
    }
  });
  test("tolerates non-string input", () => {
    assert.equal(isPrCreateCommand(undefined), false);
    assert.equal(isPrCreateCommand(null), false);
  });
});

// ─── URL extraction ──────────────────────────────────────────────────────────

describe("extractPrUrlsFromText", () => {
  test("extracts a confirmed PR URL", () => {
    const refs = extractPrUrlsFromText("done: https://github.com/closedloop-ai/symphony-alpha/pull/1199");
    assert.equal(refs.length, 1);
    assert.equal(refs[0].prNumber, 1199);
    assert.equal(refs[0].repoFullName, "closedloop-ai/symphony-alpha");
  });
  test("rejects pull/new/<branch> push hints", () => {
    assert.equal(
      extractPrUrlsFromText("https://github.com/loopco/desktop/pull/new/feat/onboarding").length,
      0,
    );
  });
  test("filters fixture owners (AC7)", () => {
    for (const o of ["owner", "acme", "org", "example", "test-org", "sample"]) {
      assert.equal(extractPrUrlsFromText(`https://github.com/${o}/repo/pull/5`).length, 0);
    }
  });
  test("ignores non-PR github URLs", () => {
    assert.equal(extractPrUrlsFromText("https://github.com/loopco/desktop/issues/9").length, 0);
    assert.equal(extractPrUrlsFromText("https://github.com/loopco/desktop/blob/main/x.ts").length, 0);
  });
  test("strips a #discussion fragment to the bare PR number", () => {
    const refs = extractPrUrlsFromText("https://github.com/loopco/api/pull/88#discussion_r3228520");
    assert.equal(refs.length, 1);
    assert.equal(refs[0].prNumber, 88);
    assert.equal(refs[0].prUrl, "https://github.com/loopco/api/pull/88");
  });
  test("isFixtureOwner is case-insensitive", () => {
    assert.ok(isFixtureOwner("ACME"));
    assert.equal(isFixtureOwner("closedloop-ai"), false);
  });
});

// ─── Schema-specific behaviour the corpus revealed ───────────────────────────

describe("real-schema parsing details", () => {
  test("Claude tool_use/tool_result are nested in message.content[], not top-level", () => {
    const state = createSessionParserState();
    // a top-level {"type":"tool_use"} (the WRONG schema my v1 assumed) yields nothing
    assert.equal(
      parseSessionLine({ type: "tool_use", name: "Bash" }, "s", state).length,
      0,
    );
  });
  test("Codex command output is gated by the paired function_call's command", () => {
    const state = createSessionParserState();
    // function_call records a non-creating command
    parseSessionLine(
      {
        type: "response_item",
        payload: {
          type: "function_call",
          arguments: '{"cmd":"gh pr view 5 --json url"}',
          call_id: "c1",
        },
      },
      "s",
      state,
    );
    // its output, even with a real PR URL, must not capture
    const out = parseSessionLine(
      {
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "c1",
          output: "https://github.com/loopco/api/pull/5",
        },
      },
      "s",
      state,
    );
    assert.equal(out.length, 0);
  });
  test("Codex session id comes from session_meta.payload.id", () => {
    const state = createSessionParserState();
    parseSessionLine(
      { type: "session_meta", payload: { id: "real-codex-id" } },
      "filename-fallback",
      state,
    );
    const events = parseSessionLine(
      {
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          parsed_cmd: [{ type: "unknown", cmd: "gh pr create --fill" }],
          aggregated_output: "https://github.com/loopco/desktop/pull/9",
        },
      },
      "filename-fallback",
      state,
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].externalSessionId, "real-codex-id");
  });
});

describe("safeParseLine", () => {
  test("parses valid JSON objects, rejects everything else", () => {
    assert.deepEqual(safeParseLine('{"type":"pr-link"}'), { type: "pr-link" });
    assert.equal(safeParseLine('{"broken'), null);
    assert.equal(safeParseLine("[1,2]"), null);
    assert.equal(safeParseLine("not json"), null);
    assert.equal(safeParseLine(""), null);
  });
});
