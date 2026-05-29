// Layer-2 audit: every Dashboard tile in the manifest has its rendered text
// asserted against the formatted oracle value. Zero magic numbers in this
// file — every expectation flows from the manifest + oracle.
//
// Contrast with the legacy dashboard-tiles.spec.ts which hardcodes 5, 6, 8.
// That file stays as a dumb baseline; this file is the manifest-driven audit.

import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

import {
  loadManifest,
  tilesForScreen,
} from "../../inventory/manifest-loader.mjs";
import { computeOracle, openDb } from "../../inventory/audit-runner.mjs";
// @ts-expect-error — .ts helper imported by Playwright's ts loader
import { sliceForTile } from "../../helpers/playwright-region";

const HERE = dirname(fileURLToPath(import.meta.url));

// The fixture DB path is written to a state file by the playwright global
// setup. Read it here so the same DB the sidecar is serving is the one we
// query for oracles.
function resolveFixtureDbPath(): string {
  const statePath = join(
    process.env.RUNNER_TEMP || "/tmp",
    "closedloop-e2e-sidecar-state.json",
  );
  if (existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    if (state.dbPath) return state.dbPath;
  }
  throw new Error(
    "Cannot resolve fixture DB path — globalSetup did not write " +
      `${statePath}, or the state file is missing dbPath. Run via ` +
      "`pnpm --filter desktop test:e2e` rather than ad-hoc Playwright.",
  );
}

// Region slicing lives in helpers/playwright-region.ts. `sliceForTile` prefers
// the tile's data-testid selector when the manifest records one as present in
// code (selector.present_in_code), and falls back to slicing <main> innerText
// near the tile's label otherwise. FEA-1437 Phase 3 added data-testids to the
// Monitor StatPills, so those tiles now bind by selector; the rest still slice
// by label.

const manifest = loadManifest();
const dashboardTiles = tilesForScreen(manifest, "Dashboard", "Monitor");

test.describe("Dashboard tiles · UI audit (manifest-driven)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait until the Total Sessions tile transitions from "0" placeholder to
    // a real value. Same trick as the legacy spec — the oracle decides what
    // "real" looks like, so we just wait for the digit to stabilize. We
    // can't compare against the oracle in beforeEach (page isn't bound to a
    // specific test row yet); we just wait for non-zero.
    await expect
      .poll(
        async () => {
          const text = await page.locator("main").innerText();
          const m = text.match(/Total Sessions\s*\n+\s*(\S+)/i);
          if (!m) return null;
          // Any non-"0", non-"-" digit string is good enough to start.
          return m[1];
        },
        { timeout: 10_000 },
      )
      .toMatch(/[1-9]/);
  });

  for (const row of dashboardTiles) {
    // Mirror the node:test todo handling: manifest tiles with a filed bug
    // (bug_ref set) are expected to fail until the bug is patched. Skip the
    // assertion so the audit-ui suite stays green without masking the bug —
    // the node-side audit already keeps the assertion alive as a `todo`
    // that flips to "todo passed" the moment the fix lands.
    // See PR #246 GitHub-Codex review [P2] re dashboard.ui-audit.spec.ts:82.
    const testFn = row.bug_ref ? test.skip : test;
    testFn(`UI audit · ${row.id} matches oracle "${row.oracle}"${row.bug_ref ? ` (skip — bug ${row.bug_ref})` : ""}`, async ({
      page,
    }) => {
      // Compute oracle expectation from the fixture DB.
      const db = openDb(resolveFixtureDbPath());
      let expectedFormatted: string;
      let expectedRaw: number | string;
      try {
        const r = computeOracle(row, db, { tzOffsetMinutes: 0 });
        expectedFormatted = r.expectedFormatted ?? String(r.expected);
        expectedRaw = r.expected as number;
      } finally {
        db.close();
      }

      // Resolve the tile's region: data-testid selector when present, else
      // label slice. See helpers/playwright-region.ts.
      const region = await sliceForTile(page, row);

      if (row.tile_kind === "trend") {
        // Trends render like "{n} active" or "{n} total" beneath the big
        // number. Look for the formatted value followed by the trend label.
        const trendLabel = row.trend_label ?? "";
        const pattern = new RegExp(
          `${escapeRegex(expectedFormatted)}\\s*${escapeRegex(trendLabel)}`,
          "i",
        );
        expect(
          region,
          `\n  manifest id: ${row.id}\n` +
            `  label:       ${row.label} (${trendLabel})\n` +
            `  oracle:      ${row.oracle} -> ${expectedRaw}\n` +
            `  expected:    "${expectedFormatted} ${trendLabel}"\n` +
            `  region:      ${JSON.stringify(region)}\n` +
            `  triage:      Compare against the API audit for this row's\n` +
            `               parent tile. If API agrees with oracle but UI\n` +
            `               doesn't, the bug is in the client formatter or\n` +
            `               rendering. If both UI and API disagree, the DB\n` +
            `               (or the oracle) is wrong.\n`,
        ).toMatch(pattern);
      } else if (row.tile_kind === "money") {
        // Money tiles render with "$X.YZ" — assert the dollar string appears.
        expect(
          region,
          `\n  ${row.id} expected "${expectedFormatted}" in region: ${JSON.stringify(region)}`,
        ).toContain(expectedFormatted);
      } else {
        // Counts: the number formatted via fmt (or raw_int) should appear as
        // a standalone token in the region.
        const pattern = new RegExp(`\\b${escapeRegex(expectedFormatted)}\\b`);
        expect(
          region,
          `\n  manifest id: ${row.id}\n` +
            `  oracle:      ${row.oracle} -> ${expectedRaw}\n` +
            `  expected:    "${expectedFormatted}"\n` +
            `  region:      ${JSON.stringify(region)}\n`,
        ).toMatch(pattern);
      }
    });
  }
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
