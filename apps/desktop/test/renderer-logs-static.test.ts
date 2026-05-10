import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const rendererPath = path.resolve("src/renderer/index.html");

function readRenderer(): string {
  return fs.readFileSync(rendererPath, "utf8");
}

describe("renderer Diagnostics and update banner wiring", () => {
  test("Diagnostics uses incremental rendering controls instead of whole-list HTML replacement", () => {
    const html = readRenderer();

    assert.equal(html.includes("logsList.innerHTML"), false);
    assert.match(html, /id="pauseLogsBtn"/);
    assert.match(html, /id="openLogFileBtn"/);
    assert.match(html, /Paused - \$\{queuedCount\} new entries queued/);
    assert.match(html, /entry\.session === "previous"/);
    assert.match(html, /previous session/);
    assert.match(html, /api\.openLogFile/);
    assert.match(html, /api\.getLogFilePath/);
    assert.match(html, /void pollLogs\(\);/);
    assert.match(html, /function renderLogs\(entries = \[\]\)/);
  });

  test("packaged update banner listens for update-status and gates on downloaded readiness", () => {
    const html = readRenderer();

    assert.match(html, /desktop:update-status/);
    assert.match(html, /status\?\.status === "downloaded"/);
    assert.match(html, /status\?\.readyToInstall === true/);
    assert.match(html, /status\?\.status === "available"/);
    assert.match(html, /status\?\.status === "downloading"/);
    assert.match(html, /hideUpdateBanner\(\)/);
    assert.match(html, /Update &amp; restart/);
  });

  test("Security settings copy covers command signing enforcement states", () => {
    const html = readRenderer();

    assert.match(html, /id="commandSigningEnforcementEnabled"/);
    assert.match(html, /Browser command keys let this Desktop trust specific web browsers/);
    assert.match(html, /signed-in browser sessions with access to this Desktop can send commands without an approved key/);
    assert.match(html, /If you require trusted keys before approving one, browser commands will be rejected/);
    assert.match(html, /Only trusted browser keys can send cloud commands to this Desktop/);
    assert.match(html, /Requiring trusted keys before approving a browser key will reject browser commands/);
    assert.match(html, /\.sec-toggle input\s*{[^}]*margin: 0;/s);
    assert.match(html, /desktop:command-keys-changed/);
  });
});
