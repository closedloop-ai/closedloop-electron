import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const sidecarSource = readFileSync(
  new URL("../src/main/agent-monitor-sidecar.ts", import.meta.url),
  "utf-8",
);
const pathSource = readFileSync(
  new URL("../src/main/agent-monitor-path.ts", import.meta.url),
  "utf-8",
);
const contractsSource = readFileSync(
  new URL("../src/shared/contracts.ts", import.meta.url),
  "utf-8",
);
const buildScriptSource = readFileSync(
  new URL("../scripts/build-agent-monitor.mjs", import.meta.url),
  "utf-8",
);
const appSource = readFileSync(
  new URL("../src/main/app.ts", import.meta.url),
  "utf-8",
);

function methodBody(signature: string, windowChars: number): string {
  const idx = sidecarSource.indexOf(signature);
  assert.ok(idx >= 0, `${signature} not found in sidecar source`);
  return sidecarSource.slice(idx, idx + windowChars);
}

const launchBody = methodBody("private async launch(signal: AbortSignal)", 3200);
const stopBody = methodBody("async stop(): Promise<void>", 1200);

describe("agent-monitor in-process runtime wiring", () => {
  test("does not spawn or supervise an Electron-as-Node child process", () => {
    assert.doesNotMatch(sidecarSource, /spawn\(process\.execPath/);
    assert.doesNotMatch(sidecarSource, /ELECTRON_RUN_AS_NODE/);
    assert.doesNotMatch(sidecarSource, /ChildProcess/);
    assert.doesNotMatch(sidecarSource, /restartAttempts/);
  });

  test("resolves and loads the generated closedloop-runtime.js wrapper", () => {
    assert.match(pathSource, /runtimeFile: string/);
    assert.match(pathSource, /"server", "closedloop-runtime\.js"/);
    assert.match(
      launchBody,
      /const \{ rootDir, runtimeFile, entryFile \} = resolveAgentMonitorPaths\(\)/,
    );
    assert.match(launchBody, /existsSync\(runtimeFile\)/);
    assert.match(launchBody, /requireFromHere\(runtimeFile\) as AgentMonitorRuntimeModule/);
    assert.match(launchBody, /startClosedLoopAgentMonitorRuntime/);
  });

  test("preserves the localhost URL and fixed-port default with a dev override", () => {
    assert.match(contractsSource, /export const AGENT_MONITOR_PORT = 4820/);
    assert.match(contractsSource, /resolveAgentMonitorPort/);
    assert.match(contractsSource, /CL_AGENT_MONITOR_PORT/);
    assert.match(sidecarSource, /private readonly port = resolveAgentMonitorPort\(\)/);
    assert.match(sidecarSource, /return this\.ready \? `http:\/\/\$\{HOST\}:\$\{this\.port\}` : null/);
    assert.doesNotMatch(sidecarSource, /pickPort|freePort|PORT_PROBE_ORDER/);
  });

  test("reclaims only verified legacy Electron-as-Node orphans on the default port", () => {
    assert.match(sidecarSource, /reclaimLegacySidecarOrphan\(entryFile\)/);
    assert.match(sidecarSource, /this\.port !== AGENT_MONITOR_PORT/);
    assert.match(sidecarSource, /"sidecar\.pid"/);
    assert.match(sidecarSource, /sessionToken/);
    assert.match(sidecarSource, /getProcessCommand\(pid\)/);
    assert.match(sidecarSource, /command\.includes\(entryFile\)/);
    assert.match(sidecarSource, /getProcessStartTime\(pid\)/);
    assert.match(sidecarSource, /killGroup\(pid, "SIGKILL"\)/);
    assert.match(sidecarSource, /deleteLegacyPidFile/);
  });

  test("passes the existing runtime environment contract into the wrapper", () => {
    const envBody = methodBody("private buildRuntimeEnv", 1900);
    for (const token of [
      "CCAM_RUNTIME_ROOT",
      "NODE_ENV",
      "NODE_PATH",
      "DASHBOARD_PORT",
      "CLAUDE_DASHBOARD_PORT",
      "DASHBOARD_DB_PATH",
      "CCAM_VAPID_KEYS_PATH",
      "CCAM_ENABLE_RUN",
      "CCAM_AUTO_INSTALL_HOOKS",
      "SANDBOX_BASE_DIRECTORY",
      "resolveRuntimeSupportNodePaths(\"agent-dashboard\")",
    ]) {
      const source = token === "resolveRuntimeSupportNodePaths(\"agent-dashboard\")"
        ? sidecarSource
        : envBody;
      assert.match(source, new RegExp(token.replace(/[()]/g, "\\$&")));
    }
  });

  test("waits for health before marking ready and flushes waiters on failure", () => {
    assert.match(launchBody, /if \(await this\.waitForHealth\(signal\)\)/);
    assert.match(launchBody, /this\.flushReady\(true\)/);
    assert.match(sidecarSource, /this\.flushReady\(false\)/);
    assert.match(sidecarSource, /fetch\(`http:\/\/\$\{HOST\}:\$\{port\}\/api\/health`/);
  });

  test("stop aborts and deterministically waits for in-flight startup cleanup", () => {
    assert.match(sidecarSource, /private startAbort: AbortController \| null = null/);
    assert.match(stopBody, /this\.startAbort\?\.abort\(\)/);
    assert.match(stopBody, /const starting = this\.starting/);
    assert.match(stopBody, /await starting\.catch\(\(\) => \{\}\)/);
    assert.doesNotMatch(stopBody, /Promise\.race/);
    assert.match(stopBody, /const runtime = this\.runtime/);
    assert.match(stopBody, /await runtime\.stop\(\)/);
    assert.match(stopBody, /this\.flushReady\(false\)/);
    assert.match(launchBody, /signal\.aborted/);
    assert.match(launchBody, /await runtime\.stop\(\)/);
  });

  test("startup failures reset started and surface terminal reasons", () => {
    assert.match(sidecarSource, /this\.started = false/);
    assert.match(sidecarSource, /this\.onTerminalFailure\?\.\(reason\)/);
    assert.match(sidecarSource, /description\.includes\("EADDRINUSE"\)/);
    assert.match(sidecarSource, /port \$\{this\.port\} is in use by another process/);
  });

  test("explicit retry paths clear the terminal-failure tray latch", () => {
    assert.match(appSource, /this\.agentMonitorFailed = false/);
    assert.match(appSource, /this\.agentMonitorFailureReason = null/);
    assert.match(appSource, /desktop:reprocess-agent-logs/);
  });
});

describe("generated runtime wrapper hardening", () => {
  test("build script emits a runtime wrapper with lifecycle cleanup", () => {
    assert.match(buildScriptSource, /closedloop-runtime\.js/);
    assert.match(buildScriptSource, /renderClosedLoopRuntimeSource/);
    assert.match(buildScriptSource, /startClosedLoopAgentMonitorRuntime/);
    assert.match(buildScriptSource, /closeHttpServer/);
    assert.match(buildScriptSource, /closeWebSocket/);
    assert.match(buildScriptSource, /clearRuntimeRequireCache/);
    assert.match(buildScriptSource, /Module\._initPaths\(\)/);
  });

  test("generated wrapper owns timers, watchers, and startup ingest that a child process used to own", () => {
    for (const token of [
      "startMaintenanceSweep",
      "startColdStartIngest",
      "startWatchers",
      "stopWatchdog",
      "startUpdateScheduler",
      "runClaudePlanBackfill",
      "runClaudePrBackfill",
      "runPackScanner",
      "scheduleCatalogFetch",
      "ingestAllHarnesses",
    ]) {
      assert.match(buildScriptSource, new RegExp(token));
    }
  });

  test("generated server listen errors reject the runtime startup promise", () => {
    assert.match(buildScriptSource, /server\.once\("error", onError\)/);
    assert.match(buildScriptSource, /server\.off\("error", onError\)/);
    assert.match(buildScriptSource, /server\.off\("error", onError\);\\n      initWebSocket\(server\);/);
    assert.match(buildScriptSource, /return new Promise\(\(resolve, reject\)/);
  });

  test("runtime wrapper sanitizes generated dashboard env from child processes", () => {
    assert.match(buildScriptSource, /let activeRuntimeStart = null/);
    assert.match(buildScriptSource, /throwIfAborted\(signal\)/);
    assert.match(buildScriptSource, /installRuntimeContext/);
    assert.match(buildScriptSource, /withRuntimeContext/);
    assert.match(buildScriptSource, /process\.env = envProxy/);
    assert.match(buildScriptSource, /process\.cwd = function cwd/);
    assert.match(buildScriptSource, /Module\._resolveFilename = function resolveFilename/);
    assert.match(buildScriptSource, /installChildProcessEnvGuard/);
    assert.match(buildScriptSource, /sanitizeChildEnv/);
    assert.match(buildScriptSource, /if \(!envState\.usesRuntimeContext\(\)\)/);
    assert.match(buildScriptSource, /syncChildProcessBuiltinExports/);
    assert.match(buildScriptSource, /Module\.syncBuiltinESMExports/);
    assert.match(buildScriptSource, /DASHBOARD_DB_PATH/);
    assert.match(buildScriptSource, /CCAM_VAPID_KEYS_PATH/);
  });

  test("startup failure cleanup also stops top-level runtime side effects", () => {
    assert.match(buildScriptSource, /function stopTopLevelRuntimeSideEffects/);
    assert.match(
      buildScriptSource,
      /if \(!handles\) \{\n    stopTopLevelRuntimeSideEffects\(\);\n    return;\n  \}/,
    );
    assert.match(buildScriptSource, /stopWatchdog/);
  });
});
