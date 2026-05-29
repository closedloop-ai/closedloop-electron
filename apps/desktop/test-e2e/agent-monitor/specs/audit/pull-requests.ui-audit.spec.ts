// Layer-2 audit: every PullRequests tile in the manifest has its rendered text
// asserted against the formatted oracle value. Same table-driven shape as
// dashboard.ui-audit.spec.ts — shared logic in helpers/audit-tile.ts. The three
// PR summary tiles render via a data-testid (FEA-1437 Phase 3), so they bind by
// selector.

import { expect, test } from "@playwright/test";

import {
  loadManifest,
  tilesForScreen,
} from "../../inventory/manifest-loader.mjs";
// @ts-expect-error — .ts helper imported by Playwright's ts loader
import { assertTileMatchesOracle, tileSkip } from "../../helpers/audit-tile";

const manifest = loadManifest();
const prTiles = tilesForScreen(manifest, "PullRequests");

test.describe("PullRequests tiles · UI audit (manifest-driven)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/pull-requests");
    // Wait until the summary stats load (the value cells show "—" until the
    // fetch resolves). Poll the Pull Requests tile until it is a digit.
    await expect
      .poll(
        async () => {
          const t = await page
            .locator("[data-testid='audit-pr-stats-pull-requests']")
            .innerText()
            .catch(() => null);
          return t;
        },
        { timeout: 10_000 },
      )
      .toMatch(/\d/);
  });

  for (const row of prTiles) {
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
