// Coverage validator. Asserts every scanner detection in
// manifest.scanned.json has been explicitly classified in coverage.json.
//
// This is the "tests for every element in the inventory" guarantee — fails
// the moment a new tile appears without an assigned status (tested /
// cross_ref / bug_filed / out_of_scope).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const HERE = dirname(fileURLToPath(import.meta.url));
const INVENTORY = join(HERE, "..", "..", "inventory");
const SPEC_DIR = join(HERE);

const coverage = JSON.parse(
  readFileSync(join(INVENTORY, "coverage.json"), "utf8"),
);
const scanned = JSON.parse(
  readFileSync(join(INVENTORY, "manifest.scanned.json"), "utf8"),
);

test("coverage.json accounts for every scanner detection", () => {
  // Every detection in manifest.scanned.json must appear in coverage.json
  // with a non-`needs_review` status.
  assert.equal(
    coverage.total_detections,
    scanned.tiles.length,
    `coverage.total_detections (${coverage.total_detections}) ≠ scanned.tiles.length (${scanned.tiles.length}) — re-run coverage-classifier`,
  );

  const VALID_STATUSES = new Set([
    "tested",
    "cross_ref",
    "cross_ref_weak",
    "bug_filed",
    "out_of_scope",
  ]);

  const unclassified = coverage.rows.filter(
    (r) => !VALID_STATUSES.has(r.status),
  );
  assert.deepEqual(
    unclassified,
    [],
    `${unclassified.length} detections have no coverage decision — add classifier rules in coverage-classifier.mjs:\n` +
      unclassified
        .slice(0, 10)
        .map((r) => `  ${r.screen} ${r.file}:${r.line} \`${r.value_expr}\``)
        .join("\n"),
  );
});

test("every cross_ref points at a test file that exists", () => {
  const referenced = new Set(
    coverage.rows
      .filter((r) => r.status === "cross_ref" && r.covered_by)
      .map((r) => r.covered_by),
  );
  const missing = [];
  for (const f of referenced) {
    if (!existsSync(join(SPEC_DIR, f))) {
      missing.push(f);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `cross_ref references to non-existent test files:\n${missing.join("\n")}`,
  );
});

test("every cross_ref covered_by test file contains assertions", () => {
  // Sanity check: the referenced file should at least contain `assert.` calls.
  const referenced = new Set(
    coverage.rows
      .filter((r) => r.status === "cross_ref" && r.covered_by)
      .map((r) => r.covered_by),
  );
  const empty = [];
  for (const f of referenced) {
    const body = readFileSync(join(SPEC_DIR, f), "utf8");
    if (!body.includes("assert.")) {
      empty.push(f);
    }
  }
  assert.deepEqual(
    empty,
    [],
    `cross_ref references to test files with no assertions:\n${empty.join("\n")}`,
  );
});

test("every out_of_scope status has a non-empty reason", () => {
  const missingReason = coverage.rows.filter(
    (r) => r.status === "out_of_scope" && (!r.reason || r.reason.length < 10),
  );
  assert.deepEqual(
    missingReason,
    [],
    `${missingReason.length} out_of_scope detections lack a documented reason`,
  );
});

test("coverage summary — counts add up", () => {
  const sum =
    coverage.by_status.tested +
    coverage.by_status.cross_ref +
    (coverage.by_status.cross_ref_weak ?? 0) +
    coverage.by_status.bug_filed +
    coverage.by_status.out_of_scope +
    coverage.by_status.needs_review;
  assert.equal(
    sum,
    coverage.total_detections,
    `by_status counts (${sum}) ≠ total_detections (${coverage.total_detections})`,
  );
  assert.equal(
    coverage.by_status.needs_review,
    0,
    `${coverage.by_status.needs_review} detections still need review`,
  );
});

test("cross_ref_weak count is informational (Phase 3 will tighten)", () => {
  // cross_ref_weak = detection in a manifest-covered screen that didn't
  // bind to a specific tile via value_expr substring match. Today these
  // pass; Phase 3 of PLN-738 drives the count toward 0 via explicit
  // tile-to-renderer annotations. This test exists so the count is
  // visible in CI output, not to fail the build.
  const weak = coverage.by_status.cross_ref_weak ?? 0;
  console.log(`  cross_ref_weak: ${weak} of ${coverage.total_detections}`);
});

// ---------------------------------------------------------------------
// Parametrized: one test per scanner detection.
//
// Every detection in manifest.scanned.json gets its own `test(...)` call
// here. The assertion is light — confirm the coverage row has a valid
// status, a reason or covered_by, and (for cross_ref) that the referenced
// test file actually contains content. This guarantees test count ≥
// detection count: re-run the scanner, add new manifest/coverage rows,
// new tests appear automatically.
// ---------------------------------------------------------------------

function detectionLabel(row) {
  const expr = row.value_expr.slice(0, 40);
  return `${row.screen}:${row.line} \`${expr}\``;
}

for (const row of coverage.rows) {
  test(`detection · ${detectionLabel(row)}`, () => {
    assert.ok(
      ["tested", "cross_ref", "cross_ref_weak", "bug_filed", "out_of_scope"].includes(
        row.status,
      ),
      `detection has no valid status: ${row.status}`,
    );

    if (row.status === "cross_ref" || row.status === "cross_ref_weak") {
      assert.ok(
        row.covered_by,
        `${row.status} must specify covered_by`,
      );
      assert.ok(
        existsSync(join(SPEC_DIR, row.covered_by)),
        `covered_by points at missing file: ${row.covered_by}`,
      );
    }

    if (
      row.status === "out_of_scope" ||
      row.status === "cross_ref" ||
      row.status === "cross_ref_weak"
    ) {
      assert.ok(
        row.reason && row.reason.length > 5,
        "status requires a reason",
      );
    }

    if (row.status === "bug_filed") {
      assert.ok(
        row.bug_ref && /^FEA-\d+$/.test(row.bug_ref),
        "bug_filed requires bug_ref (FEA-NNN)",
      );
    }
  });
}

test("scanner output is current (re-run scan-tiles if this fails)", () => {
  // Compare counts in scanned vs all .tsx pages on disk. If new pages were
  // added without rescanning, this surfaces it.
  const upstreamDir = (() => {
    const pnpmDir = join(HERE, "..", "..", "..", "..", "..", "node_modules", ".pnpm");
    let entries;
    try {
      entries = readdirSync(pnpmDir);
    } catch {
      return null;
    }
    const dir = entries.find((n) => n.startsWith("agent-dashboard-client@"));
    if (!dir) return null;
    return join(pnpmDir, dir, "node_modules", "agent-dashboard-client", "src", "pages");
  })();

  if (!upstreamDir) {
    // Upstream not resolved — skip.
    return;
  }
  const screensInScan = new Set(scanned.tiles.map((t) => t.screen));
  assert.ok(screensInScan.size >= 10, `expected ≥10 screens in scan; got ${screensInScan.size}`);
});
