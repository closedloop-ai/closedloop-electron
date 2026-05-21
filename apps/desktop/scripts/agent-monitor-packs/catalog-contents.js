/**
 * @file catalog-contents.js — fetch per-pack contents (skills, agents,
 * commands, sub-plugins) from GitHub for the catalog detail view
 * (FEA-1314 v3). Cached in pack_catalog.contents_cache via
 * catalog-store.applyContentsFetch with a 7-day TTL.
 *
 * The per-pack `contents` JSON in catalog-seed.json declares how to scrape
 * each pack:
 *   - github-skill-tree         — list <skills_path>/<dir>/SKILL.md
 *   - github-multi-skill-tree   — multiple skill_paths (BMad)
 *   - github-flat-md            — flat dir of .md files (SuperClaude commands)
 *   - github-nested-md          — categories/<cat>/<file>.md (VoltAgent)
 *   - github-nested-skill-tree  — <team>/skills/<skill>/SKILL.md (alirezarezvani)
 *   - claude-marketplace        — read .claude-plugin/marketplace.json (closedloop)
 *   - github-claude-plugin      — single marketplace plugin: walks commands/ +
 *                                  agents/ + skills/ if present under plugin_path
 *                                  (claude-plugins-official entries)
 *   - none                      — pack has no skill/command listing (RTK, claude-code-router)
 *
 * Returns [{ name, kind, description?, path? }]. kind is one of
 * 'skill', 'command', 'agent', 'plugin'.
 */
"use strict";

const { execFileSync } = require("child_process");
const https = require("https");
const { applyContentsFetch } = require("./catalog-store");

const CONTENTS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REQUEST_TIMEOUT_MS = 8000;

