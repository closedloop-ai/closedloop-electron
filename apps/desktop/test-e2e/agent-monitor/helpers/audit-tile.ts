// Shared per-tile UI-audit assertion for the manifest-driven Playwright specs
// (PLN-760, Phase 3). One screen spec = a table loop over its manifest tiles,
// each delegating to assertTileMatchesOracle here. Keeps the oracle+slice+assert
// logic in one place so every screen stays consistent and adding a screen is a
// ~10-line spec (per the repo convention to extract shared test helpers rather
// than copy spec bodies).

import { expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// @ts-expect-error — .mjs loaded by Playwright's ts loader
import { computeOracle, openDb } from "../inventory/audit-runner.mjs";
// @ts-expect-error — .ts helper imported by Playwright's ts loader
import { sliceForTile } from "./playwright-region";

/**
 * The fixture DB path is written to a state file by the Playwright global setup
 * (helpers/playwright-global-setup.ts). Read it so the DB we query for oracles
 * is the same one the sidecar is serving.
 */
export function resolveFixtureDbPath(): string {
  const statePath = join(
    process.env.RUNNER_TEMP || "/tmp",
    "closedloop-e2e-sidecar-state.json",
  );
  if (existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    if (state.dbPath) return state.dbPath;
  }
  throw new Error(
    "Cannot resolve fixture DB path — globalSetup did not write " +
      `${statePath}, or the state file is missing dbPath. Run via ` +
      "`pnpm --filter desktop test:audit:ui` rather than ad-hoc Playwright.",
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Uniform skip decision for every screen spec. A tile is audited only when it
 * is bound to a real selector (selector.present_in_code). Tiles with a filed
 * bug skip until the fix lands; tiles without a bound selector skip as
 * "selector pending" rather than silently falling back to a fragile label
 * slice that can match a number coincidentally (PR #252 review, thadeusb). Use
 * this in ALL specs so the five behave identically.
 */
export function tileSkip(row: {
  bug_ref?: string | null;
  selector?: { present_in_code?: boolean };
}): { skip: boolean; suffix: string } {
  if (row.bug_ref) return { skip: true, suffix: ` (skip — bug ${row.bug_ref})` };
  if (!row.selector?.present_in_code)
    return { skip: true, suffix: " (skip — selector pending)" };
  return { skip: false, suffix: "" };
}

/**
 * Compute the tile's oracle value from the fixture DB, slice its rendered region
 * (data-testid selector when present, else label slice), and assert the rendered
 * text matches the formatted oracle. Branches on tile_kind: trend / money / count.
 * Zero magic numbers — every expectation flows from the manifest + oracle.
 */
export async function assertTileMatchesOracle(
  page: Page,
  // row is a manifest tile loaded via manifest-loader.mjs
  row: {
    id: string;
    label: string;
    oracle: string;
    tile_kind?: string;
    trend_label?: string;
    selector?: {
      value?: string;
      present_in_code?: boolean;
      render_kind?: string;
    };
  },
): Promise<void> {
  const db = openDb(resolveFixtureDbPath());
  let expectedFormatted: string;
  let expectedRaw: number | string;
  try {
    const r = computeOracle(row, db, { tzOffsetMinutes: 0 });
    expectedFormatted = r.expectedFormatted ?? String(r.expected);
    expectedRaw = r.expected as number;
  } finally {
    db.close();
  }

  // dom_count tiles (list_length / section_card_count): there is no single
  // numeric element — the tile's value IS the number of rendered item nodes.
  // Assert the count of the item selector equals the oracle. selector.value is
  // the per-item selector for these tiles (e.g. [data-testid='audit-plan-row']).
  if (row.selector?.render_kind === "dom_count" && row.selector.present_in_code) {
    const expectedCount = Number(expectedRaw);
    await expect(
      page.locator(row.selector.value as string),
      `\n  manifest id: ${row.id}\n` +
        `  oracle:      ${row.oracle} -> ${expectedRaw}\n` +
        `  selector:    ${row.selector.value} (counted)\n` +
        `  note:        dom_count tile — rendered item count must equal oracle.\n`,
    ).toHaveCount(expectedCount);
    return;
  }

  const region = await sliceForTile(page, row);

  if (row.tile_kind === "trend") {
    const trendLabel = row.trend_label ?? "";
    const pattern = new RegExp(
      `${escapeRegex(expectedFormatted)}\\s*${escapeRegex(trendLabel)}`,
      "i",
    );
    expect(
      region,
      `\n  manifest id: ${row.id}\n` +
        `  label:       ${row.label} (${trendLabel})\n` +
        `  oracle:      ${row.oracle} -> ${expectedRaw}\n` +
        `  expected:    "${expectedFormatted} ${trendLabel}"\n` +
        `  region:      ${JSON.stringify(region)}\n` +
        `  triage:      Compare against the API audit for this row's parent\n` +
        `               tile. API agrees but UI doesn't => client formatter /\n` +
        `               rendering bug. Both disagree => DB or oracle is wrong.\n`,
    ).toMatch(pattern);
  } else if (row.tile_kind === "money") {
    expect(
      region,
      `\n  ${row.id} expected "${expectedFormatted}" in region: ${JSON.stringify(region)}`,
    ).toContain(expectedFormatted);
  } else {
    // Counts: the formatted number should appear as a standalone token.
    const pattern = new RegExp(`\\b${escapeRegex(expectedFormatted)}\\b`);
    expect(
      region,
      `\n  manifest id: ${row.id}\n` +
        `  oracle:      ${row.oracle} -> ${expectedRaw}\n` +
        `  expected:    "${expectedFormatted}"\n` +
        `  region:      ${JSON.stringify(region)}\n`,
    ).toMatch(pattern);
  }
}
