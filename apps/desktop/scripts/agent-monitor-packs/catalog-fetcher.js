/**
 * @file catalog-fetcher.js
 * @description Periodic GitHub stats fetcher for the Agent Pack Catalog
 * (FEA-1314 / PLN-657). Walks every row in `pack_catalog`, hits the GitHub
 * REST API for stars/forks/description/latest-release, and writes the
 * result via catalog-store.applyFetchResult — which both updates live
 * fields on pack_catalog and appends a row to pack_catalog_history (for the
 * sparkline).
 *
 * Auth preference:
 *   1. Local `gh` CLI (`gh api repos/<owner>/<repo>`) — uses the user's
 *      `gh auth login`, zero credentials in the sidecar
 *   2. Unauthenticated REST (`https://api.github.com/repos/...`) — 60
 *      req/hr; the catalog has ~10 packs / 24h so this is comfortable
 *
 * Best-effort: a single pack's 404/rate-limit logs a warning and continues;
 * the run as a whole always returns a summary.
 */
"use strict";

const { execFileSync } = require("child_process");
const https = require("https");
const { applyFetchResult } = require("./catalog-store");

// FEA-1314 v6: marketplace sub-plugins (e.g. code-review, context7) live as
// folders inside a parent marketplace repo. The default per-repo fetch
// (stars + description) writes the MARKETPLACE'S stars/description to every
// sub-plugin row, making all of them look identical (e.g. 5 plugins all
// showing "21.3k stars · Official, Anthropic-managed directory of...").
// For these, we instead fetch each plugin's own .claude-plugin/plugin.json
// for its plugin-specific name/description/version, and leave stars NULL —
// the marketplace's star count doesn't represent the individual plugin.

const REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const USER_AGENT = "closedloop-electron-agent-monitor";

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

/**
 * Parse owner/repo out of a github URL.
 *   https://github.com/owner/repo            -> { owner, repo }
 *   https://github.com/owner/repo.git        -> { owner, repo }
 *   https://github.com/owner/repo/tree/main  -> { owner, repo }
 */
