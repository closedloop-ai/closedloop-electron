// Data-summary inventory scanner — walks every page component (ClosedLoop
// overrides + upstream agent-dashboard pages NOT overridden) and emits a
// draft manifest for every UI surface that summarizes log-parsed DB data.
//
// "Data summary" is the right unit — not just "tile". It includes:
//   - stat-card-style big numbers
//   - per-row aggregates in tables (e.g., session.agent_count)
//   - chart values, sparkline points, donut segments
//   - sidebar/nav count badges
//   - filter/scope captions ("Showing N of M")
//   - status counters
//
// Detection is heuristic and intentionally over-emits. False positives are
// fine — humans dedupe. False negatives are dangerous, so the regex set is
// broad. Treat the output number as a SCOPE CEILING, not a final tile count.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..", "..");
const DESKTOP = join(REPO, "apps", "desktop");

// ClosedLoop overrides (the source of truth — copied over upstream at build).
const OVERRIDE_GLOB_ROOTS = [
  join(DESKTOP, "scripts", "agent-monitor-client"),
  join(DESKTOP, "scripts", "agent-monitor-packs", "client"),
  join(DESKTOP, "scripts", "agent-monitor-plans", "client"),
  join(DESKTOP, "scripts", "agent-monitor-pull-requests", "client"),
];

function locateUpstreamPagesDir() {
  const pnpmDir = join(REPO, "node_modules", ".pnpm");
  const dirs = readdirSync(pnpmDir).filter((n) =>
    n.startsWith("agent-dashboard-client@"),
  );
  if (dirs.length === 0) return null;
  const candidate = join(
    pnpmDir,
    dirs[0],
    "node_modules",
    "agent-dashboard-client",
    "src",
    "pages",
  );
  try {
    statSync(candidate);
    return candidate;
  } catch {
    return null;
  }
}

const UPSTREAM_PAGES = locateUpstreamPagesDir();

function walkTsx(root) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(root, e);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walkTsx(p));
    else if (e.endsWith(".tsx") || e.endsWith(".jsx")) out.push(p);
  }
  return out;
}

const overrideFiles = OVERRIDE_GLOB_ROOTS.flatMap(walkTsx);
const overrideBasenames = new Set(overrideFiles.map((f) => basename(f)));
const upstreamFiles = UPSTREAM_PAGES
  ? walkTsx(UPSTREAM_PAGES).filter((f) => !overrideBasenames.has(basename(f)))
  : [];
const allFiles = [...overrideFiles, ...upstreamFiles].filter(
  (f) =>
    !basename(f).endsWith(".test.tsx") &&
    !basename(f).endsWith(".test.jsx") &&
    !basename(f).startsWith("__"),
);

// ------------------------------------------------------------------ DETECTORS

// JSX `{...}` blocks. We approximate "JSX context" by requiring the `{`
// to be preceded by `>` or whitespace-only (an attribute or child position),
// not by `=` (assignment), `(`/`,` (function call/arg), `:` (object literal),
// `{` (block), or letters (function body). Without a real parser this is
// a heuristic — false positives are accepted, but skipping bare braces in
// function bodies eliminates the worst over-count.
function* iterJsxExpressions(source) {
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf("{", i);
    if (open === -1) return;
    // Skip if the brace is clearly NOT a JSX expression slot.
    const prevChar = (() => {
      for (let k = open - 1; k >= 0; k--) {
        const c = source[k];
        if (c === " " || c === "\t" || c === "\n" || c === "\r") continue;
        return c;
      }
      return "";
    })();
    if (
      prevChar &&
      !(prevChar === ">" || prevChar === '"' || prevChar === "'" || prevChar === "\n")
    ) {
      // Not a JSX expression slot — advance past this brace.
      i = open + 1;
      continue;
    }
    let depth = 1;
    let j = open + 1;
    while (j < source.length && depth > 0) {
      const c = source[j];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      j++;
    }
    if (depth === 0) {
      yield { start: open, end: j, text: source.slice(open + 1, j - 1) };
    }
    i = j;
  }
}

