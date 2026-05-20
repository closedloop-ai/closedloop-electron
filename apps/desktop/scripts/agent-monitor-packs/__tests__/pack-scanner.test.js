/**
 * @file Unit tests for pack-scanner + pack-store (FEA-1224 / PLN-651).
 * Run: node --test apps/desktop/scripts/agent-monitor-packs/__tests__/
 *
 * Uses Node's built-in node:sqlite (DatabaseSync) as the db handle — its
 * prepare/run/get/all/exec surface matches the better-sqlite3 / compat-sqlite
 * API pack-store targets at runtime.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const os = require("node:os");
const nodePath = require("node:path");

const {
  runPackScanner,
  parseSkillFrontmatter,
  deterministicSkillId,
} = require("../pack-scanner");
const {
  ensurePackSchema,
  listPacks,
  getPack,
  listSkills,
  listSkillsForPack,
} = require("../pack-store");

function mkdtemp() {
  return fs.mkdtempSync(nodePath.join(os.tmpdir(), "pack-scanner-"));
}

function writeFile(p, content) {
  fs.mkdirSync(nodePath.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function makeDb() {
  const db = new DatabaseSync(":memory:");
  // Stub the upstream sessions / events tables so the scanner can join.
  // Columns mirror the production schema (sessions.model + sessions.harness
  // come from the upstream + FEA-1132 Codex patch respectively). Tests that
  // exercise the harness-aware path call addHarnessColumn() to mimic that.
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      name TEXT,
      cwd TEXT,
      model TEXT,
      status TEXT,
      started_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      event_type TEXT,
      tool_name TEXT,
      summary TEXT,
      data TEXT,
      created_at TEXT
    );
  `);
  ensurePackSchema(db);
  return db;
}

function makeGStackTree(home, { skills = ["office-hours", "ship", "review"] } = {}) {
  const root = nodePath.join(home, ".claude", "skills", "gstack");
  fs.mkdirSync(root, { recursive: true });
  for (const name of skills) {
    writeFile(
      nodePath.join(root, name, "SKILL.md"),
      `---\nname: ${name}\nversion: 1.0.0\ndescription: Test skill ${name}\n---\n# ${name}\n`,
    );
  }
  return root;
}

function makeBmadTree(home) {
  const root = nodePath.join(home, ".claude", "skills", "bmad-method");
  fs.mkdirSync(nodePath.join(root, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(
    nodePath.join(root, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "bmad-method", version: "6.6.0" }),
  );
  writeFile(
    nodePath.join(root, "src", "core-skills", "bmad-help", "SKILL.md"),
    `---\nname: bmad-help\nversion: 6.6.0\ndescription: BMad help skill\n---\n`,
  );
  writeFile(
    nodePath.join(root, "src", "bmm-skills", "bmad-party-mode", "SKILL.md"),
    `---\nname: bmad-party-mode\nversion: 6.6.0\n---\n`,
  );
  return root;
}

function withFakeHome(home, fn) {
  const prevClaude = process.env.CLAUDE_HOME;
  const prevCodex = process.env.CODEX_HOME;
  process.env.CLAUDE_HOME = nodePath.join(home, ".claude");
  process.env.CODEX_HOME = nodePath.join(home, ".codex");
  try {
    return fn();
  } finally {
    if (prevClaude === undefined) delete process.env.CLAUDE_HOME;
    else process.env.CLAUDE_HOME = prevClaude;
    if (prevCodex === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodex;
  }
}

test("parseSkillFrontmatter handles missing fields gracefully", () => {
  assert.equal(parseSkillFrontmatter("no frontmatter here"), null);
  const meta = parseSkillFrontmatter("---\nname: foo\n---\nbody");
  assert.deepEqual(meta, { name: "foo" });
  const quoted = parseSkillFrontmatter(
    '---\nname: "foo bar"\nversion: \'1.2.3\'\n---\n',
  );
  assert.equal(quoted.name, "foo bar");
  assert.equal(quoted.version, "1.2.3");
});

test("deterministicSkillId is stable for same inputs", () => {
  const a = deterministicSkillId("claude", "/path/to/install", "office-hours");
  const b = deterministicSkillId("claude", "/path/to/install", "office-hours");
  assert.equal(a, b);
  const c = deterministicSkillId("codex", "/path/to/install", "office-hours");
  assert.notEqual(a, c);
});

test("scanner detects GStack and writes inventory rows", () => {
  const home = mkdtemp();
  makeGStackTree(home);
  const db = makeDb();

  withFakeHome(home, () => runPackScanner(db));

  const packs = listPacks(db);
  assert.equal(packs.length, 1);
  assert.equal(packs[0].pack_id, "gstack");
  assert.equal(packs[0].skill_count, 3);

  const skills = listSkillsForPack(db, "gstack");
  assert.equal(skills.length, 3);
  assert.ok(skills.every((s) => s.harness === "claude"));
});

test("scanner detects BMad via marketplace.json and parses version", () => {
  const home = mkdtemp();
  makeBmadTree(home);
  const db = makeDb();

  withFakeHome(home, () => runPackScanner(db));

  const pack = getPack(db, "bmad-method");
  assert.ok(pack, "bmad-method pack should be present");
  assert.equal(pack.version, "6.6.0");
  assert.ok(pack.skills.length >= 2);
});

test("scanner is idempotent — re-running does not duplicate rows", () => {
  const home = mkdtemp();
  makeGStackTree(home);
  const db = makeDb();

  withFakeHome(home, () => {
    runPackScanner(db);
    runPackScanner(db);
    runPackScanner(db);
  });

  const packRows = db.prepare("SELECT COUNT(*) AS c FROM agent_packs").get().c;
  const skillRows = db.prepare("SELECT COUNT(*) AS c FROM skills").get().c;
  assert.equal(packRows, 1);
  assert.equal(skillRows, 3);
});

test("missing skills directory is non-fatal", () => {
  const home = mkdtemp(); // empty — no .claude/skills tree
  const db = makeDb();
  assert.doesNotThrow(() => withFakeHome(home, () => runPackScanner(db)));
  assert.equal(listPacks(db).length, 0);
});

test("per-project association detected via .gstack/conductor.json", () => {
  const home = mkdtemp();
  makeGStackTree(home);
  const projectRoot = nodePath.join(home, "projects", "myapp");
  fs.mkdirSync(nodePath.join(projectRoot, ".gstack"), { recursive: true });
  fs.writeFileSync(
    nodePath.join(projectRoot, ".gstack", "conductor.json"),
    "{}",
  );

  const db = makeDb();
  db.prepare(
    `INSERT INTO sessions (id, cwd, started_at, updated_at)
     VALUES ('s1', ?, ?, ?)`,
  ).run(projectRoot, new Date().toISOString(), new Date().toISOString());

  withFakeHome(home, () => runPackScanner(db));

  const assoc = db
    .prepare("SELECT * FROM project_pack_associations WHERE pack_id='gstack'")
    .all();
  assert.equal(assoc.length, 1);
  assert.equal(assoc[0].project_path, projectRoot);
});

// makeDb stubs sessions WITHOUT a harness column to mirror a legacy DB; the
// harness-aware tests below add the column where they need it. The default
// store SQL uses COALESCE(NULLIF(sess.harness, ''), 'claude') so legacy rows
// without harness stamp as Claude — the documented backward-compat behavior.

function addHarnessColumn(db) {
  try {
    db.prepare("SELECT harness FROM sessions LIMIT 1").get();
  } catch {
    db.prepare(
      "ALTER TABLE sessions ADD COLUMN harness TEXT NOT NULL DEFAULT 'claude'",
    ).run();
  }
}

function seedSession(db, id, harness, model = null) {
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (id, name, cwd, started_at, updated_at, model)
     VALUES (?, ?, '/Users/me/proj', ?, ?, ?)`,
  ).run(id, id, ts, ts, model);
  if (harness) {
    db.prepare("UPDATE sessions SET harness = ? WHERE id = ?").run(harness, id);
  }
}

function seedPrompt(db, sessionId, prompt) {
  db.prepare(
    `INSERT INTO events (session_id, event_type, data, created_at)
     VALUES (?, 'UserPromptSubmit', ?, ?)`,
  ).run(sessionId, JSON.stringify({ prompt }), new Date().toISOString());
}

test("listSkills returns invocation counts from UserPromptSubmit events", () => {
  const home = mkdtemp();
  makeGStackTree(home, { skills: ["office-hours", "ship"] });
  const db = makeDb();
  addHarnessColumn(db);
  seedSession(db, "s1", "claude", "claude-opus-4-7");

  seedPrompt(db, "s1", "/office-hours");
  seedPrompt(db, "s1", "/office-hours can you brainstorm an idea?");
  seedPrompt(db, "s1", "/ship");
  // Negative case: a plain prose prompt — must NOT count toward office-hours.
  seedPrompt(db, "s1", "office-hours please");

  withFakeHome(home, () => runPackScanner(db));

  const skills = listSkills(db).filter((s) => s.harness === "claude");
  const office = skills.find((s) => s.name === "office-hours");
  const ship = skills.find((s) => s.name === "ship");
  assert.ok(office);
  assert.equal(office.invocation_count, 2);
  assert.ok(ship);
  assert.equal(ship.invocation_count, 1);
});

test("listSkills partitions invocations by harness — codex calls do not bleed into claude row", () => {
  const home = mkdtemp();
  makeGStackTree(home, { skills: ["office-hours"] });
  // Also create the Codex install of gstack so we get two install rows.
  const codexRoot = nodePath.join(home, ".codex", "skills", "gstack");
  fs.mkdirSync(nodePath.join(codexRoot, "office-hours"), { recursive: true });
  fs.writeFileSync(
    nodePath.join(codexRoot, "office-hours", "SKILL.md"),
    `---\nname: office-hours\nversion: 1.0.0\n---\n`,
  );

  const db = makeDb();
  addHarnessColumn(db);
  seedSession(db, "c1", "claude", "claude-opus-4-7");
  seedSession(db, "x1", "codex", "gpt-5.5");
  seedPrompt(db, "c1", "/office-hours via claude");
  seedPrompt(db, "c1", "/office-hours another via claude");
  seedPrompt(db, "x1", "/office-hours via codex");

  withFakeHome(home, () => runPackScanner(db));

  const skills = listSkills(db).filter((s) => s.name === "office-hours");
  const claudeRow = skills.find((s) => s.harness === "claude");
  const codexRow = skills.find((s) => s.harness === "codex");
  assert.ok(claudeRow, "claude install row should be present");
  assert.ok(codexRow, "codex install row should be present");
  assert.equal(claudeRow.invocation_count, 2);
  assert.equal(codexRow.invocation_count, 1);
});

test("listSkillInvocations filters by harness and returns session metadata", () => {
  const home = mkdtemp();
  makeGStackTree(home, { skills: ["office-hours"] });
  const db = makeDb();
  addHarnessColumn(db);
  seedSession(db, "c1", "claude", "claude-sonnet-4-6");
  seedSession(db, "x1", "codex", "gpt-5.5");

  seedPrompt(db, "c1", "/office-hours one");
  seedPrompt(db, "x1", "/office-hours via codex");
  seedPrompt(db, "c1", "/office-hours two");

  withFakeHome(home, () => runPackScanner(db));

  const { listSkillInvocations } = require("../pack-store");
  const claudeCalls = listSkillInvocations(db, "office-hours", {
    limit: 10,
    harness: "claude",
  });
  assert.equal(claudeCalls.length, 2);
  assert.ok(claudeCalls.every((c) => c.session_harness === "claude"));
  assert.ok(claudeCalls.every((c) => c.session_model === "claude-sonnet-4-6"));

  const codexCalls = listSkillInvocations(db, "office-hours", {
    limit: 10,
    harness: "codex",
  });
  assert.equal(codexCalls.length, 1);
  assert.equal(codexCalls[0].session_harness, "codex");
  assert.equal(codexCalls[0].session_model, "gpt-5.5");

  // No harness filter → all matching invocations.
  const allCalls = listSkillInvocations(db, "office-hours", { limit: 10 });
  assert.equal(allCalls.length, 3);
});

test("no skill_invocations table is ever created", () => {
  const home = mkdtemp();
  makeGStackTree(home);
  const db = makeDb();

  withFakeHome(home, () => runPackScanner(db));

  const skillInv = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='skill_invocations'",
    )
    .get();
  assert.equal(skillInv, undefined);
  const assoc = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='session_artifact_associations'",
    )
    .get();
  assert.equal(assoc, undefined);
});