function parseGithubUrl(url) {
  if (typeof url !== "string") return null;
  const m = url.match(/github\.com[/:]([^/]+)\/([^/?#.]+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
}

function ghFetch(owner, repo) {
  try {
    const out = execFileSync(
      "gh",
      ["api", `repos/${owner}/${repo}`, "--header", "Accept: application/vnd.github+json"],
      { timeout: REQUEST_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] },
    );
    return JSON.parse(out.toString("utf8"));
  } catch {
    return null;
  }
}

function ghFetchLatestRelease(owner, repo) {
  try {
    const out = execFileSync(
      "gh",
      ["api", `repos/${owner}/${repo}/releases/latest`],
      { timeout: REQUEST_TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] },
    );
    const parsed = JSON.parse(out.toString("utf8"));
    return parsed && (parsed.tag_name || parsed.name) ? parsed.tag_name || parsed.name : null;
  } catch {
    return null;
  }
}

function httpGetJson(urlPath) {
  return new Promise((resolve) => {
    const req = https.get(
      {
        host: "api.github.com",
        path: urlPath,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/vnd.github+json",
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve(null);
            }
          } else {
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

async function restFetch(owner, repo) {
  return httpGetJson(`/repos/${owner}/${repo}`);
}

async function restFetchLatestRelease(owner, repo) {
  const parsed = await httpGetJson(`/repos/${owner}/${repo}/releases/latest`);
  return parsed && (parsed.tag_name || parsed.name) ? parsed.tag_name || parsed.name : null;
}

/**
 * Fetch a marketplace sub-plugin's .claude-plugin/plugin.json from the
 * parent marketplace repo. Returns the parsed JSON or null. Used to source
 * plugin-specific description + version for catalog entries whose
 * `contents.type === 'github-claude-plugin'`.
 */
function ghFetchPluginManifest(owner, repo, pluginPath) {
  try {
    const out = execFileSync(
      "gh",
      [
        "api",
        `repos/${owner}/${repo}/contents/${encodeURI(pluginPath)}/.claude-plugin/plugin.json`,
        "--header",
        "Accept: application/vnd.github.raw",
      ],
      { timeout: REQUEST_TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] },
    );
    return JSON.parse(out.toString("utf8"));
  } catch {
    return null;
  }
}

function restFetchPluginManifest(owner, repo, pluginPath) {
  return new Promise((resolve) => {
    const req = https.get(
      {
        host: "api.github.com",
        path: `/repos/${owner}/${repo}/contents/${encodeURI(pluginPath)}/.claude-plugin/plugin.json`,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/vnd.github.raw",
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
        res.on("data", (c) => (body += c));
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

async function fetchPluginManifest(owner, repo, pluginPath, useGh) {
  if (useGh) {
    const m = ghFetchPluginManifest(owner, repo, pluginPath);
    if (m) return m;
  }
  return restFetchPluginManifest(owner, repo, pluginPath);
}

function parseJsonField(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Fetch stats for every pack in pack_catalog and apply them via the store.
 * Best-effort per pack; returns a summary.
 */
async function runCatalogFetch(db) {
  const summary = {
    started_at: new Date().toISOString(),
    used_gh_cli: ghCliAvailable(),
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };
  let rows;
  try {
    rows = db
      .prepare(
        "SELECT pack_id, github_url, upstream_github_url, contents FROM pack_catalog",
      )
      .all();
  } catch (e) {
    console.warn("[catalog-fetcher] cannot read pack_catalog:", e && e.message);
    return summary;
  }
  for (const row of rows) {
    const parsed = parseGithubUrl(row.github_url);
    if (!parsed) {
      summary.skipped += 1;
      continue;
    }
    const contents = parseJsonField(row.contents);
    const isMarketplaceSubPlugin =
      contents && contents.type === "github-claude-plugin";

    if (isMarketplaceSubPlugin) {
      // FEA-1314 v6: marketplace sub-plugin path. Read the plugin's OWN
      // manifest for description + version. For stars/forks: if the catalog
      // entry declared an `upstream_github_url` (e.g. context7 → upstash/
      // context7), fetch stars from THAT repo. Otherwise leave stars null —
      // showing the parent marketplace's count on every sub-plugin row would
      // make them all look identical (the v5 bug).
      const mkRepoOverride = contents.marketplace_repo
        ? parseGithubUrl(`https://github.com/${contents.marketplace_repo}`)
        : null;
      const pluginOwner = mkRepoOverride ? mkRepoOverride.owner : parsed.owner;
      const pluginRepo = mkRepoOverride ? mkRepoOverride.repo : parsed.repo;
      const manifest = await fetchPluginManifest(
        pluginOwner,
        pluginRepo,
        contents.plugin_path,
        summary.used_gh_cli,
      );
      if (!manifest) {
        summary.failed += 1;
        continue;
      }

      // Optional upstream fetch for sub-plugins backed by a distinct repo.
      let upstreamStars = null;
      let upstreamForks = null;
      let upstreamRelease = null;
      if (row.upstream_github_url) {
        const up = parseGithubUrl(row.upstream_github_url);
        if (up) {
          let upRepo = summary.used_gh_cli ? ghFetch(up.owner, up.repo) : null;
          if (!upRepo) upRepo = await restFetch(up.owner, up.repo);
          if (upRepo) {
            upstreamStars =
              upRepo.stargazers_count == null ? null : upRepo.stargazers_count;
            upstreamForks =
              upRepo.forks_count == null ? null : upRepo.forks_count;
            upstreamRelease = summary.used_gh_cli
              ? ghFetchLatestRelease(up.owner, up.repo)
              : await restFetchLatestRelease(up.owner, up.repo);
          }
        }
      }

      try {
        applyFetchResult(db, {
          pack_id: row.pack_id,
          stars: upstreamStars,
          forks: upstreamForks,
          description: manifest.description || null,
          last_release: manifest.version || upstreamRelease || null,
        });
        summary.succeeded += 1;
      } catch (e) {
        console.warn(
          `[catalog-fetcher] applyFetchResult failed for ${row.pack_id}:`,
          e && e.message,
        );
        summary.failed += 1;
      }
      continue;
    }

    // Default path: standalone repo — fetch its stars + description.
    let repo = null;
    let release = null;
    if (summary.used_gh_cli) {
      repo = ghFetch(parsed.owner, parsed.repo);
      if (repo) release = ghFetchLatestRelease(parsed.owner, parsed.repo);
    }
    if (!repo) {
      repo = await restFetch(parsed.owner, parsed.repo);
      if (repo) release = await restFetchLatestRelease(parsed.owner, parsed.repo);
    }
    if (!repo) {
      summary.failed += 1;
      continue;
    }
    try {
      applyFetchResult(db, {
        pack_id: row.pack_id,
        stars: repo.stargazers_count == null ? null : repo.stargazers_count,
        forks: repo.forks_count == null ? null : repo.forks_count,
        description: repo.description || null,
        last_release: release,
      });
      summary.succeeded += 1;
    } catch (e) {
      console.warn(
        `[catalog-fetcher] applyFetchResult failed for ${row.pack_id}:`,
        e && e.message,
      );
      summary.failed += 1;
    }
  }
  summary.ended_at = new Date().toISOString();
  return summary;
}

/**
 * Schedule recurring fetches. Returns a handle that can be cleared. Called
 * by server/index.js startup; the immediate run happens via runCatalogFetch.
 */
function scheduleCatalogFetch(db, intervalMs = DEFAULT_INTERVAL_MS) {
  const handle = setInterval(() => {
    runCatalogFetch(db).catch((e) => {
      console.warn("[catalog-fetcher] scheduled run failed:", e && e.message);
    });
  }, intervalMs);
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}

module.exports = {
  runCatalogFetch,
  scheduleCatalogFetch,
  // Exported for tests
  _internals: { parseGithubUrl, ghCliAvailable },
};
