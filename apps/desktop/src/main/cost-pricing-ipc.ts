/**
 * FEA-1433: thin IPC binding for the Settings → Pricing surface.
 *
 *   desktop:list-unpriced-models  – GET /api/diagnostics/unpriced-models
 *   cost-pricing:add-rule         – PUT /api/pricing (Zod-validated payload)
 *
 * All logic lives in `cost-pricing-client.ts` (no electron import) so the
 * unit tests can exercise it under plain Node without spawning Electron.
 * This module exists only to wire the handlers to `ipcMain`.
 */
import { ipcMain } from "electron";
import {
  addPricingRule,
  fetchUnpricedModels,
  type AgentMonitorRef,
} from "./cost-pricing-client.js";

export function registerCostPricingIpc(agentMonitor: AgentMonitorRef): void {
  ipcMain.handle("desktop:list-unpriced-models", () =>
    fetchUnpricedModels(agentMonitor),
  );
  ipcMain.handle("cost-pricing:add-rule", (_event, payload: unknown) =>
    addPricingRule(agentMonitor, payload),
  );
}