function parseGithubUrl(url) {
  const m = String(url || "").match(/github\.com[/:]([^/]+)\/([^/?#.]+)/);
  return m ? { owner: m[1], repo: m[2].replace(/\.git$/, "") } : null;
}

function ghCliAvailable() {
  try {
    execFileSync("which", ["gh"], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 1000,
    });
    return true;
  } catch {
    return false;
  }
}

function ghApi(endpoint) {
  try {
    const out = execFileSync(
      "gh",
      ["api", endpoint, "--header", "Accept: application/vnd.github+json"],
      { timeout: REQUEST_TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] },
    );
    return JSON.parse(out.toString("utf8"));
  } catch {
    return null;
  }
}

function restApi(endpoint) {
  return new Promise((resolve) => {
    const req = https.get(
      {
        host: "api.github.com",
        path: endpoint.startsWith("/") ? endpoint : "/" + endpoint,
        headers: {
          "User-Agent": "closedloop-electron-agent-monitor",
          Accept: "application/vnd.github+json",
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode !== 200) {
          resolve(null);
          res.resume();
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function gh(endpoint) {
  if (ghCliAvailable()) {
    const data = ghApi(endpoint);
    if (data) return data;
  }
  return restApi(endpoint);
}

function parseSkillFrontmatterFromBase64(b64) {
  if (!b64) return {};
  try {
    const content = Buffer.from(b64, "base64").toString("utf8");
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {};
    const fields = {};
    for (const raw of m[1].split(/\r?\n/)) {
      const line = raw.trim();
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
  } catch {
    return {};
  }
}

// ---------- per-type fetchers ----------

async function fetchSkillTree(owner, repo, skillsPath, marker) {
  marker = marker || "SKILL.md";
  const items = await gh(
    `repos/${owner}/${repo}/contents/${encodeURI(skillsPath)}`,
  );
  if (!Array.isArray(items)) return [];
  const skills = [];
  for (const entry of items) {
    if (entry.type !== "dir") continue;
    // Fetch the marker file's frontmatter (one extra API call per skill).
    const file = await gh(
      `repos/${owner}/${repo}/contents/${encodeURI(entry.path)}/${marker}`,
    );
    if (!file || !file.content) {
      skills.push({ name: entry.name, kind: "skill", path: entry.path });
      continue;
    }
    const meta = parseSkillFrontmatterFromBase64(file.content);
    skills.push({
      name: meta.name || entry.name,
      kind: "skill",
      description: meta.description || null,
      path: entry.path,
    });
  }
  return skills;
}

async function fetchFlatMd(owner, repo, mdPath, kind) {
  const items = await gh(
    `repos/${owner}/${repo}/contents/${encodeURI(mdPath)}`,
  );
  if (!Array.isArray(items)) return [];
  return items
    .filter(
      (e) =>
        e.type === "file" &&
        e.name.endsWith(".md") &&
        !e.name.toLowerCase().startsWith("readme"),
    )
    .map((e) => ({
      name: e.name.replace(/\.md$/, ""),
      kind: kind || "command",
      path: e.path,
    }));
}

async function fetchNestedMd(owner, repo, rootPath, kind) {
  const top = await gh(
    `repos/${owner}/${repo}/contents/${encodeURI(rootPath)}`,
  );
  if (!Array.isArray(top)) return [];
  const items = [];
  for (const cat of top) {
    if (cat.type !== "dir") continue;
    const inner = await gh(
      `repos/${owner}/${repo}/contents/${encodeURI(cat.path)}`,
    );
    if (!Array.isArray(inner)) continue;
    for (const file of inner) {
      if (file.type !== "file") continue;
      if (!file.name.endsWith(".md")) continue;
      if (file.name.toLowerCase().startsWith("readme")) continue;
      items.push({
        name: file.name.replace(/\.md$/, ""),
        kind: kind || "agent",
        category: cat.name,
        path: file.path,
      });
    }
  }
  return items;
}

async function fetchMultiSkillTree(owner, repo, paths, marker) {
  const out = [];
  for (const p of paths || []) {
    out.push(...(await fetchSkillTree(owner, repo, p, marker)));
  }
  return out;
}

async function fetchClaudeMarketplace(owner, repo, pluginsRoot) {
  // Read .claude-plugin/marketplace.json for the canonical list.
  const meta = await gh(
    `repos/${owner}/${repo}/contents/.claude-plugin/marketplace.json`,
  );
  if (meta && meta.content) {
    try {
      const parsed = JSON.parse(
        Buffer.from(meta.content, "base64").toString("utf8"),
      );
      if (Array.isArray(parsed.plugins)) {
        const items = parsed.plugins.map((p) => ({
          name: p.name,
          kind: "plugin",
          description: p.description || null,
        }));
        // If a plugins_root is declared, walk each plugin's skills/ dir for a
        // richer breakdown. Best-effort; bail if API budget is exhausted.
        if (pluginsRoot) {
          for (const item of items) {
            try {
              const skills = await fetchSkillTree(
                owner,
                repo,
                `${pluginsRoot}/${item.name}/skills`,
              );
              item.skill_count = skills.length;
              item.skills = skills.map((s) => s.name);
            } catch {
              /* per-plugin scrape best-effort */
            }
          }
        }
        return items;
      }
    } catch {
      /* malformed marketplace.json — fall through */
    }
  }
  return [];
}

/**
 * Walk a single claude-plugins-official-style plugin dir for its commands,
 * agents, and skills. Plugins in that marketplace have a mixed layout —
 * some have only commands/, some commands + agents, some skills, etc. —
 * so a single dispatch needs to handle whichever subset is present.
 */
async function fetchClaudePlugin(owner, repo, pluginPath) {
  const items = [];
  const top = await gh(
    `repos/${owner}/${repo}/contents/${encodeURI(pluginPath)}`,
  );
  if (!Array.isArray(top)) return items;
  const hasDir = (name) => top.some((e) => e.type === "dir" && e.name === name);

  // commands/<name>.md
  if (hasDir("commands")) {
    items.push(
      ...(await fetchFlatMd(owner, repo, `${pluginPath}/commands`, "command")),
    );
  }
  // agents/<name>.md
  if (hasDir("agents")) {
    items.push(
      ...(await fetchFlatMd(owner, repo, `${pluginPath}/agents`, "agent")),
    );
  }
  // skills/<name>/SKILL.md
  if (hasDir("skills")) {
    items.push(...(await fetchSkillTree(owner, repo, `${pluginPath}/skills`)));
  }
  return items;
}

async function fetchNestedSkillTree(owner, repo, matchPattern) {
  // Simple two-level walk: <team>/skills/<skill>/SKILL.md
  const top = await gh(`repos/${owner}/${repo}/contents`);
  if (!Array.isArray(top)) return [];
  const items = [];
  for (const teamDir of top) {
    if (teamDir.type !== "dir") continue;
    if (teamDir.name.startsWith(".")) continue;
    const teamSkillsPath = `${teamDir.path}/skills`;
    const innerTry = await gh(
      `repos/${owner}/${repo}/contents/${encodeURI(teamSkillsPath)}`,
    );
    if (!Array.isArray(innerTry)) continue;
    for (const skillDir of innerTry) {
      if (skillDir.type !== "dir") continue;
      items.push({
        name: skillDir.name,
        kind: "skill",
        category: teamDir.name,
        path: skillDir.path,
      });
    }
    // Soft cap to avoid blowing the API budget for huge multi-team repos.
    if (items.length >= 100) break;
  }
  return items;
}

// ---------- dispatch ----------

async function fetchContents(catalogEntry) {
  const contents = catalogEntry.contents;
  if (!contents || !contents.type) return [];
  const parsed = parseGithubUrl(catalogEntry.github_url);
  if (!parsed) return [];
  const { owner, repo } = parsed;

  switch (contents.type) {
    case "github-skill-tree":
      return fetchSkillTree(
        owner,
        repo,
        contents.skills_path,
        contents.skill_marker,
      );
    case "github-multi-skill-tree":
      return fetchMultiSkillTree(
        owner,
        repo,
        contents.skill_paths,
        contents.skill_marker,
      );
    case "github-flat-md":
      return fetchFlatMd(owner, repo, contents.md_path, contents.kind);
    case "github-nested-md":
      return fetchNestedMd(owner, repo, contents.root_path, contents.kind);
    case "github-nested-skill-tree":
      return fetchNestedSkillTree(owner, repo, contents.match_pattern);
    case "claude-marketplace": {
      const repoFromContents = contents.marketplace_repo
        ? parseGithubUrl(`https://github.com/${contents.marketplace_repo}`)
        : null;
      const mkO = repoFromContents ? repoFromContents.owner : owner;
      const mkR = repoFromContents ? repoFromContents.repo : repo;
      return fetchClaudeMarketplace(mkO, mkR, contents.plugins_root);
    }
    case "github-claude-plugin": {
      const repoFromContents = contents.marketplace_repo
        ? parseGithubUrl(`https://github.com/${contents.marketplace_repo}`)
        : null;
      const pluginO = repoFromContents ? repoFromContents.owner : owner;
      const pluginR = repoFromContents ? repoFromContents.repo : repo;
      return fetchClaudePlugin(pluginO, pluginR, contents.plugin_path);
    }
    case "none":
      return [];
    default:
      return [];
  }
}

/**
 * Top-level entry. Fetches contents for one catalog entry, applies to the
 * cache table, and returns the items.
 */
async function refreshCatalogContents(db, catalogEntry) {
  const items = await fetchContents(catalogEntry);
  applyContentsFetch(db, { pack_id: catalogEntry.pack_id, items });
  return items;
}

function isContentsFresh(catalogEntry) {
  if (!catalogEntry.contents_fetched_at) return false;
  return (
    Date.now() - new Date(catalogEntry.contents_fetched_at).getTime() <
    CONTENTS_TTL_MS
  );
}

module.exports = {
  refreshCatalogContents,
  isContentsFresh,
  fetchContents,
  _internals: {
    parseGithubUrl,
    parseSkillFrontmatterFromBase64,
  },
};
