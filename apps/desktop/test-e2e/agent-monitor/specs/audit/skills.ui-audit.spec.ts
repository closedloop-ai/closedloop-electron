// Layer-2 audit: Skills screen. `skills.list.length` is a structural-assertion,
// dom_count tile — one button per skill across pack groups, so the rendered row
// count must equal the skills_total oracle (= sum of the per-group counts).

import { expect, test } from "@playwright/test";

import { loadManifest } from "../../inventory/manifest-loader.mjs";
// @ts-expect-error — .ts helper imported by Playwright's ts loader
import { assertTileMatchesOracle, tileSkip } from "../../helpers/audit-tile";

const manifest = loadManifest();
const skillTiles = manifest.structural.filter(
  (r: { screen: string }) => r.screen === "Skills",
);

test.describe("Skills tiles · UI audit (manifest-driven)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/skills");
    await expect
      .poll(
        async () => page.locator("[data-testid='audit-skill-row']").count(),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
  });

  for (const row of skillTiles) {
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
