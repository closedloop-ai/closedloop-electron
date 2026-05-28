// Audit report generator — the "CEO one-pager" deliverable from PLN-738.
//
// Usage:
//   pnpm --filter desktop audit:report
//
// What it does:
//   1. Boots the real sidecar against the same fixture DB the contract tests
//      use.
//   2. For every manifest row whose endpoint exposes a single field, queries
//      the API and compares to the oracle.
//   3. For derived/UI-only tiles, computes the oracle value so the report
//      shows what the UI ought to be rendering (the UI audit itself is a
//      separate Playwright run; this report links to its output).
//   4. Writes REPORT-DASHBOARD.md alongside the manifest.
//
// Output is plain markdown so it can be committed and reviewed without any
// additional tooling.

import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  makeTempDbPath,
  reseedPacksAndSkills,
  seedFixtureDb,
} from "../helpers/seed-fixture-db.mjs";
import { launchSidecar } from "../helpers/launch-sidecar.mjs";
import { loadManifest } from "./manifest-loader.mjs";
import {
  computeOracle,
  compareNumeric,
  getField,
  openDb,
} from "./audit-runner.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = join(HERE, "REPORT-AUDIT.md");

function endpointUrlFor(row) {
  if (!row.endpoint || row.endpoint === "derived") return null;
  if (row.endpoint === "/api/stats") return "/api/stats?tz_offset=0";
  if (row.endpoint === "/api/analytics") return "/api/analytics?tz_offset=0";
  if (row.endpoint === "/api/pricing/totalCost") {
    return "/api/pricing/cost?tz_offset=0";
  }
  return row.endpoint.startsWith("/") ? row.endpoint : `/${row.endpoint}`;
}

function md(value) {
  if (value == null) return "_n/a_";
  if (typeof value === "number")
    return Number.isInteger(value) ? String(value) : value.toFixed(6);
  return String(value);
}

function classify(row, apiCmp) {
  if (!row.endpoint || row.endpoint === "derived") return "ui-only";
  if (apiCmp?.ok) return "agree";
  return "disagree";
}

function suspicionScore(row, apiValue, oracleValue) {
  // Order disagreements by relative or absolute delta, depending on tile_kind.
  // Bigger score = more suspicious / more user-visible.
  if (typeof apiValue !== "number" || typeof oracleValue !== "number") return Infinity;
  if (row.tile_kind === "money") return Math.abs(apiValue - oracleValue);
  if (oracleValue === 0) return Math.abs(apiValue);
  return Math.abs(apiValue - oracleValue) / Math.max(1, Math.abs(oracleValue));
}

