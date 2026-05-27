// Layer-2 UI spec: drives the live Sessions page against the fixture-loaded
// sidecar and asserts the rendered text matches the fixture data.

import { expect, test } from "@playwright/test";

const FIXTURE_SESSIONS = [
  "fixture-sess-active-1",
  "fixture-sess-active-2",
  "fixture-sess-completed-1",
  "fixture-sess-completed-2",
  "fixture-sess-error-1",
];

test.describe("Sessions page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/sessions");
    // Page header lands quickly, but the list is data-driven — wait on the
    // count text the route renders next to the page title.
    await expect(page.getByText(/session recorded/i)).toBeVisible();
  });

  test("page header reports the fixture session count", async ({ page }) => {
    // The fixture has 5 sessions. The header reads "<N> session recorded".
    // We allow trailing whitespace / punctuation variance.
    await expect(page.getByText(/5\s+session/i)).toBeVisible();
  });

  test("renders every fixture session by name in the table", async ({
    page,
  }) => {
    // The table renders the session NAME (e.g. "Fixture Active Session 1");
    // the id column is truncated to 12 chars ("fixture-sess") so identity
    // assertions should target the name field instead.
    await expect(page.getByText("Fixture Active Session 1")).toBeVisible();
    await expect(page.getByText("Fixture Active Session 2")).toBeVisible();
    await expect(page.getByText("Fixture Completed Session 1")).toBeVisible();
    await expect(page.getByText("Fixture Completed Session 2")).toBeVisible();
    await expect(page.getByText("Fixture Error Session")).toBeVisible();
  });

  test("the two active fixture sessions render an Active status cell", async ({
    page,
  }) => {
    const activeRows = page
      .getByRole("row")
      .filter({ hasText: /Fixture Active Session/ });
    await expect(activeRows).toHaveCount(2);
    for (const row of await activeRows.all()) {
      await expect(row.getByText("Active", { exact: true })).toBeVisible();
    }
  });

  test("the error fixture session row carries the Error status", async ({
    page,
  }) => {
    const errorRow = page
      .getByRole("row")
      .filter({ hasText: "Fixture Error Session" });
    await expect(errorRow).toHaveCount(1);
    await expect(errorRow.getByText("Error", { exact: true })).toBeVisible();
  });

  test("a Claude harness filter is offered (fixtures include claude + codex)", async ({
    page,
  }) => {
    // The harness filter strip is part of the toolbar above the table.
    await expect(page.getByText(/Claude/i).first()).toBeVisible();
    await expect(page.getByText(/Codex/i).first()).toBeVisible();
  });
});
