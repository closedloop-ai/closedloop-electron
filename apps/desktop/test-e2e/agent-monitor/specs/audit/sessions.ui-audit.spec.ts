// Layer-2 audit: Sessions screen tiles. Currently one tile — the total-sessions
// count rendered in the list subtitle ("N sessions"). Same table-driven shape as
// the other screens; shared logic in helpers/audit-tile.ts.

import { expect, test } from "@playwright/test";

import {
  loadManifest,
  tilesForScreen,
} from "../../inventory/manifest-loader.mjs";
// @ts-expect-error — .ts helper imported by Playwright's ts loader
import { assertTileMatchesOracle, tileSkip } from "../../helpers/audit-tile";

const manifest = loadManifest();
const sessionTiles = tilesForScreen(manifest, "Sessions");

test.describe("Sessions tiles · UI audit (manifest-driven)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/sessions");
    // The subtitle renders "0 sessions" as its initial placeholder BEFORE
    // api.sessions.list() resolves, so polling for any digit (/\d/) would match
    // that "0" and let the assertion read a stale zero. The fixture seeds a
    // non-zero session count, so wait for a non-zero leading digit ([1-9]) —
    // same anti-race trick the Dashboard audit uses for "Total Sessions".
    await expect
      .poll(
        async () => {
          return page
            .locator("[data-testid='audit-sessions-list-total']")
            .innerText()
            .catch(() => null);
        },
        { timeout: 10_000 },
      )
      .toMatch(/[1-9]/);
  });

  for (const row of sessionTiles) {
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
