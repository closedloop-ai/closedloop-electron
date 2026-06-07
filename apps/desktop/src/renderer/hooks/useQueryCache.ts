import { useEffect, useRef, useState } from "react";

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Simple in-memory query cache with TTL. Multiple components using the same
 * key share a single cached result and avoid redundant IPC round-trips.
 *
 * @param key    Stable cache key (e.g. "db:analytics")
 * @param fetcher  Async function that returns the data
 * @param ttlMs    How long the cached value is considered fresh (default 3 000 ms)
 * @param pollMs   Re-fetch interval; skipped while the cached value is fresh (default 5 000 ms)
 */
export function useQueryCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = 3_000,
  pollMs = 5_000,
): { data: T | null; loading: boolean; error: boolean } {
  const [data, setData] = useState<T | null>(() => {
    const cached = cache.get(key) as CacheEntry<T> | undefined;
    return cached ? cached.data : null;
  });
  const [loading, setLoading] = useState(data === null);
  const [error, setError] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let mounted = true;

    const load = () => {
      const existing = cache.get(key) as CacheEntry<T> | undefined;
      if (existing && Date.now() - existing.fetchedAt < ttlMs) {
        if (mounted) {
          setData(existing.data);
          setLoading(false);
        }
        return;
      }

      // No fresh cache hit; set loading so the consumer can render a loading
      // state instead of displaying stale data from a previous key.
      if (mounted) setLoading(true);

      fetcherRef.current()
        .then((result) => {
          cache.set(key, { data: result, fetchedAt: Date.now() });
          if (mounted) {
            setData(result);
            setLoading(false);
            setError(false);
          }
        })
        .catch(() => {
          if (mounted) {
            setLoading(false);
            setError(true);
          }
        });
    };

    load();
    const interval = setInterval(load, pollMs);

    // Live updates: the main process pushes desktop:db:changed after each
    // processed hook event. For DB-backed keys, drop the cached value and
    // reload immediately so a new session/event appears without waiting for
    // the next poll tick.
    let unsubscribe: (() => void) | undefined;
    if (key.startsWith("db:") && typeof window !== "undefined" && window.desktopApi?.onDbChanged) {
      unsubscribe = window.desktopApi.onDbChanged(() => {
        cache.delete(key);
        load();
      });
    }

    return () => {
      mounted = false;
      clearInterval(interval);
      unsubscribe?.();
    };
  }, [key, ttlMs, pollMs]);

  return { data, loading, error };
}

/** Invalidate a specific cache key (e.g. after a mutation). */
export function invalidateCache(key: string): void {
  cache.delete(key);
}

/** Invalidate all cache keys matching a prefix. */
export function invalidateCachePrefix(prefix: string): void {
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}
