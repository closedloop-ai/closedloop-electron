import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const helperSource = read("../scripts/agent-monitor-packs/client/PackInstallModalUtils.ts");
const packDetailSource = read("../scripts/agent-monitor-packs/client/PackDetail.tsx");
const catalogDetailSource = read("../scripts/agent-monitor-packs/client/CatalogDetail.tsx");

test("single_install uninstall resolves through the shared auto harness", () => {
  assert.match(helperSource, /action === "uninstall" && entry\.single_install === 1/);
  assert.match(helperSource, /return "auto";/);
  assert.match(helperSource, /return harness;/);
});

test("single_install auto preview joins uninstall commands and keeps install as one command", () => {
  assert.match(helperSource, /\.join\(" ; "\)/);
  assert.match(helperSource, /cmdMap\["codex"\] \|\| cmdMap\["claude"\] \|\| Object\.values\(cmdMap\)\[0\] \|\| ""/);
});

test("auto-detect notice only appears for install previews", () => {
  assert.match(helperSource, /return harness === "auto" && action === "install";/);
});

test("detail screens route single_install uninstall through the shared helper", () => {
  assert.match(
    packDetailSource,
    /resolvePackModalHarness\(entry, h, "uninstall"\)/,
  );
  assert.match(
    catalogDetailSource,
    /resolvePackModalHarness\(entry, h, "uninstall"\)/,
  );
  assert.match(packDetailSource, /resolvedInstallModal/);
  assert.match(catalogDetailSource, /resolvedInstall/);
});
