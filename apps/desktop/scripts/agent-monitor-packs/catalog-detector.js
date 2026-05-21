/**
 * @file catalog-detector.js — per-pack on-disk detection adapters
 * (FEA-1314 v2).
 *
 * Each catalog pack has its OWN install layout (some land under
 * ~/.claude/skills, some under ~/.claude/commands, some are global npm
 * binaries). The base pack-scanner.js only knows gstack, bmad-method, and
 * Claude Code marketplaces. For everything else in the catalog, we ship
 * per-pack adapters so the catalog's Installed status accurately reflects
 * what's on disk.
 *
 * Naming invariant: each adapter's pack_id MUST exactly match the
 * catalog-seed.json pack_id for that entry, so listCatalog's JOIN against
 * agent_packs resolves correctly.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const { upsertPack, upsertSkill } = require("./pack-store");
const {
  parseSkillFrontmatter,
  deterministicSkillId,
  _internals,
} = require("./pack-scanner");

const { findSkillFiles } = _internals;

function resolveClaudeHome() {
  return process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude");
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

// ---------- per-pack adapters ----------

function detectVoltagentSubagents(db) {
  const root = path.join(resolveClaudeHome(), "skills", "voltagent-subagents");
  if (!safeStat(root)) return false;
  upsertPack(db, {
    pack_id: "voltagent-subagents",
    harness: "claude",
    install_path: root,
    install_kind: "directory",
    source_url: "https://github.com/VoltAgent/awesome-claude-code-subagents",
    version: null,
  });
  // VoltAgent uses .md (NOT SKILL.md). Walk categories/ for agent files.
  const categoriesDir = path.join(root, "categories");
  if (safeStat(categoriesDir)) {
    for (const cat of safeReadDir(categoriesDir)) {
      if (!cat.isDirectory()) continue;
      const catDir = path.join(categoriesDir, cat.name);
      for (const agent of safeReadDir(catDir)) {
        if (!agent.isFile() || !agent.name.endsWith(".md")) continue;
        if (agent.name.toUpperCase().startsWith("README")) continue;
        const name = path.basename(agent.name, ".md");
        upsertSkill(db, {
          skill_id: deterministicSkillId("claude", root, name),
          pack_id: "voltagent-subagents",
          harness: "claude",
          install_path: path.join(catDir, agent.name),
          name,
          version: null,
          description: null,
          source_url:
            "https://github.com/VoltAgent/awesome-claude-code-subagents",
        });
      }
    }
  }
  return true;
}

function detectAlirezaSkills(db) {
  const root = path.join(
    resolveClaudeHome(),
    "skills",
    "alirezarezvani-claude-skills",
  );
  if (!safeStat(root)) return false;
  upsertPack(db, {
    pack_id: "alirezarezvani-claude-skills",
    harness: "claude",
    install_path: root,
    install_kind: "directory",
    source_url: "https://github.com/alirezarezvani/claude-skills",
    version: null,
  });
  for (const skillFile of findSkillFiles(root)) {
    const content = safeReadFile(skillFile);
    if (content == null) continue;
    const meta = parseSkillFrontmatter(content) || {};
    const dirName = path.basename(path.dirname(skillFile));
    const name = meta.name || dirName;
    if (!name) continue;
    upsertSkill(db, {
      skill_id: deterministicSkillId("claude", root, name),
      pack_id: "alirezarezvani-claude-skills",
      harness: "claude",
      install_path: skillFile,
      name,
      version: meta.version || null,
      description: meta.description || null,
      source_url: "https://github.com/alirezarezvani/claude-skills",
    });
  }
  return true;
}

function detectSuperClaude(db) {
  // SuperClaude installs commands (NOT skills) into ~/.claude/commands/sc/.
  // Each .md file is one slash command. We surface them under a pack so the
  // catalog shows "Installed".
  const root = path.join(resolveClaudeHome(), "commands", "sc");
  if (!safeStat(root)) return false;
  upsertPack(db, {
    pack_id: "superclaude",
    harness: "claude",
    install_path: root,
    install_kind: "directory",
    source_url: "https://github.com/SuperClaude-Org/SuperClaude_Framework",
    version: null,
  });
  for (const entry of safeReadDir(root)) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    if (entry.name.toUpperCase().startsWith("README")) continue;
    const baseName = path.basename(entry.name, ".md");
    const name = `sc:${baseName}`;
    upsertSkill(db, {
      skill_id: deterministicSkillId("claude", root, name),
      pack_id: "superclaude",
      harness: "claude",
      install_path: path.join(root, entry.name),
      name,
      version: null,
      description: null,
      source_url: "https://github.com/SuperClaude-Org/SuperClaude_Framework",
    });
  }
  return true;
}

function detectClaudePluginsOfficial(db) {
  // Anthropic's official marketplace is a *registration*, not an install of
  // any single plugin. We surface it as "installed" when the marketplace
  // metadata is on disk under ~/.claude/plugins/marketplaces/.
  const root = path.join(
    resolveClaudeHome(),
    "plugins",
    "marketplaces",
    "claude-plugins-official",
  );
  if (!safeStat(root)) return false;
  upsertPack(db, {
    pack_id: "claude-plugins-official",
    harness: "claude",
    install_path: root,
    install_kind: "directory",
    source_url:
      "https://github.com/anthropics/claude-plugins-official",
    version: null,
  });
  return true;
}

/**
 * Detect a binary-installed, harness-agnostic CLI tool (e.g. RTK installed via
 * brew). Since the binary works regardless of which agent harness invokes it,
 * one detection registers an agent_packs row for EACH harness in
 * `harnesses`, so the catalog card's per-harness chips all flip to
 * "Installed" together.
 *
 * Returns `true` if the binary is on PATH (any of `binNames` resolvable), and
 * registers rows; `false` if not found.
 */
