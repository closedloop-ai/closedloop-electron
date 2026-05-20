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
  for (const entry of safeReadDir(codexSkillsRoot)) {
    if (entry.name !== "gstack" && !entry.name.startsWith("gstack-")) continue;
    const installPath = path.join(codexSkillsRoot, entry.name);
    const real = safeRealpath(installPath);
    if (!findSkillFiles(real).length) continue;
    const added = ingestPackDir(db, {
      packId: "gstack",
      harness: "codex",
      installPath,
    });
    results.installs += 1;
    results.skills += added;
  }

  return results;
}

/**
 * Parse `marketplace.json` and confirm it's a BMad plugin. Returns
 * `{ version }` on match, null otherwise.
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
 * Detect BMad: globally under `~/.claude/skills` via marketplace.json, plus
 * per-project under recent `sessions.cwd` via `_bmad/` directory.
 */
function scanBmad(db) {
  const results = { installs: 0, skills: 0, projects: 0 };

  // 1. Global installs under ~/.claude/skills/<dir>/.claude-plugin/marketplace.json
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

  // 2. Per-project: walk distinct sessions.cwd from the last 90 days.
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
    const bmadDir = path.join(projectRoot, "_bmad");
    if (!safeStat(bmadDir)) continue;

    // Walk up to 3 parent dirs looking for marketplace.json (for version)
    let marketplace = null;
    let probe = projectRoot;
    for (let i = 0; i < 4 && !marketplace; i++) {
      marketplace = readBmadMarketplace(probe);
      probe = path.dirname(probe);
      if (probe === path.dirname(probe)) break; // hit fs root
    }

    const added = ingestPackDir(db, {
      packId: "bmad-method",
      harness: "claude",
      installPath: bmadDir,
      version: marketplace ? marketplace.version : null,
    });
    upsertProjectAssociation(db, {
      project_path: projectRoot,
      pack_id: "bmad-method",
    });
    results.installs += 1;
    results.skills += added;
    results.projects += 1;
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
 * Top-level entry: run every scan path. Best-effort — exceptions in one branch
 * never block another. Safe to call repeatedly.
 *
 * @returns {{
 *   gstack: {installs:number, skills:number},
 *   bmad:   {installs:number, skills:number, projects:number},
 *   gstackProjects: number
 * }}
 */
function runPackScanner(db) {
  const summary = {
    gstack: { installs: 0, skills: 0 },
    bmad: { installs: 0, skills: 0, projects: 0 },
    gstackProjects: 0,
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
    resolveClaudeHome,
    resolveCodexHome,
  },
};
