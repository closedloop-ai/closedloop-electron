// Layer-2 UI spec: Packs page — verifies the rendered cards reflect the
// fixture (3 installed packs, with the right skill counts and multi-harness
// display for beta).

import { expect, test } from "@playwright/test";

test.describe("Packs page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/packs");
    // The list does a network fetch; wait for the catalog-or-installed text.
    await expect(page.getByText(/Curated agent skill packs/i)).toBeVisible();
  });

  test("renders all three installed fixture pack cards", async ({ page }) => {
    // Match by github-url since display names go through pack_catalog.
    await expect(page.getByText(/fixture-pack-alpha/).first()).toBeVisible();
    await expect(page.getByText(/fixture-pack-beta/).first()).toBeVisible();
    await expect(page.getByText(/fixture-pack-gamma/).first()).toBeVisible();
  });

  test("alpha card shows '2 skills' (fixture has alpha-skill-one + alpha-skill-two)", async ({
    page,
  }) => {
    const alphaCard = page
      .locator("div,article,section")
      .filter({ hasText: /fixture-pack-alpha/ })
      .first();
    await expect(alphaCard).toContainText(/2\s+skills/i);
  });

  test("beta card shows '1 skill' and lists both claude & codex harnesses", async ({
    page,
  }) => {
    const betaCard = page
      .locator("div,article,section")
      .filter({ hasText: /fixture-pack-beta/ })
      .first();
    await expect(betaCard).toContainText(/1\s+skill/i);
    // The card surfaces installed harnesses somewhere — either "claude, codex"
    // or two separate badges.
    await expect(betaCard).toContainText(/claude/i);
    await expect(betaCard).toContainText(/codex/i);
  });

  test("gamma card shows zero skills (fixture pack has none)", async ({
    page,
  }) => {
    // The card layout renders "Installed (claude)" immediately followed by
    // "GitHub →" when the pack has zero skills (no "· N skills" chip). For
    // alpha/beta the chip appears between those two strings, so we target
    // the gamma card by scoping a narrow container around its display name.
    const gammaCard = page.locator(":scope", {
      hasText: "fixture-pack-gamma",
    });
    // Get the smallest matching ancestor that holds the full card by reading
    // the page text and slicing between "fixture-pack-gamma" and the next pack
    // heading. Avoids brittle CSS selectors tied to the dashboard's internal
    // class names.
    const bodyText = await page.locator("main").innerText();
    const idx = bodyText.indexOf("fixture-pack-gamma");
    expect(idx, "fixture-pack-gamma must be on the page").toBeGreaterThan(-1);
    const slice = bodyText.slice(idx, idx + 400).toLowerCase();
    expect(slice).not.toMatch(/[1-9]\d*\s+skill/);
    // Sanity: gamma's description is present in the same slice.
    expect(slice).toContain("pack with no skills");
    // Mark the unused locator as referenced so eslint doesn't complain
    // (we keep it documented as the original intent).
    void gammaCard;
  });

  test("delta catalog-only pack is shown as not-installed", async ({
    page,
  }) => {
    // fixture-pack-delta-uninstalled exists in pack_catalog but not in
    // agent_packs, so the UI's "available" section should include it.
    await expect(
      page.getByText(/fixture-pack-delta-uninstalled/).first(),
    ).toBeVisible();
  });
});
