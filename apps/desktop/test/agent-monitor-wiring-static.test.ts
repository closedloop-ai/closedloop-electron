import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const appSource = read("../src/main/app.ts");
const agentMonitorPathSource = read("../src/main/agent-monitor-path.ts");
const buildScriptSource = read("../scripts/build-agent-monitor.mjs");
const generatedDbUrl = new URL("../.generated/agent-monitor/server/db.js", import.meta.url);
const generatedDbSource = existsSync(generatedDbUrl)
  ? readFileSync(generatedDbUrl, "utf8")
  : null;
const generatedImportHistoryUrl = new URL(
  "../.generated/agent-monitor/scripts/import-history.js",
  import.meta.url,
);
const generatedImportHistorySource = existsSync(generatedImportHistoryUrl)
  ? readFileSync(generatedImportHistoryUrl, "utf8")
  : null;
const generatedHooksRouteUrl = new URL(
  "../.generated/agent-monitor/server/routes/hooks.js",
  import.meta.url,
);
const generatedHooksRouteSource = existsSync(generatedHooksRouteUrl)
  ? readFileSync(generatedHooksRouteUrl, "utf8")
  : null;
const generatedPricingRouteUrl = new URL(
  "../.generated/agent-monitor/server/routes/pricing.js",
  import.meta.url,
);
const generatedPricingRouteSource = existsSync(generatedPricingRouteUrl)
  ? readFileSync(generatedPricingRouteUrl, "utf8")
  : null;
const generatedAnalyticsRouteUrl = new URL(
  "../.generated/agent-monitor/server/routes/analytics.js",
  import.meta.url,
);
const generatedAnalyticsRouteSource = existsSync(generatedAnalyticsRouteUrl)
  ? readFileSync(generatedAnalyticsRouteUrl, "utf8")
  : null;
// Resolve the pinned upstream agent-dashboard source the same way the build
// script does (createRequire from apps/desktop/package.json) so we can assert
// the build-script patch anchors still match the source they patch.
const requireFromApp = createRequire(new URL("../package.json", import.meta.url));
const upstreamImportHistorySource = ((): string => {
  const pkgRoot = path.dirname(
    requireFromApp.resolve("agent-dashboard/package.json"),
  );
  return readFileSync(
    path.join(pkgRoot, "scripts", "import-history.js"),
    "utf8",
  );
})();
const plansRouteSource = read("../scripts/agent-monitor-plans/plans-route.js");
const claudeDocSource = read("../CLAUDE.md");
const shutdownSource = read("../src/main/shutdown.ts");
const stagePackagingSource = read("../scripts/stage-packaging-app.mjs");
const thirdPartyNoticesSource = read("../../../THIRD_PARTY_NOTICES.md");
const traySource = read("../src/main/tray.ts");
const preloadSource = read("../src/main/preload.ts");
const sidecarSource = read("../src/main/agent-monitor-sidecar.ts");
const hooksSource = read("../src/main/agent-monitor-hooks.ts");
const embedAppSource = read("../scripts/agent-monitor-embed/App.tsx");
const embedLayoutSource = read("../scripts/agent-monitor-embed/Layout.tsx");
const contractsSource = read("../src/shared/contracts.ts");
const settingsStoreSource = read("../src/main/settings-store.ts");
const indexHtml = read("../src/renderer/index.html");
const electronBuilder = read("../electron-builder.yml");
const gitignoreSource = read("../../../.gitignore");
const loadTopSnippet = read(
  "../scripts/agent-monitor-codex/client/sessions.loadtop.replace.txt",
);
const loadRowsSnippet = read(
  "../scripts/agent-monitor-codex/client/sessions.loadrows.replace.txt",
);
const hostFlagsSource = read(
  "../scripts/agent-monitor-plans/client/closedloop-host-flags.ts",
);
const sessionsOverlaySource = read("../scripts/agent-monitor-client/Sessions.tsx");
const dashboardOverlaySource = read("../scripts/agent-monitor-client/Dashboard.tsx");
const settingsOverlaySource = read("../scripts/agent-monitor-client/Settings.tsx");
const statusBadgeOverlaySource = read(
  "../scripts/agent-monitor-client/StatusBadge.tsx",
);
const ledgerHelperSource = read(
  "../scripts/agent-monitor-client/lib/closedloop-ledger.ts",
);
const desktopPkg = JSON.parse(read("../package.json")) as {
  version: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

function parseHostAgentNavRoutes(source: string): string[] {
  return [...source.matchAll(/kind:\s*"agent",\s*route:\s*"([^"]+)"/g)].map(
    (match) => match[1],
  );
}

function parseEmbeddedMonitorNavRoutes(source: string): string[] {
  const routes = ["/"];
  for (const match of source.matchAll(/<Route path="([^"]+)"/g)) {
    const route = match[1];
    if (route === "*" || route.includes(":")) {
      continue;
    }
    routes.push(`/${route}`);
  }
  return routes;
}

test("pnpm-managed agent-monitor source packages are declared and wired into build", () => {
  assert.equal(
    desktopPkg.scripts["build:agent-monitor"],
    "node scripts/build-agent-monitor.mjs",
  );
  // FEA-1497 (Phase 0 main-merge onto the in-process agent-DB branch): PR #264
  // moved the renderer to a first-party Vite build and decoupled
  // `build:agent-monitor` from the default `build`/`start` scripts (it remains
  // invoked by the dedicated script + the pretest hooks). The legacy assertions
  // that `build`/`start` embed `pnpm build:agent-monitor` are intentionally
  // dropped here; the vendor build pipeline + deps are removed wholesale in
  // Phase 3E (vendor teardown).
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
  // Any apps/desktop change requires a version bump (CI-enforced). origin/main is 0.15.25.
  assert.notEqual(desktopPkg.version, "0.15.25");
});

