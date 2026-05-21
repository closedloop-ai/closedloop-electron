/**
 * @file PacksLayout.tsx — tab shell for the Packs page (FEA-1314).
 * Two tabs: "Installed" (the FEA-1224 inventory view) and "Catalog" (the
 * FEA-1314 discovery view). Default tab is Catalog when no packs are
 * installed locally (FTUE), Installed otherwise. Selection persists in
 * sessionStorage so a refresh doesn't bounce the user.
 */
import { useEffect, useState } from "react";
import { PacksInstalled } from "./PacksInstalled";
import { PacksCatalog } from "./PacksCatalog";

type Tab = "installed" | "catalog";
const STORAGE_KEY = "packs-tab";

export function PacksLayout() {
  const [tab, setTab] = useState<Tab>("installed");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let stored: Tab | null = null;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw === "installed" || raw === "catalog") stored = raw;
    } catch {
      /* sessionStorage unavailable */
    }
    if (stored) {
      setTab(stored);
      setHydrated(true);
      return;
    }
    // FTUE heuristic: empty Installed -> default to Catalog
    fetch("/api/packs")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => {
        const empty = !Array.isArray(data.items) || data.items.length === 0;
        setTab(empty ? "catalog" : "installed");
      })
      .catch(() => {
        setTab("installed");
      })
      .finally(() => setHydrated(true));
  }, []);

  const switchTo = (next: Tab) => {
    setTab(next);
    try {
      window.sessionStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-gray-100">Packs</h1>
        <p className="text-xs text-gray-500">
          Installed agent skill packs and a discovery catalog of popular ones.
        </p>
      </div>

      <div className="mb-4 flex items-center gap-1 border-b border-border">
        <TabButton active={tab === "installed"} onClick={() => switchTo("installed")}>
          Installed
        </TabButton>
        <TabButton active={tab === "catalog"} onClick={() => switchTo("catalog")}>
          Catalog
        </TabButton>
      </div>

      {hydrated && tab === "installed" && <PacksInstalled />}
      {hydrated && tab === "catalog" && <PacksCatalog />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
        active
          ? "text-gray-100 border-accent"
          : "text-gray-500 border-transparent hover:text-gray-300"
      }`}
    >
      {children}
    </button>
  );
}
