/**
 * @file Unit tests for the command-gated PR parsers (FEA-1226).
 * Run: node --test apps/desktop/scripts/agent-monitor-pull-requests/__tests__/
 *
 * Golden-master: every fixture file is parsed and compared to the exact event
 * set in expected-events.json. The fixtures are synthetic-but-faithful — each
 * shape derived from a 2,561-file corpus of real engineer session logs.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, test } = require("node:test");
const {
  createSessionParserState,
  parseSessionLine,
  safeParseLine,
  extractPrUrlsFromText,
  isPrCreateCommand,
  isFixtureOwner,
} = require("../pr-parsers");

const FIXTURES = path.join(__dirname, "fixtures");

function parseFixture(name) {
  const text = fs.readFileSync(path.join(FIXTURES, name), "utf8");
  const state = createSessionParserState();
  const fallbackId = name.replace(/\.jsonl$/, "");
  const events = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const parsed = safeParseLine(line);
    if (!parsed) continue;
    for (const ev of parseSessionLine(parsed, fallbackId, state)) events.push(ev);
  }
  return events;
}

function eventKey(e) {
  return [
    e.harness,
    e.externalSessionId,
    e.prUrl,
    e.prNumber,
    e.repoFullName,
    e.branchName || "—",
  ].join("|");
}

const expected = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, "expected-events.json"), "utf8"),
);

describe("parseSessionLine — golden master against real-schema fixtures", () => {
  for (const fixtureFile of Object.keys(expected)) {
    if (fixtureFile.startsWith("_")) continue;
    test(`${fixtureFile} yields exactly its expected events`, () => {
      const actual = parseFixture(fixtureFile);
      const actualKeys = new Set(actual.map(eventKey));
      const expectedKeys = new Set(expected[fixtureFile].map(eventKey));
      assert.equal(
        actual.length,
        expected[fixtureFile].length,
        `${fixtureFile}: expected ${expected[fixtureFile].length}, got ${actual.length} -> ${[...actualKeys].join(", ")}`,
      );
      for (const k of expectedKeys) {
        assert.ok(actualKeys.has(k), `${fixtureFile}: missing ${k}`);
      }
      for (const k of actualKeys) {
        assert.ok(expectedKeys.has(k), `${fixtureFile}: unexpected ${k}`);
      }
    });
  }

  test("negatives.jsonl produces ZERO captures (the 53%-noise guard)", () => {
    assert.equal(parseFixture("negatives.jsonl").length, 0);
  });
});

describe("isPrCreateCommand — command gate", () => {
  test("accepts gh pr create in command position", () => {
    assert.ok(isPrCreateCommand("gh pr create --fill"));
    assert.ok(isPrCreateCommand("git push -u origin HEAD && gh pr create --base main"));
  });
  test("rejects non-creating gh subcommands", () => {
    for (const c of [
      "gh pr view 88 --json url",
      "gh pr edit 88 --body-file -",
      "gh pr list",
      "gh pr checks 88",
      "gh api repos/x/y/pulls/88/comments -X POST",
    ]) {
      assert.equal(isPrCreateCommand(c), false, `must reject: ${c}`);
    }
  });
  test("rejects gh pr create as an argument to another binary", () => {
    for (const c of [
      "echo gh pr create --fill",
      "cat log.txt | grep gh pr create",
      "git diff origin/main...HEAD",
      "",
    ]) {
      assert.equal(isPrCreateCommand(c), false, `must reject: ${c}`);
    }
  });
  test("tolerates non-string input", () => {
    assert.equal(isPrCreateCommand(undefined), false);
    assert.equal(isPrCreateCommand(null), false);
  });
});

describe("extractPrUrlsFromText", () => {
  test("extracts a confirmed PR URL", () => {
    const refs = extractPrUrlsFromText("see https://github.com/closedloop-ai/symphony-alpha/pull/1199");
    assert.equal(refs.length, 1);
    assert.equal(refs[0].prNumber, 1199);
    assert.equal(refs[0].repoFullName, "closedloop-ai/symphony-alpha");
  });
  test("rejects pull/new/<branch> push hints", () => {
    assert.equal(
      extractPrUrlsFromText("https://github.com/loopco/desktop/pull/new/feat/x").length,
      0,
    );
  });
  test("filters fixture owners", () => {
    for (const o of ["owner", "acme", "org", "example"]) {
      assert.equal(extractPrUrlsFromText(`https://github.com/${o}/r/pull/5`).length, 0);
    }
  });
  test("strips #discussion fragment to the bare PR number", () => {
    const refs = extractPrUrlsFromText("https://github.com/loopco/api/pull/88#discussion_r12");
    assert.equal(refs.length, 1);
    assert.equal(refs[0].prUrl, "https://github.com/loopco/api/pull/88");
  });
  test("isFixtureOwner is case-insensitive", () => {
    assert.equal(isFixtureOwner("ACME"), true);
    assert.equal(isFixtureOwner("closedloop-ai"), false);
  });
});

describe("safeParseLine", () => {
  test("parses objects, rejects everything else", () => {
    assert.deepEqual(safeParseLine('{"type":"pr-link"}'), { type: "pr-link" });
    assert.equal(safeParseLine('{"broken'), null);
    assert.equal(safeParseLine("[1,2]"), null);
    assert.equal(safeParseLine("not json"), null);
    assert.equal(safeParseLine(""), null);
  });
});
