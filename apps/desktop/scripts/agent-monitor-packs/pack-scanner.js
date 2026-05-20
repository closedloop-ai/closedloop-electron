/**
 * @file pack-scanner.js — filesystem-driven discovery of agent skill packs
 * (GStack + BMad Method) for the embedded Agent Dashboard (FEA-1224).
 *
 * Runs at sidecar startup, after `ensurePackSchema(db)` has created the three
 * inventory tables. Walks well-known skills roots (`~/.claude/skills`,
 * `~/.codex/skills`) and active project roots (distinct `sessions.cwd` from
 * recent rows) and upserts into `agent_packs`, `skills`, and
 * `project_pack_associations`. Idempotent — re-running bumps `last_seen_at`
 * but never produces duplicate rows.
 *
 * No `skill_invocations` table is written. Invocation history is sourced from
 * the existing `events` table at query time (see pack-store.listSkills).
 *
 * Materialized into the generated server/lib by build-agent-monitor.mjs;
 * relative requires (./pack-store) resolve there.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const {
  upsertPack,
  upsertSkill,
  upsertProjectAssociation,
} = require("./pack-store");

const PROJECT_LOOKBACK_DAYS = 90;
const GIT_REMOTE_TIMEOUT_MS = 1500;

function resolveClaudeHome() {
  return process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude");
}

function resolveCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function safeStat(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function safeReadDir(p) {
  try {
    return fs.readdirSync(p, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeReadFile(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function safeRealpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function isSymlink(p) {
  const st = safeStat(p);
  return !!st && st.isSymbolicLink();
}

function deterministicSkillId(harness, installPath, name) {
  return crypto
    .createHash("sha256")
    .update(`${harness}|${installPath}|${name}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Parse YAML frontmatter from a SKILL.md file. Lenient: missing fields are
 * returned as null rather than throwing. Returns null when no frontmatter
 * block is present.
 */
function parseSkillFrontmatter(content) {
  if (typeof content !== "string") return null;
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fields = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    let value = line.slice(sep + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  return fields;
}

/**
 * Walk a directory recursively (bounded depth) and yield every SKILL.md path.
 * Symlinks inside a pack are followed once; depth is capped to avoid runaway
 * traversal if a user has a weird layout.
 */
function findSkillFiles(root, { maxDepth = 6 } = {}) {
  const results = [];
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > maxDepth) continue;
    for (const entry of safeReadDir(dir)) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        stack.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        results.push(full);
      }
    }
  }
  return results;
}

