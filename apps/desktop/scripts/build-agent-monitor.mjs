// Builds the vendored Claude-Code-Agent-Monitor (vendor/agent-monitor) into a
// runtime-ready tree: server source + a built `client/dist/` + a prod-only,
// optional-free root `node_modules/`. Uses npm (upstream ships
// package-lock.json files); npm ignores the repo's pnpm-workspace.yaml, so the
// hardened root lockfile is never touched.
//
// This is a TWO-project build (root server + client Vite app) and it
// deliberately ships WITHOUT better-sqlite3 so server/db.js falls through to
// its node:sqlite (compat-sqlite.js) path — see vendor/agent-monitor/VENDOR.md.
//
// Hard gates (fail the build): vendor patches #1/#2 present; built client +
// server entry exist; better-sqlite3 absent from the shipped tree; the vendored
// compat-sqlite.js works under the Electron-as-Node runtime (when the Electron
// binary is resolvable — the #1 risk made a build gate).
//
// Idempotent: skips the expensive install/build when the three lockfiles +
// root package.json are unchanged and a prior build is present. Force with
// `--force` or AGENT_MONITOR_FORCE_BUILD=1.

import { spawnSync } from "node:child_process";
import { createHash as hash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(appDir, "../..");
const vendorDir = path.join(repoRoot, "vendor", "agent-monitor");
const clientDir = path.join(vendorDir, "client");

const force =
  process.argv.includes("--force") ||
  process.env.AGENT_MONITOR_FORCE_BUILD === "1";

const rootPkg = path.join(vendorDir, "package.json");
const rootLock = path.join(vendorDir, "package-lock.json");
const clientLock = path.join(clientDir, "package-lock.json");
const serverEntry = path.join(vendorDir, "server", "index.js");
const builtClientIndex = path.join(vendorDir, "client", "dist", "index.html");
const nodeModulesDir = path.join(vendorDir, "node_modules");
const stampFile = path.join(vendorDir, ".build-stamp");

if (!existsSync(rootPkg)) {
  throw new Error(
    `Vendored agent-monitor not found at ${vendorDir} (missing package.json).`,
  );
}

function currentStamp() {
  const h = hash("sha256");
  h.update(readFileSync(rootPkg));
  if (existsSync(rootLock)) h.update(readFileSync(rootLock));
  if (existsSync(clientLock)) h.update(readFileSync(clientLock));
  return h.digest("hex");
}

// --- Vendor patch guard (VENDOR.md risk #6): a future upstream re-copy that
// silently drops Patch #1/#2 must fail the build, not regress security. ---
function assertVendorPatches() {
  const src = readFileSync(serverEntry, "utf8");
  if (!src.includes('server.listen(port, "127.0.0.1"')) {
    throw new Error(
      "VENDOR PATCH #1 MISSING: vendor/agent-monitor/server/index.js must bind " +
        '127.0.0.1 (`server.listen(port, "127.0.0.1", ...)`). Re-apply per ' +
        "vendor/agent-monitor/VENDOR.md before building.",
    );
  }
  if (!src.includes('process.env.CCAM_AUTO_INSTALL_HOOKS === "1"')) {
    throw new Error(
      "VENDOR PATCH #2 MISSING: the silent installHooks() auto-install must be " +
        "gated behind CCAM_AUTO_INSTALL_HOOKS. Re-apply per VENDOR.md.",
    );
  }
  if (!existsSync(path.join(vendorDir, "scripts", "uninstall-hooks.js"))) {
    throw new Error(
      "VENDOR ADDITION #3 MISSING: vendor/agent-monitor/scripts/uninstall-hooks.js " +
        "is required for the consent-reversal path. Re-add per VENDOR.md.",
    );
  }
}

assertVendorPatches();

const stamp = currentStamp();

if (
  !force &&
  existsSync(builtClientIndex) &&
  existsSync(nodeModulesDir) &&
  existsSync(stampFile) &&
  readFileSync(stampFile, "utf8").trim() === stamp
) {
  console.log(
    "[build:agent-monitor] up to date — skipping (use --force to rebuild).",
  );
  process.exit(0);
}

function run(cmd, args, cwd) {
  console.log(`[build:agent-monitor] (${path.relative(repoRoot, cwd)}) ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(
        `\`${cmd}\` not found. Node.js (with npm) must be on PATH to build agent-monitor.`,
      );
    }
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// 1. Root runtime deps (pure JS: express/ws/cors/...).
run("npm", ["ci"], vendorDir);
// 2. Client: full install + Vite/TS build -> client/dist.
run("npm", ["ci"], clientDir);
run("npm", ["run", "build"], clientDir);
// 3. Reduce the root tree to the runtime closure and drop optionals
//    (better-sqlite3) so server/db.js uses the node:sqlite fallback.
run("npm", ["ci", "--omit=dev", "--omit=optional"], vendorDir);

// 3b. Belt-and-suspenders: never ship the native module even if an npm cache
//     quirk reinstalls it. node:sqlite is the only supported backend here.
const betterSqlite = path.join(nodeModulesDir, "better-sqlite3");
if (existsSync(betterSqlite)) {
  console.log(
    "[build:agent-monitor] stripping unexpected node_modules/better-sqlite3 " +
      "(node:sqlite fallback is the shipped backend).",
  );
  rmSync(betterSqlite, { recursive: true, force: true });
}

// 4. Artifact assertions.
if (!existsSync(builtClientIndex)) {
  throw new Error(
    `Build finished but ${builtClientIndex} is missing — upstream client build ` +
      "layout may have changed (see vendor/agent-monitor/VENDOR.md).",
  );
}
if (!existsSync(serverEntry)) {
  throw new Error(`Missing ${serverEntry} — vendored tree is incomplete.`);
}

// 5. SQLite gate (Phase 0 step 3): prove the vendored compat-sqlite.js works
//    under the Electron binary as Node. This is the project's #1 risk; when
//    Electron is resolvable, a failure here fails the build.
function resolveElectronBinary() {
  const dist = path.join(appDir, "node_modules", "electron", "dist");
  if (!existsSync(dist)) return null;
  for (const entry of readdirSync(dist)) {
    if (!entry.endsWith(".app")) continue;
    const macOs = path.join(dist, entry, "Contents", "MacOS");
    if (!existsSync(macOs)) continue;
    for (const exe of readdirSync(macOs)) {
      return path.join(macOs, exe);
    }
  }
  return null;
}

const electronBin = resolveElectronBinary();
if (!electronBin) {
  console.warn(
    "[build:agent-monitor] WARNING: Electron binary not found under " +
      "apps/desktop/node_modules/electron/dist — skipping the node:sqlite " +
      "build gate. The runtime sidecar + static wiring test + the " +
      "clean-machine DMG smoke test still cover this path.",
  );
} else {
  const probeDir = mkdtempSync(path.join(os.tmpdir(), "ccam-build-p0-"));
  const probe = `
    "use strict";
    const path = require("node:path");
    const Database = require(${JSON.stringify(path.join(vendorDir, "server", "compat-sqlite.js"))});
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
    "[build:agent-monitor] SQLite gate: running vendored compat-sqlite.js under Electron-as-Node…",
  );
  const result = spawnSync(electronBin, ["-e", probe], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
  });
  rmSync(probeDir, { recursive: true, force: true });
  if (result.status !== 0) {
    throw new Error(
      "SQLite BUILD GATE FAILED: vendored compat-sqlite.js (node:sqlite) did " +
        "not work under ELECTRON_RUN_AS_NODE. Do NOT ship. See the " +
        "better-sqlite3 Electron-prebuild fallback in vendor/agent-monitor/VENDOR.md.",
    );
  }
  console.log("[build:agent-monitor] SQLite gate: PASS.");
}

writeFileSync(stampFile, `${stamp}\n`);
console.log("[build:agent-monitor] done.");
