// Layer-2 audit: every Dashboard Monitor tile in the manifest has its rendered
// text asserted against the formatted oracle value. Zero magic numbers — every
// expectation flows from the manifest + oracle (shared logic in
// helpers/audit-tile.ts).
//
// Contrast with the legacy dashboard-tiles.spec.ts which hardcodes 5, 6, 8.
// That file stays as a dumb baseline; this file is the manifest-driven audit.

import { expect, test } from "@playwright/test";

import {
  loadManifest,
  tilesForScreen,
} from "../../inventory/manifest-loader.mjs";
// @ts-expect-error — .ts helper imported by Playwright's ts loader
import { assertTileMatchesOracle, tileSkip } from "../../helpers/audit-tile";

const manifest = loadManifest();
const dashboardTiles = tilesForScreen(manifest, "Dashboard", "Monitor");

test.describe("Dashboard tiles · UI audit (manifest-driven)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait until the Total Sessions tile transitions from "0" placeholder to a
    // real value before any row assertion runs. We can't compare against the
    // oracle here (page isn't bound to a row yet); just wait for a non-zero
    // digit so the sidecar has populated.
    await expect
      .poll(
        async () => {
          const text = await page.locator("main").innerText();
          const m = text.match(/Total Sessions\s*\n+\s*(\S+)/i);
          return m ? m[1] : null;
        },
        { timeout: 10_000 },
      )
      .toMatch(/[1-9]/);
  });

  for (const row of dashboardTiles) {
    // Uniform skip: bug_ref tiles (until fixed) and unbound tiles (no
    // data-testid yet) skip; only selector-bound tiles are asserted. See
    // tileSkip in helpers/audit-tile.ts.
    const { skip, suffix } = tileSkip(row);
    const testFn = skip ? test.skip : test;
    testFn(
      `UI audit · ${row.id} matches oracle "${row.oracle}"${suffix}`,
      async ({ page }) => {
        await assertTileMatchesOracle(page, row);
      },
    );
  }
});
