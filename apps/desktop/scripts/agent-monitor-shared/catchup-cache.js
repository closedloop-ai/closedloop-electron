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
 * Cache is per-process and best-effort: a process restart costs one full
 * re-parse on the next tick, which is fine because the host (server/index.js
 * boot path) already does a startup import.
 */
const fs = require("fs");

function createCatchupCache() {
  /** @type {Map<string, { mtimeMs: number, size: number }>} */
  const seen = new Map();

  /**
   * Returns true if the file has not changed since the last time it was
   * marked seen. A missing or unreadable file is treated as "not seen" so
   * the caller can decide to skip it on its own (parse usually returns null).
   */
  function isUnchanged(filePath) {
    const cached = seen.get(filePath);
    if (!cached) return false;
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return false;
    }
    return cached.mtimeMs === stat.mtimeMs && cached.size === stat.size;
  }

  /**
   * Record the current (mtime, size) for a file so a subsequent
   * isUnchanged() call can short-circuit.
   */
  function markSeen(filePath) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }
    seen.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size });
  }

  /**
   * Drop cache entries for paths not in the current listing, so a cache
   * doesn't grow unbounded as old sessions are archived or deleted.
   */
  function pruneTo(currentPaths) {
    const keep = new Set(currentPaths);
    for (const key of seen.keys()) {
      if (!keep.has(key)) seen.delete(key);
    }
  }

  function size() {
    return seen.size;
  }

  function clear() {
    seen.clear();
  }

  return { isUnchanged, markSeen, pruneTo, size, clear };
}

module.exports = { createCatchupCache };
