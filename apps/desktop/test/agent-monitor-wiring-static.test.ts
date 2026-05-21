import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");
const requireFromDesktop = createRequire(new URL("../package.json", import.meta.url));

const appSource = read("../src/main/app.ts");
const agentMonitorPathSource = read("../src/main/agent-monitor-path.ts");
const buildScriptSource = read("../scripts/build-agent-monitor.mjs");
const plansRouteSource = read("../scripts/agent-monitor-plans/plans-route.js");
const claudeDocSource = read("../CLAUDE.md");
const shutdownSource = read("../src/main/shutdown.ts");
const stagePackagingSource = read("../scripts/stage-packaging-app.mjs");
const thirdPartyNoticesSource = read("../../../THIRD_PARTY_NOTICES.md");
const traySource = read("../src/main/tray.ts");
const preloadSource = read("../src/main/preload.ts");
const sidecarSource = read("../src/main/agent-monitor-sidecar.ts");
const hooksSource = read("../src/main/agent-monitor-hooks.ts");
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
const upstreamClientAppSource = readFileSync(
  requireFromDesktop.resolve("agent-dashboard-client/src/App.tsx"),
  "utf8",
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
  // Any apps/desktop change requires a version bump (CI-enforced). origin/main is 0.15.25.
  assert.notEqual(desktopPkg.version, "0.15.25");
});

test("build script materializes a generated runtime tree with the host patches", () => {
  assert.match(buildScriptSource, /SOURCE_ROOT_PACKAGE = "agent-dashboard"/);
  assert.match(buildScriptSource, /SOURCE_CLIENT_PACKAGE = "agent-dashboard-client"/);
  assert.match(buildScriptSource, /\.generated", "agent-monitor"/);
  assert.match(buildScriptSource, /vite build/);
  assert.match(buildScriptSource, /CLIENT_SNIPPET_FILES/);
  assert.match(buildScriptSource, /server\.listen\(port, "127\.0\.0\.1", \(\) => \{/);
  assert.match(buildScriptSource, /isAllowedDashboardOrigin/);
  assert.match(buildScriptSource, /CCAM_ENABLE_RUN === "1"/);
  assert.match(buildScriptSource, /CCAM_AUTO_INSTALL_HOOKS === "1"/);
  assert.match(buildScriptSource, /Database = require\("\.\/compat-sqlite"\);/);
  assert.match(buildScriptSource, /function patchHooksRoute/);
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
  assert.match(sidecarSource, /NODE_PATH/);
  assert.match(sidecarSource, /resolveRuntimeSupportNodePaths\("agent-dashboard"\)/);
  assert.match(sidecarSource, /path\.dirname\(packageRoot\)/);
  assert.match(sidecarSource, /process\.resourcesPath,\s*"app\.asar",\s*"app",\s*"node_modules"/);
  assert.match(sidecarSource, /\/api\/health/);
  assert.match(
    sidecarSource,
    /async stop\(\): Promise<void> \{[\s\S]*this\.started = false;[\s\S]*this\.stopping = true;[\s\S]*this\.restartAttempts = 0;[\s\S]*this\.stopping = false;/,
  );
  assert.match(sidecarSource, /const shouldRestart = this\.started && !this\.stopping;/);
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
  assert.match(
    settingsStoreSource,
    /if \(typeof partial\.agentMonitorEnabled === "boolean"\) \{[\s\S]*this\.store\.set\("agentMonitorEnabled"/,
  );
  assert.match(
    settingsStoreSource,
    /if \(typeof partial\.planExtractionEnabled === "boolean"\) \{[\s\S]*this\.store\.set\("planExtractionEnabled"/,
  );
});

test("sidecar is feature-gated and, when enabled, starts before the gateway", () => {
  assert.match(appSource, /this\.agentMonitor = new AgentMonitorSidecar\(\)/);
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

test("renderer wires the Agent Dashboard sidecar into the sidebar and gates it on the setting", () => {
  // Agent nav items live in the left sidebar; hidden when the sidecar is off.
  assert.match(indexHtml, /<nav class="sb-nav" id="sidebarNav"/);
  assert.match(indexHtml, /agent-disabled/);
  assert.match(indexHtml, /<section id="claude-dashboard" class="panel active">/);
  assert.match(indexHtml, /id="agentMonitorEnabled"/);
  assert.match(indexHtml, /function syncAgentMonitorTabVisibility/);
  assert.match(indexHtml, /kind === "agent" && !cachedAgentMonitorEnabled/);
  assert.match(indexHtml, /id="claudeDashFrame"/);
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
  assert.deepEqual(
    parseHostAgentNavRoutes(indexHtml),
    parseEmbeddedMonitorNavRoutes(upstreamClientAppSource),
  );
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
    'SHARED_MODULES = ["harness-watcher-utils", "import-session-utils", "parser-utils", "catchup-cache"]',
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

test("Codex harness filter now uses server-backed pagination and rebuilds on snippet edits", () => {
  assert.match(buildScriptSource, /sourceSessionsRoute/);
  assert.match(buildScriptSource, /sourcePushLib/);
  assert.match(loadTopSnippet, /server-side status \+ harness filters/);
  assert.match(loadTopSnippet, /harness: harness \|\| undefined/);
  assert.doesNotMatch(loadTopSnippet, /filter === "waiting" \|\| harness/);
  assert.match(loadRowsSnippet, /rows = rows\.filter\(isSessionAwaitingInput\);/);
  assert.doesNotMatch(loadRowsSnippet, /\(s\.harness \|\| "claude"\)/);
});