test("build script materializes a generated runtime tree with the host patches", () => {
  assert.match(buildScriptSource, /SOURCE_ROOT_PACKAGE = "agent-dashboard"/);
  assert.match(buildScriptSource, /SOURCE_CLIENT_PACKAGE = "agent-dashboard-client"/);
  assert.match(buildScriptSource, /\.generated", "agent-monitor"/);
  assert.match(buildScriptSource, /vite build/);
  assert.match(buildScriptSource, /CLIENT_FULL_FILE_OVERRIDES/);
  assert.match(buildScriptSource, /CLIENT_SNIPPET_FILES/);
  assert.match(buildScriptSource, /server\.listen\(port, "127\.0\.0\.1", \(\) => \{/);
  assert.match(buildScriptSource, /isAllowedDashboardOrigin/);
  assert.match(buildScriptSource, /CCAM_ENABLE_RUN === "1"/);
  assert.match(buildScriptSource, /CCAM_AUTO_INSTALL_HOOKS === "1"/);
  assert.match(buildScriptSource, /Database = require\("\.\/compat-sqlite"\);/);
  assert.match(buildScriptSource, /function patchHooksRoute/);
  assert.match(buildScriptSource, /function patchHooksSandboxFilter/);
  assert.match(buildScriptSource, /function patchImportHistorySandboxFilter/);
  assert.match(buildScriptSource, /FEA-1407 sandbox scoping/);
  assert.match(buildScriptSource, /extractPlanFromHookEvent/);
  assert.match(buildScriptSource, /upsertPlanCapture\(db, capture\)/);
  assert.match(buildScriptSource, /req\.query\.harness/);
  assert.match(buildScriptSource, /CCAM_VAPID_KEYS_PATH/);
  assert.match(buildScriptSource, /closedloop-host-flags\.ts/);
  assert.match(buildScriptSource, /isPlanExtractionEnabled/);
  assert.match(buildScriptSource, /module\.exports = \{ uninstallHooks \};/);
  // Watcher shutdown cleanup must be patched into the sidecar shutdown handler
  assert.match(buildScriptSource, /stopCodexWatcher/);
  assert.match(buildScriptSource, /stopCursorWatcher/);
  assert.match(buildScriptSource, /stopCopilotWatcher/);
  assert.match(buildScriptSource, /stopOpenCodeWatcher/);
  assert.match(buildScriptSource, /stopCcWatcher/);
  assert.match(buildScriptSource, /agent-monitor-client/);
  assert.match(buildScriptSource, /StatusBadge\.tsx/);
  assert.match(buildScriptSource, /Sessions\.tsx/);
});

// Regression for the FEA-1407 clean-build failure: the sandbox-filter patch
// anchored on the old inline `path.join(os.homedir(), ".claude", "projects")`
// form of PROJECTS_DIR, but the pinned upstream derives it via getProjectsDir().
// The mismatch threw "expected PROJECTS_DIR anchor" on every clean build
// (cleared .generated, fresh clone, CI). Assert the patch anchor still matches
// the source it patches — not merely that the build script mentions the patch.
test("patchImportHistorySandboxFilter anchor matches the pinned upstream import-history", () => {
  const fnMatch = buildScriptSource.match(
    /function patchImportHistorySandboxFilter[\s\S]*?const requireAnchor = (["'])((?:\\.|(?!\1).)*)\1;/,
  );
  assert.ok(
    fnMatch,
    "expected a requireAnchor string literal in patchImportHistorySandboxFilter",
  );
  const anchor = fnMatch[2];
  assert.ok(
    upstreamImportHistorySource.includes(anchor),
    `patchImportHistorySandboxFilter anchor ${JSON.stringify(anchor)} is not present in the pinned upstream import-history.js — a clean build would throw. Update the anchor to match upstream.`,
  );
});

// The build script hard-throws if a patch anchor is missing, but that only
// fires on a clean materialize. Assert the generated tree actually carries the
// applied FEA-1407 sandbox guard (helper + importSession guard), not just that
// the build script defines the patch function.
test("generated import-history applies the FEA-1407 sandbox guard", () => {
  if (generatedImportHistorySource === null) return;
  assert.match(generatedImportHistorySource, /FEA-1407 sandbox scoping/);
  assert.match(
    generatedImportHistorySource,
    /function isSessionInSandbox\(cwd, sandboxBase\)/,
  );
  assert.match(
    generatedImportHistorySource,
    /if \(!isSessionInSandbox\(session\.cwd, process\.env\.SANDBOX_BASE_DIRECTORY\)\)/,
  );
});

test("session overview token totals include compaction baselines", () => {
  assert.match(
    buildScriptSource,
    /COALESCE\(SUM\(input_tokens \+ baseline_input\), 0\) as input_tokens/,
  );
  if (generatedDbSource !== null) {
    assert.match(
      generatedDbSource,
      /COALESCE\(SUM\(input_tokens \+ baseline_input\), 0\) as input_tokens/,
    );
    assert.match(
      generatedDbSource,
      /COALESCE\(SUM\(cache_write_tokens \+ baseline_cache_write\), 0\) as cache_write_tokens/,
    );
  }
});

test("re-import metadata refresh is not gated only on message-count changes", () => {
  assert.match(buildScriptSource, /function patchImportHistoryMetadataRefresh/);
  assert.match(buildScriptSource, /CLOSEDLOOP metadata refresh parity/);
  assert.match(buildScriptSource, /const nextEntryPoint = session\.entrypoint \|\| meta\.entrypoint \|\| null;/);
  assert.match(buildScriptSource, /const nextPermissionMode = session\.permissionMode \|\| meta\.permission_mode \|\| null;/);
  assert.match(buildScriptSource, /JSON\.stringify\(meta\.usage_extras \|\| null\) !== JSON\.stringify\(nextUsageExtras\)/);
  if (generatedImportHistorySource !== null) {
    assert.match(generatedImportHistorySource, /CLOSEDLOOP metadata refresh parity/);
    assert.match(generatedImportHistorySource, /meta\.entrypoint !== nextEntryPoint/);
    assert.match(generatedImportHistorySource, /\(meta\.turn_count \|\| 0\) !== nextTurnCount/);
  }
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
  assert.match(
    stagePackagingSource,
    /dependency\.resolved[\s\S]*packageJson\.dependencies\?\.\[dependencyName\][\s\S]*dependency\.version/,
  );
  assert.match(stagePackagingSource, /\.generated", "agent-monitor"/);
  assert.match(
    stagePackagingSource,
    /await cp\(generatedAgentMonitorDir, stageGeneratedAgentMonitorDir, \{\s*recursive: true,\s*\}\);/,
  );
});

test("runtime resolves the generated tree and sidecar wiring still uses the fixed port", () => {
  assert.match(agentMonitorPathSource, /\.generated", "agent-monitor"/);
  assert.doesNotMatch(agentMonitorPathSource, /vendor\/agent-monitor/);
  assert.match(agentMonitorPathSource, /gatewayLog\.warn/);
  assert.match(contractsSource, /export const AGENT_MONITOR_PORT = 4820/);
  assert.match(sidecarSource, /AGENT_MONITOR_PORT/);
  // Fixed port: must NOT pick a free port like the gateway sidecar did.
  assert.doesNotMatch(sidecarSource, /pickPort|freePort/);
  // Spawn the server entry with no CLI port/host flags (server reads env).
  assert.match(sidecarSource, /spawn\(process\.execPath,\s*\[entryFile\]/);
  assert.match(sidecarSource, /ELECTRON_RUN_AS_NODE:\s*"1"/);
  assert.match(sidecarSource, /DASHBOARD_PORT:\s*String\(this\.port\)/);
  assert.match(sidecarSource, /DASHBOARD_DB_PATH/);
  assert.match(sidecarSource, /CCAM_VAPID_KEYS_PATH/);
  assert.match(sidecarSource, /CCAM_ENABLE_RUN:\s*"0"/);
  assert.match(sidecarSource, /CCAM_AUTO_INSTALL_HOOKS:\s*"0"/);
  assert.match(sidecarSource, /SANDBOX_BASE_DIRECTORY/);
  assert.match(sidecarSource, /setSandboxBaseDirectory/);
  assert.match(sidecarSource, /NODE_PATH/);
  assert.match(sidecarSource, /resolveRuntimeSupportNodePaths\("agent-dashboard"\)/);
  assert.match(sidecarSource, /path\.dirname\(packageRoot\)/);
  assert.match(sidecarSource, /process\.resourcesPath,\s*"app\.asar",\s*"app",\s*"node_modules"/);
  assert.match(sidecarSource, /const healthy = await this\.waitForHealth\(child\);/);
  assert.match(sidecarSource, /\/api\/health/);
  assert.doesNotMatch(sidecarSource, /spawnSync\(\s*"lsof"/);
  assert.doesNotMatch(sidecarSource, /spawnSync\(\s*"ps"/);
  assert.match(
    sidecarSource,
    /async stop\(\): Promise<void> \{[\s\S]*this\.started = false;[\s\S]*this\.stopping = true;[\s\S]*this\.restartAttempts = 0;[\s\S]*this\.stopping = false;/,
  );
  assert.match(sidecarSource, /const shouldRestart = this\.started && !this\.stopping;/);
  assert.match(buildScriptSource, /function patchWebSocketFile/);
  assert.match(buildScriptSource, /updateScheduler = startUpdateScheduler\(\{ broadcast \}\);/);
  assert.match(buildScriptSource, /catalogFetchTimer = require\("\.\/lib\/catalog-fetcher"\)\.scheduleCatalogFetch\(dbModule\.db\);/);
  assert.match(buildScriptSource, /require\("\.\/websocket"\)\.closeWebSocket\(\);/);
  assert.match(buildScriptSource, /httpServer\.closeAllConnections\(\)/);
  assert.match(buildScriptSource, /httpServer\.__closedloopDestroyConnections\(\)/);
});

// FEA-1403: when port 4820 is held by a foreign process (orphaned dev sidecar,
// stale standalone build, etc.), /api/health answers 200 OK before OUR
// just-spawned child has even hit listen(). Readiness must be scoped to the
// child we spawned — not to "anyone on the port" — otherwise the supervisor's
// restartAttempts=0 reset fires every cycle and the documented 5-attempt cap
// is never reached. The supervisor loops forever at "attempt 1/5".
test("FEA-1403: agent monitor readiness is scoped to the spawned child, not to any process on the port", () => {
  // The stability window must outlast the observed EADDRINUSE crash latency.
  // Live testing on a dev build with port 4820 held by a foreign process
  // showed the child reaching listen() (and crashing) up to ~2.5s after
  // spawn — slower than the original ~300ms estimate, because SQLite init +
  // migrations + Express boot run before listen(). Parse the constant
  // numerically so a future change shortening it below the safety margin
  // fails this test.
  const stabilityMatch = sidecarSource.match(
    /const READY_STABILITY_WINDOW_MS = ([\d_]+)/,
  );
  assert.ok(
    stabilityMatch,
    "READY_STABILITY_WINDOW_MS constant must be defined in agent-monitor-sidecar.ts",
  );
  const stabilityMs = Number(stabilityMatch[1].replaceAll("_", ""));
  assert.ok(
    stabilityMs >= 3_000,
    `READY_STABILITY_WINDOW_MS must be >= 3000ms to outlast the observed ~2500ms EADDRINUSE crash window, got ${stabilityMs}ms`,
  );

  // waitForHealth takes the spawned child as a parameter so it can verify
  // identity, not just the port answering.
  assert.match(
    sidecarSource,
    /private async waitForHealth\(child: ChildProcess\): Promise<boolean>/,
  );

  // Single source of truth for the identity-and-alive predicate. Three
  // call sites share this guard (waitForHealth poll, post-health gate,
  // post-stability gate); keeping them in one method means a future change
  // cannot quietly drop half the check at one site.
  assert.match(
    sidecarSource,
    /private isChildAliveAndCurrent\(child: ChildProcess\): boolean \{\s*return this\.child === child && child\.exitCode === null;\s*\}/,
  );

  // waitForHealth bails when our child is no longer the active one or has
  // already exited — a 200 OK from a foreign process must NOT be credited.
  assert.match(
    sidecarSource,
    /this\.stopping[\s\S]{0,100}!this\.isChildAliveAndCurrent\(child\)/,
  );

  // The "agent monitor ready" log + restartAttempts = 0 reset only fire
  // after the stability window AND after re-verifying our child is still
  // the active live one via the shared predicate. The reset is GUARDED —
  // not unconditional.
  assert.match(
    sidecarSource,
    /await delay\(READY_STABILITY_WINDOW_MS\);[\s\S]{0,400}this\.isChildAliveAndCurrent\(child\)[\s\S]{0,400}this\.restartAttempts = 0;/,
  );

  // Guard: there must NOT be an ungated `restartAttempts = 0` immediately
  // following `await this.waitForHealth(...)` — that was the original bug.
  // The post-waitForHealth success path must check child identity first.
  assert.doesNotMatch(
    sidecarSource,
    /const healthy = await this\.waitForHealth\(child\);\s*if \(healthy\) \{\s*this\.restartAttempts = 0;/,
  );
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

test("agent monitor defaults on; plan extraction is feature-gated and defaults off in desktop settings", () => {
  assert.match(contractsSource, /agentMonitorEnabled: boolean/);
  // The Agent Dashboard now powers the primary Dashboard + agent nav, so the
  // sidecar defaults ON (it can still be turned off in Settings).
  assert.match(contractsSource, /agentMonitorEnabled: true/);
  assert.match(contractsSource, /planExtractionEnabled: boolean/);
  assert.match(contractsSource, /planExtractionEnabled: false/);
  assert.match(settingsStoreSource, /getAgentMonitorEnabled\(\)/);
  assert.match(settingsStoreSource, /setAgentMonitorEnabled\(agentMonitorEnabled: boolean\)/);
  assert.match(settingsStoreSource, /getPlanExtractionEnabled\(\)/);
  assert.match(settingsStoreSource, /setPlanExtractionEnabled\(planExtractionEnabled: boolean\)/);
  // update() handles all registered flags generically via FLAG_KEYS loop
  assert.match(
    settingsStoreSource,
    /for \(const key of FLAG_KEYS\)/,
  );
});

test("sidecar is feature-gated and, when enabled, starts before the gateway", () => {
  assert.match(appSource, /this\.agentMonitor = new AgentMonitorSidecar\([\s\S]*?\)/);
  assert.match(
    appSource,
    /if \(this\.settingsStore\.getAgentMonitorEnabled\(\)\) \{[\s\S]*void this\.agentMonitor\.start\(\);[\s\S]*syncAgentMonitorHooksOnBoot\(\);[\s\S]*this\.agentSessionSync\.start\(\);/,
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

test("agent session sync starts and stops with the agent monitor flag", () => {
  assert.match(
    appSource,
    /private async applyAgentMonitorSetting\(enabled: boolean\): Promise<void> \{[\s\S]*if \(enabled\) \{[\s\S]*this\.agentSessionSync\.start\(\);[\s\S]*return;[\s\S]*await this\.agentMonitor\.stop\(\);[\s\S]*this\.agentSessionSync\.stop\(\);/,
  );
});

test("sidecar URL + hooks toggle exposed via IPC + preload", () => {
  assert.match(
    appSource,
    /ipcMain\.handle\("desktop:get-agent-monitor-url",[\s\S]*this\.agentMonitor\.getUrl\(\)[\s\S]*this\.agentMonitor\.isReady\(\)[\s\S]*enabled: this\.isAgentMonitorEnabled\(\)[\s\S]*planExtractionEnabled: this\.isPlanExtractionEnabled\(\)/,
  );
  assert.match(
    appSource,
    /ipcMain\.handle\(\s*"desktop:set-agent-monitor-hooks-enabled"[\s\S]*Agent Dashboard is disabled in Settings\.[\s\S]*setAgentMonitorHooksEnabled/,
  );
  assert.match(
    preloadSource,
    /getAgentMonitorUrl: \(\) =>[\s\S]*planExtractionEnabled: boolean;/,
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
  assert.match(traySource, /label: "Open Agent Dashboard"/);
});

test("hooks are opt-in: default off, silent server auto-install never enabled", () => {
  // The host never sets CCAM_AUTO_INSTALL_HOOKS=1; it manages hooks directly.
  assert.doesNotMatch(sidecarSource, /CCAM_AUTO_INSTALL_HOOKS:\s*"1"/);
  assert.match(hooksSource, /store\(\)\.get\("enabled", false\)/);
  assert.match(hooksSource, /ELECTRON_RUN_AS_NODE=1/);
  assert.match(hooksSource, /JSON\.stringify\(hookType\)/);
  assert.match(hooksSource, /renameSync/);
  assert.match(hooksSource, /function uninstallHooks/);
  assert.match(appSource, /syncAgentMonitorHooksOnBoot\(\)/);
});

test("agent monitor terminal failure sets a tracked degraded state that refreshTrayState consults", () => {
  // The one-shot tray.setState in onTerminalFailure was being stomped by the
  // next refreshTrayState() call (cloud heartbeat / gateway recheck), which
  // only branched on gatewayHealthy / cloudCommandsPaused / cloudStatus. The
  // degraded indicator must instead be backed by a tracked field so it sticks.
  // (PR #247 review — thadeusb.)

  // 1. A tracked field exists.
  assert.match(appSource, /private agentMonitorFailed = false;/);

  // 2. onTerminalFailure latches the field and routes through refreshTrayState()
  //    rather than calling tray.setState directly (which would be transient).
  assert.match(
    appSource,
    /onTerminalFailure: \(reason: string\) => \{[\s\S]*this\.agentMonitorFailed = true;[\s\S]*this\.refreshTrayState\(\);[\s\S]*\},/,
  );

  // 3. refreshTrayState() actually consults the field (degraded state is owned
  //    by the single state owner, not set out-of-band).
  assert.match(
    appSource,
    /private refreshTrayState\([\s\S]*if \(this\.agentMonitorFailed\) \{[\s\S]*this\.tray\.setState\(\s*"degraded"/,
  );

  // 4. The degraded-monitor branch outranks cloud state: it must appear before
  //    the cloudStatus "online" branch so an online cloud cannot reset the tray
  //    to ready while the monitor is dead.
  const failedBranchIdx = appSource.indexOf("if (this.agentMonitorFailed)");
  const cloudOnlineBranchIdx = appSource.indexOf(
    'if (this.cloudStatus.state === "online")',
  );
  assert.ok(failedBranchIdx > 0, "agentMonitorFailed branch not found in refreshTrayState");
  assert.ok(cloudOnlineBranchIdx > 0, "cloud online branch not found in refreshTrayState");
  assert.ok(
    failedBranchIdx < cloudOnlineBranchIdx,
    "agentMonitorFailed branch must precede the cloud-online branch so the degraded indicator is not overwritten",
  );
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

// FEA-1497 (Phase 0): PR #264 removed the monolithic index.html iframe embed
// (#claudeDashFrame + the closedloop:navigate postMessage bridge). The agent UI
// is now a first-party React renderer and the sidecar iframe is deleted at the
// Phase 1 cutover, so this vendor-iframe wiring guard is obsolete. Skipped until
// the Phase 1 first-party renderer adds its own navigation/visibility guard.
test("renderer wires the Agent Dashboard sidecar into the sidebar and gates it on the setting", { skip: "superseded by PR #264 first-party renderer; re-guarded in Phase 1 (FEA-1497)" }, () => {
  // Agent nav items live in the left sidebar; hidden when the sidecar is off.
  assert.match(indexHtml, /<nav class="sb-nav" id="sidebarNav"/);
  assert.match(indexHtml, /agent-disabled/);
  assert.match(indexHtml, /<section id="claude-dashboard" class="panel active">/);
  // agentMonitorEnabled toggle moved to the Feature Flags panel (rendered via JS from the registry).
  assert.match(indexHtml, /id="featureFlagsList"/);
  assert.match(indexHtml, /function renderFeatureFlagsPanel/);
  assert.match(indexHtml, /function syncAgentMonitorTabVisibility/);
  assert.match(indexHtml, /kind === "agent" && !cachedAgentMonitorEnabled/);
  assert.match(indexHtml, /id="claudeDashFrame"/);
  assert.match(indexHtml, /id="claudeDashStatus" class="dash-loading" aria-live="polite"/);
  assert.match(indexHtml, /api\.getAgentMonitorUrl\(\)/);
  assert.match(indexHtml, /searchParams\.set\(\s*"closedloop_plan_extraction",[\s\S]*r\.planExtractionEnabled \? "1" : "0"/);
  // Embed mode + host postMessage navigation.
  assert.match(indexHtml, /searchParams\.set\("embed", "1"\)/);
  assert.match(indexHtml, /searchParams\.set\(\s*"closedloop_host_origin"/);
  assert.match(indexHtml, /type: "closedloop:navigate"/);
  assert.doesNotMatch(indexHtml, /postMessage\([\s\S]*,\s*"\*"/);
  assert.match(indexHtml, /cachedPlanExtractionEnabled/);
  assert.match(indexHtml, /planExtractionOnly: true/);
  assert.match(indexHtml, /id="claudeDashHooksToggle"/);
  assert.match(indexHtml, /api\.setAgentMonitorHooksEnabled/);
  assert.match(indexHtml, /renderDashLoading\(\);/);
  assert.match(indexHtml, /Starting your dashboard…/);
  assert.match(indexHtml, /Reading your agent sessions\./);
  assert.match(indexHtml, /#claude-dashboard\.panel\.active/);
  // Iframe-in-hidden-panel height fix must be present.
  assert.match(indexHtml, /function sizeClaudeFrame/);
  assert.match(indexHtml, /window\.addEventListener\("resize", sizeClaudeFrame\)/);
});

test("embedded layout accepts navigation only from the configured host origin", () => {
  assert.match(embedLayoutSource, /EMBED_HOST_ORIGIN_QUERY_PARAM = "closedloop_host_origin"/);
  assert.match(embedLayoutSource, /sessionStorage\.setItem\(EMBED_HOST_ORIGIN_STORAGE_KEY, fromQuery\)/);
  assert.match(embedLayoutSource, /event\.origin === allowedHostOrigin/);
});

test("renderer agent nav stays aligned with the embedded monitor router", () => {
  // The host left nav is a curated subset of the embedded router's routes:
  // some routes (e.g. /analytics, /run) intentionally remain reachable inside
  // the iframe but are hidden from the host sidebar. So every host nav route
  // must resolve to a real monitor route, but the inverse is not required.
  const hostRoutes = parseHostAgentNavRoutes(indexHtml);
  const monitorRoutes = new Set(parseEmbeddedMonitorNavRoutes(embedAppSource));
  for (const route of hostRoutes) {
    assert.ok(
      monitorRoutes.has(route),
      `Host nav route ${route} is not a route in the embedded monitor router`,
    );
  }
  // We intentionally layer host-owned route patches on top of the pinned
  // upstream client via a repo-owned App.tsx overlay, not by mutating the
  // dependency contents directly.
  assert.match(buildScriptSource, /from: embedAppSource,[\s\S]*to: path\.join\("src", "App\.tsx"\)/);
  assert.match(buildScriptSource, /for \(const override of CLIENT_FULL_FILE_OVERRIDES\)/);
});

test("owned sessions overlay keeps harness and status filters on a horizontal scroller", () => {
  assert.match(sessionsOverlaySource, /mt-3 flex items-center gap-3 overflow-x-auto pb-1/);
  assert.match(sessionsOverlaySource, /min-w-max/);
});

test("plans UI is gated by the host-loaded plan extraction flag", () => {
  assert.match(hostFlagsSource, /const PLAN_EXTRACTION_QUERY_PARAM = "closedloop_plan_extraction"/);
  assert.match(hostFlagsSource, /window\.sessionStorage/);
  assert.match(buildScriptSource, /path="plans" element=\{isPlanExtractionEnabled\(\) \? <Plans \/> : <NotFound \/>\}/);
  assert.match(buildScriptSource, /\{isPlanExtractionEnabled\(\) && \(/);
});

test("plans route filters in SQL and avoids shell-parsed Windows open commands", () => {
  assert.match(plansRouteSource, /countPlans\(db, \{ sessionId, needsConfirmation \}\)/);
  assert.match(plansRouteSource, /rundll32\.exe/);
  assert.doesNotMatch(plansRouteSource, /spawn\(cmd, \["\/c", "start"/);
});

test("billing-mode two-ledger support (FEA-1434) is wired into the generated build", () => {
  // Build script declares the billing-mode engine module + its materialization,
  // the billing_mode column migration, and the hard-gate messages so a future
  // upstream bump that breaks an anchor fails the build rather than silently
  // dropping the per-session billing dimension.
  for (const needle of [
    "agent-monitor-billing",
    'BILLING_MODULES = ["billing-mode"]',
    "ADD COLUMN billing_mode",
    "setSessionBillingMode",
    "idx_sessions_billing_mode",
    "column migration (FEA-1434)",
    "billing-mode engine, FEA-1434",
  ]) {
    assert.ok(
      buildScriptSource.includes(needle),
      `build-agent-monitor.mjs missing billing-mode wiring: ${needle}`,
    );
  }

  // The canonical engine + its CJS package scope live in-repo and are copied
  // into the generated tree at materialize time.
  assert.ok(
    existsSync(
      new URL(
        "../scripts/agent-monitor-billing/billing-mode.js",
        import.meta.url,
      ),
    ),
    "scripts/agent-monitor-billing/billing-mode.js missing",
  );
  assert.ok(
    existsSync(
      new URL(
        "../scripts/agent-monitor-billing/package.json",
        import.meta.url,
      ),
    ),
    "scripts/agent-monitor-billing/package.json missing",
  );

  // If a generated tree is present, the migration + statement + materialized
  // engine must have survived patching.
  if (generatedDbSource) {
    assert.ok(
      generatedDbSource.includes("ADD COLUMN billing_mode"),
      "generated db.js missing billing_mode column migration",
    );
    assert.ok(
      generatedDbSource.includes("setSessionBillingMode:"),
      "generated db.js missing setSessionBillingMode statement",
    );
    assert.ok(
      existsSync(
        new URL(
          "../.generated/agent-monitor/server/lib/billing-mode.js",
          import.meta.url,
        ),
      ),
      "generated server/lib/billing-mode.js missing",
    );
  }
});

test("billing_mode write paths (FEA-1434) stamp every harness", () => {
  // The shared stamp helper delegates detection to the canonical engine and
  // exposes the single write entry point used by both hooks and importers.
  const billingStamp = read("../scripts/agent-monitor-shared/billing-stamp.js");
  assert.match(billingStamp, /require\("\.\.\/lib\/billing-mode"\)/);
  assert.match(billingStamp, /function stampSessionBillingMode/);

  // Every non-Claude importer stamps its harness via the shared helper right
  // after setSessionHarness, so the billing mode is set the moment a session is
  // imported (before any token-usage rollups read it).
  const importers: Array<[string, string]> = [
    ["../scripts/agent-monitor-codex/codex-import.js", "codex"],
    ["../scripts/agent-monitor-cursor/cursor-import.js", "cursor"],
    ["../scripts/agent-monitor-copilot/copilot-import.js", "copilot"],
    ["../scripts/agent-monitor-opencode/opencode-import.js", "opencode"],
  ];
  for (const [rel, harness] of importers) {
    const src = read(rel);
    assert.ok(
      src.includes('require("../agent-monitor-shared/billing-stamp")'),
      `${rel} missing billing-stamp require`,
    );
    assert.ok(
      src.includes(
        `stampSessionBillingMode(dbModule.stmts, "${harness}", session.sessionId)`,
      ),
      `${rel} missing ${harness} billing-mode stamp`,
    );
  }

  // Build script wires the Claude hook-route stamp, lists the helper among the
  // materialized shared modules, and hard-gates the generated output.
  for (const needle of [
    "function patchHooksBillingMode",
    "patchHooksBillingMode(generatedHooksRoute)",
    '"billing-stamp"',
    "billing-mode stamp (FEA-1434)",
  ]) {
    assert.ok(
      buildScriptSource.includes(needle),
      `build-agent-monitor.mjs missing billing write-path wiring: ${needle}`,
    );
  }

  // If a generated tree is present, the Claude stamp + materialized helper
  // must have survived patching/materialization.
  if (generatedHooksRouteSource) {
    assert.ok(
      generatedHooksRouteSource.includes(
        'stampSessionBillingMode(stmts, "claude", sessionId)',
      ),
      "generated server/routes/hooks.js missing Claude billing-mode stamp",
    );
    assert.ok(
      existsSync(
        new URL(
          "../.generated/agent-monitor/server/agent-monitor-shared/billing-stamp.js",
          import.meta.url,
        ),
      ),
      "generated server/agent-monitor-shared/billing-stamp.js missing",
    );
  }
});

test("two-ledger cost aggregation (FEA-1434) is wired into both cost endpoints", () => {
  // Build script defines + invokes the analytics patch and extends the pricing
  // patch with the /cost ledger split. These needles guard the patch anchors so
  // a future upstream refactor that breaks them fails the build, not silently
  // ships an un-split headline.
  for (const needle of [
    "function patchAnalyticsRoute",
    "patchAnalyticsRoute(generatedAnalyticsRoute)",
    "CLOSEDLOOP FEA-1434 two-ledger headline",
    "CLOSEDLOOP FEA-1434 cost-endpoint ledger split",
    // The headline must be keyed off headlineCost (metered + unknown), never a
    // raw sum that would leak subscription spend into real cost.
    "headlineCost(ledgerTotals)",
    "cost_by_ledger: ledgerTotals",
    // Both generated-tree hard-gates must exist.
    "two-ledger cost split on GET /api/pricing/cost (FEA-1434)",
    "missing the two-ledger headline split (FEA-1434)",
  ]) {
    assert.ok(
      buildScriptSource.includes(needle),
      `build-agent-monitor.mjs missing two-ledger cost wiring: ${needle}`,
    );
  }

  // If a generated tree is present, both routes must carry the split: each
  // requires the ledger engine, buckets by billing_mode via a LEFT JOIN, sets
  // the headline from headlineCost, and exposes cost_by_ledger.
  if (generatedAnalyticsRouteSource) {
    assert.ok(
      generatedAnalyticsRouteSource.includes('require("../lib/billing-mode")'),
      "generated analytics.js missing billing-mode require",
    );
    assert.ok(
      generatedAnalyticsRouteSource.includes("cost_by_ledger: ledgerTotals"),
      "generated analytics.js missing cost_by_ledger",
    );
    assert.ok(
      generatedAnalyticsRouteSource.includes("headlineCost(ledgerTotals)"),
      "generated analytics.js missing headlineCost headline",
    );
    assert.ok(
      generatedAnalyticsRouteSource.includes("LEFT JOIN sessions"),
      "generated analytics.js missing billing_mode LEFT JOIN",
    );
    // The un-joined upstream scan must be gone — that's the bug we're fixing.
    assert.ok(
      !generatedAnalyticsRouteSource.includes(
        'db.prepare("SELECT * FROM token_usage")',
      ),
      "generated analytics.js still uses the un-joined token_usage scan",
    );
  }
  if (generatedPricingRouteSource) {
    assert.ok(
      generatedPricingRouteSource.includes('require("../lib/billing-mode")'),
      "generated pricing.js missing billing-mode require",
    );
    assert.ok(
      generatedPricingRouteSource.includes(
        "CLOSEDLOOP FEA-1434 cost-endpoint ledger split",
      ),
      "generated pricing.js missing /cost ledger split",
    );
    assert.ok(
      generatedPricingRouteSource.includes("cost_by_ledger: ledgerTotals"),
      "generated pricing.js missing cost_by_ledger",
    );
    assert.ok(
      generatedPricingRouteSource.includes("total_cost: headlineCost(ledgerTotals)"),
      "generated pricing.js missing headlineCost headline on /cost",
    );
    assert.ok(
      generatedPricingRouteSource.includes("GROUP BY s.billing_mode, tu.model"),
      "generated pricing.js missing billing_mode-grouped ledger query",
    );
  }
});

test("Codex support (Addition #4/#5/#6) is wired into the generated build", () => {
  // The new model patches the GENERATED tree (like Patches #1/#2/#3): the
  // build script injects the harness column, the Codex watcher/import wiring,
  // copies the in-repo Codex modules, and patches the client pre-Vite-build.
  for (const needle of [
    "agent-monitor-codex",
    'CODEX_MODULES = ["codex-home", "codex-parser", "codex-import", "codex-watcher"]',
    "function patchClientSource",
    "ADD COLUMN harness",
    "setSessionHarness",
    "startCodexWatcher",
    "importAllCodexSessions",
    // Hard-gate messages: a future upstream bump that breaks an anchor must
    // fail the build, not silently drop Codex.
    "column migration (Codex Patch #4)",
  ]) {
    assert.ok(
      buildScriptSource.includes(needle),
      `build-agent-monitor.mjs missing Codex wiring: ${needle}`,
    );
  }

  // Proven Codex modules live in-repo and are copied into the generated tree.
  for (const m of ["codex-home", "codex-parser", "codex-import", "codex-watcher"]) {
    assert.ok(
      existsSync(new URL(`../scripts/agent-monitor-codex/${m}.js`, import.meta.url)),
      `scripts/agent-monitor-codex/${m}.js missing`,
    );
  }
  assert.match(
    read("../scripts/agent-monitor-codex/codex-parser.js"),
    /module\.exports\s*=\s*\{[^}]*parseRolloutFile/,
  );
  // Self-heal: the watcher must retry when ~/.codex/sessions is absent at boot
  // (otherwise a first-ever Codex session needs an app restart).
  assert.match(
    read("../scripts/agent-monitor-codex/codex-watcher.js"),
    /runCatchupImport/,
  );

  // Client harness badge + filter snippet bodies exist (no-escaping patches).
  for (const f of [
    "statusbadge.append.tsx",
    "sessioncard.badge.replace.txt",
    "sessions.state.replace.txt",
    "sessions.loadtop.find.txt",
    "sessions.loadtop.legacy.find.txt",
    "sessions.loadtop.replace.txt",
    "sessions.loadrows.find.txt",
    "sessions.loadrows.legacy.find.txt",
    "sessions.loadrows.replace.txt",
    "sessions.filterui.find.txt",
    "sessions.filterui.replace.txt",
    "sessions.rowbadge.find.txt",
    "sessions.rowbadge.replace.txt",
  ]) {
    assert.ok(
      existsSync(
        new URL(`../scripts/agent-monitor-codex/client/${f}`, import.meta.url),
      ),
      `client snippet ${f} missing`,
    );
  }

  // Docs describe Codex under the generated/pnpm model.
  assert.match(thirdPartyNoticesSource, /Codex/);
  assert.match(claudeDocSource, /Codex/);
});

test("Cursor, Copilot, and OpenCode harnesses are wired into the generated build", () => {
  // Build script declares module arrays for all three new harnesses.
  for (const needle of [
    'CURSOR_MODULES = ["cursor-home", "cursor-parser", "cursor-import", "cursor-watcher"]',
    'COPILOT_MODULES = ["copilot-home", "copilot-parser", "copilot-import", "copilot-watcher"]',
    'OPENCODE_MODULES = ["opencode-home", "opencode-parser", "opencode-import", "opencode-watcher"]',
    "SHARED_MODULES = [",
    "MULTI_HARNESS_SPECS = [",
    "watcherPatchLines",
    "importPatchLines",
    "startCursorWatcher",
    "startCopilotWatcher",
    "startOpenCodeWatcher",
    "importAllCursorSessions",
    "importAllCopilotSessions",
    "importAllOpenCodeSessions",
  ]) {
    assert.ok(
      buildScriptSource.includes(needle),
      `build-agent-monitor.mjs missing multi-harness wiring: ${needle}`,
    );
  }

  // Shared parser utilities exist.
  assert.ok(
    existsSync(new URL("../scripts/agent-monitor-shared/parser-utils.js", import.meta.url)),
    "scripts/agent-monitor-shared/parser-utils.js missing",
  );
  assert.ok(
    existsSync(new URL("../scripts/agent-monitor-shared/harness-watcher-utils.js", import.meta.url)),
    "scripts/agent-monitor-shared/harness-watcher-utils.js missing",
  );
  assert.ok(
    existsSync(new URL("../scripts/agent-monitor-shared/import-session-utils.js", import.meta.url)),
    "scripts/agent-monitor-shared/import-session-utils.js missing",
  );
  assert.match(
    read("../scripts/agent-monitor-copilot/copilot-home.js"),
    /readWorkspacePathFromHashDir/,
  );
  assert.ok(
    read("../scripts/agent-monitor-copilot/copilot-watcher.js").includes(
      String.raw`const CHAT_SESSION_FILE_RE = /(^|[/\\])chatSessions[/\\][^/\\]+\.json$/i;`,
    ),
    "copilot-watcher.js should match real chatSessions/*.json files",
  );
  assert.match(
    read("../scripts/agent-monitor-opencode/opencode-parser.js"),
    /DatabaseSync/,
  );

  // In-repo modules exist for each harness.
  for (const [dir, modules] of [
    ["agent-monitor-cursor", ["cursor-home", "cursor-parser", "cursor-import", "cursor-watcher"]],
    ["agent-monitor-copilot", ["copilot-home", "copilot-parser", "copilot-import", "copilot-watcher"]],
    ["agent-monitor-opencode", ["opencode-home", "opencode-parser", "opencode-import", "opencode-watcher"]],
  ] as const) {
    for (const m of modules) {
      assert.ok(
        existsSync(new URL(`../scripts/${dir}/${m}.js`, import.meta.url)),
        `scripts/${dir}/${m}.js missing`,
      );
    }
  }

  // Watchers self-heal when data dirs don't exist at boot.
  for (const [dir, file] of [
    ["agent-monitor-cursor", "cursor-watcher.js"],
    ["agent-monitor-copilot", "copilot-watcher.js"],
    ["agent-monitor-opencode", "opencode-watcher.js"],
  ] as const) {
    const source = read(`../scripts/${dir}/${file}`);
    assert.match(source, /CATCHUP_POLL_MS = 5000/);
    assert.match(source, /broadcastHarnessRows/);
    assert.match(source, /runCatchupImport/);
    // Retry intervals must be bounded to prevent resource leaks.
    assert.match(source, /MAX_RETRY_ATTEMPTS/);
    assert.ok(
      source.includes("catchupTimer.unref?.();\n  runCatchupImport(broadcast);"),
      `${file} should run an immediate catch-up import on start`,
    );
  }
  // Codex watcher must also have bounded retries and catch-up polling.
  const codexSource = read("../scripts/agent-monitor-codex/codex-watcher.js");
  assert.match(codexSource, /MAX_RETRY_ATTEMPTS/);
  assert.match(
    codexSource,
    /catchupTimer\.unref\?\.\(\);\s*runCatchupImport\(broadcast\);/,
  );

  // Client harness badge supports all five harnesses.
  const badgeSnippet = read("../scripts/agent-monitor-codex/client/statusbadge.append.tsx");
  assert.match(badgeSnippet, /cursor/);
  assert.match(badgeSnippet, /copilot/);
  assert.match(badgeSnippet, /opencode/);

  // Client filter dropdown includes all five harnesses.
  const stateSnippet = read("../scripts/agent-monitor-codex/client/sessions.state.replace.txt");
  assert.match(stateSnippet, /Cursor/);
  assert.match(stateSnippet, /Copilot/);
  assert.match(stateSnippet, /OpenCode/);
});

test("FEA-1334 ingest orchestrator + progress card are wired into the build", () => {
  // Build script registers the new shared modules, wires the orchestrator
  // into server/index.js, and patches the /api/import/progress endpoint.
  for (const needle of [
    '"ingest-paths"',
    '"ingest-progress"',
    '"ingest-orchestrator"',
    "ingestAllHarnesses",
    "patchImportRoute",
    'router.get("/progress"',
    "FEA-1334 ingest orchestrator wiring",
  ]) {
    assert.ok(
      buildScriptSource.includes(needle),
      `build-agent-monitor.mjs missing FEA-1334 wiring: ${needle}`,
    );
  }

  // The new shared modules exist in-repo and get copied into the tree.
  for (const m of ["ingest-paths", "ingest-progress", "ingest-orchestrator"]) {
    assert.ok(
      existsSync(
        new URL(`../scripts/agent-monitor-shared/${m}.js`, import.meta.url),
      ),
      `scripts/agent-monitor-shared/${m}.js missing`,
    );
  }

  // Renderer drives the floating progress card off an IPC proxy so it never
  // makes a cross-origin fetch to the sidecar.
  assert.match(preloadSource, /getAgentMonitorIngestProgress/);
  assert.match(appSource, /desktop:get-agent-monitor-ingest-progress/);
  // FEA-1497 (Phase 0): the floating ingest-progress card moved out of the
  // deleted monolithic index.html into the first-party React renderer. Its IPC
  // contract (preload + app, asserted above) is unchanged; the index.html
  // banner-markup assertions are dropped pending the Phase 1 renderer re-guard.
});

test("Codex harness filter now uses server-backed pagination and rebuilds on snippet edits", () => {
  assert.match(buildScriptSource, /sourceSessionsRoute/);
  assert.match(buildScriptSource, /sourcePushLib/);
  assert.match(loadTopSnippet, /server-side status \+ harness filters/);
  assert.match(loadTopSnippet, /harness: harness \|\| undefined/);
  assert.doesNotMatch(loadTopSnippet, /filter === "waiting" \|\| harness/);
  assert.match(loadRowsSnippet, /rows = rows\.filter\(isSessionAwaitingInput\);/);
  assert.doesNotMatch(loadRowsSnippet, /\(s\.harness \|\| "claude"\)/);
});

test("two-ledger client UI (FEA-1434 Slice 4b) is wired into the build and overlays", () => {
  // 1. The shared ledger helper is delivered as a full-file overlay so the
  //    StatusBadge/Sessions/Dashboard/Settings overlays can import it.
  assert.match(
    buildScriptSource,
    /const clientOverlayLedgerSource = path\.join\(\s*clientOverlayDir,\s*"lib",\s*"closedloop-ledger\.ts"\s*\)/,
  );
  assert.match(
    buildScriptSource,
    /from: clientOverlayLedgerSource,[\s\S]*?to: path\.join\("src", "lib", "closedloop-ledger\.ts"\)/,
  );

  // 2. Latent cache-bust bug fix: currentStamp() must hash EVERY full-file
  //    client overlay. Before the fix it omitted Dashboard/Settings (and the
  //    new ledger helper), so editing only those left the cached generated tree
  //    stale. Assert all three appear inside the currentStamp() hash list.
  const stampMatch = buildScriptSource.match(
    /function currentStamp\(\)\s*\{[\s\S]*?\n\}/,
  );
  assert.ok(stampMatch, "currentStamp() function not found in build script");
  const stampBody = stampMatch[0];
  for (const overlayConst of [
    "clientOverlayStatusBadgeSource",
    "clientOverlaySessionsSource",
    "clientOverlayDashboardSource",
    "clientOverlaySettingsSource",
    "clientOverlayLedgerSource",
  ]) {
    assert.ok(
      stampBody.includes(overlayConst),
      `currentStamp() must hash ${overlayConst} so editing that overlay busts the build cache`,
    );
  }

  // 3. The Session type gains billing_mode via a declarative edit anchored on
  //    the harness line the prior edit adds (additive optional field).
  assert.match(
    buildScriptSource,
    /guard: "billing_mode\?: string \| null",\s*find: "  harness\?: string \| null;",\s*replace: "  harness\?: string \| null;\\n  billing_mode\?: string \| null;",/,
  );

  // 4. Shared helper: presentation-only classification + prefs, NO cost math.
  assert.match(ledgerHelperSource, /export function isSubscriptionMode/);
  assert.match(ledgerHelperSource, /export function subscriptionBadgeLabel/);
  assert.match(ledgerHelperSource, /export interface CostByLedger/);
  assert.match(ledgerHelperSource, /LEDGER_PREFS_KEY = "agent-monitor-ledger"/);
  assert.match(ledgerHelperSource, /showHypotheticalCost: boolean/);
  // The helper must never recompute dollars — cost math is server-side only.
  assert.doesNotMatch(ledgerHelperSource, /calcPrice|computeTokenCost|total_price/);

  // 5. StatusBadge overlay exports a BillingBadge that renders ONLY for
  //    subscription sessions (no fabricated quota %).
  assert.match(statusBadgeOverlaySource, /export function BillingBadge/);
  assert.match(
    statusBadgeOverlaySource,
    /if \(!isSubscriptionMode\(billing_mode\)\) return null;/,
  );

  // 6. Sessions overlay renders the badge from the session's billing_mode.
  assert.match(
    sessionsOverlaySource,
    /<BillingBadge billing_mode=\{session\.billing_mode\} \/>/,
  );

  // 7. Dashboard reads cost_by_ledger + the opt-in pref, but the headline value
  //    stays the billed total_cost — the subscription hypothetical only ever
  //    appears in the pill subtitle, never summed into the headline.
  assert.match(dashboardOverlaySource, /loadLedgerPrefs\(\)\.showHypotheticalCost/);
  assert.match(dashboardOverlaySource, /cost_by_ledger\?: CostByLedger/);
  assert.match(
    dashboardOverlaySource,
    /const subscriptionCost = costByLedger\?\.subscription \?\? 0;/,
  );
  assert.match(dashboardOverlaySource, /sub=\{costPillSub\}/);
  // The pill VALUE must remain total_cost (billed), never the subscription sum.
  assert.match(
    dashboardOverlaySource,
    /value=\{costData \? fmtCost\(costData\.total_cost\) : "\$0\.00"\}/,
  );

  // 8. Settings persists the opt-in toggle through the shared helper.
  assert.match(settingsOverlaySource, /loadLedgerPrefs,/);
  assert.match(settingsOverlaySource, /saveLedgerPrefs,/);
  assert.match(settingsOverlaySource, /"ledger\.showHypothetical"/);
  assert.match(
    settingsOverlaySource,
    /onChange=\{\(v\) => updateLedgerPrefs\(\{ showHypotheticalCost: v \}\)\}/,
  );
});
