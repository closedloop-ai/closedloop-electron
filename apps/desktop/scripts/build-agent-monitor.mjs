// Builds a runtime-ready Claude-Code-Agent-Monitor tree from pnpm-managed
// upstream imports:
//   - `agent-dashboard` (server + hook scripts + runtime package metadata)
//   - `agent-dashboard-client` (client source only)
//
// The generated runtime tree lives at `apps/desktop/.generated/agent-monitor`
// and contains:
//   - server/        (copied from agent-dashboard, with ClosedLoop patches)
//   - scripts/       (copied from agent-dashboard, plus uninstall-hooks.js)
//   - client/dist/   (built from agent-dashboard-client with Vite)
//   - package.json / LICENSE
//
// Unlike the old vendored flow, this does not commit the upstream repo into
// `/vendor`. The Electron app still ships the generated tree unpacked via
// extraResources so the sidecar server and hook scripts remain real files.

import { spawnSync } from "node:child_process";
import { createHash as hash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_ROOT_PACKAGE = "agent-dashboard";
const SOURCE_CLIENT_PACKAGE = "agent-dashboard-client";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(appDir, "../..");
const requireFromApp = createRequire(path.join(appDir, "package.json"));

const generatedRootDir = path.join(appDir, ".generated", "agent-monitor");
const sourceRootDir = resolvePackageRoot(SOURCE_ROOT_PACKAGE);
const sourceClientDir = resolvePackageRoot(SOURCE_CLIENT_PACKAGE);
const sourceRootPkg = path.join(sourceRootDir, "package.json");
const sourceClientPkg = path.join(sourceClientDir, "package.json");
const sourceServerEntry = path.join(sourceRootDir, "server", "index.js");
const sourceSessionsRoute = path.join(sourceRootDir, "server", "routes", "sessions.js");
const sourceHooksRoute = path.join(sourceRootDir, "server", "routes", "hooks.js");
const sourceDbFile = path.join(sourceRootDir, "server", "db.js");
const sourceCompatSqlite = path.join(sourceRootDir, "server", "compat-sqlite.js");
const sourcePushLib = path.join(sourceRootDir, "server", "lib", "push.js");
const sourceClientIndex = path.join(sourceClientDir, "index.html");
const sourceClientDistDir = path.join(sourceClientDir, "dist");
const generatedServerEntry = path.join(generatedRootDir, "server", "index.js");
const generatedSessionsRoute = path.join(
  generatedRootDir,
  "server",
  "routes",
  "sessions.js",
);
const generatedDbFile = path.join(generatedRootDir, "server", "db.js");
const generatedHooksRoute = path.join(
  generatedRootDir,
  "server",
  "routes",
  "hooks.js",
);
const generatedPricingRoute = path.join(
  generatedRootDir,
  "server",
  "routes",
  "pricing.js",
);
const generatedPushLib = path.join(generatedRootDir, "server", "lib", "push.js");
const generatedClientIndex = path.join(
  generatedRootDir,
  "client",
  "dist",
  "index.html",
);
const generatedUninstallHooks = path.join(
  generatedRootDir,
  "scripts",
  "uninstall-hooks.js",
);
const stampFile = path.join(generatedRootDir, ".build-stamp");
const viteBin = resolvePackageBin("vite", "vite");

// CLOSEDLOOP multi-harness support: proven ingestion modules live in-repo and
// are copied into the generated server/lib at materialize time (parallel to
// how uninstall-hooks.js is written). Their logic is architecture-independent
// — relative requires resolve identically in the generated tree as they did
// in the old vendored tree.
const codexModulesDir = path.join(appDir, "scripts", "agent-monitor-codex");
const cursorModulesDir = path.join(appDir, "scripts", "agent-monitor-cursor");
const copilotModulesDir = path.join(appDir, "scripts", "agent-monitor-copilot");
const opencodeModulesDir = path.join(appDir, "scripts", "agent-monitor-opencode");
const sharedModulesDir = path.join(appDir, "scripts", "agent-monitor-shared");
const clientSnippetDir = path.join(codexModulesDir, "client");
const CODEX_MODULES = ["codex-home", "codex-parser", "codex-import", "codex-watcher"];
const CURSOR_MODULES = ["cursor-home", "cursor-parser", "cursor-import", "cursor-watcher"];
const COPILOT_MODULES = ["copilot-home", "copilot-parser", "copilot-import", "copilot-watcher"];
const OPENCODE_MODULES = ["opencode-home", "opencode-parser", "opencode-import", "opencode-watcher"];
const SHARED_MODULES = ["harness-watcher-utils", "import-session-utils", "parser-utils"];
const MULTI_HARNESS_SPECS = [
  {
    key: "codex",
    label: "Codex",
    modulesDir: codexModulesDir,
    modules: CODEX_MODULES,
    watcherModule: "codex-watcher",
    watcherFn: "startCodexWatcher",
    importModule: "codex-import",
    importFn: "importAllCodexSessions",
    importedLog: "Codex sessions from ~/.codex/",
    errorLog: "Codex rollout files had errors during import",
  },
  {
    key: "cursor",
    label: "Cursor",
    modulesDir: cursorModulesDir,
    modules: CURSOR_MODULES,
    watcherModule: "cursor-watcher",
    watcherFn: "startCursorWatcher",
    importModule: "cursor-import",
    importFn: "importAllCursorSessions",
    importedLog: "Cursor sessions from ~/.cursor/",
    errorLog: "Cursor transcript files had errors during import",
  },
  {
    key: "copilot",
    label: "Copilot",
    modulesDir: copilotModulesDir,
    modules: COPILOT_MODULES,
    watcherModule: "copilot-watcher",
    watcherFn: "startCopilotWatcher",
    importModule: "copilot-import",
    importFn: "importAllCopilotSessions",
    importedLog: "Copilot sessions",
    errorLog: "Copilot session files had errors during import",
  },
  {
    key: "opencode",
    label: "OpenCode",
    modulesDir: opencodeModulesDir,
    modules: OPENCODE_MODULES,
    watcherModule: "opencode-watcher",
    watcherFn: "startOpenCodeWatcher",
    importModule: "opencode-import",
    importFn: "importAllOpenCodeSessions",
    importedLog: "OpenCode sessions from ~/.local/share/opencode/",
    errorLog: "OpenCode session files had errors during import",
  },
];
const CLIENT_SNIPPET_FILES = readdirSync(clientSnippetDir).sort();

// CLOSEDLOOP plan-extraction (FEA-1189 / PLN-613): in-repo modules copied into
// the generated server/lib (parallel to CODEX_MODULES); plans-route.js copied
// into server/routes/plans.js; Plans.tsx + a host-owned feature-flag helper
// into the client src tree before the Vite build. import-history.js,
// server/db.js and server/index.js are wired via the same idempotent
// string-anchor + hard-gate approach as the Codex patches.
const planModulesDir = path.join(appDir, "scripts", "agent-monitor-plans");
const PLAN_MODULES = ["plan-extractor", "plan-store", "plan-backfill"];
const generatedImportHistory = path.join(
  generatedRootDir,
  "scripts",
  "import-history.js",
);

// CLOSEDLOOP pack-observability (FEA-1224 / PLN-651): same materialization
// pattern as plan-extraction. pack-store + pack-scanner copied into the
// generated server/lib; packs-route.js + skills-route.js into server/routes;
// four React pages into the client src tree before the Vite build. server/db.js
// and server/index.js are wired via the same idempotent string-anchor +
// hard-gate approach as the plan patches.
const packModulesDir = path.join(appDir, "scripts", "agent-monitor-packs");
const PACK_MODULES = [
  "pack-store",
  "pack-scanner",
  // CLOSEDLOOP catalog (FEA-1314 / PLN-657): discovery catalog of popular
  // agent packs with live GitHub stats + 1-click install. catalog-route is
  // copied separately into server/routes/ (alongside packs-route/skills-route).
  "catalog-store",
  "catalog-fetcher",
  // Per-pack contents-fetcher (FEA-1314 v3): scrapes skill/agent/command
  // listings from each pack's GitHub repo for the detail view.
  "catalog-contents",
  "install-orchestrator",
  // Per-pack detection adapters (voltagent, alirezarezvani, superclaude,
  // claude-code-router). Lazy-required by pack-scanner at run time.
  "catalog-detector",
];
const PACK_CLIENT_PAGES = ["Skills", "Tools", "SubAgents", "Packs"];
// CLOSEDLOOP catalog (FEA-1314): extra client modules that need to ship with
// the Packs page (tab shell + catalog cards + install modal + sparkline).
// Packs.tsx itself is the wrapper that renders <PacksLayout/>.
const PACK_CATALOG_CLIENT_PAGES = [
  "PacksLayout",
  "PacksInstalled",
  "PacksCatalog",
  "CatalogCard",
  "CatalogDetail",
  "InstallModal",
  "Sparkline",
];

// Host-owned pricing defaults for model IDs we ingest from non-Claude harnesses.
// These keep cost stats working without requiring users to hand-enter common
// rules after startup. Rates are per 1M tokens.
const HOST_DEFAULT_PRICING = [
  // Opus family
  ["claude-opus-4-7%", "Claude Opus 4.7", 5, 25, 0.5, 6.25],
  ["claude-opus-4-6%", "Claude Opus 4.6", 5, 25, 0.5, 6.25],
  ["claude-opus-4-5%", "Claude Opus 4.5", 5, 25, 0.5, 6.25],
  ["claude-opus-4-1%", "Claude Opus 4.1", 15, 75, 1.5, 18.75],
  ["claude-opus-4-2%", "Claude Opus 4", 15, 75, 1.5, 18.75],
  // Sonnet family
  ["claude-sonnet-4-6%", "Claude Sonnet 4.6", 3, 15, 0.3, 3.75],
  ["claude-sonnet-4-5%", "Claude Sonnet 4.5", 3, 15, 0.3, 3.75],
  ["claude-sonnet-4-2%", "Claude Sonnet 4", 3, 15, 0.3, 3.75],
  ["claude-3-7-sonnet%", "Claude Sonnet 3.7", 3, 15, 0.3, 3.75],
  ["claude-3-5-sonnet%", "Claude Sonnet 3.5", 3, 15, 0.3, 3.75],
  // Haiku family
  ["claude-haiku-4-5%", "Claude Haiku 4.5", 1, 5, 0.1, 1.25],
  ["claude-3-5-haiku%", "Claude Haiku 3.5", 0.8, 4, 0.08, 1],
  ["claude-3-haiku%", "Claude Haiku 3", 0.25, 1.25, 0.03, 0.3],
  // GPT-5 family
  ["gpt-5.5%", "GPT-5.5", 5, 30, 0.5, 0],
  ["gpt-5.4-mini%", "GPT-5.4 mini", 0.75, 4.5, 0.075, 0],
  ["gpt-5.4-nano%", "GPT-5.4 nano", 0.2, 1.25, 0.02, 0],
  ["gpt-5.4%", "GPT-5.4", 2.5, 15, 0.25, 0],
  ["gpt-5-codex%", "GPT-5 Codex", 1.25, 10, 0.125, 0],
  ["gpt-5-mini%", "GPT-5 mini", 0.25, 2, 0.025, 0],
  ["gpt-5-nano%", "GPT-5 nano", 0.05, 0.4, 0.005, 0],
  ["gpt-5%", "GPT-5", 1.25, 10, 0.125, 0],
  // OpenCode-hosted free models
  ["big-pickle%", "Big Pickle", 0, 0, 0, 0],
  ["opencode/big-pickle%", "OpenCode Big Pickle", 0, 0, 0, 0],
  // Legacy
  ["claude-3-opus%", "Claude Opus 3", 15, 75, 1.5, 18.75],
];

const force =
  process.argv.includes("--force") ||
  process.env.AGENT_MONITOR_FORCE_BUILD === "1";

function resolvePackageRoot(packageName) {
  try {
    return path.dirname(requireFromApp.resolve(`${packageName}/package.json`));
  } catch (error) {
    throw new Error(
      `Unable to resolve ${packageName}. Run \`pnpm install\` for apps/desktop before building the agent monitor.`,
      { cause: error },
    );
  }
}

function resolvePackageBin(packageName, binName) {
  const packageRoot = resolvePackageRoot(packageName);
  const packageJson = JSON.parse(
    readFileSync(path.join(packageRoot, "package.json"), "utf8"),
  );
  const relativeBin =
    typeof packageJson.bin === "string"
      ? packageJson.bin
      : packageJson.bin?.[binName];

  if (typeof relativeBin !== "string" || relativeBin.length === 0) {
    throw new Error(
      `Unable to resolve the ${binName} binary from ${packageName}. Run \`pnpm install\` for apps/desktop before building the agent monitor.`,
    );
  }

  const binPath = path.join(packageRoot, relativeBin);
  if (!existsSync(binPath)) {
    throw new Error(
      `Resolved ${packageName} binary does not exist: ${binPath}.`,
    );
  }

  return binPath;
}

function assertSourcePackages() {
  const rootPkg = JSON.parse(readFileSync(sourceRootPkg, "utf8"));
  const clientPkg = JSON.parse(readFileSync(sourceClientPkg, "utf8"));

  if (rootPkg.name !== SOURCE_ROOT_PACKAGE) {
    throw new Error(
      `Expected ${sourceRootPkg} to be ${SOURCE_ROOT_PACKAGE}, got ${rootPkg.name}.`,
    );
  }
  if (clientPkg.name !== SOURCE_CLIENT_PACKAGE) {
    throw new Error(
      `Expected ${sourceClientPkg} to be ${SOURCE_CLIENT_PACKAGE}, got ${clientPkg.name}.`,
    );
  }
  if (
    rootPkg.optionalDependencies?.["better-sqlite3"] == null ||
    rootPkg.dependencies?.["better-sqlite3"] != null
  ) {
    throw new Error(
      `${SOURCE_ROOT_PACKAGE} must keep better-sqlite3 optional so the generated runtime can stay on compat-sqlite.`,
    );
  }

  for (const required of [
    sourceServerEntry,
    sourceSessionsRoute,
    sourceHooksRoute,
    sourceDbFile,
    sourceCompatSqlite,
    sourcePushLib,
    path.join(sourceRootDir, "scripts", "install-hooks.js"),
    path.join(sourceRootDir, "scripts", "hook-handler.js"),
    path.join(sourceRootDir, "LICENSE"),
    sourceClientIndex,
    path.join(sourceClientDir, "vite.config.ts"),
    path.join(sourceClientDir, "public", "favicon.svg"),
  ]) {
    if (!existsSync(required)) {
      throw new Error(`Required agent-monitor source file missing: ${required}`);
    }
  }
}

function currentStamp() {
  const h = hash("sha256");
  for (const file of [
    path.join(repoRoot, "pnpm-lock.yaml"),
    path.join(appDir, "package.json"),
    sourceRootPkg,
    sourceClientPkg,
    sourceServerEntry,
    sourceSessionsRoute,
    sourceHooksRoute,
    sourceDbFile,
    sourcePushLib,
    sourceClientIndex,
    fileURLToPath(import.meta.url),
    ...MULTI_HARNESS_SPECS.flatMap(({ modulesDir, modules }) =>
      modules.map((m) => path.join(modulesDir, `${m}.js`)),
    ),
    ...SHARED_MODULES.map((m) => path.join(sharedModulesDir, `${m}.js`)),
    ...CLIENT_SNIPPET_FILES.map((file) => path.join(clientSnippetDir, file)),
    ...PLAN_MODULES.map((m) => path.join(planModulesDir, `${m}.js`)),
    path.join(planModulesDir, "plans-route.js"),
    path.join(planModulesDir, "client", "Plans.tsx"),
    path.join(planModulesDir, "client", "closedloop-host-flags.ts"),
    ...PACK_MODULES.map((m) => path.join(packModulesDir, `${m}.js`)),
    path.join(packModulesDir, "packs-route.js"),
    path.join(packModulesDir, "skills-route.js"),
    path.join(packModulesDir, "catalog-route.js"),
    path.join(packModulesDir, "catalog-seed.json"),
    ...PACK_CLIENT_PAGES.map((p) =>
      path.join(packModulesDir, "client", `${p}.tsx`),
    ),
    ...PACK_CATALOG_CLIENT_PAGES.map((p) =>
      path.join(packModulesDir, "client", `${p}.tsx`),
    ),
  ]) {
    h.update(readFileSync(file));
  }
  return h.digest("hex");
}

function renderDefaultPricingSource(rows = HOST_DEFAULT_PRICING) {
  return [
    "const DEFAULT_PRICING = [",
    ...rows.map(
      ([pattern, name, input, output, cacheRead, cacheWrite]) =>
        `  [${JSON.stringify(pattern)}, ${JSON.stringify(name)}, ${input}, ${output}, ${cacheRead}, ${cacheWrite}],`,
    ),
    "];",
  ].join("\n");
}

function buildClient() {
  patchClientSource();
  rmSync(sourceClientDistDir, { recursive: true, force: true });
  runNodeScript("vite build", viteBin, ["build"], sourceClientDir);
  if (!existsSync(path.join(sourceClientDistDir, "index.html"))) {
    throw new Error(
      `Client build completed but ${path.join(sourceClientDistDir, "index.html")} is missing.`,
    );
  }
}

function materializeRuntimeTree() {
  rmSync(generatedRootDir, { recursive: true, force: true });
  mkdirSync(generatedRootDir, { recursive: true });

  cpSync(path.join(sourceRootDir, "server"), path.join(generatedRootDir, "server"), {
    recursive: true,
  });
  // Multi-harness ingestion modules into the generated server/lib —
  // alongside upstream's lib files, same as the old vendored layout so the
  // modules' relative requires (../db, ../../scripts/import-history,
  // ./<tool>-home) resolve unchanged.
  const generatedLibDir = path.join(generatedRootDir, "server", "lib");
  mkdirSync(generatedLibDir, { recursive: true });
  for (const { modulesDir, modules } of MULTI_HARNESS_SPECS) {
    for (const m of modules) {
      cpSync(
        path.join(modulesDir, `${m}.js`),
        path.join(generatedLibDir, `${m}.js`),
      );
    }
  }
  // Shared parser utilities: place at server/agent-monitor-shared/ to match
  // the source-tree require path (../agent-monitor-shared/parser-utils) used
  // by all parsers. Both source tests and the generated runtime resolve the
  // same relative path.
  const generatedSharedDir = path.join(generatedRootDir, "server", "agent-monitor-shared");
  mkdirSync(generatedSharedDir, { recursive: true });
  for (const m of SHARED_MODULES) {
    cpSync(
      path.join(sharedModulesDir, `${m}.js`),
      path.join(generatedSharedDir, `${m}.js`),
    );
  }
  // CLOSEDLOOP plan-extraction (FEA-1189): plan modules alongside Codex's in
  // server/lib so relative requires (../lib, ../server/lib) resolve unchanged.
  for (const m of PLAN_MODULES) {
    cpSync(
      path.join(planModulesDir, `${m}.js`),
      path.join(generatedLibDir, `${m}.js`),
    );
  }
  // CLOSEDLOOP pack-observability (FEA-1224): pack-store + pack-scanner into
  // server/lib alongside plan modules. Routes are copied below alongside
  // plans-route.js.
  for (const m of PACK_MODULES) {
    cpSync(
      path.join(packModulesDir, `${m}.js`),
      path.join(generatedLibDir, `${m}.js`),
    );
  }
  cpSync(
    path.join(sourceRootDir, "scripts"),
    path.join(generatedRootDir, "scripts"),
    { recursive: true },
  );
  // The plans HTTP route lives in the generated server/routes (server/ was
  // copied above); import-history.js (just copied with scripts/) is patched to
  // persist captured plans on the shared import sink — both harnesses, history,
  // and the default hooks-OFF path.
  cpSync(
    path.join(planModulesDir, "plans-route.js"),
    path.join(generatedRootDir, "server", "routes", "plans.js"),
  );
  // CLOSEDLOOP pack-observability (FEA-1224): packs + skills routes alongside
  // the plans route. Both read from the existing events/agents/sessions tables
  // plus the new inventory tables created by ensurePackSchema.
  cpSync(
    path.join(packModulesDir, "packs-route.js"),
    path.join(generatedRootDir, "server", "routes", "packs.js"),
  );
  cpSync(
    path.join(packModulesDir, "skills-route.js"),
    path.join(generatedRootDir, "server", "routes", "skills.js"),
  );
  // CLOSEDLOOP pack catalog (FEA-1314): catalog route + the seed JSON the
  // store reads at startup. The seed lives alongside the store under
  // server/lib so a `require("./catalog-seed.json")` from catalog-store
  // resolves cleanly in the generated tree.
  cpSync(
    path.join(packModulesDir, "catalog-route.js"),
    path.join(generatedRootDir, "server", "routes", "catalog.js"),
  );
  cpSync(
    path.join(packModulesDir, "catalog-seed.json"),
    path.join(generatedLibDir, "catalog-seed.json"),
  );
  patchImportHistory(generatedImportHistory);
  mkdirSync(path.join(generatedRootDir, "client"), { recursive: true });
  cpSync(sourceClientDistDir, path.join(generatedRootDir, "client", "dist"), {
    recursive: true,
  });
  cpSync(sourceRootPkg, path.join(generatedRootDir, "package.json"));
  cpSync(path.join(sourceRootDir, "LICENSE"), path.join(generatedRootDir, "LICENSE"));

  patchServerIndex(generatedServerEntry);
  patchSessionsRoute(generatedSessionsRoute);
  patchDbFile(generatedDbFile);
  patchPricingRoute(generatedPricingRoute);
  patchHooksRoute(generatedHooksRoute);
  patchPushFile(generatedPushLib);
  writeFileSync(generatedUninstallHooks, UNINSTALL_HOOKS_SOURCE, "utf8");
}

function patchServerIndex(file) {
  let source = readFileSync(file, "utf8");

  if (!source.includes("function isAllowedDashboardOrigin(origin)")) {
    const corsHelperNeedle = 'const runRouter = require("./routes/run");\n\nfunction createApp() {';
    if (!source.includes(corsHelperNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the run-router require block for CORS tightening.`,
      );
    }
    source = source.replace(
      corsHelperNeedle,
      [
        'const runRouter = require("./routes/run");',
        "",
        "function isAllowedDashboardOrigin(origin) {",
        "  if (!origin) return true;",
        "  try {",
        "    const url = new URL(origin);",
        '    const expectedPort = String(process.env.DASHBOARD_PORT || "4820");',
        '    const isLoopback = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");',
        "    return isLoopback && url.port === expectedPort;",
        "  } catch {",
        "    return false;",
        "  }",
        "}",
        "",
        "function createApp() {",
      ].join("\n"),
    );
  }

  if (!source.includes("callback(null, isAllowedDashboardOrigin(origin));")) {
    const corsNeedle = "  app.use(cors());";
    if (!source.includes(corsNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected \`${corsNeedle}\` for tightened CORS.`,
      );
    }
    source = source.replace(
      corsNeedle,
      [
        "  app.use(",
        "    cors({",
        "      origin(origin, callback) {",
        "        callback(null, isAllowedDashboardOrigin(origin));",
        "      },",
        "    })",
        "  );",
      ].join("\n"),
    );
  }

  if (!source.includes('server.listen(port, "127.0.0.1", () => {')) {
    const listenNeedle = "server.listen(port, () => {";
    if (!source.includes(listenNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected \`${listenNeedle}\` for loopback binding.`,
      );
    }
    source = source.replace(
      listenNeedle,
      'server.listen(port, "127.0.0.1", () => {',
    );
  }

  if (!source.includes('process.env.CCAM_ENABLE_RUN === "1"')) {
    const runNeedle = '  app.use("/api/run", runRouter);';
    if (!source.includes(runNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected \`${runNeedle}\` for run-route gating.`,
      );
    }
    source = source.replace(
      runNeedle,
      [
        '  if (process.env.CCAM_ENABLE_RUN === "1") {',
        '    app.use("/api/run", runRouter);',
        "  }",
      ].join("\n"),
    );
  }

  if (!source.includes('process.env.CCAM_AUTO_INSTALL_HOOKS === "1"')) {
    const autoInstallNeedle = [
      "  try {",
      '    const { installHooks } = require("../scripts/install-hooks");',
      "    installHooks(true);",
      '    console.log("Claude Code hooks auto-configured.");',
      "  } catch {",
      "    // Non-fatal — user can run npm run install-hooks manually",
      "  }",
    ].join("\n");
    if (!source.includes(autoInstallNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected upstream hook auto-install block.`,
      );
    }
    source = source.replace(
      autoInstallNeedle,
      [
        "  if (process.env.CCAM_AUTO_INSTALL_HOOKS === \"1\") {",
        "    try {",
        '      const { installHooks } = require("../scripts/install-hooks");',
        "      installHooks(true);",
        '      console.log("Claude Code hooks auto-configured.");',
        "    } catch {",
        "      // Non-fatal — user can run npm run install-hooks manually",
        "    }",
        "  }",
      ].join("\n"),
    );
  }

  const watcherPatchLines = MULTI_HARNESS_SPECS.flatMap(
    ({ key, watcherFn, watcherModule }) => [
      "    try {",
      `      const { ${watcherFn} } = require("./lib/${watcherModule}");`,
      `      ${watcherFn}({ broadcast });`,
      "    } catch (err) {",
      `      console.warn("${key}-watcher failed to start:", err.message);`,
      "    }",
    ],
  );
  const importPatchLines = MULTI_HARNESS_SPECS.flatMap(
    ({ key, importFn, importModule, importedLog, errorLog }) => [
      "  try {",
      `    const { ${importFn} } = require("./lib/${importModule}");`,
      `    ${importFn}(_dbMod)`,
      "      .then(({ imported, errors }) => {",
      "        if (imported > 0)",
      `          console.log("Imported " + imported + " ${importedLog}");`,
      "        if (errors > 0)",
      `          console.log(errors + " ${errorLog}");`,
      "      })",
      "      .catch(() => {});",
      "  } catch (err) {",
      `    console.warn("${key} import failed to start:", err.message);`,
      "  }",
      "",
    ],
  );

  // CLOSEDLOOP multi-harness support — start watchers for all non-Claude harnesses
  // next to cc-watcher (these tools have no hooks; the watcher is their only live path).
  if (!source.includes("startCodexWatcher")) {
    const ccWatcherBlock = [
      '      const { startCcWatcher } = require("./lib/cc-watcher");',
      "      startCcWatcher({ broadcast });",
      "    } catch (err) {",
      '      console.warn("cc-watcher failed to start:", err.message);',
      "    }",
    ].join("\n");
    if (!source.includes(ccWatcherBlock)) {
      throw new Error(
        `Unable to patch ${file}: expected the cc-watcher start block (multi-harness).`,
      );
    }
    source = source.replace(
      ccWatcherBlock,
      [
        ccWatcherBlock,
        ...watcherPatchLines,
      ].join("\n"),
    );
  }

  // CLOSEDLOOP multi-harness support — import sessions from all non-Claude
  // harnesses on every startup (not gated on a zero-row count, unlike the
  // Claude import: these tools have no hooks so sessions created while the
  // app was closed must still appear; all imports are idempotent).
  // Fire-and-forget; never blocks boot.
  if (!source.includes("importAllCodexSessions")) {
    const tailNeedle = [
      "  }",
      "}",
      "",
      "module.exports = { createApp, startServer };",
    ].join("\n");
    if (!source.includes(tailNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the require.main tail (multi-harness import).`,
      );
    }
    source = source.replace(
      tailNeedle,
      [
        "  }",
        "",
        "  let _dbMod;",
        "  try { _dbMod = require(\"./db\"); } catch (err) {",
        '    console.warn("agent-monitor db load failed:", err.message);',
        "    return;",
        "  }",
        "",
        ...importPatchLines,
        "}",
        "",
        "module.exports = { createApp, startServer };",
      ].join("\n"),
    );
  }

  // CLOSEDLOOP plan-extraction (FEA-1189): backfill ~/.claude/plans/*.md on
  // EVERY startup. The upstream Claude legacy import is gated on a zero-row DB
  // (`if (existingCount === 0)`), so on a populated DB the plan extraction
  // wired into importSession never runs for pre-existing history. This
  // gate-independent file scan (idempotent, sha256-deduped) closes that gap.
  if (!source.includes("runClaudePlanBackfill")) {
    const dbNeedle =
      '  const dbModule = require("./db");\n  const existingCount = dbModule.db.prepare("SELECT COUNT(*) AS c FROM sessions").get().c;';
    if (!source.includes(dbNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the legacy-import dbModule/existingCount anchor (plan backfill, FEA-1189).`,
      );
    }
    source = source.replace(
      dbNeedle,
      [
        '  const dbModule = require("./db");',
        "  try {",
        '    require("./lib/plan-backfill").runClaudePlanBackfill(dbModule.db);',
        "  } catch (e) {",
        '    console.warn("[plans] backfill failed:", e && e.message);',
        "  }",
        '  const existingCount = dbModule.db.prepare("SELECT COUNT(*) AS c FROM sessions").get().c;',
      ].join("\n"),
    );
  }

  // CLOSEDLOOP plan-extraction (FEA-1189): register the /api/plans route
  // (read + confirm/reject triage over plans / plan_versions).
  if (!source.includes('require("./routes/plans")')) {
    const requireNeedle = 'const runRouter = require("./routes/run");';
    const openApiNeedle = '  app.get("/api/openapi.json", (_req, res) => {';
    if (!source.includes(requireNeedle) || !source.includes(openApiNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the run-route require/openapi anchors (plans route, FEA-1189).`,
      );
    }
    source = source.replace(
      requireNeedle,
      `${requireNeedle}\nconst plansRouter = require("./routes/plans");`,
    );
    source = source.replace(
      openApiNeedle,
      `  app.use("/api/plans", plansRouter);\n${openApiNeedle}`,
    );
  }

  // CLOSEDLOOP pack-observability (FEA-1224): register /api/packs + /api/skills
  // routes. Ungated, top-level — the four new dashboard pages always visible.
  if (!source.includes('require("./routes/packs")')) {
    const requireNeedle = 'const plansRouter = require("./routes/plans");';
    const openApiNeedle = '  app.get("/api/openapi.json", (_req, res) => {';
    if (!source.includes(requireNeedle) || !source.includes(openApiNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the plans-router require / openapi anchors (packs route, FEA-1224).`,
      );
    }
    source = source.replace(
      requireNeedle,
      [
        requireNeedle,
        'const packsRouter = require("./routes/packs");',
        'const skillsRouter = require("./routes/skills");',
      ].join("\n"),
    );
    source = source.replace(
      openApiNeedle,
      [
        '  app.use("/api/packs", packsRouter);',
        '  app.use("/api/skills", skillsRouter);',
        openApiNeedle,
      ].join("\n"),
    );
  }

  // CLOSEDLOOP pack catalog (FEA-1314): register /api/catalog route + seed
  // the catalog table + kick off the first GitHub fetch at startup. The
  // fetch is async and best-effort — boot doesn't wait on it.
  if (!source.includes('require("./routes/catalog")')) {
    const requireNeedle = 'const packsRouter = require("./routes/packs");';
    const mountNeedle = '  app.use("/api/packs", packsRouter);';
    if (!source.includes(requireNeedle) || !source.includes(mountNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the packs-router require / mount anchors (catalog route, FEA-1314).`,
      );
    }
    source = source.replace(
      requireNeedle,
      [requireNeedle, 'const catalogRouter = require("./routes/catalog");'].join("\n"),
    );
    source = source.replace(
      mountNeedle,
      [mountNeedle, '  app.use("/api/catalog", catalogRouter);'].join("\n"),
    );
  }

  // CLOSEDLOOP pack-observability (FEA-1224): run the filesystem pack scanner
  // at startup, immediately after the existing plan backfill. Best-effort —
  // a scanner failure must never block boot.
  if (!source.includes("runPackScanner")) {
    const backfillNeedle = [
      '    require("./lib/plan-backfill").runClaudePlanBackfill(dbModule.db);',
      "  } catch (e) {",
      '    console.warn("[plans] backfill failed:", e && e.message);',
      "  }",
    ].join("\n");
    if (!source.includes(backfillNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the plan-backfill block anchor (pack scanner, FEA-1224).`,
      );
    }
    source = source.replace(
      backfillNeedle,
      [
        backfillNeedle,
        "  try {",
        '    require("./lib/pack-scanner").runPackScanner(dbModule.db);',
        "  } catch (e) {",
        '    console.warn("[packs] scanner failed:", e && e.message);',
        "  }",
      ].join("\n"),
    );
  }

  // CLOSEDLOOP pack catalog (FEA-1314): seed + first fetch at startup,
  // immediately after the pack scanner. Best-effort — failures don't block
  // boot. Order matters: this patch anchors on the pack-scanner block above,
  // so it must run AFTER that patch has been applied to `source`.
  if (!source.includes("upsertCatalogSeed")) {
    const scannerNeedle = [
      '    require("./lib/pack-scanner").runPackScanner(dbModule.db);',
      "  } catch (e) {",
      '    console.warn("[packs] scanner failed:", e && e.message);',
      "  }",
    ].join("\n");
    if (!source.includes(scannerNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the pack-scanner block anchor (catalog startup, FEA-1314).`,
      );
    }
    source = source.replace(
      scannerNeedle,
      [
        scannerNeedle,
        "  try {",
        '    const catalogSeed = require("./lib/catalog-seed.json");',
        '    require("./lib/catalog-store").upsertCatalogSeed(dbModule.db, catalogSeed);',
        '    require("./lib/catalog-fetcher").runCatalogFetch(dbModule.db).catch(() => {});',
        '    require("./lib/catalog-fetcher").scheduleCatalogFetch(dbModule.db);',
        "  } catch (e) {",
        '    console.warn("[catalog] startup failed:", e && e.message);',
        "  }",
      ].join("\n"),
    );
  }

  writeFileSync(file, source, "utf8");
}

function patchSessionsRoute(file) {
  let source = readFileSync(file, "utf8");

  if (!source.includes('req.query.harness')) {
    const queryNeedle = "  const cwd = req.query.cwd;";
    if (!source.includes(queryNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the query parsing block for harness filtering.`,
      );
    }
    source = source.replace(
      queryNeedle,
      [
        "  const cwd = req.query.cwd;",
        '  const harness = typeof req.query.harness === "string" ? req.query.harness.trim().toLowerCase() : "";',
      ].join("\n"),
    );

    const whereNeedle = [
      "  if (cwd) {",
      '    where.push("s.cwd = ?");',
      "    params.push(cwd);",
      "  }",
    ].join("\n");
    if (!source.includes(whereNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the cwd filter block for harness filtering.`,
      );
    }
    source = source.replace(
      whereNeedle,
      [
        whereNeedle,
        "  if (harness) {",
        `    where.push("COALESCE(NULLIF(LOWER(s.harness), ''), 'claude') = ?");`,
        "    params.push(harness);",
        "  }",
      ].join("\n"),
    );
  }

  writeFileSync(file, source, "utf8");
}

function patchDbFile(file) {
  let source = readFileSync(file, "utf8");

  const requireNeedle = '  Database = require("better-sqlite3");';
  if (source.includes(requireNeedle)) {
    source = source.replace(
      requireNeedle,
      '  Database = require("./compat-sqlite");',
    );
  } else if (!source.includes('  Database = require("./compat-sqlite");')) {
    throw new Error(
      `Unable to patch ${file}: expected better-sqlite3 bootstrap block.`,
    );
  }

  const pricingBlock = /const DEFAULT_PRICING = \[[\s\S]*?\n\];\n\n\/\/ Top-up:/;
  if (!pricingBlock.test(source)) {
    throw new Error(
      `Unable to patch ${file}: expected the DEFAULT_PRICING block.`,
    );
  }
  source = source.replace(
    pricingBlock,
    `${renderDefaultPricingSource()}\n\n// Top-up:`,
  );

  // CLOSEDLOOP Codex support (Addition #4): add a `harness` dimension so one
  // dashboard shows multiple harnesses. Additive + DEFAULT 'claude' so the
  // unchanged Claude/manual insert path stays correct; the Codex importer
  // stamps 'codex' via setSessionHarness. Read paths need no change (routes
  // use SELECT s.* / SELECT *).
  if (!source.includes("ADD COLUMN harness")) {
    const stmtsNeedle = "\nconst stmts = {";
    if (!source.includes(stmtsNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the prepared-statements block (harness).`,
      );
    }
    const replacement = [
      "",
      "try {",
      '  db.prepare("SELECT harness FROM sessions LIMIT 1").get();',
      "} catch {",
      "  db.prepare(\"ALTER TABLE sessions ADD COLUMN harness TEXT NOT NULL DEFAULT 'claude'\").run();",
      "}",
      'db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_harness ON sessions(harness)");',
      "",
      "const stmts = {",
      "  setSessionHarness: db.prepare(\"UPDATE sessions SET harness = ? WHERE id = ? AND COALESCE(harness, '') != ?\"),",
    ].join("\n");
    source = source.replace(stmtsNeedle, `\n${replacement}`);
  }

  // CLOSEDLOOP plan-extraction (FEA-1189): ensure the strategy §9.2 plans /
  // plan_versions tables exist at startup, regardless of route load order.
  // Idempotent CREATE TABLE IF NOT EXISTS — never an ALTER migration.
  if (!source.includes("ensurePlanSchema")) {
    const exportNeedle =
      "module.exports = { db, stmts, DB_PATH, DEFAULT_PRICING };";
    if (!source.includes(exportNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the db module.exports tail (plan schema, FEA-1189).`,
      );
    }
    source = source.replace(
      exportNeedle,
      [
        "try {",
        '  require("./lib/plan-store").ensurePlanSchema(db);',
        "} catch (e) {",
        '  console.warn("[plans] schema init failed:", e && e.message);',
        "}",
        "",
        exportNeedle,
      ].join("\n"),
    );
  }

  // CLOSEDLOOP pack-observability (FEA-1224): ensure the three pack-inventory
  // tables (agent_packs, skills, project_pack_associations) exist at startup.
  // Idempotent CREATE TABLE IF NOT EXISTS — never an ALTER migration.
  if (!source.includes("ensurePackSchema")) {
    const exportNeedle =
      "module.exports = { db, stmts, DB_PATH, DEFAULT_PRICING };";
    if (!source.includes(exportNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the db module.exports tail (pack schema, FEA-1224).`,
      );
    }
    source = source.replace(
      exportNeedle,
      [
        "try {",
        '  require("./lib/pack-store").ensurePackSchema(db);',
        "} catch (e) {",
        '  console.warn("[packs] schema init failed:", e && e.message);',
        "}",
        "",
        exportNeedle,
      ].join("\n"),
    );
  }

  // CLOSEDLOOP pack catalog (FEA-1314): ensure the catalog tables exist at
  // startup alongside the pack inventory tables.
  if (!source.includes("ensureCatalogSchema")) {
    const exportNeedle =
      "module.exports = { db, stmts, DB_PATH, DEFAULT_PRICING };";
    if (!source.includes(exportNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the db module.exports tail (catalog schema, FEA-1314).`,
      );
    }
    source = source.replace(
      exportNeedle,
      [
        "try {",
        '  require("./lib/catalog-store").ensureCatalogSchema(db);',
        "} catch (e) {",
        '  console.warn("[catalog] schema init failed:", e && e.message);',
        "}",
        "",
        exportNeedle,
      ].join("\n"),
    );
  }

  writeFileSync(file, source, "utf8");
}

function patchPricingRoute(file) {
  let source = readFileSync(file, "utf8");

  if (!source.includes('String(row.model || "").toLowerCase()')) {
    const matchNeedle = [
      "  for (const row of tokenRows) {",
      "    const rule = sortedRules.find((p) => {",
      '      const pattern = p.model_pattern.replace(/%/g, ".*");',
      '      return new RegExp("^" + pattern + "$").test(row.model);',
      "    });",
    ].join("\n");
    if (!source.includes(matchNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the pricing rule match block.`,
      );
    }
    source = source.replace(
      matchNeedle,
      [
        "  for (const row of tokenRows) {",
        '    const modelId = String(row.model || "").toLowerCase();',
        "    const rule = sortedRules.find((p) => {",
        '      const pattern = String(p.model_pattern || "").toLowerCase().replace(/%/g, ".*");',
        '      return new RegExp("^" + pattern + "$").test(modelId);',
        "    });",
      ].join("\n"),
    );
  }

  writeFileSync(file, source, "utf8");
}

function patchHooksRoute(file) {
  let source = readFileSync(file, "utf8");

  if (!source.includes("extractPlanFromHookEvent")) {
    const requireNeedle =
      'const { scanAndImportSubagents } = require("../../scripts/import-history");';
    if (!source.includes(requireNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the hook-route import-history require anchor (plan hooks, FEA-1189).`,
      );
    }
    source = source.replace(
      requireNeedle,
      [
        requireNeedle,
        'const { extractPlanFromHookEvent } = require("../lib/plan-extractor");',
        'const { upsertPlanCapture } = require("../lib/plan-store");',
      ].join("\n"),
    );
  }

  if (!source.includes("[plans] hook capture failed")) {
    const responseNeedle = '\n\n  res.json({ ok: true, event: result });';
    if (!source.includes(responseNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the hook-route response anchor (plan hooks, FEA-1189).`,
      );
    }
    source = source.replace(
      responseNeedle,
      [
        "",
        "  try {",
        "    const capture = extractPlanFromHookEvent(hook_type, data);",
        "    if (capture) {",
        "      const planResult = upsertPlanCapture(db, capture);",
        "      if (planResult && !planResult.deduped) {",
        '        broadcast("plan_captured", {',
        "          plan_id: planResult.planId,",
        "          version: planResult.version,",
        "          session_id: capture.created_from_session_id,",
        "        });",
        "      }",
        "    }",
        "  } catch (e) {",
        '    console.warn("[plans] hook capture failed:", e && e.message);',
        "  }",
        responseNeedle,
      ].join("\n"),
    );
  }

  writeFileSync(file, source, "utf8");
}

// CLOSEDLOOP plan-extraction (FEA-1189): wire plan capture into the single
// shared import sink so Claude (session.toolUses) AND Codex (session.plans)
// plans are persisted on the import/watch path — the primary path, since hooks
// default OFF. Best-effort + idempotent (sha256 dedup in plan-store), so it
// never blocks an import and re-imports of growing JSONL don't churn.
function patchImportHistory(file) {
  let source = readFileSync(file, "utf8");
  if (source.includes("FEA-1189 plan extraction")) {
    writeFileSync(file, source, "utf8");
    return;
  }
  const needle =
    "function importSession(dbModule, session) {\n  const { db, stmts } = dbModule;";
  if (!source.includes(needle)) {
    throw new Error(
      `Unable to patch ${file}: expected the importSession head (FEA-1189 plan extraction).`,
    );
  }
  const inject = [
    needle,
    "  // FEA-1189 plan extraction — capture ExitPlanMode / plans-dir Write",
    "  // (Claude) and item.type==='Plan' / <proposed_plan> (Codex) into the",
    "  // local plans/plan_versions tables. Runs once per importSession call,",
    "  // covering both the existing-backfill and new-session branches.",
    "  try {",
    '    const { extractPlansFromSession } = require("../server/lib/plan-extractor");',
    '    const { upsertPlanCapture } = require("../server/lib/plan-store");',
    "    let __planBroadcast = null;",
    '    try { __planBroadcast = require("../server/websocket").broadcast; } catch (e) { void e; }',
    '    for (const __cap of extractPlansFromSession(session, "log")) {',
    "      try {",
    "        const __r = upsertPlanCapture(dbModule.db, __cap);",
    "        if (__planBroadcast && __r && !__r.deduped) {",
    '          __planBroadcast("plan_captured", {',
    "            plan_id: __r.planId,",
    "            version: __r.version,",
    "            session_id: __cap.created_from_session_id,",
    "          });",
    "        }",
    "      } catch (e) { void e; /* idempotent dedup — non-fatal */ }",
    "    }",
    "  } catch (e) { void e; /* plan extraction is best-effort; never blocks import */ }",
  ].join("\n");
  source = source.replace(needle, inject);
  writeFileSync(file, source, "utf8");
}

// CLOSEDLOOP Codex support (Addition #6): surface the harness in the client
// (Claude/Codex badge + filter). The client source comes from the pinned
// pnpm package, so we string-patch it in place BEFORE `vite build` — the same
// idempotent anchor approach as patchServerIndex/patchDbFile. Replacement
// bodies live as reviewable snippet files (no escaping) under
// scripts/agent-monitor-codex/client/.
function snippet(name) {
  return readFileSync(path.join(clientSnippetDir, name), "utf8");
}

function normalizePlanUiAppSource(file) {
  const finalImport =
    'import { isPlanExtractionEnabled } from "./lib/closedloop-host-flags";';
  const oldImport = 'import { isPlansUiEnabled } from "./lib/closedloop-host-flags";';
  const finalRoute =
    '          <Route path="plans" element={isPlanExtractionEnabled() ? <Plans /> : <NotFound />} />';
  const oldRoute =
    '          <Route path="plans" element={isPlansUiEnabled() ? <Plans /> : <NotFound />} />';
  const rawRoute = '          <Route path="plans" element={<Plans />} />';

  let src = readFileSync(file, "utf8");
  src = src.replace(`${finalImport}\n${oldImport}`, finalImport);
  src = src.replace(`${oldImport}\n${finalImport}`, finalImport);
  if (src.includes(finalRoute)) {
    src = src.replace(`\n${oldRoute}`, "");
    src = src.replace(`\n${rawRoute}`, "");
  }
  writeFileSync(file, src, "utf8");
}

function normalizePlanUiSidebarSource(file, legacyPlansNavLink, plansNavLink) {
  const finalImport =
    'import { api } from "../lib/api";\nimport { isPlanExtractionEnabled } from "../lib/closedloop-host-flags";';
  const oldImport =
    'import { api } from "../lib/api";\nimport { isPlansUiEnabled } from "../lib/closedloop-host-flags";';
  const oldPlansNavLink = plansNavLink.replaceAll(
    "isPlanExtractionEnabled",
    "isPlansUiEnabled",
  );

  let src = readFileSync(file, "utf8");
  src = src.replace(
    `${finalImport}\nimport { isPlansUiEnabled } from "../lib/closedloop-host-flags";`,
    finalImport,
  );
  src = src.replace(
    `${oldImport}\nimport { isPlanExtractionEnabled } from "../lib/closedloop-host-flags";`,
    finalImport,
  );
  if (src.includes(plansNavLink)) {
    src = src.replace(`\n${oldPlansNavLink}`, "");
    src = src.replace(`\n${legacyPlansNavLink}`, "");
  }
  writeFileSync(file, src, "utf8");
}

function patchClientSource() {
  // CLOSEDLOOP plan-extraction (FEA-1189): drop the dedicated Plans page into
  // the pinned client source before Vite build (the App.tsx route + Sidebar
  // nav entry below reference it). Overwrite is intentional — the client
  // source is regenerated from the pinned package each build.
  cpSync(
    path.join(planModulesDir, "client", "Plans.tsx"),
    path.join(sourceClientDir, "src", "pages", "Plans.tsx"),
  );
  cpSync(
    path.join(planModulesDir, "client", "closedloop-host-flags.ts"),
    path.join(sourceClientDir, "src", "lib", "closedloop-host-flags.ts"),
  );
  // CLOSEDLOOP pack-observability (FEA-1224): drop the four pack/skill/tool/
  // sub-agent pages into the pinned client before Vite build. Routes + NavLink
  // entries are added below via the declarative edits array.
  for (const p of PACK_CLIENT_PAGES) {
    cpSync(
      path.join(packModulesDir, "client", `${p}.tsx`),
      path.join(sourceClientDir, "src", "pages", `${p}.tsx`),
    );
  }
  // CLOSEDLOOP pack catalog (FEA-1314): tab shell + catalog cards + install
  // modal + sparkline alongside the FEA-1224 pages. Packs.tsx (copied above)
  // is the wrapper that renders <PacksLayout/>.
  for (const p of PACK_CATALOG_CLIENT_PAGES) {
    cpSync(
      path.join(packModulesDir, "client", `${p}.tsx`),
      path.join(sourceClientDir, "src", "pages", `${p}.tsx`),
    );
  }
  const legacyPlansNavLink = [
    "        })}",
    '        <NavLink',
    '          to="/plans"',
    '          title={collapsed ? "Plans" : undefined}',
    "          className={({ isActive }) =>",
    "            `flex items-center gap-3 rounded-lg text-sm font-medium transition-colors duration-150 ${",
    '              collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5"',
    "            } ${",
    "              isActive",
    '                ? "bg-accent/10 text-accent border border-accent/20"',
    '                : "text-gray-400 hover:text-gray-200 hover:bg-surface-3 border border-transparent"',
    "            }`",
    "          }",
    "        >",
    '          <FileText className="w-4 h-4 flex-shrink-0" />',
    "          {!collapsed && <span>Plans</span>}",
    "        </NavLink>",
    "      </nav>",
  ].join("\n");
  const plansNavLink = [
    "        })}",
    "        {isPlanExtractionEnabled() && (",
    '          <NavLink',
    '            to="/plans"',
    '            title={collapsed ? "Plans" : undefined}',
    "            className={({ isActive }) =>",
    "              `flex items-center gap-3 rounded-lg text-sm font-medium transition-colors duration-150 ${",
    '                collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5"',
    "              } ${",
    "                isActive",
    '                  ? "bg-accent/10 text-accent border border-accent/20"',
    '                  : "text-gray-400 hover:text-gray-200 hover:bg-surface-3 border border-transparent"',
    "              }`",
    "            }",
    "          >",
    '            <FileText className="w-4 h-4 flex-shrink-0" />',
    "            {!collapsed && <span>Plans</span>}",
    "          </NavLink>",
    "        )}",
    "      </nav>",
  ].join("\n");
  normalizePlanUiAppSource(path.join(sourceClientDir, "src", "App.tsx"));
  normalizePlanUiSidebarSource(
    path.join(sourceClientDir, "src", "components", "Sidebar.tsx"),
    legacyPlansNavLink,
    plansNavLink,
  );
  const edits = [
    {
      rel: "src/lib/types.ts",
      guard: "harness?: string | null",
      find: "  cost?: number;",
      replace: "  cost?: number;\n  harness?: string | null;",
    },
    {
      rel: "src/lib/api.ts",
      guard: "      harness?: string;",
      find: "      cwd?: string;\n      sort_by?: string;",
      replace: "      cwd?: string;\n      harness?: string;\n      sort_by?: string;",
    },
    {
      rel: "src/lib/api.ts",
      guard: 'if (params?.harness) qs.set("harness", params.harness);',
      find: '      if (params?.cwd) qs.set("cwd", params.cwd);',
      replace:
        '      if (params?.cwd) qs.set("cwd", params.cwd);\n      if (params?.harness) qs.set("harness", params.harness);',
    },
    {
      rel: "src/components/StatusBadge.tsx",
      guard: "export function HarnessBadge",
      append: "statusbadge.append.tsx",
    },
    {
      rel: "src/components/SessionCard.tsx",
      guard: 'SessionStatusBadge, HarnessBadge } from "./StatusBadge"',
      find: 'import { SessionStatusBadge } from "./StatusBadge";',
      replace: 'import { SessionStatusBadge, HarnessBadge } from "./StatusBadge";',
    },
    {
      rel: "src/components/SessionCard.tsx",
      guard: "<HarnessBadge harness={session.harness} />",
      find: "        <SessionStatusBadge status={status} />",
      replaceFile: "sessioncard.badge.replace.txt",
    },
    {
      rel: "src/pages/Sessions.tsx",
      guard: 'SessionStatusBadge, HarnessBadge } from "../components/StatusBadge"',
      find: 'import { SessionStatusBadge } from "../components/StatusBadge";',
      replace:
        'import { SessionStatusBadge, HarnessBadge } from "../components/StatusBadge";',
    },
    {
      rel: "src/pages/Sessions.tsx",
      guard: "const [harness, setHarness] = useState",
      find: "  const [dashboardRunIds, setDashboardRunIds] = useState<Set<string>>(new Set());",
      replaceFile: "sessions.state.replace.txt",
    },
    {
      rel: "src/pages/Sessions.tsx",
      guard: "server-side status + harness filters",
      findFiles: [
        "sessions.loadtop.find.txt",
        "sessions.loadtop.legacy.find.txt",
      ],
      replaceFile: "sessions.loadtop.replace.txt",
    },
    {
      rel: "src/pages/Sessions.tsx",
      guard: "rows = rows.filter(isSessionAwaitingInput);",
      findFiles: [
        "sessions.loadrows.find.txt",
        "sessions.loadrows.legacy.find.txt",
      ],
      replaceFile: "sessions.loadrows.replace.txt",
    },
    {
      rel: "src/pages/Sessions.tsx",
      guard: "        harness?: string;",
      find: "        cwd?: string;\n        sort_by?: string;",
      replace:
        "        cwd?: string;\n        harness?: string;\n        sort_by?: string;",
    },
    {
      rel: "src/pages/Sessions.tsx",
      guard: "      if (harness) params.harness = harness;",
      find: "      if (cwd) params.cwd = cwd;",
      replace: "      if (cwd) params.cwd = cwd;\n      if (harness) params.harness = harness;",
    },
    {
      rel: "src/pages/Sessions.tsx",
      guard: "[filter, harness, search, cwd, sortBy, sortDesc, page]",
      find: "  }, [filter, search, cwd, sortBy, sortDesc, page]);",
      replace: "  }, [filter, harness, search, cwd, sortBy, sortDesc, page]);",
    },
    {
      rel: "src/pages/Sessions.tsx",
      guard: "}, [filter, harness, search, cwd, sortBy, sortDesc]);",
      find: "  }, [filter, search, cwd, sortBy, sortDesc]);",
      replace: "  }, [filter, harness, search, cwd, sortBy, sortDesc]);",
    },
    {
      rel: "src/pages/Sessions.tsx",
      guard: "Harness Filter (Addition #6)",
      findFile: "sessions.filterui.find.txt",
      replaceFile: "sessions.filterui.replace.txt",
    },
    {
      rel: "src/pages/Sessions.tsx",
      guard: "<HarnessBadge harness={session.harness} />",
      findFile: "sessions.rowbadge.find.txt",
      replaceFile: "sessions.rowbadge.replace.txt",
    },
    // CLOSEDLOOP plan-extraction (FEA-1189): dedicated Plans tab — route +
    // sidebar nav entry. Plans.tsx itself is copied in above.
    {
      rel: "src/App.tsx",
      guard: 'import { Plans }',
      find: 'import { NotFound } from "./pages/NotFound";',
      replace:
        'import { NotFound } from "./pages/NotFound";\nimport { Plans } from "./pages/Plans";',
    },
    {
      rel: "src/App.tsx",
      guard: 'import { isPlanExtractionEnabled } from "./lib/closedloop-host-flags";',
      find: 'import { Plans } from "./pages/Plans";',
      replace:
        'import { Plans } from "./pages/Plans";\nimport { isPlanExtractionEnabled } from "./lib/closedloop-host-flags";',
    },
    {
      rel: "src/App.tsx",
      guard: 'path="plans" element={isPlanExtractionEnabled() ? <Plans /> : <NotFound />}',
      find: '          <Route path="run" element={<Run />} />',
      findAlternates: [
        '          <Route path="run" element={<Run />} />\n          <Route path="plans" element={<Plans />} />',
        '          <Route path="run" element={<Run />} />\n          <Route path="plans" element={isPlansUiEnabled() ? <Plans /> : <NotFound />} />',
      ],
      replace:
        '          <Route path="run" element={<Run />} />\n          <Route path="plans" element={isPlanExtractionEnabled() ? <Plans /> : <NotFound />} />',
    },
    {
      rel: "src/components/Sidebar.tsx",
      guard: "FileText,",
      find: '  Gauge,\n} from "lucide-react";',
      replace: '  Gauge,\n  FileText,\n} from "lucide-react";',
    },
    {
      rel: "src/components/Sidebar.tsx",
      guard: 'import { isPlanExtractionEnabled } from "../lib/closedloop-host-flags";',
      find: 'import { api } from "../lib/api";',
      replace:
        'import { api } from "../lib/api";\nimport { isPlanExtractionEnabled } from "../lib/closedloop-host-flags";',
    },
    {
      rel: "src/components/Sidebar.tsx",
      guard: "{isPlanExtractionEnabled() && (",
      find: "        })}\n      </nav>",
      findAlternates: [
        legacyPlansNavLink,
        plansNavLink.replaceAll("isPlanExtractionEnabled", "isPlansUiEnabled"),
      ],
      replace: plansNavLink,
    },
    // CLOSEDLOOP pack-observability (FEA-1224): four ungated top-level nav
    // entries (Skills, Tools, Sub-agents, Packs). Labels use the i18next key
    // fallback (t(key) returns key verbatim if no translation exists), so the
    // bare strings render correctly without touching the upstream locale
    // bundles.
    {
      rel: "src/App.tsx",
      guard: 'import { Skills } from "./pages/Skills";',
      find: 'import { Plans } from "./pages/Plans";',
      replace: [
        'import { Plans } from "./pages/Plans";',
        'import { Skills } from "./pages/Skills";',
        'import { Tools } from "./pages/Tools";',
        'import { SubAgents } from "./pages/SubAgents";',
        'import { Packs } from "./pages/Packs";',
      ].join("\n"),
    },
    {
      rel: "src/App.tsx",
      guard: '<Route path="skills" element={<Skills />} />',
      find: '          <Route path="plans" element={isPlanExtractionEnabled() ? <Plans /> : <NotFound />} />',
      replace: [
        '          <Route path="plans" element={isPlanExtractionEnabled() ? <Plans /> : <NotFound />} />',
        '          <Route path="skills" element={<Skills />} />',
        '          <Route path="tools" element={<Tools />} />',
        '          <Route path="agents" element={<SubAgents />} />',
        '          <Route path="packs" element={<Packs />} />',
      ].join("\n"),
    },
    {
      rel: "src/components/Sidebar.tsx",
      guard: "Sparkles,",
      find: '  FileText,\n} from "lucide-react";',
      replace: [
        "  FileText,",
        "  Sparkles,",
        "  Wrench,",
        "  Users,",
        "  Package,",
        '} from "lucide-react";',
      ].join("\n"),
    },
    {
      rel: "src/components/Sidebar.tsx",
      guard: 'to: "/skills", icon: Sparkles',
      find: '  { to: "/settings", icon: Settings, key: "nav:settings" },\n] as const;',
      replace: [
        '  { to: "/skills", icon: Sparkles, key: "Skills" },',
        '  { to: "/tools", icon: Wrench, key: "Tools" },',
        '  { to: "/agents", icon: Users, key: "Sub-agents" },',
        '  { to: "/packs", icon: Package, key: "Packs" },',
        '  { to: "/settings", icon: Settings, key: "nav:settings" },',
        "] as const;",
      ].join("\n"),
    },
  ];

  for (const e of edits) {
    const file = path.join(sourceClientDir, e.rel);
    let src = readFileSync(file, "utf8");
    if (src.includes(e.guard)) continue; // already patched (idempotent)

    if (e.append) {
      src = src + snippet(e.append);
    } else {
      const findCandidates = [];
      if (Array.isArray(e.findFiles)) {
        findCandidates.push(...e.findFiles.map((name) => snippet(name)));
      }
      if (e.findFile) findCandidates.push(snippet(e.findFile));
      if (e.find) findCandidates.push(e.find);
      if (Array.isArray(e.findAlternates)) {
        findCandidates.push(...e.findAlternates);
      }
      const find = findCandidates.find((candidate) => src.includes(candidate));
      const replace = e.replaceFile ? snippet(e.replaceFile) : e.replace;
      if (!find || !replace) {
        throw new Error(
          `Unable to patch client ${e.rel} (Codex Addition #6): anchor not ` +
            `found — upstream client layout may have changed. Re-derive per ` +
            `scripts/agent-monitor-codex/client/.`,
        );
      }
      src = src.replace(find, replace);
    }
    writeFileSync(file, src, "utf8");
  }
}

function assertGeneratedTree() {
  for (const required of [
    path.join(generatedRootDir, "package.json"),
    path.join(generatedRootDir, "LICENSE"),
    generatedServerEntry,
    generatedSessionsRoute,
    generatedDbFile,
    generatedPushLib,
    generatedHooksRoute,
    path.join(generatedRootDir, "server", "compat-sqlite.js"),
    generatedClientIndex,
    path.join(generatedRootDir, "scripts", "install-hooks.js"),
    path.join(generatedRootDir, "scripts", "hook-handler.js"),
    generatedUninstallHooks,
  ]) {
    if (!existsSync(required)) {
      throw new Error(`Generated agent-monitor file missing: ${required}`);
    }
  }

  const serverIndex = readFileSync(generatedServerEntry, "utf8");
  if (!serverIndex.includes('server.listen(port, "127.0.0.1", () => {')) {
    throw new Error("Generated server/index.js is missing the loopback-only bind.");
  }
  if (!serverIndex.includes('process.env.CCAM_AUTO_INSTALL_HOOKS === "1"')) {
    throw new Error(
      "Generated server/index.js is missing the CCAM_AUTO_INSTALL_HOOKS guard.",
    );
  }
  if (!serverIndex.includes('process.env.CCAM_ENABLE_RUN === "1"')) {
    throw new Error("Generated server/index.js is missing the run-route gate.");
  }
  if (!serverIndex.includes("isAllowedDashboardOrigin")) {
    throw new Error("Generated server/index.js is missing the tightened CORS guard.");
  }

  const dbSource = readFileSync(generatedDbFile, "utf8");
  if (dbSource.includes('require("better-sqlite3")')) {
    throw new Error(
      "Generated server/db.js must not load better-sqlite3 directly.",
    );
  }

  // CLOSEDLOOP Codex support hard-gates (Addition #4/#5/#6): a future upstream
  // bump that breaks an anchor must fail the build, not silently drop Codex.
  if (!dbSource.includes("ADD COLUMN harness")) {
    throw new Error(
      "Generated server/db.js is missing the `harness` column migration (Codex Patch #4).",
    );
  }
  for (const { label, watcherFn, importFn } of MULTI_HARNESS_SPECS) {
    for (const fn of [watcherFn, importFn]) {
      if (serverIndex.includes(fn)) continue;
      throw new Error(
        `Generated server/index.js is missing the ${label} watcher/import wiring (${fn}).`,
      );
    }
  }
  for (const { modules } of MULTI_HARNESS_SPECS) {
    for (const m of modules) {
      if (existsSync(path.join(generatedRootDir, "server", "lib", `${m}.js`))) continue;
      throw new Error(
        `Generated server/lib/${m}.js missing (multi-harness).`,
      );
    }
  }
  for (const m of SHARED_MODULES) {
    if (!existsSync(path.join(generatedRootDir, "server", "agent-monitor-shared", `${m}.js`))) {
      throw new Error(
        `Generated server/agent-monitor-shared/${m}.js missing (multi-harness).`,
      );
    }
  }

  const sessionsSource = readFileSync(generatedSessionsRoute, "utf8");
  if (!sessionsSource.includes("req.query.harness")) {
    throw new Error(
      "Generated server/routes/sessions.js is missing the server-side harness filter.",
    );
  }

  const pushSource = readFileSync(generatedPushLib, "utf8");
  if (!pushSource.includes("CCAM_VAPID_KEYS_PATH")) {
    throw new Error(
      "Generated server/lib/push.js is missing the writable VAPID keys path override.",
    );
  }

  const hooksRouteSource = readFileSync(generatedHooksRoute, "utf8");

  // CLOSEDLOOP plan-extraction hard-gates (FEA-1189): a future upstream bump
  // that breaks an anchor must fail the build, not silently drop plan capture.
  for (const m of PLAN_MODULES) {
    if (!existsSync(path.join(generatedRootDir, "server", "lib", `${m}.js`))) {
      throw new Error(
        `Generated server/lib/${m}.js missing (plan extraction, FEA-1189).`,
      );
    }
  }
  if (
    !existsSync(path.join(generatedRootDir, "server", "routes", "plans.js"))
  ) {
    throw new Error(
      "Generated server/routes/plans.js missing (plan extraction, FEA-1189).",
    );
  }
  if (!dbSource.includes("ensurePlanSchema")) {
    throw new Error(
      "Generated server/db.js is missing the plan-schema init (FEA-1189).",
    );
  }
  if (
    !serverIndex.includes('require("./routes/plans")') ||
    !serverIndex.includes('app.use("/api/plans", plansRouter)') ||
    !serverIndex.includes('app.get("/api/openapi.json"')
  ) {
    throw new Error(
      "Generated server/index.js is missing the ungated /api/plans route wiring (FEA-1189).",
    );
  }
  const importHistorySource = readFileSync(generatedImportHistory, "utf8");
  if (!importHistorySource.includes("FEA-1189 plan extraction")) {
    throw new Error(
      "Generated scripts/import-history.js is missing the plan-capture sink (FEA-1189).",
    );
  }
  if (!serverIndex.includes("runClaudePlanBackfill")) {
    throw new Error(
      "Generated server/index.js is missing the ~/.claude/plans backfill (FEA-1189).",
    );
  }
  if (
    !hooksRouteSource.includes("extractPlanFromHookEvent") ||
    !hooksRouteSource.includes('broadcast("plan_captured"')
  ) {
    throw new Error(
      "Generated server/routes/hooks.js is missing the live hook plan capture wiring (FEA-1189).",
    );
  }

  // CLOSEDLOOP pack-observability hard-gates (FEA-1224): a future upstream
  // bump that breaks any anchor must fail the build, not silently drop a page.
  for (const m of PACK_MODULES) {
    if (!existsSync(path.join(generatedRootDir, "server", "lib", `${m}.js`))) {
      throw new Error(
        `Generated server/lib/${m}.js missing (pack observability, FEA-1224).`,
      );
    }
  }
  for (const routeFile of ["packs.js", "skills.js"]) {
    if (
      !existsSync(path.join(generatedRootDir, "server", "routes", routeFile))
    ) {
      throw new Error(
        `Generated server/routes/${routeFile} missing (pack observability, FEA-1224).`,
      );
    }
  }
  if (!dbSource.includes("ensurePackSchema")) {
    throw new Error(
      "Generated server/db.js is missing the pack-schema init (FEA-1224).",
    );
  }
  if (
    !serverIndex.includes('require("./routes/packs")') ||
    !serverIndex.includes('require("./routes/skills")') ||
    !serverIndex.includes('app.use("/api/packs", packsRouter)') ||
    !serverIndex.includes('app.use("/api/skills", skillsRouter)')
  ) {
    throw new Error(
      "Generated server/index.js is missing the /api/packs or /api/skills route wiring (FEA-1224).",
    );
  }
  if (!serverIndex.includes("runPackScanner")) {
    throw new Error(
      "Generated server/index.js is missing the pack scanner startup call (FEA-1224).",
    );
  }
  // Client-side: the four new pages must be present in the patched upstream
  // client source so Vite's bundle resolves their imports. The pre-Vite copy
  // puts them at src/pages/<Name>.tsx; if any is missing the Vite step would
  // have already failed. We hard-gate the source files plus the App.tsx route
  // wiring as belt-and-suspenders.
  for (const pageName of PACK_CLIENT_PAGES) {
    if (
      !existsSync(path.join(sourceClientDir, "src", "pages", `${pageName}.tsx`))
    ) {
      throw new Error(
        `Patched client source is missing src/pages/${pageName}.tsx (FEA-1224).`,
      );
    }
  }
  const appSource = readFileSync(
    path.join(sourceClientDir, "src", "App.tsx"),
    "utf8",
  );
  for (const route of ["skills", "tools", "agents", "packs"]) {
    if (!appSource.includes(`<Route path="${route}"`)) {
      throw new Error(
        `Patched client src/App.tsx is missing the /${route} route (FEA-1224).`,
      );
    }
  }
  const sidebarSource = readFileSync(
    path.join(sourceClientDir, "src", "components", "Sidebar.tsx"),
    "utf8",
  );
  if (
    !sidebarSource.includes('to: "/skills", icon: Sparkles') ||
    !sidebarSource.includes('to: "/packs", icon: Package')
  ) {
    throw new Error(
      "Patched client src/components/Sidebar.tsx is missing the new NAV_KEYS entries (FEA-1224).",
    );
  }

  // CLOSEDLOOP pack catalog hard-gates (FEA-1314): every catalog module,
  // route, seed, and client file must be present in the generated tree.
  for (const m of ["catalog-store", "catalog-fetcher", "install-orchestrator"]) {
    if (!existsSync(path.join(generatedRootDir, "server", "lib", `${m}.js`))) {
      throw new Error(
        `Generated server/lib/${m}.js missing (catalog, FEA-1314).`,
      );
    }
  }
  if (
    !existsSync(path.join(generatedRootDir, "server", "routes", "catalog.js"))
  ) {
    throw new Error("Generated server/routes/catalog.js missing (FEA-1314).");
  }
  if (
    !existsSync(path.join(generatedRootDir, "server", "lib", "catalog-seed.json"))
  ) {
    throw new Error(
      "Generated server/lib/catalog-seed.json missing (FEA-1314).",
    );
  }
  if (!dbSource.includes("ensureCatalogSchema")) {
    throw new Error(
      "Generated server/db.js is missing the catalog-schema init (FEA-1314).",
    );
  }
  if (
    !serverIndex.includes('require("./routes/catalog")') ||
    !serverIndex.includes('app.use("/api/catalog", catalogRouter)')
  ) {
    throw new Error(
      "Generated server/index.js is missing the /api/catalog route wiring (FEA-1314).",
    );
  }
  if (
    !serverIndex.includes("upsertCatalogSeed") ||
    !serverIndex.includes("runCatalogFetch")
  ) {
    throw new Error(
      "Generated server/index.js is missing the catalog seed/fetch startup wiring (FEA-1314).",
    );
  }
  for (const pageName of PACK_CATALOG_CLIENT_PAGES) {
    if (
      !existsSync(path.join(sourceClientDir, "src", "pages", `${pageName}.tsx`))
    ) {
      throw new Error(
        `Patched client source is missing src/pages/${pageName}.tsx (FEA-1314).`,
      );
    }
  }
}

function patchPushFile(file) {
  let source = readFileSync(file, "utf8");

  if (!source.includes("process.env.CCAM_VAPID_KEYS_PATH")) {
    const keysNeedle =
      'const KEYS_PATH = path.join(__dirname, "../../data/vapid-keys.json");';
    if (!source.includes(keysNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the VAPID key path constant.`,
      );
    }
    source = source.replace(
      keysNeedle,
      'const KEYS_PATH = process.env.CCAM_VAPID_KEYS_PATH || path.join(__dirname, "../../data/vapid-keys.json");',
    );
  }

  writeFileSync(file, source, "utf8");
}

function runSqliteGate() {
  const electronBin = resolveElectronBinary();
  if (!electronBin) {
    console.warn(
      "[build:agent-monitor] WARNING: Electron binary not found under " +
        "apps/desktop/node_modules/electron/dist — skipping the node:sqlite " +
        "build gate. The generated runtime tree and desktop wiring tests still cover this path.",
    );
    return;
  }

  const probeDir = fsMkdtemp();
  const probe = `
    "use strict";
    const path = require("node:path");
    const Database = require(${JSON.stringify(path.join(generatedRootDir, "server", "compat-sqlite.js"))});
    const db = new Database(path.join(${JSON.stringify(probeDir)}, "probe.db"));
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)");
    db.prepare("INSERT INTO t (v) VALUES (?)").run("ok");
    db.exec("BEGIN");
    db.prepare("INSERT INTO t (v) VALUES (?)").run("rollme");
    db.exec("ROLLBACK");
    const n = db.prepare("SELECT COUNT(*) c FROM t").get().c;
    db.close();
    process.exit(n === 1 ? 0 : 7);
  `;

  console.log(
    "[build:agent-monitor] SQLite gate: running generated compat-sqlite.js under Electron-as-Node…",
  );
  const result = spawnSync(electronBin, ["-e", probe], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
  });
  rmSync(probeDir, { recursive: true, force: true });
  if (result.status !== 0) {
    throw new Error(
      "SQLite BUILD GATE FAILED: generated compat-sqlite.js (node:sqlite) did not work under ELECTRON_RUN_AS_NODE. Do NOT ship.",
    );
  }
  console.log("[build:agent-monitor] SQLite gate: PASS.");
}

function resolveElectronBinary() {
  let dist;
  try {
    dist = path.join(
      path.dirname(requireFromApp.resolve("electron/package.json")),
      "dist",
    );
  } catch {
    return null;
  }
  if (!existsSync(dist)) {
    return null;
  }
  for (const entry of readdirSync(dist)) {
    if (!entry.endsWith(".app")) {
      continue;
    }
    const macOs = path.join(dist, entry, "Contents", "MacOS");
    if (!existsSync(macOs)) {
      continue;
    }
    for (const exe of readdirSync(macOs)) {
      return path.join(macOs, exe);
    }
  }
  return null;
}

function runNodeScript(label, scriptPath, args, cwd) {
  const relativeCwd = path.relative(repoRoot, cwd) || ".";
  console.log(
    `[build:agent-monitor] (${relativeCwd}) node ${path.relative(repoRoot, scriptPath)} ${args.join(" ")}`.trim(),
  );
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`[build:agent-monitor] ${label} failed with exit code ${result.status ?? 1}.`);
  }
}

function fsMkdtemp() {
  return mkdtempSync(path.join(os.tmpdir(), "ccam-build-"));
}

const UNINSTALL_HOOKS_SOURCE = `#!/usr/bin/env node

const fs = require("fs");

const { getSettingsPath } = require("../server/lib/claude-home");
const SETTINGS_PATH = getSettingsPath();

function isOurEntry(entry) {
  if (entry.command && entry.command.includes("hook-handler.js")) return true;
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some(
      (hook) => hook.command && hook.command.includes("hook-handler.js"),
    );
  }
  return false;
}

function uninstallHooks(silent = false) {
  if (!fs.existsSync(SETTINGS_PATH)) {
    if (!silent) console.log(\`No settings file at \${SETTINGS_PATH} - nothing to remove.\`);
    return true;
  }

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  } catch (error) {
    if (!silent) console.error(\`Failed to parse \${SETTINGS_PATH}:\`, error.message);
    return false;
  }

  if (!settings || !settings.hooks) {
    if (!silent) console.log("No hooks configured - nothing to remove.");
    return true;
  }

  let removed = 0;
  for (const hookType of Object.keys(settings.hooks)) {
    const list = settings.hooks[hookType];
    if (!Array.isArray(list)) continue;
    const kept = list.filter((entry) => {
      const ours = isOurEntry(entry);
      if (ours) removed += 1;
      return !ours;
    });
    if (kept.length > 0) {
      settings.hooks[hookType] = kept;
    } else {
      delete settings.hooks[hookType];
    }
  }

  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\\n", "utf8");

  if (!silent) {
    console.log(\`Settings file: \${SETTINGS_PATH}\`);
    console.log(\`Removed \${removed} dashboard hook entr\${removed === 1 ? "y" : "ies"}.\`);
  }

  return true;
}

if (require.main === module) {
  uninstallHooks(false);
}

module.exports = { uninstallHooks };
`;

assertSourcePackages();

const stamp = currentStamp();
if (
  !force &&
  existsSync(generatedServerEntry) &&
  existsSync(generatedClientIndex) &&
  existsSync(generatedUninstallHooks) &&
  existsSync(stampFile) &&
  readFileSync(stampFile, "utf8").trim() === stamp
) {
  console.log(
    "[build:agent-monitor] up to date — skipping (use --force to rebuild).",
  );
  process.exit(0);
}

buildClient();
materializeRuntimeTree();
assertGeneratedTree();
runSqliteGate();

writeFileSync(stampFile, `${stamp}\n`);
console.log("[build:agent-monitor] done.");
