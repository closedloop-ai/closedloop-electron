import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(TEST_DIR, "..");
const TERMINAL_HTML_PATH = path.join(
  DESKTOP_ROOT,
  "src",
  "renderer",
  "terminal.html",
);
const ELECTRON_BUILDER_PATH = path.join(
  DESKTOP_ROOT,
  "electron-builder.yml",
);

test("terminal renderer uses bundled xterm assets", () => {
  const html = readFileSync(TERMINAL_HTML_PATH, "utf-8");

  assert.ok(
    html.includes('./vendor/xterm.min.css'),
    "terminal.html must load local xterm CSS",
  );
  assert.ok(
    html.includes('./vendor/xterm.min.js'),
    "terminal.html must load local xterm JS",
  );
  assert.ok(
    html.includes('./vendor/addon-fit.min.js'),
    "terminal.html must load local addon-fit JS",
  );
  assert.ok(
    !html.includes("cdn.jsdelivr.net"),
    "terminal.html must not depend on CDN-hosted xterm assets",
  );

  for (const relativePath of [
    "src/renderer/vendor/xterm.min.css",
    "src/renderer/vendor/xterm.min.js",
    "src/renderer/vendor/addon-fit.min.js",
  ]) {
    assert.ok(
      existsSync(path.join(DESKTOP_ROOT, relativePath)),
      `expected bundled terminal asset to exist: ${relativePath}`,
    );
  }
});

test("electron-builder includes bundled renderer assets", () => {
  const builderConfig = readFileSync(ELECTRON_BUILDER_PATH, "utf-8");

  assert.ok(
    builderConfig.includes("- src/renderer/**/*"),
    "electron-builder must package the full renderer directory",
  );
});
