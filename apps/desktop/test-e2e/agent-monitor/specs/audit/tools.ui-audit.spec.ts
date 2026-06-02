// Layer-2 audit: Tools screen. `tools.list.length` is a dom_count tile — one
// button per distinct tool from /api/events/facets, so the rendered row count
// must equal the events_facets_tool_names_length oracle. `tools.event_types.length`
// has no countable rendered element yet (event_type only shows per-event in the
// detail panel) so it is skipped until bound. Shared logic in audit-tile.ts.

import { expect, test } from "@playwright/test";

import {
  loadManifest,
  tilesForScreen,
} from "../../inventory/manifest-loader.mjs";
// @ts-expect-error — .ts helper imported by Playwright's ts loader
import { assertTileMatchesOracle, tileSkip } from "../../helpers/audit-tile";

const manifest = loadManifest();
const toolTiles = tilesForScreen(manifest, "Tools");

test.describe("Tools tiles · UI audit (manifest-driven)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/tools");
    await expect
      .poll(
        async () => page.locator("[data-testid='audit-tool-row']").count(),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
  });

  for (const row of toolTiles) {
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
