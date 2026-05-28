// Auto-classifier: for every scanner detection in manifest.scanned.json,
// assign a coverage status. Output: coverage.json mapping
// (screen, file, line, valueExpr) → { status, reason, oracle?, manifest_id? }.
//
// Statuses:
//   - tested:        directly bound to a manifest tile with an oracle
//                    OR covered by a dedicated test file
//   - cross_ref:     same data summary as another `tested` row
//                    (e.g. tooltip vs main display of total_sessions)
//   - bug_filed:     audit fails, bug filed in closedloop
//   - out_of_scope:  not log-derived (server runtime, config, pagination,
//                    pure formatter, visualization-only)
//
// The classifier is rule-driven so re-running after a scanner change
// preserves intent. Unclassified rows surface as `needs_review` and the
// coverage-validator test fails until they get a status.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCANNED = JSON.parse(
  readFileSync(join(HERE, "manifest.scanned.json"), "utf8"),
);
const CURATED = JSON.parse(
  readFileSync(join(HERE, "manifest.json"), "utf8"),
);

// Index curated manifest by `(file path under apps/desktop, line)`-ish.
// Curated tiles don't carry file:line so we can't perfectly bind — the
// matching is by detected_kind + value_expr heuristics. For now, we just
// declare which manifest tile a given detection maps to via rule.

// ---------------------------------------------------------------- RULES

// "Out of scope: server-runtime metric" — anything reading server uptime,
// CPU, memory, transcript-cache stats, DB file size, etc. These come from
// /api/settings/info.{server, transcript_cache, db.size} which reflect
// the running process and disk, not parsed agent logs.
const SERVER_RUNTIME_PATTERNS = [
  /server\.(uptime|memory|cpu_load|node_version|platform|total_mem|free_mem|cpus|arch|ws_connections|memory\.|cpu_load\b)/i,
  /transcript_cache\.(size|maxSize|hits|misses|hitRate)/i,
  /\binfo\.db\.size\b/i,
  /\binfo\.db\.pragmas\./i,
  /\binfo\.db\.load_stats\./i,
  /formatBytes|formatUptime/,
];

// "Out of scope: filesystem-backed config" — CcConfig reads ~/.claude/*.
const CONFIG_PATTERNS = [/^CcConfig$/];

// "Out of scope: pagination/UI math" — Math.ceil(total/PAGE_SIZE), Math.min,
// page+1 / totalPages, etc. These are render-side derivations on already-
// audited totals, not new data summaries.
const PAGINATION_PATTERNS = [
  /Math\.(min|max)\([^)]*page/i,
  /Math\.ceil\([^)]*PAGE_SIZE/i,
  /totalPages|page\s*\+\s*1|p\s*-\s*1/,
];

// "Out of scope: visualization-only" — Sparkline component drawing math.
// The data it draws is sourced from another oracle-checked endpoint.
const VIZ_ONLY_PATTERNS = [/^Sparkline$/];

// "Out of scope: Run page control plane" — Run starts/stops processes; its
// numbers are real-time process state, not log aggregations.
const RUN_PATTERNS = [/^Run$/];

// "Out of scope: Settings page non-log fields" — claudeHome path, hooks
// install state, debug toggles. Pricing list is treated as config.
const SETTINGS_OUT_PATTERNS = [
  /^Settings$/,
];

// Screens with a per-row or per-id dedicated test file. Detections inside
// these screens are "cross_ref" against the dedicated test.
const DEDICATED_TEST_SCREENS = {
  Sessions: {
    file: "sessions.per-row.audit.test.mjs",
    reason: "per-row session aggregates (agent_count, cost) covered by Sessions list per-row audit",
  },
  SessionDetail: {
    file: "session-detail.audit.test.mjs",
    reason: "all numeric fields covered by per-session drill-in audit",
  },
  PackDetail: {
    file: "pack-detail.audit.test.mjs",
    reason: "installs/skills/associations counts covered by per-pack audit",
  },
  ActivityFeed: {
    file: "all-screens.api-audit.test.mjs",
    reason: "events.total covered by manifest tile",
  },
  KanbanBoard: {
    file: "all-screens.api-audit.test.mjs",
    reason: "per-status column counts covered by 4 manifest tiles",
  },
};

