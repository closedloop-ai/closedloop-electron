/**
 * @file ingest-paths.js
 * @description Resolves on-disk locations for agent-monitor ingest state
 * (persisted catchup caches — FEA-1334). The sidecar receives
 * `DASHBOARD_DB_PATH` (set by src/main/agent-monitor-sidecar.ts to
 * `<userData>/agent-monitor/dashboard.db`); the persisted caches live next to
 * that durable database so they share its lifecycle. When the env var is
 * absent (standalone runs, unit tests) we fall back to a temp directory so
 * callers never need a guard.
 */
const path = require("path");
const os = require("os");

/**
 * Directory that holds durable agent-monitor state. Mirrors the directory of
 * DASHBOARD_DB_PATH so persisted caches sit alongside dashboard.db.
 */
function ingestStateDir() {
  const dbPath = process.env.DASHBOARD_DB_PATH;
  if (typeof dbPath === "string" && dbPath.length > 0) {
    return path.dirname(dbPath);
  }
  return path.join(os.tmpdir(), "agent-monitor");
}

/**
 * Absolute path to the persisted catchup cache for a named harness/source
 * (e.g. "codex", "cursor", "copilot-chat", "copilot-cli"). One file per
 * source keeps pruneTo() correct — a shared file would let one harness's
 * prune drop another's entries.
 */
function ingestCachePath(name) {
  return path.join(ingestStateDir(), `ingest-cache-${name}.json`);
}

module.exports = { ingestStateDir, ingestCachePath };
