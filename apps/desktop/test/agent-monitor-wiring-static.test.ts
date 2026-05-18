import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const appSource = read("../src/main/app.ts");
const agentMonitorPathSource = read("../src/main/agent-monitor-path.ts");
const buildScriptSource = read("../scripts/build-agent-monitor.mjs");
const claudeDocSource = read("../CLAUDE.md");
const shutdownSource = read("../src/main/shutdown.ts");
const stagePackagingSource = read("../scripts/stage-packaging-app.mjs");
const thirdPartyNoticesSource = read("../../../THIRD_PARTY_NOTICES.md");
const traySource = read("../src/main/tray.ts");
const preloadSource = read("../src/main/preload.ts");
const sidecarSource = read("../src/main/agent-monitor-sidecar.ts");
const hooksSource = read("../src/main/agent-monitor-hooks.ts");
const contractsSource = read("../src/shared/contracts.ts");
const settingsStoreSource = read("../src/main/settings-store.ts");
const indexHtml = read("../src/renderer/index.html");
const electronBuilder = read("../electron-builder.yml");
const gitignoreSource = read("../../../.gitignore");
const desktopPkg = JSON.parse(read("../package.json")) as {
  version: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

test("pnpm-managed agent-monitor source packages are declared and wired into build", () => {
  assert.equal(
    desktopPkg.scripts["build:agent-monitor"],
    "node scripts/build-agent-monitor.mjs",
  );
  assert.match(desktopPkg.scripts.build ?? "", /pnpm build:agent-monitor/);
  assert.equal(
    desktopPkg.dependencies["agent-dashboard"],
    "github:hoangsonww/Claude-Code-Agent-Monitor#840c518d7fa69231de049e41b893938228b67e40",
  );
  assert.equal(
    desktopPkg.devDependencies["agent-dashboard-client"],
    "github:hoangsonww/Claude-Code-Agent-Monitor#840c518d7fa69231de049e41b893938228b67e40&path:/client",
  );
  for (const dep of [
    "@vitejs/plugin-react",
    "autoprefixer",
    "postcss",
    "tailwindcss",
    "vite",
  ]) {
    assert.ok(desktopPkg.devDependencies[dep], `${dep} should be installed for build:agent-monitor`);
  }
  // Any apps/desktop change requires a version bump (CI-enforced). main was 0.15.19.
  assert.notEqual(desktopPkg.version, "0.15.19");
});

test("build script materializes a generated runtime tree with the host patches", () => {
  assert.match(buildScriptSource, /SOURCE_ROOT_PACKAGE = "agent-dashboard"/);
  assert.match(buildScriptSource, /SOURCE_CLIENT_PACKAGE = "agent-dashboard-client"/);
  assert.match(buildScriptSource, /\.generated", "agent-monitor"/);
  assert.match(buildScriptSource, /vite build/);
  assert.match(buildScriptSource, /server\.listen\(port, "127\.0\.0\.1", \(\) => \{/);
  assert.match(buildScriptSource, /CCAM_AUTO_INSTALL_HOOKS === "1"/);
  assert.match(buildScriptSource, /Database = require\("\.\/compat-sqlite"\);/);
  assert.match(buildScriptSource, /module\.exports = \{ uninstallHooks \};/);
});

test("electron-builder ships the generated agent-monitor runtime tree unpacked", () => {
  assert.match(
    electronBuilder,
    /from:\s*\.generated\/agent-monitor[\s\S]*to:\s*agent-monitor/,
  );
  // Must ship client/dist (built), not client source.
  assert.match(electronBuilder, /client\/dist\/\*\*\/\*/);
  assert.doesNotMatch(electronBuilder, /node_modules\/\*\*\/\*/);
  assert.match(stagePackagingSource, /node_modules", "better-sqlite3"/);
});

test("runtime resolves the generated tree and sidecar wiring still uses the fixed port", () => {
  assert.match(agentMonitorPathSource, /\.generated", "agent-monitor"/);
  assert.doesNotMatch(agentMonitorPathSource, /vendor\/agent-monitor/);
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
  assert.match(sidecarSource, /NODE_PATH/);
  assert.match(sidecarSource, /app\.asar", "app", "node_modules"/);
  assert.match(sidecarSource, /\/api\/health/);
});

test("docs and ignores describe generated pnpm-managed inputs, not vendor source", () => {
  assert.match(gitignoreSource, /apps\/desktop\/\.generated\//);
  assert.doesNotMatch(gitignoreSource, /vendor\/agent-monitor/);

  assert.match(thirdPartyNoticesSource, /Claude-Code-Agent-Monitor/);
  assert.match(thirdPartyNoticesSource, /pinned in\s+`apps\/desktop\/package\.json`/);
  assert.match(thirdPartyNoticesSource, /MIT License/);
  assert.match(thirdPartyNoticesSource, /Son Nguyen/);
  assert.doesNotMatch(thirdPartyNoticesSource, /vendor\/agent-monitor/);

  assert.match(claudeDocSource, /pnpm-managed\s+upstream packages/);
  assert.match(claudeDocSource, /\.generated\/agent-monitor/);
  assert.doesNotMatch(claudeDocSource, /vendor\/agent-monitor/);
});

test("agent monitor is feature-gated and defaults off in desktop settings", () => {
  assert.match(contractsSource, /agentMonitorEnabled: boolean/);
  assert.match(contractsSource, /agentMonitorEnabled: false/);
  assert.match(settingsStoreSource, /getAgentMonitorEnabled\(\)/);
  assert.match(settingsStoreSource, /setAgentMonitorEnabled\(agentMonitorEnabled: boolean\)/);
  assert.match(
    settingsStoreSource,
    /if \(typeof partial\.agentMonitorEnabled === "boolean"\) \{[\s\S]*this\.store\.set\("agentMonitorEnabled"/,
  );
});

test("sidecar is feature-gated and, when enabled, starts before the gateway", () => {
  assert.match(appSource, /this\.agentMonitor = new AgentMonitorSidecar\(\)/);
  assert.match(
    appSource,
    /if \(this\.settingsStore\.getAgentMonitorEnabled\(\)\) \{[\s\S]*void this\.agentMonitor\.start\(\);[\s\S]*syncAgentMonitorHooksOnBoot\(\);/,
  );
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
    /ipcMain\.handle\("desktop:get-agent-monitor-url",[\s\S]*this\.agentMonitor\.getUrl\(\)[\s\S]*this\.agentMonitor\.isReady\(\)[\s\S]*enabled: this\.isAgentMonitorEnabled\(\)/,
  );
  assert.match(
    appSource,
    /ipcMain\.handle\(\s*"desktop:set-agent-monitor-hooks-enabled"[\s\S]*Claude Dashboard is disabled in Settings\.[\s\S]*setAgentMonitorHooksEnabled/,
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

test("openClaudeDashboard redirects to settings when disabled and tray access is gated", () => {
  assert.match(
    appSource,
    /openClaudeDashboard\(\): void \{[\s\S]*this\.desktopWindow\.show\(\);[\s\S]*if \(!this\.isAgentMonitorEnabled\(\)\) \{[\s\S]*"desktop:navigate-tab", "settings"[\s\S]*"desktop:navigate-settings-tab", "relay-gateway"[\s\S]*return;[\s\S]*"desktop:navigate-tab",\s*"claude-dashboard"/,
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
  assert.match(traySource, /setAgentMonitorEnabled\(enabled: boolean\)/);
  assert.match(traySource, /this\.agentMonitorEnabled/);
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

test("renderer hides the monitor tab by default and exposes the settings toggle", () => {
  assert.match(indexHtml, /data-tab="claude-dashboard" id="claudeDashboardTabButton" hidden>Claude Dashboard</);
  assert.match(indexHtml, /<section id="claude-dashboard" class="panel">/);
  assert.match(indexHtml, /id="agentMonitorEnabled"/);
  assert.match(indexHtml, /function syncAgentMonitorTabVisibility/);
  assert.match(indexHtml, /tabName === "claude-dashboard" && !cachedAgentMonitorEnabled/);
  assert.match(indexHtml, /id="claudeDashFrame"/);
  assert.match(indexHtml, /tabName === "claude-dashboard"/);
  assert.match(indexHtml, /api\.getAgentMonitorUrl\(\)/);
  assert.match(indexHtml, /id="claudeDashHooksToggle"/);
  assert.match(indexHtml, /api\.setAgentMonitorHooksEnabled/);
  // Iframe-in-hidden-panel height fix must be present.
  assert.match(indexHtml, /function sizeClaudeFrame/);
  assert.match(indexHtml, /window\.addEventListener\("resize", sizeClaudeFrame\)/);
});
