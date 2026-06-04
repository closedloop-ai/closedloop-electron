// Layer-2 UI spec: Dashboard tiles (the home page). Asserts the big-number
// tiles match the fixture counts the API contract test already proved.

import { expect, test } from "@playwright/test";

test.describe("Dashboard tiles", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Dashboard renders zero-placeholders while /api/stats is in flight.
    // Wait until the Total Sessions tile updates from "0" to the fixture
    // count (5) so the per-test slice grabs real data, not the loading state.
    await expect
      .poll(async () => {
        const text = await page.locator("main").innerText();
        const m = text.match(/Total Sessions\s*\n+\s*(\d+)/i);
        return m ? parseInt(m[1], 10) : -1;
      }, { timeout: 10_000 })
      .toBe(5);
  });

  // Tile labels render in caps via CSS but `innerText` reflects the
  // CSS-transformed form (`TOTAL SESSIONS`), so we match case-insensitively
  // and slice forward to capture the big number that follows.
  async function tileText(page: import("@playwright/test").Page, label: string) {
    const text = await page.locator("main").innerText();
    const idx = text.toLowerCase().indexOf(label.toLowerCase());
    expect(idx, `${label} must appear in main`).toBeGreaterThan(-1);
    return text.slice(idx, idx + 200);
  }

  test("Total Sessions tile shows fixture count (5) with 2 active", async ({
    page,
  }) => {
    const slice = await tileText(page, "Total Sessions");
    expect(slice).toMatch(/5\b/);
    expect(slice.toLowerCase()).toMatch(/2\s+active/);
  });

  test("Total Agents tile shows fixture count (6) with 2 active", async ({
    page,
  }) => {
    const slice = await tileText(page, "Total Agents");
    expect(slice).toMatch(/6\b/);
    expect(slice.toLowerCase()).toMatch(/2\s+active/);
  });

  test("Total Events tile shows fixture event count (8)", async ({
    page,
  }) => {
    const slice = await tileText(page, "Total Events");
    expect(slice).toMatch(/\b8\b/);
  });

  test("Active Agents section lists the working fixture sessions by name", async ({
    page,
  }) => {
    await expect(page.getByText(/Active Agents/i)).toBeVisible();
    // The active-agent cards on the dashboard show the agent's `name` field
    // (e.g. "Main Agent — Fixture Active 1"). Assert both are visible.
    await expect(
      page.getByText("Main Agent — Fixture Active 1"),
    ).toBeVisible();
    await expect(
      page.getByText("Main Agent — Fixture Active 2"),
    ).toBeVisible();
  });
});
