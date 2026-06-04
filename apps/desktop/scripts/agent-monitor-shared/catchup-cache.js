/**
 * @file catchup-cache.js
 * @description Per-file (mtime, size) cache shared by every non-Claude
 * harness importer. The catchup poll (currently 5 s) is a fs.watch
 * miss-fallback: without this cache it re-parses every rollout/transcript/
 * chat file on every tick, which on a developer with hundreds of historical
 * sessions burns ~500 ms of CPU per tick per watcher and grows RSS over
 * time (FEA-1316). With this cache, an unchanged file is skipped with one
 * stat() call.
 *
 * Persistence (FEA-1334): when constructed with a `persistPath`, the cache
 * loads its entries from a JSON file on startup and flushes them back on
 * demand. Without persistence the cache is per-process, so a process restart
 * costs one full re-parse of every historical file on the next boot import —
 * which is exactly the cold-start cost that grows as a user accumulates
 * sessions. A persisted cache survives the restart: the boot importer skips
 * unchanged files with a single stat() call instead of a full parse.
 * Persistence is best-effort — a missing or corrupt cache file simply starts
 * empty, and write failures are swallowed (the cache stays correct in memory).
 */
const fs = require("fs");
const path = require("path");

const PERSIST_VERSION = 1;

/**
 * @param {{ persistPath?: string }} [options]
 *   persistPath — absolute path to a JSON file used to persist cache entries
 *   across process restarts. When omitted the cache is in-memory only and
 *   behaves exactly as the original per-process FEA-1316 cache.
 */
function createCatchupCache(options = {}) {
  const persistPath =
    typeof options.persistPath === "string" && options.persistPath.length > 0
      ? options.persistPath
      : null;

  /** @type {Map<string, { mtimeMs: number, size: number }>} */
  const seen = new Map();
  let dirty = false;

  if (persistPath) {
    try {
      const parsed = JSON.parse(fs.readFileSync(persistPath, "utf8"));
      const entries = parsed && parsed.entries;
      if (entries && typeof entries === "object") {
        for (const [key, value] of Object.entries(entries)) {
          if (
            value &&
            typeof value.mtimeMs === "number" &&
            typeof value.size === "number"
          ) {
            seen.set(key, { mtimeMs: value.mtimeMs, size: value.size });
          }
        }
      }
    } catch {
      /* missing or corrupt cache file — start empty, non-fatal */
    }
  }

  /**
   * Returns { unchanged, stat }. When unchanged is false the caller should
   * process the file and then pass stat to markSeenWith() — this avoids a
   * re-stat race where the file is appended to between isUnchanged and
   * markSeen, causing the new content to be silently skipped.
   */
  function isUnchanged(filePath) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return { unchanged: false, stat: null };
    }
    const cached = seen.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return { unchanged: true, stat };
    }
    return { unchanged: false, stat };
  }

  /**
   * Record a previously-captured stat so a subsequent isUnchanged() call
   * can short-circuit. Prefer this over markSeen() to avoid TOCTOU races.
   */
  function markSeenWith(filePath, stat) {
    if (stat) {
      seen.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size });
      dirty = true;
    }
  }

  /**
   * Record the current (mtime, size) for a file. Only use when no prior
   * stat is available (e.g. startup seeding). Prefer markSeenWith().
   */
  function markSeen(filePath) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }
    seen.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size });
    dirty = true;
  }

  /**
   * Drop cache entries for paths not in the current listing, so a cache
   * doesn't grow unbounded as old sessions are archived or deleted.
   */
  function pruneTo(currentPaths) {
    const keep = new Set(currentPaths);
    for (const key of seen.keys()) {
      if (!keep.has(key)) {
        seen.delete(key);
        dirty = true;
      }
    }
  }

  /**
   * Persist the cache to disk if it changed since the last flush and a
   * persistPath was configured. Best-effort: write failures are swallowed.
   * No-op (and no disk write) when nothing changed — an unchanged catchup
   * tick costs zero IO here.
   */
  function flush() {
    if (!persistPath || !dirty) return;
    dirty = false;
    try {
      fs.mkdirSync(path.dirname(persistPath), { recursive: true });
      const entries = {};
      for (const [key, value] of seen) entries[key] = value;
      fs.writeFileSync(
        persistPath,
        JSON.stringify({ version: PERSIST_VERSION, entries }),
      );
    } catch {
      /* best-effort persistence — cache stays correct in memory */
    }
  }

  function size() {
    return seen.size;
  }

  function clear() {
    if (seen.size > 0) dirty = true;
    seen.clear();
  }

  return {
    isUnchanged,
    markSeen,
    markSeenWith,
    pruneTo,
    flush,
    size,
    clear,
    persisted: persistPath != null,
  };
}

module.exports = { createCatchupCache };