async function main() {
  const manifest = loadManifest();
  const tiles = manifest.tiles;

  const tmp = makeTempDbPath();
  seedFixtureDb(tmp.dbPath);
  let sidecar;
  let rows = [];
  try {
    sidecar = await launchSidecar({ dbPath: tmp.dbPath });
    reseedPacksAndSkills(tmp.dbPath);
    const db = openDb(tmp.dbPath);
    try {

    // Cache so each endpoint is hit once even if multiple tiles use it.
    const cache = new Map();
    async function fetchOnce(u) {
      if (cache.has(u)) return cache.get(u);
      const res = await fetch(`${sidecar.baseUrl}${u}`);
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`GET ${u} -> ${res.status} ${res.statusText}\n${txt}`);
      }
      const body = await res.json();
      cache.set(u, body);
      return body;
    }

    for (const tile of tiles) {
      const { expected, expectedFormatted } = computeOracle(tile, db, {
        tzOffsetMinutes: 0,
      });

      let apiValue = undefined;
      let apiCmp = null;
      const url = endpointUrlFor(tile);
      if (url) {
        try {
          const body = await fetchOnce(url);
          apiValue = getField(body, tile.endpoint_field);
          if (apiValue !== undefined) {
            apiCmp = compareNumeric(Number(apiValue), Number(expected));
          } else {
            apiCmp = {
              ok: false,
              reason: `field "${tile.endpoint_field}" missing in ${url} response`,
              actual: undefined,
              expected,
            };
          }
        } catch (err) {
          apiCmp = {
            ok: false,
            reason: `fetch error: ${err.message}`,
            actual: undefined,
            expected,
          };
        }
      }

      rows.push({
        tile,
        expected,
        expectedFormatted,
        apiValue,
        apiCmp,
        verdict: classify(tile, apiCmp),
        suspicion: suspicionScore(tile, Number(apiValue), Number(expected)),
        url,
      });
    }

    } finally {
      db.close();
    }
  } finally {
    if (sidecar) await sidecar.stop();
    tmp.cleanup();
  }

  // Build the markdown report.
  const total = rows.length;
  const agree = rows.filter((r) => r.verdict === "agree").length;
  const disagree = rows.filter((r) => r.verdict === "disagree").length;
  const uiOnly = rows.filter((r) => r.verdict === "ui-only").length;

  const topSuspicious = rows
    .filter((r) => r.verdict === "disagree")
    .sort((a, b) => b.suspicion - a.suspicion)
    .slice(0, 5);

  const screens = [...new Set(rows.map((r) => r.tile.screen))];
  const perScreen = screens.map((s) => {
    const r = rows.filter((row) => row.tile.screen === s);
    return {
      screen: s,
      total: r.length,
      agree: r.filter((row) => row.verdict === "agree").length,
      disagree: r.filter((row) => row.verdict === "disagree").length,
      uiOnly: r.filter((row) => row.verdict === "ui-only").length,
    };
  });

  const lines = [];
  lines.push("# UI Numbers Audit Report — all screens");
  lines.push("");
  lines.push(
    `_Generated: ${new Date().toISOString()} · FEA-1415 / PLN-738_`,
  );
  lines.push("");
  lines.push("## Headline");
  lines.push("");
  lines.push(`- Screens with manifest coverage: **${screens.length}**`);
  lines.push(`- Tiles audited: **${total}**`);
  lines.push(`- API agrees with oracle: **${agree}**`);
  lines.push(`- API disagrees with oracle: **${disagree}**`);
  lines.push(`- UI-only / derived tiles (no API field — see Playwright run): **${uiOnly}**`);
  lines.push("");
  lines.push(
    "> This report covers manifest-driven tiles only. Additional dedicated test files (`sessions.per-row`, `bucketed-counts`, `per-model-tokens`, `timezone-bucketing`, `pricing-breakdown`, `session-detail`) probe cross-cutting concerns and surface more bugs — run `pnpm --filter desktop test:audit` for the full picture.",
  );
  lines.push("");
  lines.push("## Coverage by screen");
  lines.push("");
  lines.push("| screen | tiles | ✅ agree | ❌ disagree | 🟦 ui-only |");
  lines.push("|--------|-------|----------|-------------|------------|");
  for (const s of perScreen) {
    lines.push(
      `| ${s.screen} | ${s.total} | ${s.agree} | ${s.disagree} | ${s.uiOnly} |`,
    );
  }
  lines.push("");
  if (disagree === 0 && uiOnly === total) {
    lines.push(
      "> ⚠️  Zero disagreements detected at the API layer. Per PLN-738, a zero-disagreement run is a flag, not a celebration — verify the oracles are not just rubber-stamping the API. Look at the UI-audit Playwright run for layer-2 confirmation.",
    );
  } else if (disagree === 0) {
    lines.push(
      "> ⚠️  Zero API↔oracle disagreements on this slice. Audit the oracles before scaling: a 0% disagreement rate after a real audit is suspicious. Cross-check with the UI-audit Playwright run.",
    );
  } else {
    lines.push(
      `> Bugs found: ${disagree} tiles disagree between the API and the oracle on the fixture DB. See triage table below. Each disagreement should be filed as its own bug feature, linked RELATES_TO FEA-1415.`,
    );
  }
  lines.push("");

  lines.push("## Top suspicious tiles");
  lines.push("");
  if (topSuspicious.length === 0) {
    lines.push("_No disagreements on this run._");
  } else {
    lines.push("| # | tile id | oracle (DB) | API returned | Δ | endpoint |");
    lines.push("|---|---------|-------------|--------------|----|----------|");
    topSuspicious.forEach((r, i) => {
      lines.push(
        `| ${i + 1} | \`${r.tile.id}\` | ${md(r.expected)} | ${md(r.apiValue)} | ${md(r.suspicion)} | \`${r.url ?? "—"}\` |`,
      );
    });
  }
  lines.push("");

  lines.push("## Full table");
  lines.push("");
  lines.push(
    "| tile id | label | oracle (DB) | rendered (expected) | API field | API returned | verdict |",
  );
  lines.push(
    "|---------|-------|-------------|---------------------|-----------|--------------|---------|",
  );
  for (const r of rows) {
    const apiCell =
      r.tile.endpoint === "derived"
        ? "_derived — see UI audit_"
        : r.apiValue !== undefined
          ? md(r.apiValue)
          : `**MISSING** (${r.apiCmp?.reason ?? "?"})`;
    const verdictEmoji =
      r.verdict === "agree"
        ? "✅ agree"
        : r.verdict === "ui-only"
          ? "🟦 ui-only"
          : "❌ DISAGREE";
    lines.push(
      `| \`${r.tile.id}\` | ${r.tile.label}${r.tile.trend_label ? ` (${r.tile.trend_label})` : ""} | ${md(r.expected)} | ${md(r.expectedFormatted)} | \`${r.tile.endpoint_field ?? "—"}\` | ${apiCell} | ${verdictEmoji} |`,
    );
  }
  lines.push("");

  lines.push("## Triage notes per disagreement");
  lines.push("");
  const disagreements = rows.filter((r) => r.verdict === "disagree");
  if (disagreements.length === 0) {
    lines.push("_None — see the headline warning about zero disagreements._");
  } else {
    for (const r of disagreements) {
      lines.push(`### \`${r.tile.id}\``);
      lines.push("");
      lines.push(`- **Tile:** ${r.tile.label}${r.tile.trend_label ? ` (${r.tile.trend_label} trend)` : ""}`);
      lines.push(`- **Oracle (DB ground truth):** \`${r.tile.oracle}\` → ${md(r.expected)}`);
      lines.push(`- **API:** \`GET ${r.url}\` → \`${r.tile.endpoint_field}\` = ${md(r.apiValue)}`);
      lines.push(`- **Δ:** ${md(r.suspicion)} (relative for counts, absolute for money)`);
      lines.push(`- **Reason:** ${r.apiCmp?.reason ?? "(none)"}`);
      lines.push("");
      lines.push(
        `- **Triage layer:** API↔DB. Either the API aggregation is wrong, or the oracle is wrong. To distinguish: read the sidecar's implementation of the field, then re-derive by hand against the fixture data. If the sidecar matches your manual derivation, the oracle is wrong (rare — adjust \`oracles.mjs\`). If the sidecar doesn't match, file a bug feature linked RELATES_TO FEA-1415.`,
      );
      if (r.tile.notes) {
        lines.push(`- **Tile notes:** ${r.tile.notes}`);
      }
      lines.push("");
    }
  }

  lines.push("## Methodology");
  lines.push("");
  lines.push(
    "- **Fixture DB:** built by `helpers/seed-fixture-db.mjs` from the JSON fixtures in `fixtures/`. The same fixture DB that `dashboard.contract.test.mjs` uses.",
  );
  lines.push(
    "- **Oracle:** named SQL/JS function in `inventory/oracles.mjs`. Pure function of the DB. Does not call the parsers or the sidecar.",
  );
  lines.push(
    "- **API:** the real built agent-monitor sidecar (`scripts/build-agent-monitor.mjs`) booted against the fixture DB.",
  );
  lines.push(
    "- **Manifest:** `inventory/manifest.json`. Adding a tile = add a row + an oracle. No test code changes.",
  );
  lines.push(
    "- **UI audit:** runs as Playwright spec `specs/audit/dashboard.ui-audit.spec.ts`. Same oracle, asserted against the rendered text in the live sidecar iframe.",
  );
  lines.push("");
  lines.push("## What this slice intentionally does not prove");
  lines.push("");
  lines.push(
    "- **Parser correctness.** This Phase 0.5 slice seeds the DB directly from JSON. Phase 1 (parser-to-DB harness) wires raw-log fixtures through the real parsers so the chain `logs → parser → DB` is asserted. If the API agrees with the oracle here but parser output drifts from the same DB shape, only Phase 1 catches it.",
  );
  lines.push(
    "- **Health tab.** Out of scope for Phase 0.5; the Health tab is much larger (~15+ tiles, system telemetry) and gets its own slice.",
  );
  lines.push(
    "- **Other screens.** Analytics, Sessions, Session Detail, Workflows, Activity, Pull Requests, Packs, Skills, Tools, SubAgents, Plans, CC Config, Run, and host Electron panels are all out of scope for this slice. Phase 0 (full inventory) enumerates them; Phases 3–5 cover them.",
  );
  lines.push("");
  lines.push("## Next steps");
  lines.push("");
  lines.push(
    "1. **CEO review:** look at the disagreement triage table. Decide which disagreements to file as bugs and which need an oracle correction.",
  );
  lines.push(
    "2. **Sign-off:** if the slice approach holds, scale to Phase 0 (full app inventory) and Phase 1 (parser foundation).",
  );
  lines.push(
    "3. **UI audit:** run `pnpm --filter desktop test:audit:ui` to catch Layer-2 (UI↔API) bugs the API audit can't see.",
  );

  writeFileSync(REPORT_PATH, lines.join("\n") + "\n");
  console.log(`Report written: ${REPORT_PATH}`);
  console.log(
    `Headline: ${agree} agree · ${disagree} disagree · ${uiOnly} ui-only`,
  );
}

main().catch((err) => {
  console.error(err.stack ?? err);
  process.exit(1);
});
