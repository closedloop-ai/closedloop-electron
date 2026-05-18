import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const appSource = read("../src/main/app.ts");
const shutdownSource = read("../src/main/shutdown.ts");
const traySource = read("../src/main/tray.ts");
const preloadSource = read("../src/main/preload.ts");
const sidecarSource = read("../src/main/agent-monitor-sidecar.ts");
const hooksSource = read("../src/main/agent-monitor-hooks.ts");
const contractsSource = read("../src/shared/contracts.ts");
const indexHtml = read("../src/renderer/index.html");
const electronBuilder = read("../electron-builder.yml");
const desktopPkg = JSON.parse(read("../package.json")) as {
  version: string;
  scripts: Record<string, string>;
};

const vendorUrl = (p: string): URL =>
  new URL(`../../../vendor/agent-monitor/${p}`, import.meta.url);

test("vendored Claude-Code-Agent-Monitor is present and well-formed", () => {
  for (const f of [
    "package.json",
    "package-lock.json",
    "LICENSE",
    "server/index.js",
    "server/db.js",
    "server/compat-sqlite.js",
    "client/package.json",
    "scripts/install-hooks.js",
    "scripts/hook-handler.js",
    "scripts/uninstall-hooks.js",
  ]) {
    assert.ok(existsSync(vendorUrl(f)), `vendor/agent-monitor/${f} missing`);
  }
  const vendorPkg = JSON.parse(readFileSync(vendorUrl("package.json"), "utf8")) as {
    name: string;
    optionalDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  assert.equal(vendorPkg.name, "agent-dashboard");
  // better-sqlite3 must remain OPTIONAL (so node:sqlite fallback engages and
  // npm ci --omit=optional drops it) — never a hard runtime dependency.
  assert.ok(
    vendorPkg.optionalDependencies?.["better-sqlite3"],
    "better-sqlite3 should be an optionalDependency",
  );
  assert.ok(
    !vendorPkg.dependencies?.["better-sqlite3"],
    "better-sqlite3 must NOT be a hard dependency",
  );
  assert.equal(LICENSE_HAS_MIT(), true);
});

function LICENSE_HAS_MIT(): boolean {
  const l = readFileSync(vendorUrl("LICENSE"), "utf8");
  return /MIT License/.test(l) && /Son Nguyen/.test(l);
}

test("vendor patches #1/#2 + uninstall addition are applied (VENDOR.md ledger)", () => {
  const serverIndex = readFileSync(vendorUrl("server/index.js"), "utf8");
  // Patch #1: bind loopback only.
  assert.match(serverIndex, /server\.listen\(port,\s*"127\.0\.0\.1"/);
  // Patch #2: silent hook auto-install gated behind opt-in env.
  assert.match(serverIndex, /process\.env\.CCAM_AUTO_INSTALL_HOOKS === "1"/);
  // Addition #3: symmetric uninstall using the same predicate.
  const uninstall = readFileSync(vendorUrl("scripts/uninstall-hooks.js"), "utf8");
  assert.match(uninstall, /hook-handler\.js/);
  assert.match(uninstall, /module\.exports\s*=\s*\{\s*uninstallHooks\s*\}/);
});

test("build:agent-monitor is wired into build and the version is bumped", () => {
  assert.equal(
    desktopPkg.scripts["build:agent-monitor"],
    "node scripts/build-agent-monitor.mjs",
  );
  assert.match(desktopPkg.scripts.build ?? "", /pnpm build:agent-monitor/);
  // Any apps/desktop change requires a version bump (CI-enforced). main was 0.15.19.
  assert.notEqual(desktopPkg.version, "0.15.19");
});

test("electron-builder ships agent-monitor unpacked via extraResources", () => {
  assert.match(
    electronBuilder,
    /from:\s*\.\.\/\.\.\/vendor\/agent-monitor[\s\S]*to:\s*agent-monitor/,
  );
  // Must ship client/dist (built), not client source.
  assert.match(electronBuilder, /client\/dist\/\*\*\/\*/);
});

test("sidecar uses the fixed loopback port and no --port/--host args", () => {
  assert.match(contractsSource, /export const AGENT_MONITOR_PORT = 4820/);
  assert.match(sidecarSource, /AGENT_MONITOR_PORT/);
  // Fixed port: must NOT pick a free port like the gateway sidecar did.
  assert.doesNotMatch(sidecarSource, /pickPort|freePort/);
  // Spawn the server entry with no CLI port/host flags (server reads env).
  assert.match(sidecarSource, /spawn\(process\.execPath,\s*\[entryFile\]/);
  assert.match(sidecarSource, /ELECTRON_RUN_AS_NODE:\s*"1"/);
  assert.match(sidecarSource, /DASHBOARD_PORT:\s*String\(this\.port\)/);
  assert.match(sidecarSource, /DASHBOARD_DB_PATH/);
  assert.match(sidecarSource, /CCAM_AUTO_INSTALL_HOOKS:\s*"0"/);
  assert.match(sidecarSource, /\/api\/health/);
});

test("sidecar is constructed and started unconditionally before the gateway", () => {
  assert.match(appSource, /this\.agentMonitor = new AgentMonitorSidecar\(\)/);
  const startIdx = appSource.indexOf("void this.agentMonitor.start()");
  const gatewayTryIdx = appSource.indexOf("await this.server.start()");
  assert.ok(startIdx > 0, "sidecar start call missing");
  assert.ok(gatewayTryIdx > 0, "server.start call missing");
  assert.ok(
    startIdx < gatewayTryIdx,
    "sidecar must start before the gateway try-block",
  );
});

test("sidecar URL + hooks toggle exposed via IPC + preload", () => {
  assert.match(
    appSource,
    /ipcMain\.handle\("desktop:get-agent-monitor-url",[\s\S]*this\.agentMonitor\.getUrl\(\)[\s\S]*this\.agentMonitor\.isReady\(\)/,
  );
  assert.match(
    appSource,
    /ipcMain\.handle\(\s*"desktop:set-agent-monitor-hooks-enabled"[\s\S]*setAgentMonitorHooksEnabled/,
  );
  assert.match(
    preloadSource,
    /getAgentMonitorUrl: \(\) =>\s*ipcRenderer\.invoke\("desktop:get-agent-monitor-url"\)/,
  );
  assert.match(
    preloadSource,
    /setAgentMonitorHooksEnabled:[\s\S]*ipcRenderer\.invoke\(\s*"desktop:set-agent-monitor-hooks-enabled"/,
  );
});

test("openClaudeDashboard focuses the window and navigates to the tab", () => {
  assert.match(
    appSource,
    /openClaudeDashboard\(\): void \{[\s\S]*this\.desktopWindow\.show\(\);[\s\S]*"desktop:navigate-tab",\s*"claude-dashboard"/,
  );
  assert.match(
    appSource,
    /onOpenClaudeDashboard: \(\) => this\.openClaudeDashboard\(\)/,
  );
  assert.match(
    appSource,
    /ipcMain\.handle\("desktop:open-agent-monitor",[\s\S]*this\.openClaudeDashboard\(\)/,
  );
  assert.match(traySource, /onOpenClaudeDashboard\?: \(\) => void/);
  assert.match(traySource, /label: "Open Claude Dashboard"/);
});

test("hooks are opt-in: default off, silent server auto-install never enabled", () => {
  // The host never sets CCAM_AUTO_INSTALL_HOOKS=1; it manages hooks directly.
  assert.doesNotMatch(sidecarSource, /CCAM_AUTO_INSTALL_HOOKS:\s*"1"/);
  assert.match(hooksSource, /store\(\)\.get\("enabled", false\)/);
  assert.match(hooksSource, /ELECTRON_RUN_AS_NODE=1/);
  assert.match(hooksSource, /function uninstallHooks/);
  assert.match(appSource, /syncAgentMonitorHooksOnBoot\(\)/);
});

test("shutdown sequence stops the sidecar before the server", () => {
  assert.match(shutdownSource, /agentMonitor: \{ stop:/);
  assert.match(
    shutdownSource,
    /runPhase\("agentMonitor\.stop"[\s\S]*deps\.agentMonitor\.stop\(\)/,
  );
  const amIdx = shutdownSource.indexOf('runPhase("agentMonitor.stop"');
  const srvIdx = shutdownSource.indexOf('runPhase("server.stop"');
  assert.ok(amIdx > 0 && srvIdx > 0 && amIdx < srvIdx, "agentMonitor.stop must precede server.stop");
});

test("renderer embeds the monitor as the Claude Dashboard nav tab", () => {
  assert.match(indexHtml, /data-tab="claude-dashboard">Claude Dashboard</);
  assert.match(indexHtml, /<section id="claude-dashboard" class="panel">/);
  assert.match(indexHtml, /id="claudeDashFrame"/);
  assert.match(indexHtml, /tabName === "claude-dashboard"/);
  assert.match(indexHtml, /api\.getAgentMonitorUrl\(\)/);
  assert.match(indexHtml, /id="claudeDashHooksToggle"/);
  assert.match(indexHtml, /api\.setAgentMonitorHooksEnabled/);
  // Iframe-in-hidden-panel height fix must be present.
  assert.match(indexHtml, /function sizeClaudeFrame/);
  assert.match(indexHtml, /window\.addEventListener\("resize", sizeClaudeFrame\)/);
});
