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
const sourceDbFile = path.join(sourceRootDir, "server", "db.js");
const sourceCompatSqlite = path.join(sourceRootDir, "server", "compat-sqlite.js");
const sourceClientIndex = path.join(sourceClientDir, "index.html");
const sourceClientDistDir = path.join(sourceClientDir, "dist");
const generatedServerEntry = path.join(generatedRootDir, "server", "index.js");
const generatedDbFile = path.join(generatedRootDir, "server", "db.js");
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

// CLOSEDLOOP Codex support (Addition #6): proven Codex ingestion modules live
// in-repo and are copied into the generated server/lib at materialize time
// (parallel to how uninstall-hooks.js is written). Their logic is
// architecture-independent — relative requires resolve identically in the
// generated tree as they did in the old vendored tree.
const codexModulesDir = path.join(appDir, "scripts", "agent-monitor-codex");
const CODEX_MODULES = ["codex-home", "codex-parser", "codex-import", "codex-watcher"];

// CLOSEDLOOP plan-extraction (FEA-1189 / PLN-613): in-repo modules copied into
// the generated server/lib (parallel to CODEX_MODULES); plans-route.js copied
// into server/routes/plans.js; Plans.tsx into the client src/pages before the
// Vite build. import-history.js, server/db.js and server/index.js are wired via
// the same idempotent string-anchor + hard-gate approach as the Codex patches.
const planModulesDir = path.join(appDir, "scripts", "agent-monitor-plans");
const PLAN_MODULES = ["plan-extractor", "plan-store"];
const generatedImportHistory = path.join(
  generatedRootDir,
  "scripts",
  "import-history.js",
);

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
    sourceDbFile,
    sourceCompatSqlite,
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
    sourceDbFile,
    sourceClientIndex,
    fileURLToPath(import.meta.url),
    ...CODEX_MODULES.map((m) => path.join(codexModulesDir, `${m}.js`)),
    ...PLAN_MODULES.map((m) => path.join(planModulesDir, `${m}.js`)),
    path.join(planModulesDir, "plans-route.js"),
    path.join(planModulesDir, "client", "Plans.tsx"),
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
  // Codex ingestion modules (Addition #6) into the generated server/lib —
  // alongside upstream's lib files, same as the old vendored layout so the
  // modules' relative requires (../db, ../../scripts/import-history,
  // ./codex-home) resolve unchanged.
  const generatedLibDir = path.join(generatedRootDir, "server", "lib");
  mkdirSync(generatedLibDir, { recursive: true });
  for (const m of CODEX_MODULES) {
    cpSync(
      path.join(codexModulesDir, `${m}.js`),
      path.join(generatedLibDir, `${m}.js`),
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
  patchImportHistory(generatedImportHistory);
  mkdirSync(path.join(generatedRootDir, "client"), { recursive: true });
  cpSync(sourceClientDistDir, path.join(generatedRootDir, "client", "dist"), {
    recursive: true,
  });
  cpSync(sourceRootPkg, path.join(generatedRootDir, "package.json"));
  cpSync(path.join(sourceRootDir, "LICENSE"), path.join(generatedRootDir, "LICENSE"));

  patchServerIndex(generatedServerEntry);
  patchDbFile(generatedDbFile);
  writeFileSync(generatedUninstallHooks, UNINSTALL_HOOKS_SOURCE, "utf8");
}

function patchServerIndex(file) {
  let source = readFileSync(file, "utf8");

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

  // CLOSEDLOOP Codex support (Addition #6) — start the Codex rollout watcher
  // next to cc-watcher (Codex has no hooks; the watcher is its only live path).
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
        `Unable to patch ${file}: expected the cc-watcher start block (Codex).`,
      );
    }
    source = source.replace(
      ccWatcherBlock,
      [
        ccWatcherBlock,
        "    try {",
        '      const { startCodexWatcher } = require("./lib/codex-watcher");',
        "      startCodexWatcher({ broadcast });",
        "    } catch (err) {",
        '      console.warn("codex-watcher failed to start:", err.message);',
        "    }",
      ].join("\n"),
    );
  }

  // CLOSEDLOOP Codex support (Addition #6) — import Codex sessions on every
  // startup (not gated on a zero-row count, unlike the Claude import: Codex
  // has no hooks so sessions created while the app was closed must still
  // appear; the import is idempotent). Fire-and-forget; never blocks boot.
  if (!source.includes("importAllCodexSessions")) {
    const tailNeedle = [
      "  }",
      "}",
      "",
      "module.exports = { createApp, startServer };",
    ].join("\n");
    if (!source.includes(tailNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the require.main tail (Codex import).`,
      );
    }
    source = source.replace(
      tailNeedle,
      [
        "  }",
        "",
        "  try {",
        '    const { importAllCodexSessions } = require("./lib/codex-import");',
        '    importAllCodexSessions(require("./db"))',
        "      .then(({ imported, errors }) => {",
        "        if (imported > 0)",
        '          console.log("Imported " + imported + " Codex sessions from ~/.codex/");',
        "        if (errors > 0)",
        '          console.log(errors + " Codex rollout files had errors during import");',
        "      })",
        "      .catch(() => {});",
        "  } catch (err) {",
        '    console.warn("codex import failed to start:", err.message);',
        "  }",
        "}",
        "",
        "module.exports = { createApp, startServer };",
      ].join("\n"),
    );
  }

  // CLOSEDLOOP plan-extraction (FEA-1189): register the /api/plans route
  // (read + confirm/reject triage over plans / plan_versions).
  if (!source.includes('require("./routes/plans")')) {
    const requireNeedle = 'const runRouter = require("./routes/run");';
    const useNeedle = 'app.use("/api/run", runRouter);';
    if (!source.includes(requireNeedle) || !source.includes(useNeedle)) {
      throw new Error(
        `Unable to patch ${file}: expected the run-route require/use anchors (plans route, FEA-1189).`,
      );
    }
    source = source.replace(
      requireNeedle,
      `${requireNeedle}\nconst plansRouter = require("./routes/plans");`,
    );
    source = source.replace(
      useNeedle,
      `${useNeedle}\n  app.use("/api/plans", plansRouter);`,
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
const clientSnippetDir = path.join(codexModulesDir, "client");

function snippet(name) {
  return readFileSync(path.join(clientSnippetDir, name), "utf8");
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
  const plansNavLink = [
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
  const edits = [
    {
      rel: "src/lib/types.ts",
      guard: "harness?: string | null",
      find: "  cost?: number;",
      replace: "  cost?: number;\n  harness?: string | null;",
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
      guard: 'filter === "waiting" || harness',
      findFile: "sessions.loadtop.find.txt",
      replaceFile: "sessions.loadtop.replace.txt",
    },
    {
      rel: "src/pages/Sessions.tsx",
      guard: "let rows = res.sessions;",
      findFile: "sessions.loadrows.find.txt",
      replaceFile: "sessions.loadrows.replace.txt",
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
      guard: 'path="plans"',
      find: '          <Route path="run" element={<Run />} />',
      replace:
        '          <Route path="run" element={<Run />} />\n          <Route path="plans" element={<Plans />} />',
    },
    {
      rel: "src/components/Sidebar.tsx",
      guard: "FileText,",
      find: '  Gauge,\n} from "lucide-react";',
      replace: '  Gauge,\n  FileText,\n} from "lucide-react";',
    },
    {
      rel: "src/components/Sidebar.tsx",
      guard: 'to="/plans"',
      find: "        })}\n      </nav>",
      replace: plansNavLink,
    },
  ];

  for (const e of edits) {
    const file = path.join(sourceClientDir, e.rel);
    let src = readFileSync(file, "utf8");
    if (src.includes(e.guard)) continue; // already patched (idempotent)

    if (e.append) {
      src = src + snippet(e.append);
    } else {
      const find = e.findFile ? snippet(e.findFile) : e.find;
      const replace = e.replaceFile ? snippet(e.replaceFile) : e.replace;
      if (!src.includes(find)) {
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
    generatedDbFile,
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
  if (
    !serverIndex.includes("startCodexWatcher") ||
    !serverIndex.includes("importAllCodexSessions")
  ) {
    throw new Error(
      "Generated server/index.js is missing the Codex watcher/import wiring (Patch #5).",
    );
  }
  for (const m of CODEX_MODULES) {
    if (!existsSync(path.join(generatedRootDir, "server", "lib", `${m}.js`))) {
      throw new Error(
        `Generated server/lib/${m}.js missing (Codex Addition #6).`,
      );
    }
  }

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
    !serverIndex.includes('app.use("/api/plans", plansRouter)')
  ) {
    throw new Error(
      "Generated server/index.js is missing the /api/plans route wiring (FEA-1189).",
    );
  }
  const importHistorySource = readFileSync(generatedImportHistory, "utf8");
  if (!importHistorySource.includes("FEA-1189 plan extraction")) {
    throw new Error(
      "Generated scripts/import-history.js is missing the plan-capture sink (FEA-1189).",
    );
  }
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
