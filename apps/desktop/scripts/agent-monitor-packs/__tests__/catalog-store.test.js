/**
 * @file Tests for catalog-store (FEA-1314 / PLN-657).
 * Run: node --test apps/desktop/scripts/agent-monitor-packs/__tests__/
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");

const {
  ensureCatalogSchema,
  upsertCatalogSeed,
  listCatalog,
  getCatalog,
  listHistory,
  applyFetchResult,
  recordInstallRunStart,
  recordInstallRunEnd,
  inFlightInstallRun,
  listInstallRuns,
  deleteInstallRun,
} = require("../catalog-store");
const { ensurePackSchema, upsertPack, upsertSkill } = require("../pack-store");

function makeDb() {
  const db = new DatabaseSync(":memory:");
  ensurePackSchema(db);
  ensureCatalogSchema(db);
  return db;
}

const SEED_FIXTURE = {
  seed_version: 1,
  packs: [
    {
      pack_id: "gstack",
      display_name: "gstack",
      category: "workflow-pack",
      github_url: "https://github.com/garrytan/gstack",
      description: "test gstack",
      harnesses: ["claude", "codex"],
      install_commands: { claude: "git clone ...", codex: "git clone ... --host codex" },
      uninstall_commands: { claude: "rm -rf ~/.claude/skills/gstack" },
    },
    {
      pack_id: "bmad-method",
      display_name: "BMAD",
      category: "framework",
      github_url: "https://github.com/bmad-code-org/BMAD-METHOD",
      description: "test bmad",
      harnesses: ["claude", "codex"],
      install_commands: { claude: "npx bmad-method install", codex: "npx bmad-method install" },
      project_scoped: true,
    },
    {
      pack_id: "superpowers",
      display_name: "Superpowers",
      category: "methodology",
      github_url: "https://github.com/obra/superpowers",
      description: "test superpowers",
      harnesses: ["claude"],
      install_commands: { claude: "git clone ..." },
    },
  ],
};

test("ensureCatalogSchema creates all three tables idempotently", () => {
  const db = makeDb();
  // Second call is a no-op.
  ensureCatalogSchema(db);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.ok(tables.includes("pack_catalog"));
  assert.ok(tables.includes("pack_catalog_history"));
  assert.ok(tables.includes("pack_install_runs"));
});

test("upsertCatalogSeed populates rows then is a no-op when seed_version unchanged", () => {
  const db = makeDb();
  const first = upsertCatalogSeed(db, SEED_FIXTURE);
  assert.equal(first.inserted, 3);
  assert.equal(first.updated, 0);
  assert.equal(first.skipped, 0);

  const again = upsertCatalogSeed(db, SEED_FIXTURE);
  assert.equal(again.inserted, 0);
  assert.equal(again.skipped, 3);
});

test("upsertCatalogSeed bumps rows when seed_version increases", () => {
  const db = makeDb();
  upsertCatalogSeed(db, SEED_FIXTURE);
  const v2 = {
    ...SEED_FIXTURE,
    seed_version: 2,
    packs: SEED_FIXTURE.packs.map((p) =>
      p.pack_id === "gstack" ? { ...p, description: "UPDATED" } : p,
    ),
  };
  const r = upsertCatalogSeed(db, v2);
  assert.equal(r.updated, 3);
  const g = getCatalog(db, "gstack");
  assert.equal(g.description, "UPDATED");
});

test("listCatalog joins against agent_packs and surfaces installed_harnesses", () => {
  const db = makeDb();
  upsertCatalogSeed(db, SEED_FIXTURE);
  // Mark gstack installed for claude + codex via the pack inventory tables
  upsertPack(db, {
    pack_id: "gstack",
    harness: "claude",
    install_path: "/home/me/.claude/skills/gstack",
    install_kind: "directory",
  });
  upsertPack(db, {
    pack_id: "gstack",
    harness: "codex",
    install_path: "/home/me/.codex/skills",
    install_kind: "symlink",
  });
  upsertSkill(db, {
    skill_id: "x",
    pack_id: "gstack",
    harness: "claude",
    install_path: "/p/s.md",
    name: "office-hours",
  });

  const items = listCatalog(db);
  const g = items.find((i) => i.pack_id === "gstack");
  assert.ok(g);
  assert.deepEqual([...g.installed_harnesses].sort(), ["claude", "codex"]);
  assert.equal(g.installed_skill_count, 1);

  const sp = items.find((i) => i.pack_id === "superpowers");
  assert.deepEqual(sp.installed_harnesses, []);
  assert.equal(sp.installed_skill_count, 0);

  // v3 sort: no pin_order on any of these → by stars (all null/0 in
  // this fixture) → alphabetic tiebreak. installed status is decorated
  // but no longer drives the sort.
  assert.equal(items[0].pack_id, "bmad-method");
});

test("listCatalog respects pin_order ahead of star count", () => {
  const db = makeDb();
  upsertCatalogSeed(db, {
    seed_version: 1,
    packs: [
      {
        pack_id: "high-star-not-pinned",
        display_name: "High Stars",
        github_url: "https://github.com/test/hs",
        harnesses: ["claude"],
      },
      {
        pack_id: "pinned-low-star",
        display_name: "Pinned",
        github_url: "https://github.com/test/p",
        harnesses: ["claude"],
        pin_order: 0,
      },
    ],
  });
  // Give "high-star-not-pinned" 200k stars; pinned has none.
  applyFetchResult(db, {
    pack_id: "high-star-not-pinned",
    stars: 200000,
    forks: 0,
  });
  const items = listCatalog(db);
  assert.equal(
    items[0].pack_id,
    "pinned-low-star",
    "pinned entry must lead even when another pack has way more stars",
  );
  assert.equal(items[1].pack_id, "high-star-not-pinned");
});

test("applyFetchResult updates live fields and appends a history row", () => {
  const db = makeDb();
  upsertCatalogSeed(db, SEED_FIXTURE);
  applyFetchResult(db, {
    pack_id: "gstack",
    stars: 100000,
    forks: 14900,
    description: "Live description",
    last_release: "v1.40.0.0",
  });
  const g = getCatalog(db, "gstack");
  assert.equal(g.stars, 100000);
  assert.equal(g.forks, 14900);
  assert.equal(g.description_live, "Live description");
  assert.equal(g.last_release, "v1.40.0.0");
  const history = listHistory(db, "gstack", 1);
  assert.equal(history.length, 1);
  assert.equal(history[0].stars, 100000);
});

test("getCatalog preserves project_scoped metadata for project installs", () => {
  const db = makeDb();
  upsertCatalogSeed(db, SEED_FIXTURE);
  const bmad = getCatalog(db, "bmad-method");
  assert.equal(bmad.project_scoped, 1);
});

test("install run lifecycle: start, query in-flight, end, list", () => {
  const db = makeDb();
  upsertCatalogSeed(db, SEED_FIXTURE);

  const id = recordInstallRunStart(db, {
    pack_id: "gstack",
    harness: "claude",
    command: "git clone ...",
  });
  assert.ok(id > 0);

  const inflight = inFlightInstallRun(db, "gstack");
  assert.ok(inflight);
  assert.equal(inflight.id, id);

  recordInstallRunEnd(db, id, {
    exit_code: 0,
    stdout_tail: "ok",
    stderr_tail: null,
  });
  assert.equal(inFlightInstallRun(db, "gstack"), undefined);

  const runs = listInstallRuns(db, { pack_id: "gstack" });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].exit_code, 0);

  assert.ok(deleteInstallRun(db, id));
  assert.equal(listInstallRuns(db, { pack_id: "gstack" }).length, 0);
});

test("deleteInstallRun refuses to delete an in-flight run", () => {
  const db = makeDb();
  upsertCatalogSeed(db, SEED_FIXTURE);
  const id = recordInstallRunStart(db, {
    pack_id: "gstack",
    harness: "claude",
    command: "sleep 9",
  });
  assert.equal(deleteInstallRun(db, id), false);
});

test("listHistory respects the day-range filter", () => {
  const db = makeDb();
  upsertCatalogSeed(db, SEED_FIXTURE);
  // Backdate a sample 60 days old via manual insert (applyFetchResult always
  // stamps "now").
  const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    "INSERT INTO pack_catalog_history (pack_id, fetched_at, stars, forks) VALUES (?, ?, ?, ?)",
  ).run("gstack", oldDate, 50000, 5000);
  applyFetchResult(db, { pack_id: "gstack", stars: 100000, forks: 14900 });
  assert.equal(listHistory(db, "gstack", 7).length, 1);
  assert.equal(listHistory(db, "gstack", 90).length, 2);
});
