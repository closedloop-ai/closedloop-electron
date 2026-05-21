#!/usr/bin/env node
/**
 * @file reset-dashboard-db.mjs — wipe the Agent Dashboard sidecar's local DB.
 *
 * Two modes:
 *   (default)     full wipe — removes dashboard.db + dashboard.db-wal/-shm.
 *                 Loses sessions, events, agents, plans, AND pack inventory.
 *                 Use for first-time-user-experience (FTUE) testing.
 *   --packs-only  wipe only the pack inventory tables
 *                 (agent_packs, skills, project_pack_associations).
 *                 Preserves sessions, events, agents, plans. Use when
 *                 iterating on the scanner.
 *
 * The Electron sidecar must be STOPPED before running this — node:sqlite
 * locks the DB file. The script will refuse with a clear message if the
 * sidecar is still running (port 4820 is bound).
 *
 * Cross-platform DB path resolution mirrors `app.getPath("userData")` from
 * the Electron main process — see apps/desktop/CLAUDE.md "Agent Monitor
 * Sidecar" section for the canonical location.
 */
import { existsSync, rmSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import net from "node:net";

const PACKS_ONLY = process.argv.includes("--packs-only");
const APP_NAME = "ClosedLoop";

function dashboardDbPath() {
  switch (platform()) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", APP_NAME, "agent-monitor", "dashboard.db");
    case "win32":
      return join(
        process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
        APP_NAME,
        "agent-monitor",
        "dashboard.db",
      );
    default:
      return join(homedir(), ".config", APP_NAME, "agent-monitor", "dashboard.db");
  }
}

async function sidecarIsRunning(port = 4820) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: "127.0.0.1", timeout: 200 }, () => {
      sock.end();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    sock.on("timeout", () => {
      sock.destroy();
      resolve(false);
    });
  });
}

async function main() {
  const dbPath = dashboardDbPath();

  if (await sidecarIsRunning()) {
    console.error(
      "[reset-dashboard-db] Sidecar is running on 127.0.0.1:4820 — stop the\n" +
        "ClosedLoop app first (Cmd-Q the tray icon) so the DB is unlocked.",
    );
    process.exit(1);
  }

  if (!existsSync(dbPath)) {
    console.log(`[reset-dashboard-db] No DB at ${dbPath} — nothing to do.`);
    return;
  }

  if (PACKS_ONLY) {
    // Open via node:sqlite (built-in, same path the sidecar uses) and run
    // DELETE on just the three inventory tables. Refuse to run on older
    // Node — the previous fallback silently wiped the WHOLE DB (sessions,
    // events, agents, plans), which was actively dangerous because the
    // command name `--packs-only` promised the opposite. (shafty PR review
    // P2.)
    let DatabaseSync;
    try {
      ({ DatabaseSync } = await import("node:sqlite"));
    } catch (e) {
      console.error(
        "[reset-dashboard-db] --packs-only requires Node >=22.5 (node:sqlite\n" +
          "  built-in module). Refusing to widen this into a full DB wipe.\n" +
          "  Upgrade Node or run `pnpm -C apps/desktop dashboard:reset`\n" +
          "  if you explicitly want the full FTUE reset. Reason:",
        e && e.message,
      );
      process.exit(2);
    }
    const db = new DatabaseSync(dbPath);
    try {
      for (const t of ["agent_packs", "skills", "project_pack_associations"]) {
        try {
          db.exec(`DELETE FROM ${t};`);
          console.log(`[reset-dashboard-db] cleared ${t}`);
        } catch (e) {
          console.warn(`[reset-dashboard-db] could not clear ${t}:`, e && e.message);
        }
      }
    } finally {
      db.close();
    }
    console.log("[reset-dashboard-db] Pack inventory wiped. Restart the sidecar to rescan.");
    return;
  }

  removeAll(dbPath);
  console.log(
    "[reset-dashboard-db] Full DB wiped. Next sidecar boot starts at FTUE state.",
  );
}

function removeAll(dbPath) {
  for (const ext of ["", "-wal", "-shm"]) {
    const f = dbPath + ext;
    if (existsSync(f)) {
      rmSync(f, { force: true });
      console.log(`[reset-dashboard-db] removed ${f}`);
    }
  }
}

main().catch((err) => {
  console.error("[reset-dashboard-db] failed:", err);
  process.exit(1);
});
