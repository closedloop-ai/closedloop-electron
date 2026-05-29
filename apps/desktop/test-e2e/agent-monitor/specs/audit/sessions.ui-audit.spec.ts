// Layer-2 audit: Sessions screen tiles. Currently one tile — the total-sessions
// count rendered in the list subtitle ("N sessions"). Same table-driven shape as
// the other screens; shared logic in helpers/audit-tile.ts.

import { expect, test } from "@playwright/test";

import {
  loadManifest,
  tilesForScreen,
} from "../../inventory/manifest-loader.mjs";
// @ts-expect-error — .ts helper imported by Playwright's ts loader
import { assertTileMatchesOracle } from "../../helpers/audit-tile";

const manifest = loadManifest();
const sessionTiles = tilesForScreen(manifest, "Sessions");

test.describe("Sessions tiles · UI audit (manifest-driven)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/sessions");
    // The subtitle shows "0 sessions" until the list loads. Poll until a digit
    // appears in the testid'd subtitle element.
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
      .toMatch(/\d/);
  });

  for (const row of sessionTiles) {
    const testFn = row.bug_ref ? test.skip : test;
    testFn(
      `UI audit · ${row.id} matches oracle "${row.oracle}"${row.bug_ref ? ` (skip — bug ${row.bug_ref})` : ""}`,
      async ({ page }) => {
        await assertTileMatchesOracle(page, row);
      },
    );
  }
});