// Property paths anchored to "data-shape" identifiers commonly used for row
// objects, aggregates, and stats in this codebase.
const DATA_SHAPE_ID_RE =
  /\b(stats|data|info|workflow|session|sessionStats|agent|agents|subagent|subagents|pack|packs|skill|skills|tool|tools|pr|prs|pull|plan|plans|row|item|entry|cell|seg|segment|bin|point|d|e|m|s|a|p|r|t|tu|costData|usage|tokens|model|modelStats|workflowData)\b\.[A-Za-z_$][A-Za-z0-9_$.]*/g;

// Property suffixes that are almost always numeric (the noisy tail — caps
// false positives from generic identifiers).
const NUMERIC_SUFFIX_RE =
  /\.(count|length|size|total|totals|sum|amount|avg|average|rate|pct|percent|percentage|score|tokens|input_tokens|output_tokens|cache_read_tokens|cache_write_tokens|cost|cost_today|cost_total|total_cost|cost_30d|duration|duration_ms|seconds|ms|elapsed|events|agents|sessions|subagents|errors|active|completed|working|waiting|pending|installed|enabled|disabled|hits|misses|peak|max|min|hours|minutes|days|kb|mb|gb|tps|qps)\b/;

// Function-call patterns that turn a raw number into a rendered string.
const FORMATTER_CALL_RE =
  /\b(fmt|fmtCost|fmtCostFull|formatBytes|formatUptime|formatDuration|formatMs|formatTime|formatDateTime|timeAgo)\s*\([^)]*\)/g;