function detectBinaryTool(
  db,
  { pack_id, binNames, source_url, harnesses, versionArgs },
) {
  let binaryPath = null;
  for (const bin of binNames) {
    try {
      const out = execFileSync("/usr/bin/which", [bin], {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1000,
      });
      const trimmed = out.toString().trim();
      if (trimmed) {
        binaryPath = trimmed;
        break;
      }
    } catch {
      /* not on PATH — try next bin name */
    }
  }
  if (!binaryPath) return false;

  let version = null;
  if (Array.isArray(versionArgs) && versionArgs.length > 0) {
    try {
      const out = execFileSync(binaryPath, versionArgs, {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2000,
      });
      const m = out.toString().match(/(\d+(?:\.\d+)+)/);
      if (m) version = m[1];
    } catch {
      /* version probe is best-effort */
    }
  }
  for (const harness of harnesses) {
    upsertPack(db, {
      pack_id,
      harness,
      install_path: binaryPath,
      install_kind: "directory", // CHECK constraint allows symlink|directory
      source_url: source_url || null,
      version,
    });
  }
  return true;
}

function detectRtk(db) {
  return detectBinaryTool(db, {
    pack_id: "rtk",
    binNames: ["rtk"],
    source_url: "https://github.com/rtk-ai/rtk",
    harnesses: ["claude", "codex"],
    versionArgs: ["--version"],
  });
}

function detectClaudeCodeRouter(db) {
  // Global npm install — probe via `npm ls -g` (fast, no network).
  let installed = false;
  try {
    execFileSync(
      "npm",
      ["ls", "-g", "--depth=0", "@musistudio/claude-code-router"],
      { stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
    );
    installed = true;
  } catch {
    // Fall back to probing the binary on PATH (some users install via brew /
    // alternative package managers).
    try {
      execFileSync("which", ["ccr"], {
        stdio: ["ignore", "ignore", "ignore"],
        timeout: 1000,
      });
      installed = true;
    } catch {
      installed = false;
    }
  }
  if (!installed) return false;
  upsertPack(db, {
    pack_id: "claude-code-router",
    harness: "claude",
    install_path: "@musistudio/claude-code-router (npm -g)",
    install_kind: "directory",
    source_url: "https://github.com/musistudio/claude-code-router",
    version: null,
  });
  return true;
}

// ---------- top-level entry ----------

function runCatalogDetectors(db) {
  const results = {};
  const ADAPTERS = [
    ["voltagent-subagents", detectVoltagentSubagents],
    ["alirezarezvani-claude-skills", detectAlirezaSkills],
    ["superclaude", detectSuperClaude],
    ["claude-code-router", detectClaudeCodeRouter],
    ["claude-plugins-official", detectClaudePluginsOfficial],
    ["rtk", detectRtk],
  ];
  for (const [name, fn] of ADAPTERS) {
    try {
      results[name] = fn(db);
    } catch (e) {
      console.warn(
        `[catalog-detector] adapter ${name} failed:`,
        e && e.message,
      );
      results[name] = false;
    }
  }
  return results;
}

module.exports = {
  runCatalogDetectors,
  // Exported for tests
  _internals: {
    detectVoltagentSubagents,
    detectAlirezaSkills,
    detectSuperClaude,
    detectClaudeCodeRouter,
    detectClaudePluginsOfficial,
    detectRtk,
    detectBinaryTool,
  },
};
