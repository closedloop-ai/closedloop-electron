/**
 * @file Packs.tsx — top-level Packs page. Refactored by FEA-1314 from a
 * monolithic inventory view into a tabbed shell. The shell (PacksLayout)
 * picks between PacksInstalled (FEA-1224 inventory) and PacksCatalog
 * (FEA-1314 discovery). This file stays as the upstream-routed entry point.
 */
import { PacksLayout } from "./PacksLayout";

export function Packs() {
  return <PacksLayout />;
}
