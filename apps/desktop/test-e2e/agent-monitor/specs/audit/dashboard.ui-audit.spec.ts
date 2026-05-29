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
import { assertTileMatchesOracle } from "../../helpers/audit-tile";

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
    // Tiles with a filed bug (bug_ref set) are expected to fail until the bug
    // is patched. Skip so the audit-ui suite stays green without masking the
    // bug — the node-side audit keeps the assertion alive as a `todo` that
    // flips to "todo passed" the moment the fix lands.
    const testFn = row.bug_ref ? test.skip : test;
    testFn(
      `UI audit · ${row.id} matches oracle "${row.oracle}"${row.bug_ref ? ` (skip — bug ${row.bug_ref})` : ""}`,
      async ({ page }) => {
        await assertTileMatchesOracle(page, row);
      },
    );
  }
});
