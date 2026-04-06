export const DEFAULT_GATEWAY_PORT = 19432;
export const FALLBACK_GATEWAY_PORTS = [19433, 19434, 19435] as const;
export const PORT_PROBE_ORDER = [DEFAULT_GATEWAY_PORT, ...FALLBACK_GATEWAY_PORTS] as const;
export const DESKTOP_GATEWAY_VERSION = "0.1.0";

/** WebSocket relay host — the electron app connects here for cloud commands, not the REST API. */
export const DEFAULT_RELAY_ORIGIN = process.env.CL_RELAY_ORIGIN ?? "https://relay.closedloop.ai";
export const DEFAULT_WEB_APP_ORIGIN = process.env.CL_WEB_APP_ORIGIN ?? "https://app.closedloop.ai";
/** REST API origin — used for auth verification and other REST calls (not the Socket.IO relay). */
export const DEFAULT_AUTH_API_ORIGIN = process.env.CL_AUTH_API_ORIGIN ?? "https://api.closedloop.ai";
export const DEFAULT_POSTHOG_HOST = process.env.CL_POSTHOG_HOST ?? "https://us.i.posthog.com";

export type CapabilityToolName = "claude" | "codex" | "git" | "gh" | "python3";
export type LoopProviderName = "claude" | "codex";

export interface ComputeTargetCapabilities {
  tools: Record<CapabilityToolName, boolean>;
  versions: Partial<Record<CapabilityToolName, string>>;
  supportedLoopProviders: LoopProviderName[];
}

export const EMPTY_CAPABILITIES: ComputeTargetCapabilities = {
  tools: {
    claude: false,
    codex: false,
    git: false,
    gh: false,
    python3: false
  },
  versions: {},
  supportedLoopProviders: []
};

export interface HealthResponse {
  status: "ok";
  machineName: string;
  capabilities: ComputeTargetCapabilities;
  version: string;
  port: number;
}

export type RiskTier = "none" | "low" | "medium" | "high";

export interface AlwaysAllowRule {
  id: string;
  operationId: string;
  method: string;
  path: string;
  scopePath?: string;
  createdAt: string;
  expiresAt: string;
}

export interface DesktopSettings {
  autoApprovalRules: Record<string, RiskTier>;
  alwaysAllowRules: AlwaysAllowRule[];
  sandboxBaseDirectory: string;
  onboardingCompleted: boolean;
  cloudCommandsPaused: boolean;
  cloudConnectionEnabled: boolean;
  defaultApprovalTier: RiskTier;
  relayOrigin: string;
  apiOrigin: string;
  webAppOrigin: string;
  verboseLogging: boolean;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  autoApprovalRules: {},
  alwaysAllowRules: [],
  sandboxBaseDirectory: "",
  onboardingCompleted: false,
  cloudCommandsPaused: false,
  cloudConnectionEnabled: true,
  defaultApprovalTier: "high",
  relayOrigin: DEFAULT_RELAY_ORIGIN,
  apiOrigin: DEFAULT_AUTH_API_ORIGIN,
  webAppOrigin: DEFAULT_WEB_APP_ORIGIN,
  verboseLogging: false
};
