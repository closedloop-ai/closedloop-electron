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
const generatedCompatSqlite = path.join(generatedRootDir, "server", "compat-sqlite.js");
const generatedHooksRoute = path.join(
  generatedRootDir,
  "server",
  "routes",
  "hooks.js",
);
const generatedImportRoute = path.join(
  generatedRootDir,
  "server",
  "routes",
  "import.js",
);
const generatedPricingRoute = path.join(
  generatedRootDir,
  "server",
  "routes",
  "pricing.js",
);
const generatedPushLib = path.join(generatedRootDir, "server", "lib", "push.js");
const generatedWebSocketFile = path.join(
  generatedRootDir,
  "server",
  "websocket.js",
);
const generatedCcDiscovery = path.join(
  generatedRootDir,
  "server",
  "lib",
  "cc-discovery.js",
);
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

// FEA-1407: shared CJS body for the isSessionInSandbox helper injected into
// both hooks.js and import-history.js. Single source of truth — the two patch
// functions reference this constant instead of inlining separate copies.
const IS_SESSION_IN_SANDBOX_CJS = [
  "function isSessionInSandbox(cwd, sandboxBase) {",
  "  if (!sandboxBase) return false;",
  "  if (!cwd) return false;",
  '  const _path = require("path");',
  '  const _os = require("os");',
  "  function _expandHome(p) {",
  '    if (p === "~") return _os.homedir();',
  '    if (p.startsWith("~/")) return _path.join(_os.homedir(), p.slice(2));',
  "    return p;",
  "  }",
  "  const nc = _path.resolve(_expandHome(cwd));",
  "  const ns = _path.resolve(_expandHome(sandboxBase));",
  "  if (nc === ns) return true;",
  '  const prefix = ns.endsWith(_path.sep) ? ns : ns + _path.sep;',
  "  return nc.startsWith(prefix);",
  "}",
].join("\n");

// CLOSEDLOOP multi-harness support: proven ingestion modules live in-repo and
// are copied into the generated server/lib at materialize time (parallel to
// how uninstall-hooks.js is written). Their logic is architecture-independent
// — relative requires resolve identically in the generated tree as they did
// in the old vendored tree.
const codexModulesDir = path.join(appDir, "scripts", "agent-monitor-codex");
// FEA-1444: Codex hook handler wrapper ships in-repo (mirrors the upstream
// Claude hook-handler.js placement under generated `scripts/`). Copied at
// materialize time and surfaced by agent-monitor-hooks.ts via the same
// `scriptsDir` resolver as the Claude handler.
const codexHookHandlerSource = path.join(
  codexModulesDir,
  "codex-hook-handler.js",
);
const cursorModulesDir = path.join(appDir, "scripts", "agent-monitor-cursor");
const copilotModulesDir = path.join(appDir, "scripts", "agent-monitor-copilot");
const opencodeModulesDir = path.join(appDir, "scripts", "agent-monitor-opencode");
const sharedModulesDir = path.join(appDir, "scripts", "agent-monitor-shared");
const clientSnippetDir = path.join(codexModulesDir, "client");
const CODEX_MODULES = ["codex-home", "codex-parser", "codex-import", "codex-watcher"];
const CURSOR_MODULES = ["cursor-home", "cursor-parser", "cursor-import", "cursor-watcher"];
const COPILOT_MODULES = ["copilot-home", "copilot-parser", "copilot-import", "copilot-watcher"];
const OPENCODE_MODULES = ["opencode-home", "opencode-parser", "opencode-import", "opencode-watcher"];
const SHARED_MODULES = [
  "harness-watcher-utils",
  "import-session-utils",
  "parser-utils",
  "catchup-cache",
  // CLOSEDLOOP FEA-1334: cold-start ingest orchestration + persisted-cache
  // path resolution + the progress singleton GET /api/import/progress reads.
  "ingest-paths",
  "ingest-progress",
  "ingest-orchestrator",
];
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
  "catalog-action-handler",
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
  // v4: full-page detail view at /packs/:packId — replaces CatalogDetail
  // modal but uses the same components (InstallModal, etc.). CatalogDetail
  // is preserved as a no-op import for back-compat with users who still
  // reference it via stale build caches.
  "PackDetail",
  "CatalogDetail",
  "InstallModal",
  "Sparkline",
];

// CLOSEDLOOP engineer GitHub activity capture (FEA-1226): PR records captured
// from session logs (command-gated to `gh pr create` output) into the shared
// dashboard.db. Same materialization pattern as agent-monitor-plans —
// pr-parsers + pull-request-store + pr-extractor into server/lib;
// pull-requests-route.js into server/routes; PullRequests.tsx into the client.
const prModulesDir = path.join(appDir, "scripts", "agent-monitor-pull-requests");
const PR_MODULES = ["pr-parsers", "pull-request-store", "pr-extractor", "pr-backfill"];

