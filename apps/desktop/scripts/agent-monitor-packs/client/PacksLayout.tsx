/**
 * @file PacksLayout.tsx — Packs landing page.
 *
 * `/packs` shows the scanner-backed installed inventory first (or an explicit
 * empty state when nothing is detected yet), then the broader discovery
 * catalog beneath it.
 */
import { PacksCatalog } from "./PacksCatalog";

export function PacksLayout() {
  return (
    <div>
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
