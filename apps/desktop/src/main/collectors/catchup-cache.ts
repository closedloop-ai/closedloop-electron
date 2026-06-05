/**
 * @file catchup-cache.ts
 * @description Per-file (mtime, size) cache shared by every harness importer
 * (FEA-1503; ported from the vendor `catchup-cache.js`, logic preserved). The
 * boot import + catchup poll re-list files cheaply: an unchanged file is skipped
 * with one stat() call instead of a full parse. When constructed with a
 * `persistPath` the cache survives process restarts (best-effort JSON file), so a
 * cold-start boot import skips unchanged history with a single stat() each.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync, type Stats } from "node:fs";
import path from "node:path";

const PERSIST_VERSION = 1;

interface SeenEntry {
  mtimeMs: number;
  size: number;
}

export interface CatchupCache {
  isUnchanged(filePath: string): { unchanged: boolean; stat: Stats | null };
  markSeen(filePath: string): void;
  markSeenWith(filePath: string, stat: Stats | null): void;
  pruneTo(currentPaths: string[]): void;
  flush(): void;
  size(): number;
  clear(): void;
  readonly persisted: boolean;
}

export function createCatchupCache(options: { persistPath?: string } = {}): CatchupCache {
  const persistPath =
    typeof options.persistPath === "string" && options.persistPath.length > 0
      ? options.persistPath
      : null;

  const seen = new Map<string, SeenEntry>();
  let dirty = false;

  if (persistPath) {
    try {
      const parsed = JSON.parse(readFileSync(persistPath, "utf8")) as {
        entries?: Record<string, unknown>;
      };
      const entries = parsed && parsed.entries;
      if (entries && typeof entries === "object") {
        for (const [key, value] of Object.entries(entries)) {
          const v = value as Partial<SeenEntry> | null;
          if (v && typeof v.mtimeMs === "number" && typeof v.size === "number") {
            seen.set(key, { mtimeMs: v.mtimeMs, size: v.size });
          }
        }
      }
    } catch {
      /* missing or corrupt cache file — start empty, non-fatal */
    }
  }

  function isUnchanged(filePath: string): { unchanged: boolean; stat: Stats | null } {
    let stat: Stats;
    try {
      stat = statSync(filePath);
    } catch {
      return { unchanged: false, stat: null };
    }
    const cached = seen.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return { unchanged: true, stat };
    }
    return { unchanged: false, stat };
  }

  function markSeenWith(filePath: string, stat: Stats | null): void {
    if (stat) {
      seen.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size });
      dirty = true;
    }
  }

  function markSeen(filePath: string): void {
    let stat: Stats;
    try {
      stat = statSync(filePath);
    } catch {
      return;
    }
    seen.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size });
    dirty = true;
  }

  function pruneTo(currentPaths: string[]): void {
    const keep = new Set(currentPaths);
    for (const key of seen.keys()) {
      if (!keep.has(key)) {
        seen.delete(key);
        dirty = true;
      }
    }
  }

  function flush(): void {
    if (!persistPath || !dirty) return;
    dirty = false;
    try {
      mkdirSync(path.dirname(persistPath), { recursive: true });
      const entries: Record<string, SeenEntry> = {};
      for (const [key, value] of seen) entries[key] = value;
      writeFileSync(persistPath, JSON.stringify({ version: PERSIST_VERSION, entries }));
    } catch {
      /* best-effort persistence — cache stays correct in memory */
    }
  }

  function size(): number {
    return seen.size;
  }

  function clear(): void {
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
