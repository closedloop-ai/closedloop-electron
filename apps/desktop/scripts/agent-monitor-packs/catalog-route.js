/**
 * @file Express router for the Agent Pack Catalog (FEA-1314 / PLN-657).
 * Read paths over `pack_catalog` + `pack_catalog_history`, write paths for
 * the install orchestrator. Materialized into the generated tree as
 * server/routes/catalog.js by build-agent-monitor.mjs.
 */
"use strict";

const { execFileSync } = require("child_process");
const https = require("https");
const { Router } = require("express");
const { db } = require("../db");
const catalogStore = require("../lib/catalog-store");
const catalogFetcher = require("../lib/catalog-fetcher");
const installOrchestrator = require("../lib/install-orchestrator");
const packScanner = require("../lib/pack-scanner");

catalogStore.ensureCatalogSchema(db);

const README_MAX_BYTES = 30000; // ~30KB excerpt is plenty for a detail panel
const README_TTL_MS = 24 * 60 * 60 * 1000;

function parseGithubUrl(url) {
  const m = String(url || "").match(/github\.com[/:]([^/]+)\/([^/?#.]+)/);
  return m ? { owner: m[1], repo: m[2].replace(/\.git$/, "") } : null;
}

function ghReadme(owner, repo) {
  try {
    const out = execFileSync(
      "gh",
      [
        "api",
        `repos/${owner}/${repo}/readme`,
        "--header",
        "Accept: application/vnd.github.raw",
      ],
      { timeout: 7000, stdio: ["ignore", "pipe", "ignore"] },
    );
    return out.toString("utf8");
  } catch {
    return null;
  }
}

function restReadme(owner, repo) {
  return new Promise((resolve) => {
    const req = https.get(
      {
        host: "api.github.com",
        path: `/repos/${owner}/${repo}/readme`,
        headers: {
          "User-Agent": "closedloop-electron-agent-monitor",
          Accept: "application/vnd.github.raw",
        },
        timeout: 7000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          resolve(null);
          res.resume();
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > README_MAX_BYTES * 2) req.destroy();
        });
        res.on("end", () => resolve(body));
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function fetchReadmeFor(githubUrl) {
  const parsed = parseGithubUrl(githubUrl);
  if (!parsed) return null;
  const out = ghReadme(parsed.owner, parsed.repo) || (await restReadme(parsed.owner, parsed.repo));
  if (!out) return null;
  return out.length > README_MAX_BYTES ? out.slice(0, README_MAX_BYTES) + "\n\n…(truncated)" : out;
}

const router = Router();

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function clampInt(raw, fallback, min, max) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

// ----- Read -----

router.get("/", (_req, res) => {
  try {
    res.json({ items: catalogStore.listCatalog(db) });
  } catch (err) {
    res.status(500).json({ error: { message: err && err.message } });
  }
});

router.get("/runs", (req, res) => {
  try {
    const limit = clampInt(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const pack_id =
      typeof req.query.pack_id === "string" && req.query.pack_id.trim()
        ? req.query.pack_id.trim()
        : null;
    res.json({
      items: catalogStore.listInstallRuns(db, { pack_id, limit, offset }),
    });
  } catch (err) {
    res.status(500).json({ error: { message: err && err.message } });
  }
});

router.delete("/runs/:id", (req, res) => {
  try {
    const ok = catalogStore.deleteInstallRun(db, Number(req.params.id));
    res.status(ok ? 200 : 404).json({ deleted: ok });
  } catch (err) {
    res.status(500).json({ error: { message: err && err.message } });
  }
});

router.get("/:pack_id", (req, res) => {
  try {
    const entry = catalogStore.getCatalog(db, req.params.pack_id, {
      historyDays: clampInt(req.query.history_days, 30, 1, 365),
    });
    if (!entry) return res.status(404).json({ error: { message: "pack not found" } });
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: { message: err && err.message } });
  }
});

router.get("/:pack_id/readme", async (req, res) => {
  try {
    const entry = catalogStore.getCatalog(db, req.params.pack_id);
    if (!entry) return res.status(404).json({ error: { message: "pack not found" } });

    const force = req.query.refresh === "1";
    const fresh =
      entry.readme_fetched_at &&
      Date.now() - new Date(entry.readme_fetched_at).getTime() < README_TTL_MS;
    if (!force && fresh && entry.readme_excerpt) {
      return res.json({
        pack_id: entry.pack_id,
        readme_excerpt: entry.readme_excerpt,
        readme_fetched_at: entry.readme_fetched_at,
        cached: true,
      });
    }

    const readme = await fetchReadmeFor(entry.github_url);
    if (readme == null) {
      return res
        .status(502)
        .json({ error: { message: "Could not fetch README from GitHub (rate limit or 404)" } });
    }
    catalogStore.applyReadmeFetch(db, {
      pack_id: entry.pack_id,
      readme_excerpt: readme,
    });
    res.json({
      pack_id: entry.pack_id,
      readme_excerpt: readme,
      cached: false,
    });
  } catch (err) {
    res.status(500).json({ error: { message: err && err.message } });
  }
});

router.get("/:pack_id/history", (req, res) => {
  try {
    const days = clampInt(req.query.days, 30, 1, 365);
    res.json({
      items: catalogStore.listHistory(db, req.params.pack_id, days),
    });
  } catch (err) {
    res.status(500).json({ error: { message: err && err.message } });
  }
});

// ----- Write: refresh, install, uninstall -----

router.post("/refresh", async (_req, res) => {
  try {
    const summary = await catalogFetcher.runCatalogFetch(db);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: { message: err && err.message } });
  }
});

function streamAction(action, req, res) {
  const harness =
    typeof req.query.harness === "string" && req.query.harness.trim()
      ? req.query.harness.trim()
      : null;
  if (!harness) {
    res.status(400).json({ error: { message: "harness query param required" } });
    return;
  }
  installOrchestrator.streamRun(db, {
    pack_id: req.params.pack_id,
    harness,
    action,
    res,
    onComplete: ({ exit_code, killed }) => {
      // Re-run the pack scanner after a successful install/uninstall so the
      // Installed badge flips without manual refresh.
      if (!killed && exit_code === 0) {
        try {
          packScanner.runPackScanner(db);
        } catch (e) {
          console.warn(
            "[catalog-route] post-install rescan failed:",
            e && e.message,
          );
        }
      }
    },
  });
}

router.post("/:pack_id/install", (req, res) => streamAction("install", req, res));
router.post("/:pack_id/uninstall", (req, res) => streamAction("uninstall", req, res));

module.exports = router;
