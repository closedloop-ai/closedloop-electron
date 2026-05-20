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

function makeGStackTree(
  home,
  { skills = ["office-hours", "ship", "review"], version = null } = {},
) {
  const root = nodePath.join(home, ".claude", "skills", "gstack");
  fs.mkdirSync(root, { recursive: true });
  for (const name of skills) {
    writeFile(
      nodePath.join(root, name, "SKILL.md"),
      `---\nname: ${name}\nversion: 1.0.0\ndescription: Test skill ${name}\n---\n# ${name}\n`,
    );
  }
  if (version) {
    fs.writeFileSync(nodePath.join(root, "VERSION"), `${version}\n`);
  }
  return root;
}

// Legacy BMad layout (pre-v6): a global Claude Code plugin under
// ~/.claude/skills/bmad-method with marketplace.json + src/{core,bmm}-skills.
// Still supported by the scanner for back-compat.
function makeLegacyBmadTree(home) {
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

// Current BMad layout (v6+, from `npx bmad-method install`): per-project
// install with .agents/skills/bmad-*/SKILL.md and _bmad/_config/manifest.yaml
// for version. No marketplace.json.
function makeBmadV6Tree(projectRoot) {
  fs.mkdirSync(nodePath.join(projectRoot, ".agents", "skills"), {
    recursive: true,
  });
  const skills = ["bmad-help", "bmad-prd", "bmad-party-mode"];
  for (const s of skills) {
    writeFile(
      nodePath.join(projectRoot, ".agents", "skills", s, "SKILL.md"),
      `---\nname: ${s}\ndescription: Test ${s}\n---\n# ${s}\n`,
    );
  }
  // Throw in a non-bmad sibling skill that must NOT be attributed to bmad.
  writeFile(
    nodePath.join(projectRoot, ".agents", "skills", "other-pack-skill", "SKILL.md"),
    `---\nname: other-pack-skill\n---\n`,
  );
  fs.mkdirSync(nodePath.join(projectRoot, "_bmad", "_config"), {
    recursive: true,
  });
  fs.writeFileSync(
    nodePath.join(projectRoot, "_bmad", "_config", "manifest.yaml"),
    [
      "installation:",
      "  version: 6.7.1",
      "  installDate: 2026-05-20T23:13:17.769Z",
      "modules:",
      "  - name: core",
      "    version: 6.7.1",
    ].join("\n"),
  );
  return projectRoot;
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

test("scanner detects legacy BMad install via marketplace.json", () => {
  const home = mkdtemp();
  makeLegacyBmadTree(home);
  const db = makeDb();

  withFakeHome(home, () => runPackScanner(db));

  const pack = getPack(db, "bmad-method");
  assert.ok(pack, "bmad-method pack should be present");
  assert.equal(pack.version, "6.6.0");
  assert.ok(pack.skills.length >= 2);
});

test("scanner detects BMad v6+ project install via .agents/skills/bmad-*", () => {
  const home = mkdtemp();
  const projectRoot = nodePath.join(home, "projects", "myapp");
  fs.mkdirSync(projectRoot, { recursive: true });
  makeBmadV6Tree(projectRoot);

  const db = makeDb();
  addHarnessColumn(db);
  // Scanner walks sessions.cwd to find candidate project roots
  seedSession(db, "s1", "claude");
  db.prepare("UPDATE sessions SET cwd = ? WHERE id = 's1'").run(projectRoot);

  withFakeHome(home, () => runPackScanner(db));

  const pack = getPack(db, "bmad-method");
  assert.ok(pack, "bmad-method pack should be present");
  assert.equal(pack.version, "6.7.1", "version should be read from manifest.yaml");

  // Pack is registered for both harnesses (BMad supports claude + codex)
  const harnesses = pack.installs.map((i) => i.harness).sort();
  assert.deepEqual(harnesses, ["claude", "codex"]);

  // Only bmad-* skills are attributed; the sibling `other-pack-skill` is not.
  const bmadSkillNames = pack.skills.map((s) => s.name).sort();
  assert.ok(
    bmadSkillNames.every((n) => n.startsWith("bmad-")),
    "no non-bmad sibling skills should be ingested under bmad-method",
  );
  assert.ok(bmadSkillNames.includes("bmad-help"));
  assert.ok(bmadSkillNames.includes("bmad-prd"));
  assert.ok(bmadSkillNames.includes("bmad-party-mode"));

  // Project association recorded
  assert.equal(
    pack.associations.length,
    1,
    "one project association expected",
  );
  assert.equal(pack.associations[0].project_path, projectRoot);
});

test("gstack Codex install collapses N per-skill symlinks into ONE install row", () => {
  const home = mkdtemp();
  // Simulate the Codex install: ~/.codex/skills/gstack-<name> symlinks
  // pointing into the Claude install's .agents/skills tree. Use a real
  // physical "source" repo and real symlinks so safeRealpath / findSkillFiles
  // behave as they do in production.
  const claudeRoot = nodePath.join(home, ".claude", "skills", "gstack");
  const codexRoot = nodePath.join(home, ".codex", "skills");
  fs.mkdirSync(claudeRoot, { recursive: true });
  fs.mkdirSync(codexRoot, { recursive: true });
  // Claude install needs a SKILL.md somewhere so its scan path triggers
  writeFile(
    nodePath.join(claudeRoot, "office-hours", "SKILL.md"),
    `---\nname: office-hours\n---\n`,
  );
  // Source tree the codex symlinks point INTO
  const sourceSkillsRoot = nodePath.join(claudeRoot, ".agents", "skills");
  for (const name of ["office-hours", "ship", "review", "investigate"]) {
    writeFile(
      nodePath.join(sourceSkillsRoot, `gstack-${name}`, "SKILL.md"),
      `---\nname: ${name}\n---\n`,
    );
    // Symlink each into ~/.codex/skills/gstack-<name>
    fs.symlinkSync(
      nodePath.join(sourceSkillsRoot, `gstack-${name}`),
      nodePath.join(codexRoot, `gstack-${name}`),
    );
  }

  const db = makeDb();
  withFakeHome(home, () => runPackScanner(db));

  const packs = db
    .prepare(
      "SELECT harness, install_path FROM agent_packs WHERE pack_id='gstack' ORDER BY harness",
    )
    .all();
  // Expect exactly 2 install rows: 1 claude + 1 codex (NOT 1 + 4 symlinks).
  assert.equal(packs.length, 2, "expect one claude + one codex install row");
  const codexInstall = packs.find((p) => p.harness === "codex");
  assert.ok(codexInstall);
  assert.equal(
    codexInstall.install_path,
    codexRoot,
    "codex install path collapses to the skills root, not per-skill symlinks",
  );

  // All 4 codex-symlinked skills should still appear individually in the
  // skills table — collapse is for install rows only.
  const codexSkills = db
    .prepare(
      "SELECT COUNT(*) AS n FROM skills WHERE pack_id='gstack' AND harness='codex'",
    )
    .get().n;
  assert.equal(codexSkills, 4, "all symlinked skills still ingested");
});

test("runPackScanner prunes stale rows from prior scans", () => {
  const home = mkdtemp();
  makeGStackTree(home, { skills: ["office-hours"] });
  const db = makeDb();

  // Seed a stale row from a hypothetical earlier scanner version that
  // registered N per-skill installs. Backdated last_seen_at so the prune
  // step catches it.
  db.prepare(
    `INSERT INTO agent_packs
       (pack_id, harness, install_path, install_kind, source_url, version, detected_at, last_seen_at)
     VALUES ('gstack', 'codex', '/old/per/skill/path', 'symlink', NULL, NULL, ?, ?)`,
  ).run("2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z");
  db.prepare(
    `INSERT INTO skills (skill_id, pack_id, harness, install_path, name, detected_at, last_seen_at)
     VALUES ('stale-1', 'gstack', 'codex', '/old/path', 'stale-skill', ?, ?)`,
  ).run("2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z");

  withFakeHome(home, () => runPackScanner(db));

  const stalePack = db
    .prepare(
      "SELECT * FROM agent_packs WHERE install_path = '/old/per/skill/path'",
    )
    .get();
  assert.equal(stalePack, undefined, "stale agent_packs row should be pruned");
  const staleSkill = db
    .prepare("SELECT * FROM skills WHERE skill_id = 'stale-1'")
    .get();
  assert.equal(staleSkill, undefined, "stale skills row should be pruned");
});

test("scanner reads gstack pack version from top-level VERSION file", () => {
  const home = mkdtemp();
  makeGStackTree(home, { skills: ["office-hours"], version: "1.40.0.0" });
  const db = makeDb();

  withFakeHome(home, () => runPackScanner(db));

  const pack = getPack(db, "gstack");
  assert.ok(pack);
  const claudeInstall = pack.installs.find((i) => i.harness === "claude");
  assert.ok(claudeInstall);
  assert.equal(claudeInstall.version, "1.40.0.0");
});

test("readGStackVersion rejects malformed VERSION content", () => {
  const { _internals } = require("../pack-scanner");
  const home = mkdtemp();
  const root = nodePath.join(home, "g");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(nodePath.join(root, "VERSION"), "definitely not a version\n");
  assert.equal(_internals.readGStackVersion(root), null);
});

// Build a minimal Claude Code marketplace install on disk:
// ~/.claude/plugins/installed_plugins.json + per-plugin cache dirs with
// SKILL.md files inside each plugin's skills/ subdir. Mirrors the layout
// produced by `claude plugin install <p>@<marketplace> --scope user`.
function makeClaudeMarketplaceTree(home, marketplace, plugins) {
  const cacheRoot = nodePath.join(home, ".claude", "plugins", "cache", marketplace);
  const registry = { version: 2, plugins: {} };
  for (const p of plugins) {
    const installPath = nodePath.join(cacheRoot, p.name, p.version);
    fs.mkdirSync(installPath, { recursive: true });
    // Plugin manifest
    fs.mkdirSync(nodePath.join(installPath, ".claude-plugin"), {
      recursive: true,
    });
    fs.writeFileSync(
      nodePath.join(installPath, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: p.name, version: p.version }),
    );
    // Skills
    for (const skillName of p.skills || []) {
      writeFile(
        nodePath.join(installPath, "skills", skillName, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: skill ${skillName}\n---\n`,
      );
    }
    registry.plugins[`${p.name}@${marketplace}`] = [
      {
        scope: "user",
        installPath,
        version: p.version,
        installedAt: "2026-05-20T00:00:00Z",
        lastUpdated: "2026-05-20T00:00:00Z",
      },
    ];
  }
  const registryPath = nodePath.join(home, ".claude", "plugins", "installed_plugins.json");
  fs.mkdirSync(nodePath.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  return registry;
}

test("marketplace pack collapses to ONE install per harness regardless of plugin count", () => {
  const home = mkdtemp();
  makeClaudeMarketplaceTree(home, "closedloop-ai", [
    { name: "code", version: "1.11.20", skills: ["plan-validate", "decision-table", "find-plugin-file"] },
    { name: "code-review", version: "1.5.5", skills: ["start"] },
    { name: "judges", version: "1.7.1", skills: ["run-judges", "eval-cache"] },
    { name: "platform", version: "1.1.3", skills: [] },
    { name: "self-learning", version: "1.2.5", skills: ["push-learnings"] },
  ]);

  const db = makeDb();
  withFakeHome(home, () => runPackScanner(db));

  const pack = getPack(db, "closedloop-ai");
  assert.ok(pack, "closedloop-ai pack should be present");
  // Invariant: one install per (pack, harness). All 5 plugins belong to the
  // same marketplace install — that's still ONE install row, not 5.
  assert.equal(
    pack.installs.length,
    1,
    "marketplace collapses to one install row per harness",
  );
  assert.equal(pack.installs[0].harness, "claude");
  // install_path is the marketplace cache root, NOT a per-plugin versioned
  // path, so it remains stable across plugin version bumps.
  assert.ok(
    pack.installs[0].install_path.endsWith(
      nodePath.join(".claude", "plugins", "cache", "closedloop-ai"),
    ),
    `unexpected install_path: ${pack.installs[0].install_path}`,
  );
  // No single pack-level version (5 plugins at 5 versions).
  assert.equal(pack.installs[0].version, null);
  assert.equal(
    pack.installs[0].source_url,
    "https://github.com/closedloop-ai/claude-plugins",
  );

  // Skills still aggregate across all plugins (3+1+2+0+1 = 7).
  assert.equal(pack.skills.length, 7);
  const skillsByName = Object.fromEntries(pack.skills.map((s) => [s.name, s]));
  // Per-plugin versions ride along on each skill row (sourced from the
  // plugin.json the installer wrote), so the UI can still surface them.
  assert.equal(skillsByName["plan-validate"].version, "1.11.20");
  assert.equal(skillsByName["run-judges"].version, "1.7.1");
  assert.equal(skillsByName["push-learnings"].version, "1.2.5");
});

test("marketplace scanner ignores reserved pack_ids (gstack, bmad-method)", () => {
  // Hypothetical: someone publishes "gstack" via a Claude marketplace too.
  // It should be skipped to avoid colliding with the dedicated gstack scanner.
  const home = mkdtemp();
  makeClaudeMarketplaceTree(home, "gstack", [
    { name: "office-hours", version: "9.9.9", skills: ["office-hours"] },
  ]);
  const db = makeDb();
  withFakeHome(home, () => runPackScanner(db));
  const pack = getPack(db, "gstack");
  // Either null (no real gstack install) or the real one — but NEVER the
  // hypothetical marketplace install.
  if (pack) {
    assert.ok(
      pack.installs.every((i) => i.version !== "9.9.9"),
      "marketplace shouldn't have created a fake gstack install",
    );
  }
});

test("BMad v6+ manifest parser tolerates missing version", () => {
  const { _internals } = require("../pack-scanner");
  const home = mkdtemp();
  const root = nodePath.join(home, "proj");
  fs.mkdirSync(nodePath.join(root, "_bmad", "_config"), { recursive: true });
  fs.writeFileSync(
    nodePath.join(root, "_bmad", "_config", "manifest.yaml"),
    "installation:\n  installDate: 2026-05-20\n",
  );
  const result = _internals.readBmadProjectManifest(root);
  assert.equal(result, null, "no version line → null");
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
