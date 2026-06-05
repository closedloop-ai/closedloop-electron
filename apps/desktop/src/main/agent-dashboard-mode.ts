import type { SettingsStore } from "./settings-store.js";

/**
 * Labs flag that opts into the in-process design-system Agent Dashboard when
 * the broader Agent Monitor feature remains enabled.
 */
export const AGENT_DASHBOARD_DESIGN_SYSTEM_FLAG =
  "agentDashboardDesignSystemEnabled";

/**
 * Boot-owned dashboard runtime mode. Only `design-system` may load the
 * in-process database, app:// renderer, design preload, listeners, or collectors.
 */
export type AgentDashboardMode = "disabled" | "legacy" | "design-system";

/**
 * Resolve the boot-owned Agent Dashboard mode from persisted feature flags.
 *
 * The design-system flag is strict on purpose: only the literal boolean `true`
 * opts into the in-process runtime. Missing, false, or tampered non-boolean
 * values keep the default legacy sidecar experience.
 */
export function resolveAgentDashboardMode(
  settingsStore: Pick<SettingsStore, "getAgentMonitorEnabled" | "getFlag">,
): AgentDashboardMode {
  if (!settingsStore.getAgentMonitorEnabled()) {
    return "disabled";
  }

  return settingsStore.getFlag(AGENT_DASHBOARD_DESIGN_SYSTEM_FLAG) === true
    ? "design-system"
    : "legacy";
}

/**
 * Narrow an already-resolved dashboard mode to the design-system runtime branch.
 */
export function isDesignSystemDashboardMode(
  mode: AgentDashboardMode,
): mode is "design-system" {
  return mode === "design-system";
}
