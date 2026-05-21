/**
 * @file PacksLayout.tsx — unified Packs page (FEA-1314 v3).
 *
 * The original v1/v2 layout split "Installed" and "Catalog" into two tabs.
 * v3 collapses to ONE grid sorted by:
 *   1. pin_order (closedloop-ai first)
 *   2. star count desc
 *   3. display name asc
 *
 * Installed vs not-installed status renders inline on each card. The
 * old PacksInstalled inventory view is preserved as a click-through from
 * each installed card's CatalogDetail modal — see the "Installed inventory"
 * section there.
 */
import { PacksCatalog } from "./PacksCatalog";

export function PacksLayout() {
  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-gray-100">Packs</h1>
        <p className="text-xs text-gray-500">
          Curated agent skill packs for Claude Code and Codex. Click any
          pack for its README, skill list, and install commands.
        </p>
      </div>
      <PacksCatalog />
    </div>
  );
}
