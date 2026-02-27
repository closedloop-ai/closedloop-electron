export const DEFAULT_GATEWAY_PORT = 19432;
export const FALLBACK_GATEWAY_PORTS = [19433, 19434, 19435] as const;
export const PORT_PROBE_ORDER = [DEFAULT_GATEWAY_PORT, ...FALLBACK_GATEWAY_PORTS] as const;
export const DESKTOP_GATEWAY_VERSION = "0.1.0";

export const DEFAULT_API_ORIGIN = "https://api.symphony.com";
export const DEFAULT_WEB_APP_ORIGIN = "https://app.symphony.com";

export type CapabilityToolName = "claude" | "codex" | "git" | "gh" | "python3";

export interface ComputeTargetCapabilities {
  tools: Record<CapabilityToolName, boolean>;
  versions: Partial<Record<CapabilityToolName, string>>;
}

export const EMPTY_CAPABILITIES: ComputeTargetCapabilities = {
  tools: {
    claude: false,
    codex: false,
    git: false,
    gh: false,
    python3: false
  },
  versions: {}
};

export interface HealthResponse {
  status: "ok";
  machineName: string;
  capabilities: ComputeTargetCapabilities;
  version: string;
  port: number;
}

export type RiskTier = "auto" | "low" | "medium" | "high";

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
  allowedDirectories: string[];
  autoApprovalRules: Record<string, RiskTier>;
  alwaysAllowRules: AlwaysAllowRule[];
  sandboxBaseDirectory: string;
  onboardingCompleted: boolean;
  cloudCommandsPaused: boolean;
  cloudConnectionEnabled: boolean;
  defaultApprovalTier: RiskTier;
  apiOrigin: string;
  webAppOrigin: string;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  allowedDirectories: [],
  autoApprovalRules: {},
  alwaysAllowRules: [],
  sandboxBaseDirectory: "",
  onboardingCompleted: false,
  cloudCommandsPaused: false,
  cloudConnectionEnabled: true,
  defaultApprovalTier: "high",
  apiOrigin: DEFAULT_API_ORIGIN,
  webAppOrigin: DEFAULT_WEB_APP_ORIGIN
};
