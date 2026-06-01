// Shared DOM-slicing helpers for the manifest-driven UI audit (PLN-760, Phase 3).
//
// Two strategies for locating a tile's rendered value:
//   - sliceAtSelector: preferred. Reads the innerText of a stable
//     `data-testid` element. Use when the manifest tile's
//     `selector.present_in_code` is true.
//   - sliceAtLabel: fallback. Slices <main> innerText to a window near a known
//     label string. Use for tiles that have no data-testid yet (the bulk today
//     — see PHASE3-RENDERER-MAP.md: present_in_code is false for most tiles).
//
// Keeping both here means every screen's spec shares one implementation instead
// of copy-pasting the slice logic (per the repo's "extract shared test helpers"
// convention in CLAUDE.md).

import { expect, type Page } from "@playwright/test";

/**
 * Return the innerText of the element matching `selector` (a CSS selector,
 * typically `[data-testid='…']`). Fails with a clear message if the element is
 * absent, so a missing/renamed testid surfaces as a test failure rather than a
 * silent empty match.
 */
export async function sliceAtSelector(
  page: Page,
  selector: string,
): Promise<string> {
  const locator = page.locator(selector);
  await expect(
    locator,
    `selector "${selector}" must match exactly one element in the page`,
  ).toHaveCount(1);
  return (await locator.innerText()).trim();
}

/**
 * Slice <main> innerText to a `windowChars`-wide window starting at `label`.
 * Label-based fallback for tiles without a data-testid. Matches the pattern
 * originally inlined in dashboard.ui-audit.spec.ts.
 */
export async function sliceAtLabel(
  page: Page,
  label: string,
  windowChars = 80,
): Promise<string> {
  const text = await page.locator("main").innerText();
  const idx = text.toLowerCase().indexOf(label.toLowerCase());
  expect(idx, `label "${label}" must appear in <main>`).toBeGreaterThan(-1);
  return text.slice(idx, idx + windowChars);
}

/**
 * Resolve the region for a manifest tile: prefer its data-testid selector when
 * the manifest records one as present in code, else fall back to label slicing.
 * `row` is a manifest tile (loaded via manifest-loader.mjs).
 */
export async function sliceForTile(
  page: Page,
  row: {
    label: string;
    selector?: { value?: string; present_in_code?: boolean };
  },
): Promise<string> {
  if (row.selector?.present_in_code && row.selector.value) {
    return sliceAtSelector(page, row.selector.value);
  }
  return sliceAtLabel(page, row.label);
}
