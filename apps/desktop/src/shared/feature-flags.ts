/**
 * Feature flag registry — single source of truth for all boolean feature flags.
 *
 * Adding a new flag: append an entry to FEATURE_FLAGS. The key must match the
 * corresponding field on DesktopSettings in contracts.ts. The registry drives
 * the Feature Flags settings panel and the generic getFlag/setFlag accessors
 * in settings-store.ts.
 */

export interface FlagDefinition {
  key: string;
  default: boolean;
  label: string;
  description: string;
  category: "Cloud" | "Diagnostics" | "Experimental" | "Labs" | "Security";
  /** If true, flag requires an app restart to take full effect. */
  requiresRestart?: boolean;
  /** Env var that overrides the persisted value when set to "1"/"0"/"true"/"false". */
  envOverride?: string;
}

const FEATURE_FLAGS_INTERNAL = [
  {
    key: "agentMonitorEnabled" as const,
    default: true,
    label: "Agent Dashboard",
    description:
      "Runs the local Agent Dashboard sidecar that powers the Dashboard and agent views in the sidebar.",
    category: "Diagnostics" as const,
    requiresRestart: true,
  },
  {
    key: "agentDashboardDesignSystemEnabled" as const,
    default: false,
    label: "Agent Dashboard Design System",
    description:
      "Use the in-process design-system Agent Dashboard instead of the legacy sidecar dashboard.",
    category: "Labs" as const,
    requiresRestart: true,
  },
  {
    key: "planExtractionEnabled" as const,
    default: false,
    label: "Plan Extraction",
    description:
      "Host-owned opt-in for Plans / plan extraction UI in the embedded Agent Dashboard.",
    category: "Experimental" as const,
  },
  {
    key: "commandSigningEnforcementEnabled" as const,
    default: false,
    label: "Trusted Browser Enforcement",
    description:
      "Requires browser commands to carry an approved signing key before execution.",
    category: "Security" as const,
  },
  {
    key: "cloudConnectionEnabled" as const,
    default: true,
    label: "Cloud Connection",
    description:
      "Enables the Socket.IO relay connection to the ClosedLoop cloud control plane.",
    category: "Cloud" as const,
  },
  {
    key: "cloudCommandsPaused" as const,
    default: false,
    label: "Pause Remote Commands",
    description:
      "Pauses execution of cloud-dispatched commands while keeping the relay connection alive.",
    category: "Cloud" as const,
  },
  {
    key: "updateAndRestartEnabled" as const,
    default: false,
    label: "Auto-Update & Restart",
    description:
      "Automatically download and install updates, then restart the app.",
    category: "Experimental" as const,
  },
  {
    key: "agentSessionChunkedSyncEnabled" as const,
    default: false,
    label: "Chunked Session Sync",
    description:
      "Splits oversized agent sessions into multiple smaller batches for sync. Enable after the relay supports chunked ingestion.",
    category: "Experimental" as const,
  },
] as const;

export type FlagKey = (typeof FEATURE_FLAGS_INTERNAL)[number]["key"];

export const FEATURE_FLAGS: readonly FlagDefinition[] = FEATURE_FLAGS_INTERNAL;

export function getFlagDefinition(key: FlagKey): FlagDefinition {
  const def = FEATURE_FLAGS.find((f) => f.key === key);
  if (!def) {
    throw new Error(`Unknown feature flag: ${key}`);
  }
  return def;
}

/** All flag keys as a Set for runtime membership checks. */
export const FLAG_KEYS: ReadonlySet<string> = new Set(
  FEATURE_FLAGS.map((f) => f.key),
);