function deriveGitRemoteUrl(dir) {
  try {
    const out = execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], {
      timeout: GIT_REMOTE_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.toString("utf8").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Ingest one resolved pack directory: write the agent_packs row and every
 * SKILL.md it contains. Used by both gstack and bmad detection paths.
 */
function ingestPackDir(db, { packId, harness, installPath, sourceUrl, version }) {
  const real = safeRealpath(installPath);
  const installKind = isSymlink(installPath) ? "symlink" : "directory";
  const remoteUrl = sourceUrl || deriveGitRemoteUrl(real);

  upsertPack(db, {
    pack_id: packId,
    harness,
    install_path: installPath,
    install_kind: installKind,
    source_url: remoteUrl,
    version: version || null,
  });

  let skillCount = 0;
  for (const skillFile of findSkillFiles(real)) {
    const content = safeReadFile(skillFile);
    if (content == null) continue;
    const meta = parseSkillFrontmatter(content) || {};
    const dirName = path.basename(path.dirname(skillFile));
    const name = meta.name || dirName;
    if (!name) continue;
    upsertSkill(db, {
      skill_id: deterministicSkillId(harness, installPath, name),
      pack_id: packId,
      harness,
      install_path: skillFile,
      name,
      version: meta.version || null,
      description: meta.description || null,
      source_url: remoteUrl,
    });
    skillCount++;
  }
  return skillCount;
}

/**
 * Detect GStack: look for `gstack` or `gstack-*` entries under each known
 * skills root.
 *
 * Claude install is a single directory at ~/.claude/skills/gstack — one
 * agent_packs row.
 *
 * Codex install is special: the gstack ./setup --host codex creates ONE
 * symlink per skill under ~/.codex/skills/ (gstack-autoplan, gstack-ship,
 * etc., ~46 entries), each pointing into the same upstream gstack repo's
 * .agents/skills tree. They all share one logical install — so we collapse
 * them into a single agent_packs row keyed on the codex skills root (rather
 * than registering 46 install rows), and still ingest every linked SKILL.md
 * into the skills table.
 */
function scanGStack(db) {
  const results = { installs: 0, skills: 0 };

  const claudeSkillsRoot = path.join(resolveClaudeHome(), "skills");
  for (const entry of safeReadDir(claudeSkillsRoot)) {
    if (entry.name !== "gstack") continue;
    const installPath = path.join(claudeSkillsRoot, entry.name);
    const real = safeRealpath(installPath);
    if (!findSkillFiles(real).length) continue;
    const added = ingestPackDir(db, {
      packId: "gstack",
      harness: "claude",
      installPath,
    });
    results.installs += 1;
    results.skills += added;
  }

  const codexSkillsRoot = path.join(resolveCodexHome(), "skills");
  const codexEntries = safeReadDir(codexSkillsRoot).filter(
    (e) =>
      (e.isDirectory() || e.isSymbolicLink()) &&
      (e.name === "gstack" || e.name.startsWith("gstack-")),
  );
  if (codexEntries.length > 0) {
    // Derive source_url from any one entry's real path (they all resolve to
    // the same source repo).
    let sourceUrl = null;
    for (const e of codexEntries) {
      const real = safeRealpath(path.join(codexSkillsRoot, e.name));
      sourceUrl =
        deriveGitRemoteUrl(real) || deriveGitRemoteUrl(path.dirname(real));
      if (sourceUrl) break;
    }
    upsertPack(db, {
      pack_id: "gstack",
      harness: "codex",
      install_path: codexSkillsRoot,
      install_kind: "symlink",
      source_url: sourceUrl,
      version: null,
    });
    results.installs += 1;
    for (const e of codexEntries) {
      const entryPath = path.join(codexSkillsRoot, e.name);
      const real = safeRealpath(entryPath);
      for (const skillFile of findSkillFiles(real)) {
        const content = safeReadFile(skillFile);
        if (content == null) continue;
        const meta = parseSkillFrontmatter(content) || {};
        const dirName = path.basename(path.dirname(skillFile));
        const name = meta.name || dirName;
        if (!name) continue;
        upsertSkill(db, {
          skill_id: deterministicSkillId("codex", codexSkillsRoot, name),
          pack_id: "gstack",
          harness: "codex",
          install_path: skillFile,
          name,
          version: meta.version || null,
          description: meta.description || null,
          source_url: sourceUrl,
        });
        results.skills += 1;
      }
    }
  }

  return results;
}

/**
 * Parse `marketplace.json` and confirm it's a BMad plugin (pre-v6 layout).
 * Returns `{ version }` on match, null otherwise. Kept for back-compat with
 * older BMad installs distributed as Claude Code plugins.
 */
function readBmadMarketplace(dir) {
  const file = path.join(dir, ".claude-plugin", "marketplace.json");
  const content = safeReadFile(file);
  if (!content) return null;
  try {
    const parsed = JSON.parse(content);
    if (parsed && parsed.name === "bmad-method") {
      return { version: parsed.version || null };
    }
  } catch {
    /* malformed JSON — non-fatal */
  }
  return null;
}

/**
 * Parse the project-local BMad install manifest (`_bmad/_config/manifest.yaml`)
 * to extract the installed version. Written by `npx bmad-method install`
 * (BMad v6+). Tiny line-based parser — sufficient for the well-known top-level
 * `installation.version: X.Y.Z` field; avoids pulling in a YAML dependency.
 */
function readBmadProjectManifest(projectRoot) {
  const manifestPath = path.join(
    projectRoot,
    "_bmad",
    "_config",
    "manifest.yaml",
  );
  const content = safeReadFile(manifestPath);
  if (!content) return null;
  // Find the `installation:` block and pull the first `version: ...` line
  // beneath it. Stops at the next top-level key (a line with no leading
  // whitespace and ending in `:`).
  const lines = content.split(/\r?\n/);
  let inInstallation = false;
  for (const raw of lines) {
    if (/^installation:\s*$/.test(raw)) {
      inInstallation = true;
      continue;
    }
    if (inInstallation && /^[A-Za-z_][^:]*:/.test(raw) && !raw.startsWith(" ")) {
      break;
    }
    if (inInstallation) {
      const m = raw.match(/^\s+version:\s*['"]?([0-9][0-9A-Za-z.\-+]*)['"]?\s*$/);
      if (m) return { version: m[1] };
    }
  }
  return null;
}

/**
 * Detect a BMad v6+ project install: project root has `.agents/skills/bmad-*`
 * directories with SKILL.md files. The `bmad-` skill-name prefix is the
 * pack identity signal (no marketplace.json in this layout).
 *
 * Returns the install_path + version (read from `_bmad/_config/manifest.yaml`
 * if present) — or null if no bmad-* skills are found under the root.
 */
function detectBmadProjectInstall(projectRoot) {
  const skillsRoot = path.join(projectRoot, ".agents", "skills");
  if (!safeStat(skillsRoot)) return null;
  const hasBmadSkill = safeReadDir(skillsRoot).some(
    (e) =>
      (e.isDirectory() || e.isSymbolicLink()) &&
      e.name.startsWith("bmad-") &&
      safeStat(path.join(skillsRoot, e.name, "SKILL.md")),
  );
  if (!hasBmadSkill) return null;
  const manifest = readBmadProjectManifest(projectRoot);
  return {
    installPath: skillsRoot,
    version: manifest ? manifest.version : null,
  };
}

/**
 * Ingest BMad v6+ skills from a project install path. Same shape as
 * ingestPackDir but only pulls in directories whose name is prefixed
 * "bmad-" — the .agents/skills root in BMad v6 can in principle host
 * non-BMad skills (other plugins use the same convention), so we
 * partition by name prefix.
 */
function ingestBmadProjectSkills(db, { installPath, harness, version }) {
  upsertPack(db, {
    pack_id: "bmad-method",
    harness,
    install_path: installPath,
    install_kind: "directory",
    source_url: "https://github.com/bmad-code-org/BMAD-METHOD",
    version: version || null,
  });
  let skillCount = 0;
  for (const entry of safeReadDir(installPath)) {
    if (!(entry.isDirectory() || entry.isSymbolicLink())) continue;
    if (!entry.name.startsWith("bmad-")) continue;
    const skillFile = path.join(installPath, entry.name, "SKILL.md");
    const content = safeReadFile(skillFile);
    if (content == null) continue;
    const meta = parseSkillFrontmatter(content) || {};
    const name = meta.name || entry.name;
    upsertSkill(db, {
      skill_id: deterministicSkillId(harness, installPath, name),
      pack_id: "bmad-method",
      harness,
      install_path: skillFile,
      name,
      version: meta.version || version || null,
      description: meta.description || null,
      source_url: "https://github.com/bmad-code-org/BMAD-METHOD",
    });
    skillCount++;
  }
  return skillCount;
}

/**
 * Detect BMad across all known layouts:
 *   1. v6+ per-project install via .agents/skills/bmad-* (current)
 *   2. Legacy global install via ~/.claude/skills/<plugin>/.claude-plugin/
 *      marketplace.json
 *   3. Legacy per-project install via _bmad/ directory (very old)
 *
 * Every install path also produces a project_pack_associations row for the
 * project root that hosts it.
 */
function scanBmad(db) {
  const results = { installs: 0, skills: 0, projects: 0 };

  // 1. Legacy global installs under ~/.claude/skills/<dir>/.claude-plugin/
  const claudeSkillsRoot = path.join(resolveClaudeHome(), "skills");
  for (const entry of safeReadDir(claudeSkillsRoot)) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const installPath = path.join(claudeSkillsRoot, entry.name);
    const marketplace = readBmadMarketplace(safeRealpath(installPath));
    if (!marketplace) continue;
    const added = ingestPackDir(db, {
      packId: "bmad-method",
      harness: "claude",
      installPath,
      version: marketplace.version,
    });
    results.installs += 1;
    results.skills += added;
  }

  // 2 & 3. Per-project: walk distinct sessions.cwd from the last 90 days.
  let projectRoots = [];
  try {
    const since = new Date(
      Date.now() - PROJECT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    projectRoots = db
      .prepare(
        `SELECT DISTINCT cwd FROM sessions
         WHERE cwd IS NOT NULL AND cwd != ''
           AND (updated_at >= ? OR started_at >= ?)`,
      )
      .all(since, since)
      .map((r) => r.cwd)
      .filter(Boolean);
  } catch {
    /* sessions table missing in tests / fresh DB — non-fatal */
  }

  for (const projectRoot of projectRoots) {
    let added = 0;
    let installedHere = false;

    // 2. BMad v6+: project-local `.agents/skills/bmad-*` install. Stamp the
    // pack against both `claude` and `codex` harnesses because the manifest
    // explicitly lists both as supported IDEs (and either can invoke the
    // skills from this same install).
    const v6 = detectBmadProjectInstall(projectRoot);
    if (v6) {
      for (const harness of ["claude", "codex"]) {
        added += ingestBmadProjectSkills(db, {
          installPath: v6.installPath,
          harness,
          version: v6.version,
        });
        results.installs += 1;
      }
      installedHere = true;
    }

    // 3. Legacy per-project `_bmad/` install with marketplace.json upstream.
    const legacyBmadDir = path.join(projectRoot, "_bmad");
    if (safeStat(legacyBmadDir) && !v6) {
      let marketplace = null;
      let probe = projectRoot;
      for (let i = 0; i < 4 && !marketplace; i++) {
        marketplace = readBmadMarketplace(probe);
        probe = path.dirname(probe);
        if (probe === path.dirname(probe)) break; // hit fs root
      }
      added += ingestPackDir(db, {
        packId: "bmad-method",
        harness: "claude",
        installPath: legacyBmadDir,
        version: marketplace ? marketplace.version : null,
      });
      results.installs += 1;
      installedHere = true;
    }

    if (installedHere) {
      upsertProjectAssociation(db, {
        project_path: projectRoot,
        pack_id: "bmad-method",
      });
      results.skills += added;
      results.projects += 1;
    }
  }

  return results;
}

/**
 * Scan recent project roots for `.gstack/conductor.json` markers and record
 * per-project associations.
 */
function scanProjectGStackAssociations(db) {
  let projectRoots = [];
  try {
    const since = new Date(
      Date.now() - PROJECT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    projectRoots = db
      .prepare(
        `SELECT DISTINCT cwd FROM sessions
         WHERE cwd IS NOT NULL AND cwd != ''
           AND (updated_at >= ? OR started_at >= ?)`,
      )
      .all(since, since)
      .map((r) => r.cwd)
      .filter(Boolean);
  } catch {
    return 0;
  }

  let count = 0;
  for (const projectRoot of projectRoots) {
    const marker = path.join(projectRoot, ".gstack", "conductor.json");
    if (!safeStat(marker)) continue;
    upsertProjectAssociation(db, {
      project_path: projectRoot,
      pack_id: "gstack",
    });
    count++;
  }
  return count;
}

/**
 * Drop pack-inventory rows that weren't touched during this scan. The scanner
 * is the filesystem-of-truth — any row in agent_packs / skills /
 * project_pack_associations that didn't have its last_seen_at refreshed by
 * the current pass is stale and should age out. Without this, schema changes
 * to the scanner (e.g. the 47-codex-rows -> 1-row collapse for gstack)
 * permanently leave the old rows in place.
 *
 * Best-effort: if any DELETE fails (locked DB, etc.) the scanner still
 * succeeds — pruning is a cleanup, not a correctness requirement.
 */
function pruneStaleRows(db, scanStartedAt) {
  try {
    db.prepare(
      "DELETE FROM agent_packs WHERE last_seen_at < ?",
    ).run(scanStartedAt);
  } catch (e) {
    console.warn("[pack-scanner] prune agent_packs failed:", e && e.message);
  }
  try {
    db.prepare("DELETE FROM skills WHERE last_seen_at < ?").run(scanStartedAt);
  } catch (e) {
    console.warn("[pack-scanner] prune skills failed:", e && e.message);
  }
  try {
    db.prepare(
      "DELETE FROM project_pack_associations WHERE last_seen_at < ?",
    ).run(scanStartedAt);
  } catch (e) {
    console.warn(
      "[pack-scanner] prune project_pack_associations failed:",
      e && e.message,
    );
  }
}

/**
 * Top-level entry: run every scan path. Best-effort — exceptions in one branch
 * never block another. Safe to call repeatedly. At the end, prune any
 * inventory rows whose last_seen_at wasn't refreshed (i.e. weren't observed
 * in the current pass).
 *
 * @returns {{
 *   gstack: {installs:number, skills:number},
 *   bmad:   {installs:number, skills:number, projects:number},
 *   gstackProjects: number,
 *   prunedBefore: string
 * }}
 */
function runPackScanner(db) {
  const scanStartedAt = new Date().toISOString();
  const summary = {
    gstack: { installs: 0, skills: 0 },
    bmad: { installs: 0, skills: 0, projects: 0 },
    gstackProjects: 0,
    prunedBefore: scanStartedAt,
  };
  try {
    summary.gstack = scanGStack(db);
  } catch (e) {
    console.warn("[pack-scanner] gstack scan failed:", e && e.message);
  }
  try {
    summary.bmad = scanBmad(db);
  } catch (e) {
    console.warn("[pack-scanner] bmad scan failed:", e && e.message);
  }
  try {
    summary.gstackProjects = scanProjectGStackAssociations(db);
  } catch (e) {
    console.warn(
      "[pack-scanner] gstack project association scan failed:",
      e && e.message,
    );
  }
  pruneStaleRows(db, scanStartedAt);
  return summary;
}

module.exports = {
  runPackScanner,
  parseSkillFrontmatter,
  deterministicSkillId,
  // Exported for tests
  _internals: {
    findSkillFiles,
    readBmadMarketplace,
    readBmadProjectManifest,
    detectBmadProjectInstall,
    resolveClaudeHome,
    resolveCodexHome,
  },
};