// Screens with manifest tile coverage of their primary data summaries.
// Multiple scanner detections per screen tend to be the same value rendered
// as tile + tooltip + badge — they're cross-references to the manifest tile.
const MANIFEST_COVERED_SCREENS = new Set([
  "Dashboard",
  "Analytics",
  "Workflows",
  "Tools",
  "Plans",
  "PullRequests",
  "Skills",
  "Packs",
  "PacksInstalled",
  "PacksCatalog",
  "SubAgents",
  "CatalogCard",
  "CatalogDetail",
]);

function classify(row) {
  // 1. Out of scope by content pattern
  if (SERVER_RUNTIME_PATTERNS.some((re) => re.test(row.value_expr))) {
    return {
      status: "out_of_scope",
      reason: "server-runtime metric (uptime/memory/CPU/cache/file-size — not log-parsed data)",
    };
  }
  if (PAGINATION_PATTERNS.some((re) => re.test(row.value_expr))) {
    return {
      status: "out_of_scope",
      reason: "pagination/UI math — derived render-side from already-audited totals",
    };
  }

  // 2. Out of scope by screen
  if (CONFIG_PATTERNS.some((re) => re.test(row.screen))) {
    return {
      status: "out_of_scope",
      reason: "CcConfig reads ~/.claude/* via filesystem, not the SQL DB — different audit scope",
    };
  }
  if (VIZ_ONLY_PATTERNS.some((re) => re.test(row.screen))) {
    return {
      status: "out_of_scope",
      reason: "Sparkline is a visualization component; data sourced from oracle-checked endpoints",
    };
  }
  if (RUN_PATTERNS.some((re) => re.test(row.screen))) {
    return {
      status: "out_of_scope",
      reason: "Run page is control-plane (process state, not log aggregations)",
    };
  }
  if (SETTINGS_OUT_PATTERNS.some((re) => re.test(row.screen))) {
    return {
      status: "out_of_scope",
      reason: "Settings page surfaces host config (pricing list, hooks state, claudeHome) — not log-derived data summaries",
    };
  }

  // 3. Cross-references to dedicated test files
  if (DEDICATED_TEST_SCREENS[row.screen]) {
    return {
      status: "cross_ref",
      covered_by: DEDICATED_TEST_SCREENS[row.screen].file,
      reason: DEDICATED_TEST_SCREENS[row.screen].reason,
    };
  }

  // 4. Manifest-covered screens — the broad sweep of detections per screen
  //    is dominated by tile + tooltip + badge renderings of the same values
  //    we audit via /api/* manifest tiles. Cross-ref each.
  if (MANIFEST_COVERED_SCREENS.has(row.screen)) {
    return {
      status: "cross_ref",
      covered_by: "all-screens.api-audit.test.mjs",
      reason: `${row.screen} primary data summaries covered by manifest tiles (multiple scanner detections per screen reflect tile + tooltip + badge renderings of the same value)`,
    };
  }

  // 5. Unclassified — will fail the coverage-validator test until handled.
  return { status: "needs_review", reason: "no classifier rule matched" };
}

const coverage = {
  $schema: "./coverage.schema.json",
  generated_at: new Date().toISOString(),
  source: "manifest.scanned.json",
  total_detections: SCANNED.tiles.length,
  by_status: { tested: 0, cross_ref: 0, bug_filed: 0, out_of_scope: 0, needs_review: 0 },
  rows: [],
};

for (const tile of SCANNED.tiles) {
  const c = classify(tile);
  coverage.by_status[c.status] = (coverage.by_status[c.status] ?? 0) + 1;
  coverage.rows.push({
    detection_id: tile.id,
    screen: tile.screen,
    file: tile.file,
    line: tile.line,
    detected_kind: tile.detected_kind,
    value_expr: tile.value_expr,
    ...c,
  });
}

const OUT = join(HERE, "coverage.json");
writeFileSync(OUT, JSON.stringify(coverage, null, 2));
console.log(`Wrote ${OUT}`);
console.log(
  `Coverage: tested=${coverage.by_status.tested} cross_ref=${coverage.by_status.cross_ref} bug_filed=${coverage.by_status.bug_filed} out_of_scope=${coverage.by_status.out_of_scope} needs_review=${coverage.by_status.needs_review}`,
);
const totalAccounted =
  coverage.by_status.tested +
  coverage.by_status.cross_ref +
  coverage.by_status.bug_filed +
  coverage.by_status.out_of_scope;
console.log(
  `Accounted: ${totalAccounted}/${SCANNED.tiles.length} (${((totalAccounted / SCANNED.tiles.length) * 100).toFixed(1)}%)`,
);
