/**
 * @file Tests for catalog-fetcher (FEA-1314 / PLN-657).
 * Pure-unit coverage of the URL parser + `runCatalogFetch` against a stub
 * fetch path. The live `gh` / REST path is exercised manually; these tests
 * validate the orchestration logic only.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");

const {
  ensureCatalogSchema,
  upsertCatalogSeed,
  getCatalog,
} = require("../catalog-store");
const { ensurePackSchema } = require("../pack-store");
const { _internals } = require("../catalog-fetcher");

function makeDb() {
  const db = new DatabaseSync(":memory:");
  ensurePackSchema(db); // catalog reads join agent_packs/skills
  ensureCatalogSchema(db);
  return db;
}

test("parseGithubUrl extracts owner/repo from common URL shapes", () => {
  const { parseGithubUrl } = _internals;
  assert.deepEqual(parseGithubUrl("https://github.com/foo/bar"), {
    owner: "foo",
    repo: "bar",
  });
  assert.deepEqual(parseGithubUrl("https://github.com/foo/bar.git"), {
    owner: "foo",
    repo: "bar",
  });
  assert.deepEqual(parseGithubUrl("https://github.com/foo/bar/tree/main"), {
    owner: "foo",
    repo: "bar",
  });
  assert.equal(parseGithubUrl("not a url"), null);
  assert.equal(parseGithubUrl(null), null);
});

test("ghCliAvailable returns boolean without throwing", () => {
  const { ghCliAvailable } = _internals;
  assert.equal(typeof ghCliAvailable(), "boolean");
});

test("catalog-fetcher handles empty catalog without error", async () => {
  const db = makeDb();
  const { runCatalogFetch } = require("../catalog-fetcher");
  const summary = await runCatalogFetch(db);
  assert.equal(summary.succeeded, 0);
  assert.equal(summary.failed, 0);
  assert.equal(summary.skipped, 0);
});

test("catalog-fetcher skips packs whose github_url is unparseable", async () => {
  const db = makeDb();
  upsertCatalogSeed(db, {
    seed_version: 1,
    packs: [
      {
        pack_id: "bogus",
        display_name: "Bogus",
        github_url: "not-a-github-url",
        harnesses: ["claude"],
      },
    ],
  });
  const { runCatalogFetch } = require("../catalog-fetcher");
  const summary = await runCatalogFetch(db);
  assert.equal(summary.skipped, 1);
  // The pack still exists in catalog; just no live fields populated.
  const entry = getCatalog(db, "bogus");
  assert.ok(entry);
  assert.equal(entry.stars, null);
});
