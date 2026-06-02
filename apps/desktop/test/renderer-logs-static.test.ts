import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const rendererPath = path.resolve("src/renderer/index.html");

function readRenderer(): string {
  return fs.readFileSync(rendererPath, "utf8");
}

// FEA-1497 (Phase 0): PR #264 replaced the monolithic index.html shell (which
// hosted the Diagnostics log viewer, the packaged update banner, and the
// security-settings copy) with a first-party React renderer. These static
// string guards target the deleted inline-JS implementation; the equivalent
// behaviour now lives in React components (e.g. LogsPanel/SettingsPanel) and is
// re-guarded in Phase 1. Skipped until then.
describe("renderer Diagnostics and update banner wiring", { skip: "superseded by PR #264 React renderer; re-guarded in Phase 1 (FEA-1497)" }, () => {
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
    assert.match(html, /<section class="sec-section" hidden id="browserCommandKeysSection">/);
    assert.match(html, /const serverSupported = state\.serverSupported === true;/);
    assert.match(html, /browserCommandKeysSection\.hidden = !serverSupported;/);
    assert.match(html, /updateSigningPostureUnavailable\(\);/);
    assert.match(html, /Current server does not support trusted browser keys/);
    assert.match(html, /Browser command keys let this Desktop trust specific web browsers/);
    assert.match(html, /signed-in browser sessions with access to this Desktop can send commands without an approved key/);
    assert.match(html, /If you require trusted keys before approving one, browser commands will be rejected/);
    assert.match(html, /Only trusted browser keys can send cloud commands to this Desktop/);
    assert.match(html, /Requiring trusted keys before approving a browser key will reject browser commands/);
    assert.match(html, /\.sec-toggle input\s*{[^}]*margin: 0;/s);
    assert.match(html, /desktop:command-keys-changed/);
  });
});
