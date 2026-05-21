export const DEFAULT_GATEWAY_PORT = 19432;
export const FALLBACK_GATEWAY_PORTS = [19433, 19434, 19435] as const;
export const PORT_PROBE_ORDER = [DEFAULT_GATEWAY_PORT, ...FALLBACK_GATEWAY_PORTS] as const;
export const GATEWAY_PROTOCOL_VERSION = "0.1.0";

/**
 * Fixed loopback port for the generated Agent Monitor sidecar. It MUST be fixed
 * (not an ephemeral free port like the gateway) because Claude Code hooks bake
 * a port at install time and the hook handler POSTs to
 * `127.0.0.1:${CLAUDE_DASHBOARD_PORT || 4820}` — 4820 is upstream's own default,
 * so hooks work with zero per-hook env. Outside PORT_PROBE_ORDER, so it never
 * collides with the gateway's port selection.
 */
export const AGENT_MONITOR_PORT = 4820;

export const COMMAND_SIGNING_REJECTION_REASONS = {
  noKeysAuthorized: "unauthorized: no keys authorized",
  unsignedCommand: "unauthorized: unsigned command",
  unknownSigningKey: "unauthorized: unknown signing key",
  invalidSignature: "unauthorized: invalid signature",
  staleOrReplayedCommand: "unauthorized: stale or replayed command",
  payloadMismatch: "unauthorized: payload_mismatch"
} as const;

export type CommandSigningRejectionReason =
  (typeof COMMAND_SIGNING_REJECTION_REASONS)[keyof typeof COMMAND_SIGNING_REJECTION_REASONS];

export const BROWSER_COMMAND_KEY_REVOKE_OPERATION_ID =
  "browser_key_revoke";
export const BROWSER_COMMAND_KEY_REVOKE_PATH =
  "/api/gateway/internal/browser-key/revoke";
export const BROWSER_COMMAND_KEY_REVOKE_METHOD = "POST";
export const BROWSER_COMMAND_KEY_REVOKE_INVALID_REASON =
  "invalid browser command key revocation payload";
export const BROWSER_COMMAND_KEY_APPROVAL_REQUEST_OPERATION_ID =
  "browser_key_approval_request";
export const BROWSER_COMMAND_KEY_APPROVAL_REQUEST_PATH =
  "/api/gateway/internal/browser-key/approval-request";
export const BROWSER_COMMAND_KEY_APPROVAL_REQUEST_METHOD = "POST";
export const BROWSER_COMMAND_KEY_APPROVAL_REQUEST_INVALID_REASON =
  "invalid browser command key approval request payload";

/** WebSocket relay host — the electron app connects here for cloud commands, not the REST API. */
export const DEFAULT_RELAY_ORIGIN = process.env.CL_RELAY_ORIGIN ?? "https://relay.closedloop.ai";
export const DEFAULT_WEB_APP_ORIGIN = process.env.CL_WEB_APP_ORIGIN ?? "https://app.closedloop.ai";
/** REST API origin — used for auth verification and other REST calls (not the Socket.IO relay). */
export const DEFAULT_AUTH_API_ORIGIN = process.env.CL_AUTH_API_ORIGIN ?? "https://api.closedloop.ai";

export type CapabilityToolName = "claude" | "codex" | "git" | "gh" | "python3";

export interface ComputeTargetCapabilities {
  tools: Record<CapabilityToolName, boolean>;
  versions: Partial<Record<CapabilityToolName, string>>;
  /** Desktop can verify browser-origin Ed25519 command signatures. */
  commandSigning?: boolean;
  /** Desktop requires browser-origin Ed25519 command signatures for cloud commands. */
  commandSigningRequired?: boolean;
  /** Desktop supports the loop runner token-refresh protocol. */
  loopRunnerRefreshSupported?: boolean;
  /** Desktop supports the loop runner heartbeat protocol. */
  loopRunnerHeartbeatSupported?: boolean;
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
  commandSigning: true
};

export interface HealthResponse {
  status: "ok";
  machineName: string;
  capabilities: ComputeTargetCapabilities;
  version: string;
  port: number;
  /** Stable Desktop gateway identity used to match this local app to cloud compute targets. */
  gatewayId?: string;
  /** True once this desktop profile has completed setup and can accept cloud commands. */
  onboardingCompleted?: boolean;
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

export interface SavedConfig {
  id: string;
  name: string;
  relayOrigin: string;
  apiOrigin: string;
  webAppOrigin: string;
  // cloudApiKey is NOT stored here -- stored encrypted in ApiKeyStore keyed by profile UUID
  /** Provenance of the encrypted API key stored for this profile. Missing values migrate as USER_CREATED. */
  apiKeySource?: "USER_CREATED" | "DESKTOP_MANAGED";
  /** Desktop-managed gateway identity scoped to this saved profile. */
  gatewayId?: string;
  /** Public half of the profile-scoped Ed25519 PoP keypair. */
  gatewayPublicKeyPem?: string;
  /** Security-upgrade protocol version supported by this profile identity. */
  desktopSecurityUpgradeProtocolVersion?: 1;
  /** Last relay compute target observed for this profile. */
  lastComputeTargetId?: string | null;
  /** One-time Settings prompt dismissal scoped to this profile. */
  desktopSecurityPromptDismissedAt?: string | null;
  /** Pending managed onboarding attempt scoped to this profile, if any. */
  pendingOnboardingAttemptId?: string | null;
}

export interface DesktopSettings {
  autoApprovalRules: Record<string, RiskTier>;
  alwaysAllowRules: AlwaysAllowRule[];
  sandboxBaseDirectory: string;
  onboardingCompleted: boolean;
  /** Permanent dismissal of the onboarding reminder popup. Session dismissals are not persisted. */
  onboardingPopupDismissedPermanent: boolean;
  cloudCommandsPaused: boolean;
  cloudConnectionEnabled: boolean;
  /** Enables the Claude Dashboard sidecar/tab. Off by default. */
  agentMonitorEnabled: boolean;
  /** Host-owned opt-in for Plans / plan extraction UI in the embedded Agent Dashboard. */
  planExtractionEnabled: boolean;
  /** Desktop-local opt-in that requires trusted browser command signatures. */
  commandSigningEnforcementEnabled: boolean;
  defaultApprovalTier: RiskTier;
  relayOrigin: string;
  apiOrigin: string;
  webAppOrigin: string;
  verboseLogging: boolean;
  binaryPaths?: {
    claude?: string;
    gh?: string;
    codex?: string;
    python3?: string;
    git?: string;
  };
  savedConfigs: SavedConfig[];
  activeConfigId: string | null;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  autoApprovalRules: {},
  alwaysAllowRules: [],
  sandboxBaseDirectory: "",
  onboardingCompleted: false,
  onboardingPopupDismissedPermanent: false,
  cloudCommandsPaused: false,
  cloudConnectionEnabled: true,
  agentMonitorEnabled: false,
  planExtractionEnabled: false,
  commandSigningEnforcementEnabled: false,
  defaultApprovalTier: "high",
  relayOrigin: DEFAULT_RELAY_ORIGIN,
  apiOrigin: DEFAULT_AUTH_API_ORIGIN,
  webAppOrigin: DEFAULT_WEB_APP_ORIGIN,
  verboseLogging: false,
  binaryPaths: {},
  savedConfigs: [],
  activeConfigId: null
};
