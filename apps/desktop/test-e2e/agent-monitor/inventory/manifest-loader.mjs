// Single entry point for reading the manifest. Centralizes the JSON parse and
// the (light) schema validation so callers don't drift apart.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { oracles } from "./oracles.mjs";
import { formatters } from "./formatters.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(HERE, "manifest.json");

function validateRow(row, kind) {
  const need = (k) => {
    if (row[k] === undefined || row[k] === null) {
      throw new Error(
        `Manifest ${kind} row "${row.id ?? "(no id)"}" is missing required field "${k}"`,
      );
    }
  };
  need("id");
  need("screen");
  need("route");
  need("oracle");
  need("priority");
  if (!oracles[row.oracle]) {
    throw new Error(
      `Manifest row "${row.id}" references oracle "${row.oracle}" — but it is ` +
        `not exported from inventory/oracles.mjs. Add it or fix the manifest.`,
    );
  }
  if (row.formatter && !formatters[row.formatter]) {
    throw new Error(
      `Manifest row "${row.id}" references formatter "${row.formatter}" — but ` +
        `it is not exported from inventory/formatters.mjs.`,
    );
  }
}

/**
 * Load and validate the manifest. Throws on any schema/wiring error.
 * Returns { tiles, structural }, each an array of rows.
 */
export function loadManifest() {
  const raw = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  for (const row of raw.tiles ?? []) validateRow(row, "tile");
  for (const row of raw.structural_assertions ?? []) validateRow(row, "structural");
  return { tiles: raw.tiles ?? [], structural: raw.structural_assertions ?? [] };
}

/** Filter helper: return only manifest rows for a given screen/tab. */
export function tilesForScreen(manifest, screen, tab = null) {
  return manifest.tiles.filter(
    (t) => t.screen === screen && (tab === null || t.tab === tab),
  );
}
