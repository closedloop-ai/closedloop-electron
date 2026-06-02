// Layer-2 UI spec: Pull Requests page — fixtures have 3 PRs across 2 repos
// and 2 harnesses.

import { expect, test } from "@playwright/test";

test.describe("Pull Requests page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/pull-requests");
    await expect(page.getByText(/Pull Requests/i).first()).toBeVisible();
  });

  test("header counters reflect 3 PRs / 2 sessions / 2 repos", async ({
    page,
  }) => {
    // The page renders three big-number tiles labeled Pull Requests,
    // Sessions w/ PRs, Repositories. We assert the rendered values.
    const text = await page.locator("body").innerText();
    expect(text).toMatch(/\b3\b[\s\S]{0,60}Pull Requests/i);
    // Sessions with PRs = 2 (both PRs from sess-completed-1 collapse to one
    // session; sess-completed-2 contributes the third) — that's 2 distinct.
    expect(text).toMatch(/\b2\b[\s\S]{0,60}Sessions w\/ PRs/i);
    expect(text).toMatch(/\b2\b[\s\S]{0,60}Repositories/i);
  });

  test("renders each fixture PR with title, branch, and repo (By PR view)", async ({
    page,
  }) => {
    // PR titles and branch names are surfaced in the "By PR" view; the
    // default "By session" view only shows PR numbers. The toggle is a
    // button labeled "By PR" near the top.
    await page.getByRole("button", { name: "By PR", exact: true }).click();

    await expect(
      page.getByText("Fix auth bug from fixture session 1"),
    ).toBeVisible();
    await expect(page.getByText("Add landing page")).toBeVisible();
    await expect(
      page.getByText("Lint cleanup from codex session"),
    ).toBeVisible();

    await expect(page.getByText("fix/auth-bug")).toBeVisible();
    await expect(page.getByText("feat/landing-page")).toBeVisible();
    await expect(page.getByText("chore/lint")).toBeVisible();
  });

  test("shows both Claude and Codex harnesses among PR rows", async ({
    page,
  }) => {
    // The codex PR is the lint cleanup; the claude PRs are the two from
    // fixture-sess-completed-1.
    const text = await page.locator("body").innerText();
    expect(text.toLowerCase()).toContain("claude");
    expect(text.toLowerCase()).toContain("codex");
  });
});