const TO_LOCALE_RE = /([A-Za-z0-9_.\[\]?]+)\.toLocaleString\(\)/g;
const TO_FIXED_RE = /([A-Za-z0-9_.\[\]?]+)\.toFixed\(\s*\d+\s*\)/g;
const MATH_RE = /\bMath\.(round|floor|ceil|max|min|abs)\s*\(/g;

// Stat-card-style named components (kept from prior scanner version).
const TILE_COMP_RE =
  /<(StatCard|TrendBig|Tile|Metric|BigStat|CountTile)\b([\s\S]*?)\/?>/g;

function lineOf(source, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (source[i] === "\n") n++;
  return n;
}

function classifyContext(source, idx) {
  // Look back ~200 chars to spot what kind of UI element we're inside.
  // Used to tag rows with surface=table_cell / chart / nav etc.
  const before = source.slice(Math.max(0, idx - 200), idx);
  if (/<td\b[^>]*>$|<TableCell\b[^>]*>$|<td\b[^>]*>\s*$/i.test(before))
    return "table_cell";
  if (/<NavLink\b[\s\S]*$|<Link\b[\s\S]*sidebar/i.test(before)) return "nav";
  if (/<svg\b[\s\S]*$|<Sparkline\b[\s\S]*$|<DonutChart\b[\s\S]*$/i.test(before))
    return "chart";
  if (/<StatCard[\s\S]*$|<Tile[\s\S]*$|<Metric[\s\S]*$/.test(before))
    return "tile";
  if (
    /Showing\s*$|of\s*$|total\s*$|in\s+the\s+last\s*$|last\s+\d+\s*$/i.test(
      before,
    )
  )
    return "caption";
  return "inline";
}

const reportRows = [];

function emit(file, isOverride, screen, kind, valueExpr, line, surface) {
  reportRows.push({
    screen,
    origin: isOverride ? "override" : "upstream",
    kind,
    surface,
    valueExpr: String(valueExpr ?? "").slice(0, 200),
    file: file.replace(REPO + "/", ""),
    line,
  });
}

for (const file of allFiles) {
  const source = readFileSync(file, "utf8");
  const screen = basename(file).replace(/\.(tsx|jsx)$/, "");
  const isOverride = overrideFiles.includes(file);

  // 1. Stat-card-like named components.
  for (const m of source.matchAll(TILE_COMP_RE)) {
    const block = m[2];
    const labelMatch =
      block.match(/\blabel\s*=\s*"([^"]+)"/) ||
      block.match(/\blabel\s*=\s*\{[^}]*t\(\s*"([^"]+)"\s*\)[^}]*\}/);
    const valueMatch = block.match(/\bvalue\s*=\s*\{([^}]+)\}/);
    emit(
      file,
      isOverride,
      screen,
      "stat_card",
      `${labelMatch?.[1] ?? "?"}=${valueMatch?.[1] ?? "?"}`,
      lineOf(source, m.index),
      "tile",
    );
  }

  // Track positions we've already accounted for so the JSX-expression sweep
  // doesn't double-count the same span.
  const seen = new Set();

  // 2. JSX `{...}` expressions — the broad sweep.
  for (const expr of iterJsxExpressions(source)) {
    const text = expr.text;
    if (text.length === 0) continue;
    if (seen.has(expr.start)) continue;
    seen.add(expr.start);

    // Skip expressions that are clearly handlers / non-data.
    if (
      /^(on[A-Z]|aria-|ref|className|style|key|id|children|to|href|disabled|hidden|placeholder|title|alt|target|rel|role|type|name|checked|value|defaultValue|tabIndex|loading|autoFocus)\b/.test(
        text.trim(),
      )
    )
      continue;

    // Pure-string literal interpolation → not a data summary.
    if (/^['"`][^'"`]*['"`]$/.test(text.trim())) continue;

    // 2a. Formatter calls inside the expression.
    let matched = false;
    for (const fm of text.matchAll(FORMATTER_CALL_RE)) {
      emit(
        file,
        isOverride,
        screen,
        "formatter_call",
        fm[0],
        lineOf(source, expr.start),
        classifyContext(source, expr.start),
      );
      matched = true;
    }
    for (const tm of text.matchAll(TO_LOCALE_RE)) {
      emit(
        file,
        isOverride,
        screen,
        "toLocaleString",
        tm[1],
        lineOf(source, expr.start),
        classifyContext(source, expr.start),
      );
      matched = true;
    }
    for (const tm of text.matchAll(TO_FIXED_RE)) {
      emit(
        file,
        isOverride,
        screen,
        "toFixed",
        tm[1],
        lineOf(source, expr.start),
        classifyContext(source, expr.start),
      );
      matched = true;
    }
    for (const mm of text.matchAll(MATH_RE)) {
      // Math.round/.. by itself isn't proof of data-summary; require a
      // numeric-suffix-bearing argument inside the expression.
      if (NUMERIC_SUFFIX_RE.test(text)) {
        emit(
          file,
          isOverride,
          screen,
          "math",
          mm[0],
          lineOf(source, expr.start),
          classifyContext(source, expr.start),
        );
        matched = true;
        break;
      }
    }

    if (matched) continue;

    // 2b. Data-shape property accesses with numeric-looking suffixes.
    for (const dm of text.matchAll(DATA_SHAPE_ID_RE)) {
      if (NUMERIC_SUFFIX_RE.test(dm[0])) {
        emit(
          file,
          isOverride,
          screen,
          "data_property",
          dm[0],
          lineOf(source, expr.start),
          classifyContext(source, expr.start),
        );
        // Don't break — one expression can render multiple values
        // ("{a.count} / {b.count}").
      }
    }
  }
}

// ---------------------------------------------------------------- ROLL-UP

const byScreen = new Map();
for (const f of allFiles) {
  const name = basename(f).replace(/\.(tsx|jsx)$/, "");
  if (!byScreen.has(name)) {
    byScreen.set(name, {
      origin: overrideFiles.includes(f) ? "override" : "upstream",
      total: 0,
      by_kind: { stat_card: 0, formatter_call: 0, toLocaleString: 0, toFixed: 0, math: 0, data_property: 0 },
      by_surface: {},
    });
  }
}
for (const r of reportRows) {
  if (!byScreen.has(r.screen)) {
    byScreen.set(r.screen, {
      origin: r.origin,
      total: 0,
      by_kind: { stat_card: 0, formatter_call: 0, toLocaleString: 0, toFixed: 0, math: 0, data_property: 0 },
      by_surface: {},
    });
  }
  const e = byScreen.get(r.screen);
  e.total++;
  e.by_kind[r.kind] = (e.by_kind[r.kind] ?? 0) + 1;
  e.by_surface[r.surface] = (e.by_surface[r.surface] ?? 0) + 1;
}

const grandTotal = reportRows.length;
const surfaceTotals = {};
for (const r of reportRows)
  surfaceTotals[r.surface] = (surfaceTotals[r.surface] ?? 0) + 1;

// --------------------------------------------------------------- DRAFT MANIFEST

// Emit a draft manifest.scanned.json alongside the report so future runs can
// auto-fill stub rows. NEVER overwrite the curated manifest.json — that's
// human-edited.
const draftManifest = {
  $schema: "./manifest.schema.json",
  version: 1,
  description:
    "Auto-generated draft manifest from scan-tiles.mjs. Each row needs human review: oracle name + endpoint + formatter must be filled in before the tile becomes audit-checkable. The curated manifest is manifest.json — DO NOT auto-update it from this file.",
  generated_at: new Date().toISOString(),
  scanner_version: 2,
  tiles: reportRows.map((r, i) => ({
    id: `auto.${r.screen.toLowerCase()}.${i}`,
    screen: r.screen,
    route: routeForScreen(r.screen),
    surface: r.surface,
    detected_kind: r.kind,
    value_expr: r.valueExpr,
    file: r.file,
    line: r.line,
    label: null,
    selector_kind: "label_slice",
    endpoint: null,
    endpoint_field: null,
    oracle: null,
    formatter: null,
    tile_kind: "count",
    priority: priorityForScreen(r.screen),
    owner: null,
    status: "needs_oracle",
    bug_ref: null,
  })),
};

function routeForScreen(name) {
  const map = {
    Dashboard: "/",
    Sessions: "/sessions",
    SessionDetail: "/sessions/:id",
    Analytics: "/analytics",
    Workflows: "/workflows",
    CcConfig: "/cc-config",
    KanbanBoard: "/kanban",
    ActivityFeed: "/activity",
    Run: "/run",
    Plans: "/plans",
    Skills: "/skills",
    Tools: "/tools",
    SubAgents: "/agents",
    Packs: "/packs",
    PacksLayout: "/packs",
    PacksCatalog: "/packs",
    PacksInstalled: "/packs",
    PackDetail: "/packs/:packId",
    CatalogDetail: "/packs",
    CatalogCard: "/packs",
    InstallModal: "/packs",
    PullRequests: "/pull-requests",
    Settings: "/settings",
    Sparkline: "?",
    StatusBadge: "?",
    NotFound: "?",
  };
  return map[name] ?? "?";
}

function priorityForScreen(name) {
  const P0 = new Set([
    "Dashboard",
    "Analytics",
    "Sessions",
    "SessionDetail",
    "Workflows",
    "ActivityFeed",
    "PullRequests",
  ]);
  const P1 = new Set([
    "Packs",
    "PacksLayout",
    "PacksCatalog",
    "PacksInstalled",
    "PackDetail",
    "Skills",
    "Tools",
    "SubAgents",
    "Plans",
    "CcConfig",
  ]);
  if (P0.has(name)) return "P0";
  if (P1.has(name)) return "P1";
  return "P2";
}

const DRAFT_MANIFEST_PATH = join(HERE, "manifest.scanned.json");
writeFileSync(DRAFT_MANIFEST_PATH, JSON.stringify(draftManifest, null, 2));

// ------------------------------------------------------------ MARKDOWN REPORT

const lines = [];
lines.push("# Full App Inventory — draft scan (v2 · data-summary aware)");
lines.push("");
lines.push(
  `_Generated: ${new Date().toISOString()} · FEA-1415 / PLN-738 Phase 0 (draft)_`,
);
lines.push("");
lines.push("## Headline");
lines.push("");
lines.push(`- Pages scanned: **${byScreen.size}**`);
lines.push(`- **Data-summary instances detected: ${grandTotal}**`);
lines.push("");
lines.push(`### By kind`);
lines.push("");
lines.push("| kind | count |");
lines.push("|------|-------|");
const kindOrder = [
  "stat_card",
  "formatter_call",
  "toLocaleString",
  "toFixed",
  "math",
  "data_property",
];
for (const k of kindOrder) {
  const n = reportRows.filter((r) => r.kind === k).length;
  lines.push(`| \`${k}\` | ${n} |`);
}
lines.push("");
lines.push(`### By surface (where the value is rendered)`);
lines.push("");
lines.push("| surface | count |");
lines.push("|---------|-------|");
for (const [k, v] of Object.entries(surfaceTotals).sort(
  (a, b) => b[1] - a[1],
)) {
  lines.push(`| \`${k}\` | ${v} |`);
}
lines.push("");
lines.push(
  "> Counts include false positives (the same value rendered in a tile and its tooltip; type-narrowing chains; expression sub-parts). Realistic *unique-tile* count is typically 40–60% of the total. The number is a **scope ceiling** for engineering planning, not a final tile count.",
);
lines.push("");

lines.push("## Per-screen breakdown");
lines.push("");
lines.push(
  "| screen | origin | stat_card | formatter | toLocale | toFixed | math | data_prop | TOTAL |",
);
lines.push(
  "|--------|--------|-----------|-----------|----------|---------|------|-----------|-------|",
);
const screens = [...byScreen.entries()].sort((a, b) => b[1].total - a[1].total);
for (const [name, e] of screens) {
  lines.push(
    `| ${name} | ${e.origin} | ${e.by_kind.stat_card} | ${e.by_kind.formatter_call} | ${e.by_kind.toLocaleString} | ${e.by_kind.toFixed} | ${e.by_kind.math} | ${e.by_kind.data_property} | **${e.total}** |`,
  );
}
lines.push("");

lines.push("## Detail — every detected data summary (grouped by screen)");
lines.push("");
for (const [name] of screens) {
  const rows = reportRows.filter((r) => r.screen === name);
  if (rows.length === 0) continue;
  lines.push(`### ${name}`);
  lines.push("");
  lines.push("| kind | surface | value expression | file:line |");
  lines.push("|------|---------|------------------|-----------|");
  for (const r of rows) {
    lines.push(
      `| ${r.kind} | ${r.surface} | \`${truncate(r.valueExpr, 80)}\` | ${r.file}:${r.line} |`,
    );
  }
  lines.push("");
}

lines.push("## Output files");
lines.push("");
lines.push(
  `- \`INVENTORY-DRAFT.md\` — this markdown summary (committed: NO, gitignored)`,
);
lines.push(
  `- \`manifest.scanned.json\` — machine-readable draft manifest with one row per detection, every row \`status: "needs_oracle"\``,
);
lines.push("");
lines.push(
  "Curated manifest stays at `manifest.json`. The draft is for scoping and bulk-import; humans copy rows from draft → curated as oracles are written.",
);
lines.push("");
lines.push("## What this scanner still does NOT detect");
lines.push("");
lines.push(
  "- Numbers rendered as SVG path geometry without a text node (bar heights, donut arcs). The underlying data accessor is usually caught via `data_property`; the geometric encoding itself is invisible to a regex scan.",
);
lines.push(
  "- Numbers computed via i18n interpolation: `t('common:pagination.showing', {total})`. The number ends up rendered but the JSX expression sees only the i18n key.",
);
lines.push(
  "- Numbers in components OUTSIDE pages/ that aren't named per-screen (e.g., a shared `<TokenSparkline>` component used by multiple pages).",
);
lines.push(
  "- Host Electron panels (Approvals, Requests, Diagnostics, host Settings) — separate codebase under `apps/desktop/src/renderer`, not yet scanned.",
);
lines.push("");

const OUT = join(HERE, "INVENTORY-DRAFT.md");
writeFileSync(OUT, lines.join("\n") + "\n");
console.log(`Wrote ${OUT}`);
console.log(`Wrote ${DRAFT_MANIFEST_PATH}`);
console.log(
  `Screens: ${byScreen.size} · data-summary instances: ${grandTotal}`,
);

function truncate(s, n) {
  if (s == null) return "";
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
