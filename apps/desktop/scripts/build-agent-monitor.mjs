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
const SHARED_MODULES = ["parser-utils"];
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
    sourceDbFile,
    sourcePushLib,
    sourceClientIndex,
    fileURLToPath(import.meta.url),
    ...MULTI_HARNESS_SPECS.flatMap(({ modulesDir, modules }) =>
      modules.map((m) => path.join(modulesDir, `${m}.js`)),
    ),
    ...SHARED_MODULES.map((m) => path.join(sharedModulesDir, `${m}.js`)),
    ...CLIENT_SNIPPET_FILES.map((file) => path.join(clientSnippetDir, file)),
  ]) {
    h.update(readFileSync(file));
  }
  return h.digest("hex");
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
  cpSync(
    path.join(sourceRootDir, "scripts"),
    path.join(generatedRootDir, "scripts"),
    { recursive: true },
  );
  mkdirSync(path.join(generatedRootDir, "client"), { recursive: true });
  cpSync(sourceClientDistDir, path.join(generatedRootDir, "client", "dist"), {
    recursive: true,
  });
  cpSync(sourceRootPkg, path.join(generatedRootDir, "package.json"));
  cpSync(path.join(sourceRootDir, "LICENSE"), path.join(generatedRootDir, "LICENSE"));

  patchServerIndex(generatedServerEntry);
  patchSessionsRoute(generatedSessionsRoute);
  patchDbFile(generatedDbFile);
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

function patchClientSource() {
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
  ];

  for (const e of edits) {
    const file = path.join(sourceClientDir, e.rel);
    let src = readFileSync(file, "utf8");
    if (src.includes(e.guard)) continue; // already patched (idempotent)

    if (e.append) {
      src = src + snippet(e.append);
    } else {
      const finds = e.findFiles
        ? e.findFiles.map((name) => snippet(name))
        : [e.findFile ? snippet(e.findFile) : e.find];
      const find = finds.find((candidate) => src.includes(candidate));
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
