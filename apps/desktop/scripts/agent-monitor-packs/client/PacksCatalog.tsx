/**
 * @file PacksCatalog.tsx — discovery catalog of popular agent packs
 * (FEA-1314 / PLN-657). Card grid sorted installed-first, then by star
 * count. Manual refresh button hits /api/catalog/refresh.
 */
import { useCallback, useEffect, useState } from "react";
import { CatalogCard, type CatalogEntry } from "./CatalogCard";

export function PacksCatalog() {
  const [items, setItems] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/catalog");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetch("/api/catalog/refresh", { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  const installedCount = items.filter((i) => i.installed_harnesses.length > 0).length;
  const totalStars = items.reduce((s, i) => s + (i.stars || 0), 0);

  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <p className="text-xs text-gray-500">
          {items.length === 0
            ? "Loading catalog…"
            : `${items.length} popular agent packs · ${installedCount} installed · ${totalStars.toLocaleString()} combined stars on GitHub`}
        </p>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="text-[11px] rounded border border-border bg-surface-2 text-gray-300 px-2.5 py-1 hover:bg-surface-3 disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh GitHub data"}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-500 italic">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-500 italic">
          Catalog is empty. This is unexpected — the seed should have been
          applied at startup. Check sidecar logs for errors and try{" "}
          <code className="mx-1">/api/catalog/refresh</code>.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {items.map((pack) => (
            <CatalogCard key={pack.pack_id} pack={pack} onAfterRun={load} />
          ))}
        </div>
      )}
    </div>
  );
}
