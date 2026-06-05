/**
 * @file ingest-paths.ts
 * @description Pure path helpers for durable collector ingest state — the
 * persisted per-source catchup caches and the OpenCode DB fingerprint
 * (FEA-1503; ported from the vendor `ingest-paths.js`). Unlike the vendor module
 * (which read `DASHBOARD_DB_PATH` from the now-removed sidecar env), these take
 * the state directory explicitly; the CollectorManager derives it from
 * `app.getPath("userData")/agent-monitor` so caches sit beside the in-process DB.
 */
import path from "node:path";

export const INGEST_STATE_VERSION = 2;

/** Absolute path to the persisted catchup cache for a named source. */
export function ingestCachePath(stateDir: string, name: string): string {
  return path.join(stateDir, `ingest-cache-${name}.json`);
}

/** Absolute path to the OpenCode DB fingerprint file (single-DB high-water-mark). */
export function ingestOpencodeFingerprintPath(stateDir: string): string {
  return path.join(stateDir, "ingest-opencode-fingerprint.txt");
}