// CLOSEDLOOP embed integration: the agent monitor ships as an <iframe> inside
// the desktop app. These ClosedLoop-authored files are copied over the
// upstream client source before the Vite build — Layout.tsx adds embed mode
// (drops the monitor's own sidebar) plus the host postMessage nav bridge;
// tailwind.config.js remaps the accent token to the ClosedLoop brand primary.
const embedModulesDir = path.join(appDir, "scripts", "agent-monitor-embed");
const embedAppSource = path.join(embedModulesDir, "App.tsx");
const embedLayoutSource = path.join(embedModulesDir, "Layout.tsx");
const embedTailwindSource = path.join(embedModulesDir, "tailwind.config.js");
const clientOverlayDir = path.join(appDir, "scripts", "agent-monitor-client");
const clientOverlayStatusBadgeSource = path.join(clientOverlayDir, "StatusBadge.tsx");
const clientOverlaySessionsSource = path.join(clientOverlayDir, "Sessions.tsx");
const clientOverlayDashboardSource = path.join(clientOverlayDir, "Dashboard.tsx");
const CLIENT_FULL_FILE_OVERRIDES = [
  {
    from: embedAppSource,
    to: path.join("src", "App.tsx"),
  },
  {
    from: embedLayoutSource,
    to: path.join("src", "components", "Layout.tsx"),
  },
  {
    from: embedTailwindSource,
    to: "tailwind.config.js",
  },
  {
    from: clientOverlayStatusBadgeSource,
    to: path.join("src", "components", "StatusBadge.tsx"),
  },
  {
    from: clientOverlaySessionsSource,
    to: path.join("src", "pages", "Sessions.tsx"),
  },
  {
    from: clientOverlayDashboardSource,
    to: path.join("src", "pages", "Dashboard.tsx"),
  },
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
  // GPT-5 family — cache_write rates are the prompt caching write rate
  // (typically equal to the input rate per 1M tokens for cached writes).
  ["gpt-5.5%", "GPT-5.5", 5, 30, 0.5, 5],
  ["gpt-5.4-mini%", "GPT-5.4 mini", 0.75, 4.5, 0.075, 0.75],
  ["gpt-5.4-nano%", "GPT-5.4 nano", 0.2, 1.25, 0.02, 0.2],
  ["gpt-5.4%", "GPT-5.4", 2.5, 15, 0.25, 2.5],
  ["gpt-5-codex%", "GPT-5 Codex", 1.25, 10, 0.125, 1.25],
  ["gpt-5-mini%", "GPT-5 mini", 0.25, 2, 0.025, 0.25],
  ["gpt-5-nano%", "GPT-5 nano", 0.05, 0.4, 0.005, 0.05],
  ["gpt-5%", "GPT-5", 1.25, 10, 0.125, 1.25],
  // OpenCode-hosted free models
  ["big-pickle%", "Big Pickle", 0, 0, 0, 0],
  ["opencode/big-pickle%", "OpenCode Big Pickle", 0, 0, 0, 0],
  // Fallback patterns for non-Claude harness parsers — when the model
  // field is missing from the raw data, each parser falls back to a
  // hardcoded default key (e.g. "gpt-codex", "cursor-default", etc.).
  // These entries ensure the fallback key has a reasonable pricing match,
  // even if the exact model is unknown. The broadest pattern comes last
  // so more specific rules match first.
  ["gpt-codex%", "GPT Codex (fallback)", 1.25, 10, 0.125, 1.25],
  ["cursor-default%", "Cursor default (fallback)", 3, 15, 0.3, 3],
  ["copilot-default%", "Copilot default (fallback)", 3, 15, 0.3, 3],
  ["opencode-default%", "OpenCode default (fallback)", 0, 0, 0, 0],
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
    sourceCompatSqlite,
    sourcePushLib,
    sourceClientIndex,
    fileURLToPath(import.meta.url),
    ...MULTI_HARNESS_SPECS.flatMap(({ modulesDir, modules }) =>
      modules.map((m) => path.join(modulesDir, `${m}.js`)),
    ),
    // FEA-1444: invalidate the cached generated tree when the Codex hook
    // wrapper source changes.
    codexHookHandlerSource,
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
    ...PR_MODULES.map((m) => path.join(prModulesDir, `${m}.js`)),
    path.join(prModulesDir, "pull-requests-route.js"),
    path.join(prModulesDir, "client", "PullRequests.tsx"),
    embedAppSource,
    embedLayoutSource,
    embedTailwindSource,
    clientOverlayStatusBadgeSource,
    clientOverlaySessionsSource,
    clientOverlayDashboardSource,
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
  // CLOSEDLOOP engineer GitHub activity capture (FEA-1226): pr-parsers +
  // pull-request-store + pr-extractor into server/lib alongside plan modules.
  for (const m of PR_MODULES) {
    cpSync(
      path.join(prModulesDir, `${m}.js`),
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
  // CLOSEDLOOP engineer GitHub activity capture (FEA-1226): the pull-requests
  // HTTP route alongside the plans/packs routes. Reads the `pull_requests`
  // table created by ensurePullRequestSchema.
  cpSync(
    path.join(prModulesDir, "pull-requests-route.js"),
    path.join(generatedRootDir, "server", "routes", "pull-requests.js"),
  );
  patchImportHistory(generatedImportHistory);
  patchImportHistoryForPullRequests(generatedImportHistory);
  // CLOSEDLOOP token reconciliation fix: replace the subagent-only guard
  // with an unconditional writeSessionTokens call so non-Claude harnesses
  // can update token_usage on re-import. Must run AFTER patchImportHistory
  // since both modify the same file.
  patchImportHistoryTokenReconcile(generatedImportHistory);
  patchImportHistoryMetaImported(generatedImportHistory);
  patchImportHistoryMetadataRefresh(generatedImportHistory);
  patchImportHistorySandboxFilter(generatedImportHistory);
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
  patchCompatSqliteBeginImmediate(generatedCompatSqlite);
  patchHooksTranscriptOutsideTx(generatedHooksRoute);
  patchHooksWriteQueueAndWatchdog(generatedHooksRoute);
  patchHooksSandboxFilter(generatedHooksRoute);
  // FEA-1444: stamp harness='codex' inside processEventCore when the inbound
  // hook payload was forwarded by the Codex wrapper handler. Order: must run
  // AFTER patchHooksTranscriptOutsideTx because it relies on the
  // `function processEventCore(hookType, data, ...)` signature that patch
  // installs.
  patchHooksRouteCodexHarness(generatedHooksRoute);
  patchImportRoute(generatedImportRoute);
  patchPushFile(generatedPushLib);
  patchWebSocketFile(generatedWebSocketFile);
  patchCcDiscovery(generatedCcDiscovery);
  writeFileSync(generatedUninstallHooks, UNINSTALL_HOOKS_SOURCE, "utf8");
  // FEA-1444: copy the Codex hook wrapper into the generated scripts/ tree
  // so the agent-monitor-hooks installer can resolve it via the same
  // `scriptsDir` it uses for the upstream Claude hook-handler.js.
  cpSync(
    codexHookHandlerSource,
    path.join(generatedRootDir, "scripts", "codex-hook-handler.js"),
  );
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

  if (!source.includes("__closedloopDestroyConnections")) {
    const serverNeedle = [
      "function startServer(app, port) {",
      "  const server = http.createServer(app);",
      "  initWebSocket(server);",
    ].join("\n");
    if (!source.includes(serverNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the startServer bootstrap for socket ownership tracking.`,
      );
    }
    source = source.replace(
      serverNeedle,
      [
        "function startServer(app, port) {",
        "  const server = http.createServer(app);",
        "  initWebSocket(server);",
        "  const sockets = new Set();",
        "  server.on(\"connection\", (socket) => {",
        "    sockets.add(socket);",
        "    socket.on(\"close\", () => {",
        "      sockets.delete(socket);",
        "    });",
        "  });",
        "  server.__closedloopDestroyConnections = () => {",
        "    for (const socket of sockets) {",
        "      try { socket.destroy(); } catch { /* ignore */ }",
        "    }",
        "    sockets.clear();",
        "  };",
      ].join("\n"),
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
  // CLOSEDLOOP FEA-1334: a single ingest orchestrator replaces the four
  // independent per-harness import chains. It runs every non-Claude importer
  // as one coordinated unit (still fire-and-forget, still never blocks boot)
  // and feeds the ingest-progress singleton that GET /api/import/progress
  // exposes to the desktop floating progress card. The harness importers are
  // dependency-injected so ingest-orchestrator.js stays a pure, identical
  // module in both the generated runtime tree and the source tree.
  const orchestratorHarnessLines = MULTI_HARNESS_SPECS.map(
    ({ key, importFn, importModule }) =>
      `        { key: ${JSON.stringify(key)}, importAll: require("./lib/${importModule}").${importFn} },`,
  );
  const importPatchLines = [
    "  try {",
    "    // CLOSEDLOOP FEA-1334: a fresh/empty DB no longer matches the",
    "    // persisted ingest caches — drop them so every harness re-parses in",
    "    // full and reports an honest total to the progress bar.",
    "    if (existingCount === 0) {",
    "      try {",
    '        require("./agent-monitor-shared/ingest-paths").clearIngestState();',
    "      } catch (e) { void e; }",
    "    }",
    '    const { ingestAllHarnesses } = require("./agent-monitor-shared/ingest-orchestrator");',
    "    const _ingestHarnesses = [",
    ...orchestratorHarnessLines,
    "    ];",
    "    // CLOSEDLOOP FEA-1334: on an empty DB the one-time Claude legacy",
    "    // import is the bulk of the cold-start work — run it through the",
    "    // orchestrator too so it shares the progress bar.",
    "    if (existingCount === 0) {",
    "      _ingestHarnesses.unshift({",
    '        key: "claude",',
    "        importAll: async (db, opts) => {",
    "          const _r = await importAllSessions(db, opts);",
    "          try { await backfillCompactions(db); } catch (e) { void e; }",
    "          return _r;",
    "        },",
    "      });",
    "    }",
    "    ingestAllHarnesses({ dbModule: _dbMod, harnesses: _ingestHarnesses }).catch(() => {});",
    "  } catch (err) {",
    '    console.warn("ingest orchestrator failed to start:", err.message);',
    "  }",
    "",
  ];

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

  // CLOSEDLOOP multi-harness support — stop all watchers during graceful
  // shutdown so their retry setIntervals and fs.watch handles are cleaned up.
  // Without this, leaked intervals accumulate and cause resource exhaustion.
  if (!source.includes("stopCodexWatcher")) {
    const shutdownNeedle = [
      "    shutdownInProgress = true;",
      '    console.log(`\\n${signal} received — shutting down gracefully… (hit Ctrl+C again to force)`);',
      "    if (httpServer) {",
    ].join("\n");
    if (!source.includes(shutdownNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the shutdown handler (watcher cleanup).`,
      );
    }
    source = source.replace(
      shutdownNeedle,
      [
        "    shutdownInProgress = true;",
        '    console.log(`\\n${signal} received — shutting down gracefully… (hit Ctrl+C again to force)`);',
        "    // Stop all file watchers and clear their retry intervals",
        '    try { require("./lib/cc-watcher").stopCcWatcher(); } catch { /* ignore */ }',
        '    try { require("./lib/codex-watcher").stopCodexWatcher(); } catch { /* ignore */ }',
        '    try { require("./lib/cursor-watcher").stopCursorWatcher(); } catch { /* ignore */ }',
        '    try { require("./lib/copilot-watcher").stopCopilotWatcher(); } catch { /* ignore */ }',
        '    try { require("./lib/opencode-watcher").stopOpenCodeWatcher(); } catch { /* ignore */ }',
        "    if (httpServer) {",
      ].join("\n"),
    );
  }

  if (!source.includes('require("./websocket").closeWebSocket();')) {
    const shutdownNeedle = [
      "    // Stop all file watchers and clear their retry intervals",
      '    try { require("./lib/cc-watcher").stopCcWatcher(); } catch { /* ignore */ }',
      '    try { require("./lib/codex-watcher").stopCodexWatcher(); } catch { /* ignore */ }',
      '    try { require("./lib/cursor-watcher").stopCursorWatcher(); } catch { /* ignore */ }',
      '    try { require("./lib/copilot-watcher").stopCopilotWatcher(); } catch { /* ignore */ }',
      '    try { require("./lib/opencode-watcher").stopOpenCodeWatcher(); } catch { /* ignore */ }',
      "    if (httpServer) {",
    ].join("\n");
    if (!source.includes(shutdownNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the shutdown cleanup block for sidecar ownership hardening.`,
      );
    }
    source = source.replace(
      shutdownNeedle,
      [
        "    // Stop all file watchers and clear their retry intervals",
        '    try { require("./lib/cc-watcher").stopCcWatcher(); } catch { /* ignore */ }',
        '    try { require("./lib/codex-watcher").stopCodexWatcher(); } catch { /* ignore */ }',
        '    try { require("./lib/cursor-watcher").stopCursorWatcher(); } catch { /* ignore */ }',
        '    try { require("./lib/copilot-watcher").stopCopilotWatcher(); } catch { /* ignore */ }',
        '    try { require("./lib/opencode-watcher").stopOpenCodeWatcher(); } catch { /* ignore */ }',
        "    try { updateScheduler && updateScheduler.stop(); } catch { /* ignore */ }",
        "    if (catalogFetchTimer) clearInterval(catalogFetchTimer);",
        '    try { require("./websocket").closeWebSocket(); } catch { /* ignore */ }',
        "    if (httpServer) {",
      ].join("\n"),
    );
  }

  if (!source.includes("httpServer.closeAllConnections")) {
    const closeNeedle = [
      "    if (httpServer) {",
      "      httpServer.close(() => {",
      '        console.log("HTTP server closed.");',
      "      });",
      "    }",
    ].join("\n");
    if (!source.includes(closeNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the HTTP shutdown block for forced connection teardown.`,
      );
    }
    source = source.replace(
      closeNeedle,
      [
        "    if (httpServer) {",
        "      httpServer.close(() => {",
        '        console.log("HTTP server closed.");',
        "      });",
        "      try {",
        "        if (typeof httpServer.closeAllConnections === \"function\") {",
        "          httpServer.closeAllConnections();",
        "        }",
        "      } catch { /* ignore */ }",
        "      try {",
        "        if (typeof httpServer.closeIdleConnections === \"function\") {",
        "          httpServer.closeIdleConnections();",
        "        }",
        "      } catch { /* ignore */ }",
        "      try {",
        "        if (typeof httpServer.__closedloopDestroyConnections === \"function\") {",
        "          httpServer.__closedloopDestroyConnections();",
        "        }",
        "      } catch { /* ignore */ }",
        "    }",
      ].join("\n"),
    );
  }

  // CLOSEDLOOP FEA-1334 — import sessions from all non-Claude harnesses on
  // every startup via the unified ingest orchestrator (not gated on a
  // zero-row count, unlike the Claude import: these tools have no hooks so
  // sessions created while the app was closed must still appear; all imports
  // are idempotent). Fire-and-forget; never blocks boot.
  if (!source.includes("ingestAllHarnesses")) {
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

  if (!source.includes("let updateScheduler = null;")) {
    const serverNeedle = [
      "  const PORT = parseInt(process.env.DASHBOARD_PORT || \"4820\", 10);",
      "  const app = createApp();",
      "  let httpServer = null;",
    ].join("\n");
    if (!source.includes(serverNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the main bootstrap for scheduler handle ownership.`,
      );
    }
    source = source.replace(
      serverNeedle,
      [
        "  const PORT = parseInt(process.env.DASHBOARD_PORT || \"4820\", 10);",
        "  const app = createApp();",
        "  let httpServer = null;",
        "  let updateScheduler = null;",
        "  let catalogFetchTimer = null;",
      ].join("\n"),
    );
  }

  if (!source.includes("updateScheduler = startUpdateScheduler({ broadcast });")) {
    const updateNeedle = [
      '    const { startUpdateScheduler } = require("./update-scheduler");',
      '    const { broadcast } = require("./websocket");',
      "    startUpdateScheduler({ broadcast });",
    ].join("\n");
    if (!source.includes(updateNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the update scheduler startup block for handle ownership.`,
      );
    }
    source = source.replace(
      updateNeedle,
      [
        '    const { startUpdateScheduler } = require("./update-scheduler");',
        '    const { broadcast } = require("./websocket");',
        "    updateScheduler = startUpdateScheduler({ broadcast });",
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
        // CLOSEDLOOP engineer GitHub activity capture (FEA-1226): mirror the
        // plan backfill for pull-request URLs. Same `existingCount === 0` gap
        // — historical sessions that ran before this feature shipped never
        // get re-imported, so their captured PRs never reach the DB. This
        // standalone file scan (idempotent, deterministic-id-deduped, mtime-
        // skipped on repeat boots) closes that gap. Forward-looking capture
        // still goes through the importSession PR-extract block on the hook
        // → POST path.
        //
        // Deferred via setImmediate so the first-run scan runs after the
        // current synchronous startup tick completes — boot is not blocked
        // by it. Note: this is NOT tied to a sidecar "ready" signal; it
        // simply defers to the next event-loop tick, which is enough to
        // keep the boot critical path clean even at thousands of files.
        // The mtime cache in pr_backfill_seen makes subsequent boots
        // ~stat-time at any scale (see PR #238 review feedback).
        "  setImmediate(() => {",
        "    try {",
        '      require("./lib/pr-backfill").runClaudePrBackfill(dbModule.db);',
        "    } catch (e) {",
        '      console.warn("[pull-requests] backfill failed:", e && e.message);',
        "    }",
        "  });",
        '  const existingCount = dbModule.db.prepare("SELECT COUNT(*) AS c FROM sessions").get().c;',
      ].join("\n"),
    );
  }

  // CLOSEDLOOP FEA-1334: the one-time Claude legacy import now runs through the
  // ingest orchestrator (see the claude harness in the multi-harness block) so
  // it shares the desktop progress bar. Remove the standalone fire-and-forget
  // block so the same sessions are not imported twice.
  if (source.includes("importAllSessions(dbModule)\n      .then(")) {
    const legacyClaudeBlock = [
      "  if (existingCount === 0) {",
      "    importAllSessions(dbModule)",
      "      .then(({ imported, skipped, errors }) => {",
      "        if (imported > 0) console.log(`Imported ${imported} legacy sessions from ~/.claude/`);",
      "        if (errors > 0) console.log(`${errors} session files had errors during import`);",
      "      })",
      "      .then(() => backfillCompactions(dbModule))",
      "      .then(({ backfilled }) => {",
      "        if (backfilled > 0)",
      "          console.log(`Backfilled ${backfilled} compaction events from ~/.claude/`);",
      "      })",
      "      .catch(() => {});",
      "  }",
    ].join("\n");
    if (!source.includes(legacyClaudeBlock)) {
      throw new Error(
        `Unable to patch ${file}: expected the standalone Claude legacy-import block (FEA-1334).`,
      );
    }
    source = source.replace(
      legacyClaudeBlock,
      [
        "  // CLOSEDLOOP FEA-1334: the one-time Claude legacy import runs through",
        "  // the ingest orchestrator below (the claude harness) so it shares the",
        "  // desktop progress bar; the standalone import block was removed.",
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

  // CLOSEDLOOP engineer GitHub activity capture (FEA-1226): register the
  // /api/pull-requests route (read surface for the Pull Requests page + tile).
  if (!source.includes('require("./routes/pull-requests")')) {
    const requireNeedle = 'const skillsRouter = require("./routes/skills");';
    const openApiNeedle = '  app.get("/api/openapi.json", (_req, res) => {';
    if (!source.includes(requireNeedle) || !source.includes(openApiNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the skills-router require / openapi anchors (pull-requests route, FEA-1226).`,
      );
    }
    source = source.replace(
      requireNeedle,
      `${requireNeedle}\nconst pullRequestsRouter = require("./routes/pull-requests");`,
    );
    source = source.replace(
      openApiNeedle,
      `  app.use("/api/pull-requests", pullRequestsRouter);\n${openApiNeedle}`,
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

  if (!source.includes("catalogFetchTimer = require(\"./lib/catalog-fetcher\").scheduleCatalogFetch(dbModule.db);")) {
    const catalogNeedle = '    require("./lib/catalog-fetcher").scheduleCatalogFetch(dbModule.db);';
    if (!source.includes(catalogNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the catalog schedule startup block for timer ownership.`,
      );
    }
    source = source.replace(
      catalogNeedle,
      '    catalogFetchTimer = require("./lib/catalog-fetcher").scheduleCatalogFetch(dbModule.db);',
    );
  }

  writeFileSync(file, source, "utf8");
}

function patchWebSocketFile(file) {
  let source = readFileSync(file, "utf8");

  if (!source.includes("function closeWebSocket()")) {
    const closeNeedle = [
      "function getConnectionCount() {",
      "  if (!wss) return 0;",
      "  let count = 0;",
      "  wss.clients.forEach((client) => {",
      "    if (client.readyState === 1) count++;",
      "  });",
      "  return count;",
      "}",
      "",
      "module.exports = { initWebSocket, broadcast, getConnectionCount };",
    ].join("\n");
    if (!source.includes(closeNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the websocket export block for closeWebSocket.`,
      );
    }
    source = source.replace(
      closeNeedle,
      [
        "function getConnectionCount() {",
        "  if (!wss) return 0;",
        "  let count = 0;",
        "  wss.clients.forEach((client) => {",
        "    if (client.readyState === 1) count++;",
        "  });",
        "  return count;",
        "}",
        "",
        "function closeWebSocket() {",
        "  if (!wss) return;",
        "  const server = wss;",
        "  wss = null;",
        "  server.clients.forEach((client) => {",
        "    try { client.terminate(); } catch { /* ignore */ }",
        "  });",
        "  try { server.close(); } catch { /* ignore */ }",
        "}",
        "",
        "module.exports = { initWebSocket, broadcast, getConnectionCount, closeWebSocket };",
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

  const sessionTotalsNeedle = [
    "  sessionTokenTotals: db.prepare(`",
    "    SELECT",
    "      COALESCE(SUM(input_tokens), 0) as input_tokens,",
    "      COALESCE(SUM(output_tokens), 0) as output_tokens,",
    "      COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,",
    "      COALESCE(SUM(cache_write_tokens), 0) as cache_write_tokens",
    "    FROM token_usage",
    "    WHERE session_id = ?",
    "  `),",
  ].join("\n");
  const sessionTotalsReplacement = [
    "  sessionTokenTotals: db.prepare(`",
    "    SELECT",
    "      COALESCE(SUM(input_tokens + baseline_input), 0) as input_tokens,",
    "      COALESCE(SUM(output_tokens + baseline_output), 0) as output_tokens,",
    "      COALESCE(SUM(cache_read_tokens + baseline_cache_read), 0) as cache_read_tokens,",
    "      COALESCE(SUM(cache_write_tokens + baseline_cache_write), 0) as cache_write_tokens",
    "    FROM token_usage",
    "    WHERE session_id = ?",
    "  `),",
  ].join("\n");
  if (source.includes(sessionTotalsNeedle)) {
    source = source.replace(sessionTotalsNeedle, sessionTotalsReplacement);
  } else if (!source.includes("COALESCE(SUM(input_tokens + baseline_input), 0) as input_tokens")) {
    throw new Error(
      `Unable to patch ${file}: expected the sessionTokenTotals query (baseline session totals).`,
    );
  }

  // CLOSEDLOOP FEA-1390: align the startup stale-session cleanup with the
  // runtime sweep at server/index.js:291. Upstream hardcodes a 1-hour
  // threshold and marks sessions 'completed' on boot, which reaps long
  // Bash tools and awaiting-input pauses falsely. We make the threshold
  // configurable via DASHBOARD_STALE_MINUTES (default 180, matching the
  // runtime sweep), anchor on updated_at instead of started_at, and use
  // 'abandoned' so we don't claim a session finished cleanly when we only
  // lost contact with it.
  const startupStaleNeedle = [
    "// Startup cleanup: mark stale active sessions as completed.",
    "// Legacy sessions (created before SessionEnd hook) will never receive a SessionEnd event,",
    "// so they stay \"active\" forever. Complete any active session whose last event is older than",
    "// 1 hour — the CLI process is certainly gone by then.",
    "db.prepare(",
    "  `",
    "  UPDATE sessions SET",
    "    status = 'completed',",
    "    ended_at = COALESCE(ended_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
    "  WHERE status = 'active'",
    "    AND started_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')",
    "    AND NOT EXISTS (",
    "      SELECT 1 FROM events e",
    "      WHERE e.session_id = sessions.id",
    "        AND e.created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')",
    "    )",
    "`",
    ").run();",
  ].join("\n");
  const startupStaleReplacement = [
    "// CLOSEDLOOP FEA-1390: Startup cleanup aligned with the runtime sweep",
    "// (server/index.js DASHBOARD_STALE_MINUTES, default 180). Uses 'abandoned'",
    "// — not 'completed' — and anchors on updated_at so an active session that",
    "// was paused on a long Bash tool / awaiting-input prompt is NOT silently",
    "// flipped to a finished state on the next dashboard boot.",
    "const _ccStaleMinutes = (() => {",
    "  const raw = parseInt(process.env.DASHBOARD_STALE_MINUTES, 10);",
    "  return Number.isFinite(raw) && raw > 0 ? raw : 180;",
    "})();",
    "db.prepare(",
    "  `",
    "  UPDATE sessions SET",
    "    status = 'abandoned',",
    "    ended_at = COALESCE(ended_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
    "  WHERE status = 'active'",
    "    AND updated_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || ? || ' minutes')",
    "    AND NOT EXISTS (",
    "      SELECT 1 FROM events e",
    "      WHERE e.session_id = sessions.id",
    "        AND e.created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || ? || ' minutes')",
    "    )",
    "`",
    ").run(_ccStaleMinutes, _ccStaleMinutes);",
  ].join("\n");
  if (source.includes(startupStaleNeedle)) {
    source = source.replace(startupStaleNeedle, startupStaleReplacement);
  } else if (!source.includes("CLOSEDLOOP FEA-1390")) {
    throw new Error(
      `Unable to patch ${file}: expected the startup stale-session cleanup block (FEA-1390). Upstream may have changed the SQL.`,
    );
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

  // CLOSEDLOOP engineer GitHub activity capture (FEA-1226): ensure the
  // `pull_requests` table exists at startup, regardless of route load order.
  // Idempotent CREATE TABLE IF NOT EXISTS — never an ALTER migration.
  if (!source.includes("ensurePullRequestSchema")) {
    const exportNeedle =
      "module.exports = { db, stmts, DB_PATH, DEFAULT_PRICING };";
    if (!source.includes(exportNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the db module.exports tail (pull-request schema, FEA-1226).`,
      );
    }
    source = source.replace(
      exportNeedle,
      [
        "try {",
        '  require("./lib/pull-request-store").ensurePullRequestSchema(db);',
        "} catch (e) {",
        '  console.warn("[pull-requests] schema init failed:", e && e.message);',
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

// CLOSEDLOOP FEA-1444: stamp `harness='codex'` on the session row when the
// inbound hook payload was forwarded by the in-repo `codex-hook-handler.js`
// wrapper (which injects `__provider: "codex"`). The upstream hooks route is
// provider-agnostic and already supports a `harness` column + setSessionHarness
// statement (Codex Patch #4); this patch is the single place that wires the
// hook stream to that stamp so the dashboard renders Codex-sourced hook events
// alongside the existing rollout-tail-imported rows.
function patchHooksRouteCodexHarness(file) {
  let source = readFileSync(file, "utf8");
  if (source.includes("FEA-1444 codex harness stamp")) return;

  // Anchors on the processEventCore signature installed by
  // patchHooksTranscriptOutsideTx (FEA-1363) + the immediate ensureSession
  // call. Both must already be present; this patch runs after that one in
  // the materialize sequence.
  const needle = [
    "function processEventCore(hookType, data, transcriptData) {",
    "  const sessionId = data.session_id;",
    "  if (!sessionId) return null;",
    "",
    "  const session = ensureSession(sessionId, data);",
  ].join("\n");
  if (!source.includes(needle)) {
    throw new Error(
      `Unable to patch ${file}: expected processEventCore + ensureSession anchor (FEA-1444).`,
    );
  }
  source = source.replace(
    needle,
    [
      needle,
      "  // FEA-1444 codex harness stamp: the in-repo codex-hook-handler.js",
      "  // wrapper injects `__provider: \"codex\"` into the forwarded hook",
      "  // payload. When present, mark the session row as a Codex session so",
      "  // the dashboard groups it with the rollout-tail-imported rows and",
      "  // any harness-scoped UI affordances apply.",
      "  if (session && data && data.__provider === \"codex\") {",
      "    try {",
      "      stmts.setSessionHarness.run(\"codex\", sessionId, \"codex\");",
      "    } catch (_) {",
      "      /* non-fatal: harness column/stmt guaranteed by Codex Patch #4 */",
      "    }",
      "  }",
    ].join("\n"),
  );
  writeFileSync(file, source, "utf8");
}

// CLOSEDLOOP FEA-1363: Fix SQLite write contention under 22+ concurrent agents.
// Three patches below address five compounding SQLite problems that cause the
// agent monitor dashboard to corrupt when many agents fire hooks simultaneously.

// Patch 1/3: Use BEGIN IMMEDIATE instead of DEFERRED in the compat-sqlite
// transaction wrapper. DEFERRED lets two transactions both succeed at BEGIN,
// then deadlock upgrading to a write lock. IMMEDIATE acquires upfront so
// busy_timeout can serialize properly.
function patchCompatSqliteBeginImmediate(file) {
  let source = readFileSync(file, "utf8");
  if (source.includes('"BEGIN IMMEDIATE"')) return;
  const needle = 'db.exec("BEGIN");';
  if (!source.includes(needle)) {
    throw new Error(
      `Unable to patch ${file}: expected db.exec("BEGIN") anchor (FEA-1363).`,
    );
  }
  source = source.replace(needle, 'db.exec("BEGIN IMMEDIATE");');
  writeFileSync(file, source, "utf8");
}

// Patch 2/3: Move transcript disk I/O outside the SQLite write transaction.
// transcriptCache.extract() does synchronous file reads (50-200ms) while holding
// the write lock, blocking all other hook events. This patch:
//   a) Extracts processEventCore as an unwrapped function accepting pre-computed
//      transcriptData
//   b) Re-creates processEvent as db.transaction(processEventCore) for compat
//   c) Moves transcript extraction to the POST handler call site, before the tx
function patchHooksTranscriptOutsideTx(file) {
  let source = readFileSync(file, "utf8");
  if (source.includes("processEventCore")) return;

  // (a) Unwrap processEvent into processEventCore
  const sigNeedle = "const processEvent = db.transaction((hookType, data) => {";
  if (!source.includes(sigNeedle)) {
    throw new Error(
      `Unable to patch ${file}: expected processEvent signature anchor (FEA-1363).`,
    );
  }
  source = source.replace(
    sigNeedle,
    "function processEventCore(hookType, data, transcriptData) {",
  );

  // (b) Use pre-computed transcriptData instead of extracting inside the tx
  const extractNeedle = [
    "  if (data.transcript_path) {",
    "    const result = transcriptCache.extract(data.transcript_path);",
  ].join("\n");
  if (!source.includes(extractNeedle)) {
    throw new Error(
      `Unable to patch ${file}: expected transcriptCache.extract anchor inside processEvent (FEA-1363).`,
    );
  }
  source = source.replace(extractNeedle, [
    "  if (transcriptData) {",
    "    const result = transcriptData;",
  ].join("\n"));

  // (c) Close the unwrapped function + re-create transaction-wrapped version
  const closeNeedle = [
    '  broadcast("new_event", event);',
    "  return event;",
    "});",
  ].join("\n");
  if (!source.includes(closeNeedle)) {
    throw new Error(
      `Unable to patch ${file}: expected processEvent closing anchor (FEA-1363).`,
    );
  }
  source = source.replace(closeNeedle, [
    '  broadcast("new_event", event);',
    "  return event;",
    "}",
    "const processEvent = db.transaction(processEventCore);",
  ].join("\n"));

  // (d) Pre-compute transcript data at the POST handler call site
  const callNeedle = "  const result = processEvent(hook_type, data);";
  if (!source.includes(callNeedle)) {
    throw new Error(
      `Unable to patch ${file}: expected processEvent call site anchor (FEA-1363).`,
    );
  }
  source = source.replace(callNeedle, [
    "  let transcriptData = null;",
    "  if (data.transcript_path) {",
    "    transcriptData = transcriptCache.extract(data.transcript_path);",
    "  }",
    "  const result = processEvent(hook_type, data, transcriptData);",
  ].join("\n"));

  writeFileSync(file, source, "utf8");
}

// Patch 3/3: Add write queue for batching + wrap watchdog in a transaction.
//   a) Adds a setImmediate-based write queue that coalesces hook events arriving
//      in the same event-loop tick into a single batched transaction, reducing
//      lock contention ~20x under 22+ concurrent agents
//   b) Wraps the watchdog's read-check-write cycle in a single transaction so
//      a hook event committed between read and write can't cause stale decisions
function patchHooksWriteQueueAndWatchdog(file) {
  let source = readFileSync(file, "utf8");
  if (source.includes("hookWriteQueue")) return;

  // (a) Insert write queue infrastructure before the POST handler
  const postNeedle = 'router.post("/event", (req, res) => {';
  if (!source.includes(postNeedle)) {
    throw new Error(
      `Unable to patch ${file}: expected router.post("/event") anchor (FEA-1363).`,
    );
  }
  source = source.replace(postNeedle, [
    "// FEA-1363: Write queue coalesces concurrent hook events into batched transactions.",
    "const hookWriteQueue = [];",
    "let hookDrainScheduled = false;",
    "let hookDrainRetries = 0;",
    "const MAX_HOOK_DRAIN_RETRIES = 5;",
    "",
    "function enqueueHookEvent(hookType, data, transcriptData, planCapture) {",
    "  hookWriteQueue.push({ hookType, data, transcriptData, planCapture });",
    "  if (!hookDrainScheduled) {",
    "    hookDrainScheduled = true;",
    "    setImmediate(drainHookQueue);",
    "  }",
    "}",
    "",
    "function drainHookQueue() {",
    "  hookDrainScheduled = false;",
    "  const batch = hookWriteQueue.splice(0);",
    "  if (batch.length === 0) return;",
    "  const succeeded = new Set();",
    "  try {",
    "    db.transaction(() => {",
    "      for (let i = 0; i < batch.length; i++) {",
    "        db.exec('SAVEPOINT hook_event');",
    "        try {",
    "          processEventCore(batch[i].hookType, batch[i].data, batch[i].transcriptData);",
    "          db.exec('RELEASE hook_event');",
    "          succeeded.add(i);",
    "        } catch (err) {",
    "          db.exec('ROLLBACK TO hook_event');",
    "          db.exec('RELEASE hook_event');",
    '          console.warn("[hooks] batch event failed:", batch[i].hookType, err?.message || err);',
    "        }",
    "      }",
    "    })();",
    "    hookDrainRetries = 0;",
    "  } catch (err) {",
    "    hookDrainRetries++;",
    "    if (hookDrainRetries > MAX_HOOK_DRAIN_RETRIES) {",
    '      console.error("[hooks] batch transaction failed after " + MAX_HOOK_DRAIN_RETRIES + " retries, dropping " + batch.length + " events:", err?.message || err);',
    "      hookDrainRetries = 0;",
    "      return;",
    "    }",
    '    console.warn("[hooks] batch transaction failed (attempt " + hookDrainRetries + "/" + MAX_HOOK_DRAIN_RETRIES + "), requeuing:", err?.message || err);',
    "    hookWriteQueue.unshift(...batch);",
    "    if (!hookDrainScheduled) {",
    "      hookDrainScheduled = true;",
    "      setTimeout(drainHookQueue, Math.min(1000 * Math.pow(2, hookDrainRetries - 1), 30000));",
    "    }",
    "    return;",
    "  }",
    "  for (let i = 0; i < batch.length; i++) {",
    "    if (!succeeded.has(i)) continue;",
    "    const item = batch[i];",
    "    if (item.planCapture) {",
    "      try {",
    "        const planResult = upsertPlanCapture(db, item.planCapture);",
    "        if (planResult && !planResult.deduped) {",
    '          broadcast("plan_captured", {',
    "            plan_id: planResult.planId,",
    "            version: planResult.version,",
    "            session_id: item.planCapture.created_from_session_id,",
    "          });",
    "        }",
    "      } catch (e) {",
    '        console.warn("[plans] batch plan capture failed:", e && e.message);',
    "      }",
    "    }",
    "    if (item.hookType === \"SubagentStop\" && item.data.session_id && item.data.transcript_path) {",
    "      scanAndImportSubagents(dbModule, item.data.session_id, item.data.transcript_path)",
    "        .then(({ created }) => {",
    "          if (created > 0) {",
    '            broadcast("new_event", {',
    "              session_id: item.data.session_id,",
    "              agent_id: null,",
    '              event_type: "SubagentJsonlImported",',
    "              tool_name: null,",
    "              summary: `Imported ${created} subagent record(s) from JSONL`,",
    "              created_at: new Date().toISOString(),",
    "            });",
    "          }",
    "        })",
    "        .catch(() => {});",
    "    }",
    "  }",
    "}",
    "",
    postNeedle,
  ].join("\n"));

  // (b) Replace the synchronous processEvent flow in the POST handler with
  //     eager validation + enqueue + immediate response
  const syncFlowNeedle = [
    "",
    "  let transcriptData = null;",
    "  if (data.transcript_path) {",
    "    transcriptData = transcriptCache.extract(data.transcript_path);",
    "  }",
    "  const result = processEvent(hook_type, data, transcriptData);",
    "  if (!result) {",
    "    return res.status(400).json({",
    '      error: { code: "MISSING_SESSION", message: "session_id is required in data" },',
    "    });",
    "  }",
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
    "",
    "",
    '  res.json({ ok: true, event: result });',
  ].join("\n");
  if (!source.includes(syncFlowNeedle)) {
    throw new Error(
      `Unable to patch ${file}: expected synchronous processEvent flow anchor (FEA-1363).`,
    );
  }
  source = source.replace(syncFlowNeedle, [
    "",
    "  if (!data.session_id) {",
    "    return res.status(400).json({",
    '      error: { code: "MISSING_SESSION", message: "session_id is required in data" },',
    "    });",
    "  }",
    "  let transcriptData = null;",
    "  if (data.transcript_path) {",
    "    transcriptData = transcriptCache.extract(data.transcript_path);",
    "  }",
    "  let planCapture = null;",
    "  try {",
    "    planCapture = extractPlanFromHookEvent(hook_type, data);",
    "  } catch (e) {",
    '    console.warn("[plans] hook capture failed:", e && e.message);',
    "  }",
    "  enqueueHookEvent(hook_type, data, transcriptData, planCapture);",
    "  res.json({ ok: true });",
  ].join("\n"));

  // (c) Remove the post-response SubagentStop block (now handled in drainHookQueue)
  const subagentStopNeedle = [
    "",
    "  // After SubagentStop, scan the session's subagent JSONL files and ingest any",
    "  // tool calls that aren't yet in the events table. Subagent tool_use blocks",
    "  // never fire hooks on the parent session — this scan is the only path that",
    "  // attributes them to the subagent's agent_id.",
    '  if (hook_type === "SubagentStop" && data.session_id && data.transcript_path) {',
    "    scanAndImportSubagents(dbModule, data.session_id, data.transcript_path)",
    "      .then(({ created }) => {",
    "        if (created > 0) {",
    "          // Nudge SessionDetail to refetch — the page already debounces",
    "          // bursts of new_event into a single paginated reload.",
    '          broadcast("new_event", {',
    "            session_id: data.session_id,",
    "            agent_id: null,",
    '            event_type: "SubagentJsonlImported",',
    "            tool_name: null,",
    "            summary: `Imported ${created} subagent record(s) from JSONL`,",
    "            created_at: new Date().toISOString(),",
    "          });",
    "        }",
    "      })",
    "      .catch(() => {",
    "        // non-fatal — partial JSONL during a live run is expected",
    "      });",
    "  }",
  ].join("\n");
  if (!source.includes(subagentStopNeedle)) {
    throw new Error(
      `Unable to patch ${file}: expected SubagentStop post-response anchor (FEA-1363).`,
    );
  }
  source = source.replace(subagentStopNeedle, "");

  // (d) Wrap watchdog read-check-write in a transaction with broadcasts after commit
  const watchdogNeedle = "function watchdogCheck() {";
  if (!source.includes(watchdogNeedle)) {
    throw new Error(
      `Unable to patch ${file}: expected watchdogCheck function anchor (FEA-1363).`,
    );
  }
  // Replace the entire watchdog function body
  const watchdogEndNeedle = [
    "  } catch (err) {",
    "    // Watchdog is best-effort — log but never crash the server",
    '    console.warn("[WATCHDOG] Error during check:", err?.message || err);',
    "  }",
    "}",
  ].join("\n");
  if (!source.includes(watchdogEndNeedle)) {
    throw new Error(
      `Unable to patch ${file}: expected watchdogCheck closing anchor (FEA-1363).`,
    );
  }
  const watchdogFull = source.substring(
    source.indexOf(watchdogNeedle),
    source.indexOf(watchdogEndNeedle) + watchdogEndNeedle.length,
  );
  source = source.replace(watchdogFull, [
    "function watchdogCheck() {",
    "  try {",
    '    const os = require("os");',
    '    const path = require("path");',
    '    const fs = require("fs");',
    "    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();",
    "    const staleSessions = db",
    "      .prepare(",
    "        `SELECT s.id, s.status, s.cwd,",
    "                (SELECT MAX(e.created_at) FROM events e WHERE e.session_id = s.id) as last_event,",
    "                (SELECT e.data FROM events e WHERE e.session_id = s.id",
    "                 AND e.event_type IN ('SessionStart','UserPromptSubmit','PreToolUse','Stop','Notification')",
    "                 ORDER BY e.created_at DESC LIMIT 1) as last_data",
    "         FROM sessions s",
    "         WHERE s.status = 'active' AND s.updated_at < ?`",
    "      )",
    "      .all(cutoff);",
    "",
    "    // Phase 1: Extract transcripts outside the transaction (disk I/O)",
    "    const sessionsWithErrors = [];",
    "    for (const sess of staleSessions) {",
    "      let tPath = null;",
    "      if (sess.last_data) {",
    "        try {",
    "          tPath = JSON.parse(sess.last_data).transcript_path;",
    "        } catch {}",
    "      }",
    "      if (!tPath && sess.cwd) {",
    '        const slug = sess.cwd.replace(/[\\/\\.]/g, "-");',
    '        const candidate = path.join(os.homedir(), ".claude", "projects", slug, `${sess.id}.jsonl`);',
    "        if (fs.existsSync(candidate)) tPath = candidate;",
    "      }",
    "      if (!tPath) continue;",
    "      const result = transcriptCache.extract(tPath);",
    "      if (!result || !result.errors || result.errors.length === 0) continue;",
    "      sessionsWithErrors.push({ sess, result });",
    "    }",
    "    if (sessionsWithErrors.length === 0) return;",
    "",
    "    // Phase 2: Atomic read-check-write inside a single transaction",
    "    const pendingBroadcasts = [];",
    "    db.transaction(() => {",
    "      for (const { sess, result } of sessionsWithErrors) {",
    "        const existingErrorCount = db",
    "          .prepare(",
    '            "SELECT COUNT(*) as cnt FROM events WHERE session_id = ? AND event_type = \'APIError\'"',
    "          )",
    "          .get(sess.id).cnt;",
    "        const mainAgent = db",
    '          .prepare("SELECT * FROM agents WHERE session_id = ? AND type = \'main\' LIMIT 1")',
    "          .get(sess.id);",
    "        const mainAgentId = mainAgent?.id ?? null;",
    "",
    "        if (existingErrorCount < result.errors.length) {",
    "          const existingSummaries = new Set(",
    "            db",
    "              .prepare(`SELECT summary FROM events WHERE session_id = ? AND event_type = 'APIError'`)",
    "              .all(sess.id)",
    "              .map((r) => r.summary)",
    "          );",
    "",
    "          let newErrorRecorded = false;",
    "          for (const apiErr of result.errors) {",
    "            const summary = `${apiErr.type}: ${apiErr.message}`;",
    "            if (existingSummaries.has(summary)) continue;",
    "            stmts.insertEvent.run(",
    "              sess.id,",
    "              mainAgentId,",
    '              "APIError",',
    "              null,",
    "              summary,",
    "              JSON.stringify(apiErr)",
    "            );",
    '            pendingBroadcasts.push(["new_event", {',
    "              session_id: sess.id,",
    "              agent_id: mainAgentId,",
    '              event_type: "APIError",',
    "              tool_name: null,",
    "              summary,",
    "              created_at: apiErr.timestamp || new Date().toISOString(),",
    "            }]);",
    "            newErrorRecorded = true;",
    "          }",
    "",
    "          if (newErrorRecorded) {",
    "            const curSession = stmts.getSession.get(sess.id);",
    '            if (curSession && curSession.status === "active") {',
    '              stmts.updateSession.run(null, "error", null, null, sess.id);',
    '              pendingBroadcasts.push(["session_updated", stmts.getSession.get(sess.id)]);',
    "            }",
    '            if (mainAgent && mainAgent.status !== "completed" && mainAgent.status !== "error") {',
    '              stmts.updateAgent.run(null, "error", null, null, null, null, mainAgentId);',
    "              if (mainAgentId) {",
    "                stmts.clearAgentAwaitingInput.run(mainAgentId);",
    '                pendingBroadcasts.push(["agent_updated", stmts.getAgent.get(mainAgentId)]);',
    "              }",
    "            }",
    "          }",
    "        }",
    "      }",
    "    })();",
    "",
    "    // Phase 3: Broadcast after commit",
    "    for (const [event, data] of pendingBroadcasts) {",
    "      broadcast(event, data);",
    "    }",
    "  } catch (err) {",
    '    console.warn("[WATCHDOG] Error during check:", err?.message || err);',
    "  }",
    "}",
  ].join("\n"));

  writeFileSync(file, source, "utf8");
}

// CLOSEDLOOP FEA-1407: sandbox scoping — skip hook events whose cwd falls
// outside the configured sandbox directory. Injects an isSessionInSandbox
// helper and a guard in the POST /event handler before the session_id check.
function patchHooksSandboxFilter(file) {
  let source = readFileSync(file, "utf8");
  if (source.includes("FEA-1407 sandbox scoping")) return;

  // (a) Inject the isSessionInSandbox helper before the POST handler.
  const postAnchor = "// FEA-1363: Write queue coalesces concurrent hook events into batched transactions.";
  if (!source.includes(postAnchor)) {
    throw new Error(
      `Unable to patch ${file}: expected FEA-1363 write queue comment anchor (FEA-1407 sandbox scoping).`,
    );
  }
  source = source.replace(postAnchor, [
    "// FEA-1407 sandbox scoping — reject hook events outside the configured sandbox.",
    IS_SESSION_IN_SANDBOX_CJS,
    "",
    postAnchor,
  ].join("\n"));

  // (b) Inject sandbox guard in the POST handler before the session_id check.
  const sessionIdCheck = [
    '  if (!data.session_id) {',
    '    return res.status(400).json({',
    '      error: { code: "MISSING_SESSION", message: "session_id is required in data" },',
    '    });',
    '  }',
  ].join("\n");
  if (!source.includes(sessionIdCheck)) {
    throw new Error(
      `Unable to patch ${file}: expected session_id guard anchor (FEA-1407 sandbox scoping).`,
    );
  }
  source = source.replace(sessionIdCheck, [
    "  // FEA-1407 sandbox scoping: skip events outside the configured sandbox.",
    "  if (data.cwd && !isSessionInSandbox(data.cwd, process.env.SANDBOX_BASE_DIRECTORY)) {",
    "    return res.json({ ok: true });",
    "  }",
    sessionIdCheck,
  ].join("\n"));

  writeFileSync(file, source, "utf8");
}

// CLOSEDLOOP FEA-1334: expose cold-start ingest progress so the desktop
// renderer can show a floating "catching up on agent history" card on every
// launch. The ingest orchestrator writes into the ingest-progress singleton;
// this read-only endpoint snapshots it. Idempotent string-anchor patch.
function patchImportRoute(file) {
  let source = readFileSync(file, "utf8");
  if (source.includes('router.get("/progress"')) return;

  const needle = "module.exports = router;";
  if (!source.includes(needle)) {
    throw new Error(
      `Unable to patch ${file}: expected the import-route module.exports anchor (FEA-1334 progress endpoint).`,
    );
  }
  source = source.replace(
    needle,
    [
      "// CLOSEDLOOP FEA-1334: read-only snapshot of cold-start ingest progress",
      "// for the desktop floating progress card. The ingest orchestrator writes",
      "// into the ingest-progress singleton; this endpoint only reads it.",
      'router.get("/progress", (_req, res) => {',
      "  try {",
      '    const progress = require("../agent-monitor-shared/ingest-progress");',
      "    res.json(progress.snapshot());",
      "  } catch (err) {",
      "    res.status(500).json({ error: String((err && err.message) || err) });",
      "  }",
      "});",
      "",
      needle,
    ].join("\n"),
  );
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

  // CLOSEDLOOP FEA-1334: give importAllSessions optional progress hooks so the
  // first-run Claude legacy import drives the desktop ingest progress bar.
  // Other callers (CLI mode, the /api/import rescan route) omit `opts` and are
  // unaffected.
  if (!source.includes("FEA-1334 progress hooks")) {
    const headNeedle = [
      "async function importAllSessions(dbModule) {",
      "  if (!fs.existsSync(PROJECTS_DIR)) return { imported: 0, skipped: 0, errors: 0 };",
      "",
      "  const projectDirs = fs",
      "    .readdirSync(PROJECTS_DIR, { withFileTypes: true })",
      "    .filter((d) => d.isDirectory())",
      "    .map((d) => d.name);",
    ].join("\n");
    if (!source.includes(headNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the importAllSessions head (FEA-1334 progress hooks).`,
      );
    }
    source = source.replace(
      headNeedle,
      [
        "async function importAllSessions(dbModule, opts = {}) {",
        "  // FEA-1334 progress hooks — optional; the importer is unchanged when omitted.",
        '  const _onBegin = opts && typeof opts.onBegin === "function" ? opts.onBegin : null;',
        '  const _onProgress = opts && typeof opts.onProgress === "function" ? opts.onProgress : null;',
        "  const _signal = opts && opts.signal ? opts.signal : null;",
        "  if (!fs.existsSync(PROJECTS_DIR)) {",
        "    if (_onBegin) _onBegin(0);",
        "    return { imported: 0, skipped: 0, errors: 0 };",
        "  }",
        "",
        "  const projectDirs = fs",
        "    .readdirSync(PROJECTS_DIR, { withFileTypes: true })",
        "    .filter((d) => d.isDirectory())",
        "    .map((d) => d.name);",
        "",
        "  if (_onBegin) {",
        "    let _total = 0;",
        "    for (const _d of projectDirs) {",
        "      try {",
        "        _total += fs",
        "          .readdirSync(path.join(PROJECTS_DIR, _d))",
        '          .filter((f) => f.endsWith(".jsonl")).length;',
        "      } catch (e) { void e; }",
        "    }",
        "    _onBegin(_total);",
        "  }",
      ].join("\n"),
    );

    const loopNeedle = [
      "    const batch = [];",
      "    for (const file of files) {",
      "      try {",
      "        const session = await parseSessionFile(path.join(projPath, file));",
    ].join("\n");
    if (!source.includes(loopNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the importAllSessions file loop (FEA-1334 progress hooks).`,
      );
    }
    source = source.replace(
      loopNeedle,
      [
        "    const batch = [];",
        "    for (const file of files) {",
        "      if (_signal && _signal.aborted) break;",
        "      if (_onProgress) _onProgress();",
        "      try {",
        "        const session = await parseSessionFile(path.join(projPath, file));",
      ].join("\n"),
    );
  }

  writeFileSync(file, source, "utf8");
}

/**
 * CLOSEDLOOP token reconciliation fix: replace the subagent-only token guard
 * in importSession's existing-session branch with an unconditional call to
 * writeSessionTokens. Without this, parsers that extract fresh token data
 * on every re-import (OpenCode, Copilot, Cursor, Codex) never update a
 * session's token_usage row after the initial import — the upstream code
 * only reconciled tokens when parsedSubagents existed with non-zero tokens.
 */
function patchImportHistoryTokenReconcile(file) {
  let source = readFileSync(file, "utf8");
  if (source.includes("CLOSEDLOOP token reconciliation")) {
    writeFileSync(file, source, "utf8");
    return;
  }
  const needle = [
    "    // Reconcile token usage. The earlier importer dropped subagent tokens",
    "    // entirely, so any session with subagent JSONLs has under-counted totals.",
    "    // replaceTokenUsage's baseline-shift logic guarantees this can never",
    "    // reduce a session's totals — at worst it's a no-op.",
    "    if (",
    "      session.parsedSubagents &&",
    "      session.parsedSubagents.some(",
    "        (s) =>",
    "          s.tokensByModel &&",
    "          Object.values(s.tokensByModel).some(",
    "            (t) => (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0) > 0",
    "          )",
    "      )",
    "    ) {",
    "      const written = writeSessionTokens(",
    "        dbModule,",
    "        session.sessionId,",
    "        combineSessionTokens(session)",
    "      );",
    "      if (written > 0) backfilled = true;",
    "    }",
  ].join("\n");
  if (!source.includes(needle)) {
    throw new Error(
      `Unable to patch ${file}: expected the subagent-only token guard (CLOSEDLOOP token reconciliation).`,
    );
  }
  const replacement = [
    "    // CLOSEDLOOP token reconciliation — unconditionally write tokens for",
    "    // every re-import so parsers that extract fresh token data (OpenCode,",
    "    // Copilot, Cursor, Codex) can update totals when a session is",
    "    // re-imported. The upstream code only reconciled when subagents had",
    "    // non-zero tokens, which meant sessions without subagents (most",
    "    // non-Claude sessions) never had their token_usage refreshed.",
    "    // replaceTokenUsage's baseline-shift logic guarantees this can never",
    "    // reduce a session's totals — at worst it's a no-op.",
    "    {",
    "      const written = writeSessionTokens(",
    "        dbModule,",
    "        session.sessionId,",
    "        combineSessionTokens(session)",
    "      );",
    "      if (written > 0) backfilled = true;",
    "    }",
  ].join("\n");
  source = source.replace(needle, replacement);
  writeFileSync(file, source, "utf8");
}

/**
 * CLOSEDLOOP meta.imported fix: for legacy sessions imported before the
 * `imported` metadata flag existed, stamp the flag instead of returning
 * early with `{ skipped: true }` so event backfill and token reconciliation
 * can proceed during re-import. The high-water-mark dedup protects against
 * duplicate events and the baseline-shifting upsert protects against
 * double-counted tokens.
 */
function patchImportHistoryMetaImported(file) {
  let source = readFileSync(file, "utf8");
  if (source.includes("CLOSEDLOOP meta.imported fix")) {
    writeFileSync(file, source, "utf8");
    return;
  }
  const needle =
    '    if (!meta.imported) return { skipped: true };';
  if (!source.includes(needle)) {
    throw new Error(
      `Unable to patch ${file}: expected the meta.imported early return (CLOSEDLOOP meta.imported fix).`,
    );
  }
  const replacement = [
    "    // CLOSEDLOOP meta.imported fix: legacy session imported before the",
    '    // `imported` metadata flag existed — stamp it and continue so event',
    "    // backfill and token reconciliation can proceed. The high-water-mark",
    "    // dedup protects against duplicate events and the baseline-shifting",
    "    // upsert protects against double-counted tokens.",
    "    if (!meta.imported) {",
    "      meta.imported = true;",
    "    }",
  ].join("\n");
  source = source.replace(needle, replacement);
  writeFileSync(file, source, "utf8");
}

/**
 * CLOSEDLOOP metadata refresh parity: widen the existing-session refresh gate
 * in importSession() so re-imports update derived metadata even when message
 * counts stay stable. Without this, non-Claude sessions can keep stale
 * permission mode, thinking-block counts, usage extras, or turn metrics
 * forever unless user/assistant counts also happen to change.
 */
function patchImportHistoryMetadataRefresh(file) {
  let source = readFileSync(file, "utf8");
  if (source.includes("CLOSEDLOOP metadata refresh parity")) {
    writeFileSync(file, source, "utf8");
    return;
  }
  const needle = [
    "    // Refresh sessions.ended_at and the message-count metadata so the dashboard",
    "    // shows the latest window when a long-running session is re-imported. We",
    "    // only move ended_at forward — never backward — and only when the JSONL's",
    "    // latest activity is genuinely past whatever the DB currently records.",
    "    const metaChanged =",
    "      meta.user_messages !== session.userMessages ||",
    "      meta.assistant_messages !== session.assistantMessages ||",
    "      (!meta.entrypoint && (session.entrypoint || session.turnDurations?.length > 0));",
  ].join("\n");
  if (!source.includes(needle)) {
    throw new Error(
      `Unable to patch ${file}: expected the narrow metadata refresh gate (CLOSEDLOOP metadata refresh parity).`,
    );
  }
  const replacement = [
    "    // CLOSEDLOOP metadata refresh parity: re-imports must refresh the",
    "    // derived metadata we already know how to compute, even when message",
    "    // counts do not change. Otherwise non-Claude sessions can keep stale",
    "    // permission mode, thinking-block counts, usage extras, and turn",
    "    // latency metrics forever after the first import.",
    "    const nextEntryPoint = session.entrypoint || meta.entrypoint || null;",
    "    const nextPermissionMode = session.permissionMode || meta.permission_mode || null;",
    "    const nextThinkingBlocks = Math.max(meta.thinking_blocks || 0, session.thinkingBlockCount || 0);",
    "    const nextUsageExtras = session.usageExtras || meta.usage_extras || null;",
    "    const nextTurnCount = session.turnDurations ? session.turnDurations.length : meta.turn_count || 0;",
    "    const nextTotalTurnDurationMs = session.turnDurations",
    "      ? session.turnDurations.reduce((s, t) => s + t.durationMs, 0)",
    "      : meta.total_turn_duration_ms || 0;",
    "    const metaChanged =",
    "      meta.user_messages !== session.userMessages ||",
    "      meta.assistant_messages !== session.assistantMessages ||",
    "      meta.entrypoint !== nextEntryPoint ||",
    "      (meta.permission_mode || null) !== nextPermissionMode ||",
    "      (meta.thinking_blocks || 0) !== nextThinkingBlocks ||",
    "      JSON.stringify(meta.usage_extras || null) !== JSON.stringify(nextUsageExtras) ||",
    "      (meta.turn_count || 0) !== nextTurnCount ||",
    "      (meta.total_turn_duration_ms || 0) !== nextTotalTurnDurationMs;",
  ].join("\n");
  source = source.replace(needle, replacement);
  writeFileSync(file, source, "utf8");
}

// CLOSEDLOOP engineer GitHub activity capture (FEA-1226): two idempotent
// patches to import-history.js — (1) expose the source JSONL path on the
// normalized session object so the PR extractor can re-read it for
// command-gating (the normalized object drops tool_result output); (2) extract
// PRs in importSession, right after the FEA-1189 plan block. Runs after
// patchImportHistory so the plan block is in place to anchor on.
function patchImportHistoryForPullRequests(file) {
  let source = readFileSync(file, "utf8");

  // (1) parseSessionFile return — add sourceLogPath: filePath.
  if (!source.includes("sourceLogPath: filePath")) {
    const needle = "  return {\n    sessionId,\n    name: sessionName,";
    if (!source.includes(needle)) {
      throw new Error(
        `Unable to patch ${file}: expected the parseSessionFile return head (sourceLogPath, FEA-1226).`,
      );
    }
    source = source.replace(
      needle,
      "  return {\n    sessionId,\n    sourceLogPath: filePath,\n    name: sessionName,",
    );
  }

  // (2) importSession — extract PRs after the FEA-1189 plan block.
  if (!source.includes("FEA-1226 pull-request extraction")) {
    const anchor =
      "  } catch (e) { void e; /* plan extraction is best-effort; never blocks import */ }";
    if (!source.includes(anchor)) {
      throw new Error(
        `Unable to patch ${file}: expected the FEA-1189 plan block tail (PR extraction, FEA-1226).`,
      );
    }
    const inject = [
      anchor,
      "  // FEA-1226 pull-request extraction — capture `gh pr create` PR URLs",
      "  // from the session's raw JSONL into the pull_requests table. Runs once",
      "  // per importSession; best-effort, never blocks import. Per-error",
      "  // console.warn (not silent `void e`) so a regression in the require",
      "  // chain or upsert path surfaces in main.log instead of vanishing — the",
      "  // original silent swallow hid the FEA-1226 backfill gap for days.",
      "  try {",
      '    const { extractPullRequestsFromSession } = require("../server/lib/pr-extractor");',
      '    const { upsertPullRequest } = require("../server/lib/pull-request-store");',
      "    let __prFirstUpsertErr = null;",
      "    for (const __pr of extractPullRequestsFromSession(session)) {",
      "      try {",
      "        upsertPullRequest(dbModule.db, __pr);",
      "      } catch (e) {",
      "        if (!__prFirstUpsertErr) __prFirstUpsertErr = e;",
      "      }",
      "    }",
      "    if (__prFirstUpsertErr) {",
      '      console.warn("[pull-requests] upsert failed for session", session && session.sessionId, "—", __prFirstUpsertErr && __prFirstUpsertErr.message);',
      "    }",
      "  } catch (e) {",
      '    console.warn("[pull-requests] extract failed for session", session && session.sessionId, "—", e && e.message);',
      "  }",
    ].join("\n");
    source = source.replace(anchor, inject);
  }

  writeFileSync(file, source, "utf8");
}

// CLOSEDLOOP FEA-1407: sandbox scoping — skip sessions whose cwd falls outside
// the configured sandbox directory. Injects an isSessionInSandbox helper and a
// guard at the top of importSession, before any DB interaction.
function patchImportHistorySandboxFilter(file) {
  let source = readFileSync(file, "utf8");
  if (source.includes("FEA-1407 sandbox scoping")) return;

  // (a) Inject the isSessionInSandbox helper at the top of the file, after
  // the existing requires section. Anchor on the PROJECTS_DIR const which is
  // always present near the top. Upstream (pinned 840c518d) derives it via the
  // claude-home helper rather than the older inline os.homedir() form.
  const requireAnchor = "const PROJECTS_DIR = getProjectsDir();";
  if (!source.includes(requireAnchor)) {
    throw new Error(
      `Unable to patch ${file}: expected PROJECTS_DIR anchor (FEA-1407 sandbox scoping).`,
    );
  }
  source = source.replace(requireAnchor, [
    requireAnchor,
    "",
    "// FEA-1407 sandbox scoping — reject sessions outside the configured sandbox.",
    IS_SESSION_IN_SANDBOX_CJS,
  ].join("\n"));

  // (b) Inject sandbox guard at the top of importSession, before the plan
  // extraction block.
  const importSessionHead =
    "function importSession(dbModule, session) {\n  const { db, stmts } = dbModule;";
  if (!source.includes(importSessionHead)) {
    throw new Error(
      `Unable to patch ${file}: expected importSession head anchor (FEA-1407 sandbox scoping).`,
    );
  }
  source = source.replace(importSessionHead, [
    "function importSession(dbModule, session) {",
    "  // FEA-1407 sandbox scoping: skip sessions outside the configured sandbox.",
    "  if (!isSessionInSandbox(session.cwd, process.env.SANDBOX_BASE_DIRECTORY)) {",
    '    return { skipped: true, reason: "sandbox" };',
    "  }",
    "  const { db, stmts } = dbModule;",
  ].join("\n"));

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
  // CLOSEDLOOP engineer GitHub activity capture (FEA-1226): drop the Pull
  // Requests page into the pinned client before Vite build. The route is
  // declared in scripts/agent-monitor-embed/App.tsx; the Sidebar nav entry is
  // added below via the declarative edits array.
  cpSync(
    path.join(prModulesDir, "client", "PullRequests.tsx"),
    path.join(sourceClientDir, "src", "pages", "PullRequests.tsx"),
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
  cpSync(
    path.join(packModulesDir, "client", "PackInstallModalUtils.ts"),
    path.join(sourceClientDir, "src", "pages", "PackInstallModalUtils.ts"),
  );
  // CLOSEDLOOP embed integration: replace selected upstream client files with
  // repo-owned overlays. Extend CLIENT_FULL_FILE_OVERRIDES for future host
  // patches that should fully override an upstream file at build time.
  for (const override of CLIENT_FULL_FILE_OVERRIDES) {
    cpSync(override.from, path.join(sourceClientDir, override.to));
  }
  const snippetBypassFiles = new Set([
    path.join("src", "components", "StatusBadge.tsx"),
    path.join("src", "pages", "Sessions.tsx"),
  ]);
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
        '          <Route path="packs/:packId" element={<PackDetail />} />',
      ].join("\n"),
    },
    // FEA-1314 v4 (separately patched): the packs/:packId route was added
    // to the FEA-1224 patch above, but on existing patched sources where
    // the FEA-1224 patch had already fired (guard already matches), the
    // whole edit short-circuits and the new packs/:packId line never lands.
    // This dedicated entry — guarded on the packs/:packId line itself — is
    // surgical and idempotent: it adds JUST the missing route line after
    // the packs route, regardless of whether the FEA-1224 patch fired
    // before or after v4 was introduced.
    {
      rel: "src/App.tsx",
      guard: 'path="packs/:packId"',
      find: '          <Route path="packs" element={<Packs />} />',
      replace:
        '          <Route path="packs" element={<Packs />} />\n          <Route path="packs/:packId" element={<PackDetail />} />',
    },
    // FEA-1314 v4: import the PackDetail component referenced in the
    // /packs/:packId route. Anchors AFTER the Packs import added above so
    // re-runs are idempotent.
    {
      rel: "src/App.tsx",
      guard: 'import { PackDetail } from "./pages/PackDetail"',
      find: 'import { Packs } from "./pages/Packs";',
      replace:
        'import { Packs } from "./pages/Packs";\nimport { PackDetail } from "./pages/PackDetail";',
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
    // CLOSEDLOOP engineer GitHub activity capture (FEA-1226): one ungated
    // top-level nav entry (Pull Requests). Runs after the FEA-1224 pack edits
    // so the `Package` lucide import + the `/packs` nav row are present to
    // anchor on.
    {
      rel: "src/components/Sidebar.tsx",
      guard: "  GitPullRequest,",
      find: '  Package,\n} from "lucide-react";',
      replace: '  Package,\n  GitPullRequest,\n} from "lucide-react";',
    },
    {
      rel: "src/components/Sidebar.tsx",
      guard: 'to: "/pull-requests"',
      find: '  { to: "/packs", icon: Package, key: "Packs" },',
      replace: [
        '  { to: "/packs", icon: Package, key: "Packs" },',
        '  { to: "/pull-requests", icon: GitPullRequest, key: "Pull Requests" },',
      ].join("\n"),
    },
  ];

  for (const e of edits) {
    if (snippetBypassFiles.has(e.rel)) continue;
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
    // FEA-1444: Codex hook wrapper must materialize alongside the upstream
    // Claude handler so agent-monitor-hooks.ts can resolve both from the same
    // `scriptsDir`.
    path.join(generatedRootDir, "scripts", "codex-hook-handler.js"),
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
  if (!serverIndex.includes("stopCodexWatcher")) {
    throw new Error(
      "Generated server/index.js is missing the watcher shutdown cleanup.",
    );
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

  // CLOSEDLOOP FEA-1334 hard-gates: a future upstream bump that breaks an
  // anchor must fail the build, not silently drop the ingest orchestrator or
  // the progress endpoint that powers the desktop floating progress card.
  if (!serverIndex.includes("ingestAllHarnesses")) {
    throw new Error(
      "Generated server/index.js is missing the FEA-1334 ingest orchestrator wiring (ingestAllHarnesses).",
    );
  }
  if (!serverIndex.includes('key: "claude"')) {
    throw new Error(
      "Generated server/index.js is missing the FEA-1334 Claude orchestrator harness.",
    );
  }
  if (serverIndex.includes("legacy sessions from ~/.claude/")) {
    throw new Error(
      "Generated server/index.js still has the standalone Claude import block — FEA-1334 expects it removed (the orchestrator now runs it).",
    );
  }
  const fea1334ImportHistory = readFileSync(generatedImportHistory, "utf8");
  if (!fea1334ImportHistory.includes("FEA-1334 progress hooks")) {
    throw new Error(
      "Generated scripts/import-history.js is missing the FEA-1334 importAllSessions progress hooks.",
    );
  }
  const importRouteSource = readFileSync(generatedImportRoute, "utf8");
  if (!importRouteSource.includes('router.get("/progress"')) {
    throw new Error(
      "Generated server/routes/import.js is missing the FEA-1334 /api/import/progress endpoint.",
    );
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

  // CC-Config MCP discovery: hard-gate the claude.ai-connector patch so a
  // future upstream bump can't silently drop the closedloop MCP from the
  // dashboard's MCP panel.
  if (!existsSync(generatedCcDiscovery)) {
    throw new Error(
      "Generated server/lib/cc-discovery.js is missing — upstream layout changed?",
    );
  }
  const ccDiscoverySource = readFileSync(generatedCcDiscovery, "utf8");
  if (!ccDiscoverySource.includes("claudeAiMcpEverConnected")) {
    throw new Error(
      "Generated server/lib/cc-discovery.js is missing the claudeAiMcpEverConnected patch.",
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

  // CLOSEDLOOP FEA-1363: SQLite write contention fix hard-gates. A future
  // upstream bump that breaks an anchor must fail the build, not silently
  // revert to the contention-prone code paths.
  const compatSqliteSource = readFileSync(generatedCompatSqlite, "utf8");
  if (!compatSqliteSource.includes('"BEGIN IMMEDIATE"')) {
    throw new Error(
      "Generated server/compat-sqlite.js is missing BEGIN IMMEDIATE (FEA-1363).",
    );
  }
  if (!hooksRouteSource.includes("processEventCore")) {
    throw new Error(
      "Generated server/routes/hooks.js is missing processEventCore extraction (FEA-1363).",
    );
  }
  if (!hooksRouteSource.includes("hookWriteQueue")) {
    throw new Error(
      "Generated server/routes/hooks.js is missing the write queue (FEA-1363).",
    );
  }
  if (!hooksRouteSource.includes("drainHookQueue")) {
    throw new Error(
      "Generated server/routes/hooks.js is missing drainHookQueue (FEA-1363).",
    );
  }
  if (!hooksRouteSource.includes("SAVEPOINT hook_event")) {
    throw new Error(
      "Generated server/routes/hooks.js is missing per-event savepoints in drainHookQueue (FEA-1363).",
    );
  }
  if (!hooksRouteSource.includes("MAX_HOOK_DRAIN_RETRIES")) {
    throw new Error(
      "Generated server/routes/hooks.js is missing retry backoff limit in drainHookQueue (FEA-1363).",
    );
  }
  if (!hooksRouteSource.includes("pendingBroadcasts")) {
    throw new Error(
      "Generated server/routes/hooks.js is missing watchdog transaction wrapping (FEA-1363).",
    );
  }

  // CLOSEDLOOP FEA-1407: sandbox scoping hard-gates. A future upstream bump
  // that breaks an anchor must fail the build, not silently drop sandbox filtering.
  if (!hooksRouteSource.includes("FEA-1407 sandbox scoping")) {
    throw new Error(
      "Generated server/routes/hooks.js is missing the sandbox scoping filter (FEA-1407).",
    );
  }

  // CLOSEDLOOP FEA-1444 hard-gates: Codex hook ingestion. A future upstream
  // bump that drops the processEventCore anchor must fail the build rather
  // than silently disabling Codex harness stamping on hook-sourced sessions.
  if (!hooksRouteSource.includes("FEA-1444 codex harness stamp")) {
    throw new Error(
      "Generated server/routes/hooks.js is missing the Codex harness stamp (FEA-1444).",
    );
  }
  if (!importHistorySource.includes("FEA-1407 sandbox scoping")) {
    throw new Error(
      "Generated scripts/import-history.js is missing the sandbox scoping filter (FEA-1407).",
    );
  }

  // CLOSEDLOOP engineer GitHub activity capture hard-gates (FEA-1226): a future
  // upstream bump that breaks an anchor must fail the build, not silently drop
  // PR capture.
  for (const m of PR_MODULES) {
    if (!existsSync(path.join(generatedRootDir, "server", "lib", `${m}.js`))) {
      throw new Error(
        `Generated server/lib/${m}.js missing (PR capture, FEA-1226).`,
      );
    }
  }
  if (
    !existsSync(
      path.join(generatedRootDir, "server", "routes", "pull-requests.js"),
    )
  ) {
    throw new Error(
      "Generated server/routes/pull-requests.js missing (PR capture, FEA-1226).",
    );
  }
  if (!dbSource.includes("ensurePullRequestSchema")) {
    throw new Error(
      "Generated server/db.js is missing the pull-request schema init (FEA-1226).",
    );
  }
  if (
    !serverIndex.includes('require("./routes/pull-requests")') ||
    !serverIndex.includes('app.use("/api/pull-requests", pullRequestsRouter)')
  ) {
    throw new Error(
      "Generated server/index.js is missing the /api/pull-requests route wiring (FEA-1226).",
    );
  }
  if (
    !importHistorySource.includes("FEA-1226 pull-request extraction") ||
    !importHistorySource.includes("sourceLogPath: filePath")
  ) {
    throw new Error(
      "Generated scripts/import-history.js is missing the PR-capture sink or sourceLogPath (FEA-1226).",
    );
  }
  if (!serverIndex.includes("runClaudePrBackfill")) {
    throw new Error(
      "Generated server/index.js is missing the ~/.claude/projects PR backfill (FEA-1226).",
    );
  }
  {
    const prSidebarSource = readFileSync(
      path.join(sourceClientDir, "src", "components", "Sidebar.tsx"),
      "utf8",
    );
    if (!prSidebarSource.includes('to: "/pull-requests"')) {
      throw new Error(
        "Patched client Sidebar.tsx is missing the /pull-requests nav entry (FEA-1226).",
      );
    }
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
  // FEA-1314 v8: per-session usage rollup on Pack detail. Hard-gate the
  // server-side endpoint + the pack-store helper so a future patch can't
  // silently drop them.
  const packsRouteSource = readFileSync(
    path.join(generatedRootDir, "server", "routes", "packs.js"),
    "utf8",
  );
  if (!packsRouteSource.includes("/:pack_id/sessions")) {
    throw new Error(
      "Generated server/routes/packs.js is missing the /sessions endpoint (FEA-1314 v8).",
    );
  }
  const packStoreSource = readFileSync(
    path.join(generatedRootDir, "server", "lib", "pack-store.js"),
    "utf8",
  );
  if (
    !packStoreSource.includes("listPackSessions") ||
    !packStoreSource.includes("collectPackPaths")
  ) {
    throw new Error(
      "Generated server/lib/pack-store.js is missing listPackSessions / collectPackPaths (FEA-1314 v8).",
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
  // FEA-1314 v4: the packs/:packId detail route + PackDetail import must be
  // present in App.tsx. v3 → v4 had a silent-fail bug where the FEA-1224
  // patch's guard short-circuited the new :packId line; this hard-gate
  // catches that class of regression next time.
  if (!appSource.includes('<Route path="packs/:packId"')) {
    throw new Error(
      "Patched client src/App.tsx is missing the /packs/:packId detail route (FEA-1314 v4).",
    );
  }
  if (!appSource.includes('import { PackDetail }')) {
    throw new Error(
      "Patched client src/App.tsx is missing the PackDetail import (FEA-1314 v4).",
    );
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

/**
 * Patch cc-discovery.js to ALSO surface MCP servers that live in
 * `~/.claude.json` under the `claudeAiMcpEverConnected` array. These are the
 * "claude.ai connectors" (Mintlify, Airtable, ClosedLoop, Asana, etc.) that
 * Claude Code resolves via the claude.ai web auth handshake — their full
 * configs (URLs, credentials) live server-side, so locally we only know names.
 * Upstream's `readMcpServers()` only scans `mcpServers` dicts and never sees
 * them. We append them to `out.user` with kind="remote" so the CC-Config tab's
 * MCP panel lists them alongside locally-configured stdio/http servers.
 *
 * Idempotent: presence-checked on the "claudeAiMcpEverConnected" string.
 */
function patchCcDiscovery(file) {
  let source = readFileSync(file, "utf8");

  if (source.includes("claudeAiMcpEverConnected")) {
    return; // already patched
  }

  const needle = "  return out;\n}\n\nfunction summarizeMcpDef(def) {";
  if (!source.includes(needle)) {
    throw new Error(
      `Unable to patch ${file}: expected the readMcpServers return + summarizeMcpDef boundary.`,
    );
  }
  const replacement = [
    "  // ClosedLoop patch: surface claude.ai-managed remote connectors (the",
    "  // 7+ entries Claude Code resolves via the claude.ai web auth handshake;",
    "  // their full configs live server-side, locally we only see the names).",
    "  if (claudeJson.ok && claudeJson.data) {",
    "    const remoteNames = claudeJson.data.claudeAiMcpEverConnected;",
    "    if (Array.isArray(remoteNames)) {",
    '      const already = new Set(out.user.map((s) => s.name));',
    "      for (const name of remoteNames) {",
    '        if (typeof name !== "string" || already.has(name)) continue;',
    "        out.user.push({",
    "          name,",
    '          source: "~/.claude.json (claudeAiMcpEverConnected — claude.ai connector)",',
    '          kind: "remote",',
    "        });",
    "      }",
    "    }",
    "  }",
    "  return out;",
    "}",
    "",
    "function summarizeMcpDef(def) {",
  ].join("\n");
  source = source.replace(needle, replacement);

  writeFileSync(file, source, "utf8");
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
