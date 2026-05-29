/**
 * IPC wiring for FEA-1435 cost reconciliation. Lives in its own module so the
 * 3600+ line app.ts doesn't grow another 200 lines, and so the Zod payload
 * validation lives close to the handlers it protects.
 *
 * Channel naming follows the `cost-reconciliation:*` namespace agreed in the
 * FEA-1435 plan rather than the generic `desktop:*` prefix used by older IPC.
 *
 * Per the "Boundary Validation" CLAUDE.md learning, every payload that crosses
 * the IPC boundary is validated with Zod before it reaches the store or the
 * worker.
 */

import type { IpcMain } from "electron";
import { z } from "zod";
import type { AnthropicAdminKeyStore } from "./anthropic-admin-key-store.js";
import type { OpenAIAdminKeyStore } from "./openai-admin-key-store.js";
import type { ReconciliationWorker } from "./reconciliation-worker.js";
import type { SettingsStore } from "./settings-store.js";
import { gatewayLog } from "./gateway-logger.js";

const SetKeySchema = z.object({
  key: z.string().min(1).max(512),
});

const SetEnabledSchema = z.object({
  enabled: z.boolean(),
});

export interface CostReconciliationIpcDeps {
  anthropicKeyStore: AnthropicAdminKeyStore;
  openaiKeyStore: OpenAIAdminKeyStore;
  worker: ReconciliationWorker;
  settingsStore: SettingsStore;
  /**
   * Called when the user enables reconciliation or saves a new key, so the
   * worker can re-initialize without an app restart.
   */
  reinitWorker: () => void;
}

export function registerCostReconciliationIpc(
  ipcMain: IpcMain,
  deps: CostReconciliationIpcDeps,
): void {
  ipcMain.handle("cost-reconciliation:get-anthropic-key-status", () =>
    deps.anthropicKeyStore.getStatus(),
  );

  ipcMain.handle("cost-reconciliation:set-anthropic-key", async (_event, payload) => {
    const parsed = SetKeySchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, error: "invalid_payload" };
    }
    try {
      const outcome = await deps.anthropicKeyStore.validateAndPersist(parsed.data.key);
      if (!outcome.ok) {
        // Generic error code only — no key contents, no upstream body.
        gatewayLog.warn(
          "cost-reconciliation",
          `anthropic key validation failed code=${outcome.error}`,
        );
        return { success: false, error: outcome.error };
      }
      deps.reinitWorker();
      return { success: true };
    } catch {
      // Catch-all so a stray throw never echoes the key.
      return { success: false, error: "network" };
    }
  });

  ipcMain.handle("cost-reconciliation:clear-anthropic-key", () => {
    deps.anthropicKeyStore.clear();
    deps.reinitWorker();
    return { success: true };
  });

  ipcMain.handle("cost-reconciliation:get-openai-key-status", () =>
    deps.openaiKeyStore.getStatus(),
  );

  ipcMain.handle("cost-reconciliation:set-openai-key", async (_event, payload) => {
    const parsed = SetKeySchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, error: "invalid_payload" };
    }
    try {
      const outcome = await deps.openaiKeyStore.validateAndPersist(parsed.data.key);
      if (!outcome.ok) {
        gatewayLog.warn(
          "cost-reconciliation",
          `openai key validation failed code=${outcome.error}`,
        );
        return { success: false, error: outcome.error };
      }
      deps.reinitWorker();
      return { success: true };
    } catch {
      return { success: false, error: "network" };
    }
  });

  ipcMain.handle("cost-reconciliation:clear-openai-key", () => {
    deps.openaiKeyStore.clear();
    deps.reinitWorker();
    return { success: true };
  });

  ipcMain.handle("cost-reconciliation:trigger-run", async () => {
    return deps.worker.runNow();
  });

  ipcMain.handle("cost-reconciliation:get-status", () => {
    const status = deps.worker.getStatus();
    return {
      ...status,
      enabled: deps.settingsStore.getReconciliationEnabled(),
      intervalHours: deps.settingsStore.getReconciliationIntervalHours(),
    };
  });

  ipcMain.handle("cost-reconciliation:set-enabled", (_event, payload) => {
    const parsed = SetEnabledSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, enabled: deps.settingsStore.getReconciliationEnabled() };
    }
    deps.settingsStore.setReconciliationEnabled(parsed.data.enabled);
    deps.reinitWorker();
    return { success: true, enabled: parsed.data.enabled };
  });
}
