/**
 * @file Packs.tsx — top-level Packs page entry point.
 *
 * The routed page lives in PacksLayout, which renders the installed-inventory
 * section/empty state first and the broader discovery catalog beneath it.
 */
import { PacksLayout } from "./PacksLayout";

export function Packs() {
  return <PacksLayout />;
}
