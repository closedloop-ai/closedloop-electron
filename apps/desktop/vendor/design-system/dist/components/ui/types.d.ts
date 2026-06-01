import { LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';

declare const SESSION_STATUS: {
    readonly ACTIVE: "active";
    readonly WAITING: "waiting";
    readonly COMPLETED: "completed";
    readonly ERROR: "error";
    readonly ABANDONED: "abandoned";
};
type Harness = "claude" | "codex" | "cursor" | "copilot" | "opencode" | (string & {});
type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];
declare const AGENT_STATUS: {
    readonly WORKING: "working";
    readonly WAITING: "waiting";
    readonly COMPLETED: "completed";
    readonly ERROR: "error";
    readonly IDLE: "idle";
};
type AgentStatus = (typeof AGENT_STATUS)[keyof typeof AGENT_STATUS];
declare const TONE: {
    readonly DEFAULT: "default";
    readonly SUCCESS: "success";
    readonly WARNING: "warning";
    readonly DANGER: "danger";
    readonly INFO: "info";
    readonly ACCENT: "accent";
    readonly MUTED: "muted";
};
type Tone = (typeof TONE)[keyof typeof TONE];
type Metric = {
    label: string;
    value: string | number;
    detail?: string;
    trend?: string;
    raw?: string;
    icon?: LucideIcon;
};
type TabItem = {
    value: string;
    label: string;
    count?: number;
    icon?: LucideIcon;
};
type FilterOption = {
    label: string;
    value: string;
};
type FilterField = {
    id: string;
    label: string;
    value: string;
    options: FilterOption[];
};
type SessionRow = {
    id: string;
    name: string;
    repo: string;
    model: string;
    harness: Harness;
    status: SessionStatus | string;
    startedAt: string;
    lastActivity: string;
    cost: number;
    agents: number;
    totalTokens?: number | null;
    durationLabel?: string;
    isRunDriven?: boolean;
    runHref?: string;
    awaitingInputSince?: string | null;
};
type SessionControls = {
    title?: string;
    countLabel?: string;
    isLive?: boolean;
    liveLabel?: string;
    offlineLabel?: string;
    searchPlaceholder?: string;
    searchValue?: string;
    directoryValue?: string;
    directoryOptions: FilterOption[];
    harnessValue?: string;
    harnessOptions: FilterOption[];
    statusValue?: string;
    statusOptions: FilterOption[];
    sortValue?: string;
    sortOptions: FilterOption[];
    sortDescending?: boolean;
    refreshLabel?: string;
};
type PaginationState = {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
};
type KanbanView = "agents" | "sessions";
type ActivityItem = {
    id: string;
    method: string;
    title: string;
    badge: string;
    tone: Tone;
    time: string;
    summary: string;
    session?: string;
    details?: {
        label: string;
        value: string;
    }[];
};
type RunStatus = "idle" | "spawning" | "running" | "completed" | "error" | "killed" | "abandoned";
type RunMode = "conversation" | "headless";
type RunSummary = {
    id: string;
    title: string;
    promptPreview: string;
    status: RunStatus;
    mode: RunMode;
    cwd: string;
    model?: string | null;
    permissionMode: string;
    startedAt: string;
    endedAt?: string | null;
    sessionId?: string | null;
};
type RunComposer = {
    mode: RunMode;
    source: "fresh" | "resume";
    prompt: string;
    cwd: string;
    model: string;
    permissionMode: string;
    effort?: string;
    resumeSessionLabel?: string;
    slashCommands: Array<{
        name: string;
        description: string;
        source: "builtin" | "user" | "project";
    }>;
};
type RunSessionRecord = {
    handle: RunSummary;
    transcript: ConversationTranscript;
    followUp?: string;
    tokenUsage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
        contextWindow: number;
    };
    result?: {
        durationLabel: string;
        turns: number;
        costUsd: number;
    };
};
type CcScope = "all" | "user" | "project";
type CcTabKey = "overview" | "skills" | "agents" | "commands" | "outputStyles" | "plugins" | "marketplaces" | "mcp" | "hooks" | "keybindings" | "settings" | "memory";
type CcCounts = {
    skills: {
        user: number;
        project: number;
    };
    agents: {
        user: number;
        project: number;
    };
    commands: {
        user: number;
        project: number;
    };
    outputStyles: {
        user: number;
        project: number;
    };
    plugins: number;
    marketplaces: number;
    mcpServers: {
        user: number;
        project: number;
    };
    hooks: Record<string, number>;
    keybindings: number;
    settingsFiles: number;
    memory: number;
};
type CcRoot = {
    label: string;
    value: string;
};
type CcArtifact = {
    id: string;
    name: string;
    scope: "user" | "project";
    path: string;
    description?: string;
    tags?: string[];
    updatedAt?: string;
};
type CcPlugin = {
    id: string;
    name: string;
    version: string;
    enabled: boolean;
    installPath: string;
    author?: string;
    license?: string;
    homepage?: string;
    contributes: Array<{
        label: string;
        count: number;
    }>;
};
type CcMarketplace = {
    id: string;
    name: string;
    source: string;
    owner?: string;
    pluginCount: number;
    updatedAt?: string;
};
type CcMcpServer = {
    id: string;
    name: string;
    scope: "user" | "project";
    transport: "command" | "http";
    command?: string;
    args?: string[];
    url?: string;
    headers?: Array<{
        label: string;
        value: string;
    }>;
    env?: Array<{
        label: string;
        value: string;
    }>;
};
type CcHookSource = {
    id: string;
    path: string;
    missing?: boolean;
    hooks: Array<{
        event: string;
        matcher?: string;
        command: string;
    }>;
};
type CcHookScript = {
    id: string;
    path: string;
    command: string;
};
type CcKeybindingGroup = {
    id: string;
    context: string;
    bindings: Array<{
        key: string;
        command: string;
    }>;
};
type CcSettingsSource = {
    id: string;
    label: string;
    path: string;
    missing?: boolean;
    summary: Array<{
        label: string;
        value: string;
    }>;
};
type CcStatusline = {
    configured: boolean;
    configPath?: string;
    scripts: Array<{
        id: string;
        path: string;
    }>;
};
type CcMemoryItem = {
    id: string;
    scope: "user" | "project";
    path: string;
    preview: string;
    missing?: boolean;
};
declare const CLI_TOOL_STATE: {
    readonly CHECKING: "checking";
    readonly DETECTED: "detected";
    readonly CUSTOM: "custom";
    readonly INVALID: "invalid";
    readonly MISSING: "missing";
};
type CliToolState = (typeof CLI_TOOL_STATE)[keyof typeof CLI_TOOL_STATE];
type CliTool = {
    id: string;
    name: string;
    description: string;
    path: string;
    hint: string;
    state: CliToolState;
};
type DashboardSeriesPoint = {
    label: string;
    sessions: number;
    events: number;
};
type DashboardLabelValue = {
    label: string;
    value: string;
    detail?: string;
    tone?: Tone;
};
type DashboardHealthRecord = {
    runtime: Metric[];
    storage: {
        totalLabel: string;
        breakdown: Array<{
            label: string;
            value: number;
            color: string;
        }>;
        details: DashboardLabelValue[];
    };
    healthScore: {
        value: number;
        factors: DashboardLabelValue[];
    };
    tokenUsage: Array<{
        label: string;
        value: number;
        color: string;
    }>;
    concurrency: WorkflowConcurrencyData;
    toolUsage: Array<{
        name: string;
        count: number;
    }>;
    effectiveness: WorkflowEffectivenessItem[];
    integrations: DashboardLabelValue[];
    platform: DashboardLabelValue[];
};
type PanelAction = {
    label: string;
    icon?: LucideIcon;
};
type HeaderProps = {
    title: string;
    description?: string;
    eyebrow?: string;
    actions?: ReactNode;
};
type Job = {
    id: string;
    command: string;
    label: string;
    status: string;
    startedAt: string;
    updatedAt?: string;
    repoPath?: string;
    phase?: string;
};
type ApprovalAction = "approve" | "deny" | "always-allow";
type Approval = {
    id: string;
    title: string;
    risk: "low" | "medium" | "high";
    status: "pending" | "approved" | "denied" | "expired" | "always-allow";
    reason: string;
    scope: string;
    createdAt: string;
};
type SecurityKey = {
    id: string;
    ownerName: string;
    ownerEmail?: string;
    fingerprint: string;
    state: "authorized" | "pending";
};
type FeatureFlag = {
    id: string;
    label: string;
    description: string;
    source: "default" | "user" | "env";
    enabled: boolean;
};
type SavedConfig = {
    id: string;
    name: string;
    hasApiKey: boolean;
    active?: boolean;
};
type SavedConfigStatus = {
    tone: "success" | "warning" | "error";
    message: string;
};
type LogEntry = {
    id: string;
    timestamp: string;
    level: "info" | "warn" | "error";
    tag: string;
    message: string;
    previousSession?: boolean;
};
type PlanVersion = {
    id: string;
    version: number;
    content: string;
    createdAt: string;
};
type Plan = {
    id: string;
    title: string;
    status: string;
    harness: Harness;
    captureMethod: string;
    confidence: number;
    needsConfirmation?: boolean;
    updatedAt: string;
    sessionId: string;
    planFile?: string;
    logFile?: string;
    versions: PlanVersion[];
};
type ToolFacet = {
    id: string;
    name: string;
    count: number;
    lastSeen?: string;
};
type ToolEvent = {
    id: string;
    type: string;
    summary: string;
    createdAt: string;
    sessionId: string;
};
type SkillInvocation = {
    id: string;
    sessionName: string;
    harness?: Harness;
    model?: string;
    cwd?: string;
    createdAt: string;
};
type Skill = {
    id: string;
    name: string;
    pack: string;
    harness: Harness;
    version?: string;
    description?: string;
    invocationCount: number;
    lastInvokedAt?: string;
    invocations: SkillInvocation[];
};
type SubagentDispatch = {
    id: string;
    name: string;
    type: string;
    status: string;
    task?: string;
    sessionId: string;
    startedAt: string;
    endedAt?: string;
};
type PullRequest = {
    id: string;
    repo: string;
    number: number;
    title?: string;
    url?: string;
    branch?: string;
    harness: Harness;
    state?: "open" | "merged" | "closed";
    author?: string;
    observedAt: string;
};
type PullRequestSession = {
    id: string;
    sessionName: string;
    startedAt: string;
    cwd?: string;
    harness: Harness;
    pullRequests: PullRequest[];
};
type EndpointConfig = {
    label: string;
    value: string;
};
type RelaySettings = {
    targetId: string;
    relayOrigin: string;
    apiOrigin: string;
    webAppOrigin: string;
    apiKeyStatus: string;
    debugTokenStatus?: string;
    metrics: Metric[];
    endpoints: EndpointConfig[];
};
type ShellNavItem = {
    id: string;
    label: string;
    href: string;
    icon: LucideIcon;
    badge?: string | number;
    active?: boolean;
};
type ShellConnectionEvent = {
    type: string;
    at: string;
};
type ShellConnectionSummary = {
    connected: boolean;
    connectedSince?: string | null;
    eventCount: number;
    peakPerSecond: number;
    lastEvent?: ShellConnectionEvent | null;
    recentEvents: ShellConnectionEvent[];
};
type ShellUpdateStatus = {
    state: "idle" | "checking" | "available" | "up-to-date" | "error";
    label: string;
    detail?: string;
};
type ShellLanguageOption = {
    code: string;
    label: string;
    active?: boolean;
};
type ShellRecord = {
    title: string;
    productLabel?: string;
    embedded?: boolean;
    collapsed?: boolean;
    navItems: ShellNavItem[];
    connection: ShellConnectionSummary;
    update: ShellUpdateStatus;
    languages: ShellLanguageOption[];
};
type RuntimePricingRule = {
    id: string;
    modelPattern: string;
    displayName: string;
    inputPerMillion: number;
    outputPerMillion: number;
    cacheReadPerMillion: number;
    cacheWritePerMillion: number;
    updatedAt?: string;
};
type RuntimePricingDraft = Omit<RuntimePricingRule, "id" | "updatedAt">;
type NotificationPreference = {
    id: string;
    label: string;
    description?: string;
    enabled: boolean;
};
type SystemStatusItem = {
    label: string;
    value: string;
    detail?: string;
    tone?: Tone;
    icon?: LucideIcon;
};
type MaintenanceAction = {
    id: string;
    label: string;
    description: string;
    buttonLabel: string;
    tone?: Tone;
    danger?: boolean;
};
type ImportHistoryItem = {
    id: string;
    filename: string;
    importedAt: string;
    sessions: number;
    events: number;
    status: "complete" | "partial" | "failed";
};
type PolicyOverride = {
    operationId: string;
    tier: "high" | "medium" | "low" | "none";
};
type AlwaysAllowRule = {
    id: string;
    operationId: string;
    method: string;
    path: string;
    scopePath?: string;
    expiresAt: string;
};
type SecurityPosture = {
    id: string;
    label: string;
    value: string;
    detail: string;
    tone: "success" | "warning" | "danger";
};
type SandboxPolicy = {
    allowedRoot?: string;
    warning?: string;
    deniedPaths: string[];
};
type PackUsage = {
    toolCalls: number;
    sessions: number;
    firstUsedAt?: string | null;
    lastUsedAt?: string | null;
};
type Pack = {
    id: string;
    displayName: string;
    category?: string;
    description?: string;
    stars?: number;
    harnesses: Harness[];
    installedHarnesses: Harness[];
    installedSkillCount: number;
    usageCount?: number;
    githubUrl?: string;
    marketplaceUrl?: string;
    placeholderReason?: string;
    installNotes?: string;
    projectScoped?: boolean;
    singleInstall?: boolean;
    uninstalledAt?: string | null;
    usage?: PackUsage | null;
    history?: Array<{
        label: string;
        stars: number | null;
        forks?: number | null;
    }>;
};
type PackInstall = {
    harness: Harness;
    path: string;
    kind: "symlink" | "directory";
    version?: string;
};
type PackInstallCommand = {
    harness: Harness;
    command: string;
    installed?: boolean;
    actionLabel?: string;
    commandIsAutoDetect?: boolean;
};
type PackContentItem = {
    name: string;
    kind: "skill" | "command" | "agent" | "plugin";
    description?: string | null;
    category?: string | null;
    path?: string | null;
    skillCount?: number;
    skills?: string[];
};
type PackPostInstall = {
    title: string;
    body: string;
    copyCommand?: string;
    url?: string;
    required?: boolean;
};
type PackInstallRun = {
    action: "install" | "uninstall";
    harness: Harness;
    command: string;
    projectScoped?: boolean;
    commandIsAutoDetect?: boolean;
    state: "preview" | "running" | "complete";
    exitCode?: number;
    reason?: string;
    lines?: string[];
    projectOptions?: string[];
    selectedProject?: string;
    postInstall?: PackPostInstall | null;
};
type PackDetail = {
    pack: Pack;
    verified?: boolean;
    githubUrl?: string;
    marketplaceUrl?: string;
    readme?: string | null;
    installCommands: PackInstallCommand[];
    installs: PackInstall[];
    skills: string[];
    contents?: PackContentItem[];
    sessions: SessionRow[];
};
type WorkflowStats = {
    totalSessions: number;
    totalAgents: number;
    totalSubagents: number;
    avgSubagents: number;
    successRate: number;
    avgDepth: number;
    avgDurationSec: number;
    totalCompactions: number;
    avgCompactions: number;
    topFlow: {
        source: string;
        target: string;
        count: number;
    } | null;
};
type WorkflowOrchestrationEdge = {
    source: string;
    target: string;
    weight: number;
};
type WorkflowOrchestrationData = {
    sessionCount: number;
    mainCount: number;
    subagentTypes: Array<{
        subagentType: string;
        count: number;
        completed: number;
        errors: number;
    }>;
    edges: WorkflowOrchestrationEdge[];
    outcomes: Array<{
        status: string;
        count: number;
    }>;
    compactions: {
        total: number;
        sessions: number;
    };
};
type WorkflowToolFlowData = {
    transitions: Array<{
        source: string;
        target: string;
        value: number;
    }>;
    toolCounts: Array<{
        toolName: string;
        count: number;
    }>;
};
type WorkflowEffectivenessItem = {
    subagentType: string;
    total: number;
    completed: number;
    errors: number;
    sessions: number;
    successRate: number;
    avgDuration: number | null;
    trend: number[];
};
type WorkflowPattern = {
    steps: string[];
    count: number;
    percentage: number;
};
type WorkflowPatternsData = {
    patterns: WorkflowPattern[];
    soloSessionCount: number;
    soloPercentage: number;
};
type WorkflowModelDelegationData = {
    mainModels: Array<{
        model: string;
        agentCount: number;
        sessionCount: number;
    }>;
    subagentModels: Array<{
        model: string;
        agentCount: number;
    }>;
    tokensByModel: Array<{
        model: string;
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
    }>;
};
type WorkflowErrorPropagationData = {
    byDepth: Array<{
        depth: number;
        count: number;
    }>;
    byType: Array<{
        subagentType: string;
        count: number;
    }>;
    eventErrors: Array<{
        summary: string;
        count: number;
    }>;
    sessionsWithErrors: number;
    totalSessions: number;
    errorRate: number;
};
type WorkflowConcurrencyLane = {
    name: string;
    avgStart: number;
    avgEnd: number;
    count: number;
};
type WorkflowConcurrencyData = {
    aggregateLanes: WorkflowConcurrencyLane[];
};
type WorkflowComplexityItem = {
    id: string;
    name: string | null;
    status: string;
    duration: number;
    agentCount: number;
    subagentCount: number;
    totalTokens: number;
    model: string | null;
};
type WorkflowCompactionImpactData = {
    totalCompactions: number;
    tokensRecovered: number;
    perSession: Array<{
        sessionId: string;
        compactions: number;
    }>;
    sessionsWithCompactions: number;
    totalSessions: number;
};
type WorkflowData = {
    stats: WorkflowStats;
    orchestration: WorkflowOrchestrationData;
    toolFlow: WorkflowToolFlowData;
    effectiveness: WorkflowEffectivenessItem[];
    patterns: WorkflowPatternsData;
    modelDelegation: WorkflowModelDelegationData;
    errorPropagation: WorkflowErrorPropagationData;
    concurrency: WorkflowConcurrencyData;
    complexity: WorkflowComplexityItem[];
    compaction: WorkflowCompactionImpactData;
    cooccurrence: Array<{
        source: string;
        target: string;
        weight: number;
    }>;
};
type WorkflowSessionDrillIn = {
    session: {
        id: string;
        name: string | null;
        status: string;
        cwd: string | null;
        model: string | null;
        startedAt: string;
        endedAt: string | null;
    };
    tree: Array<{
        id: string;
        name: string;
        type: string;
        subagentType: string | null;
        status: string;
        task: string | null;
        startedAt: string;
        endedAt: string | null;
        children: WorkflowSessionDrillIn["tree"];
    }>;
    toolTimeline: Array<{
        id: number;
        toolName: string;
        eventType: string;
        agentId: string | null;
        createdAt: string;
        summary: string | null;
    }>;
    swimLanes: Array<{
        id: string;
        name: string;
        type: string;
        subagentType: string | null;
        status: string;
        startedAt: string;
        endedAt: string | null;
        parentAgentId: string | null;
    }>;
    events: Array<{
        id: number;
        sessionId: string;
        agentId: string | null;
        eventType: string;
        toolName: string | null;
        summary: string | null;
        createdAt: string;
    }>;
};
type SessionOverviewStats = {
    totalEvents: number;
    toolCalls: number;
    subagents: number;
    compactions: number;
    errors: number;
    durationLabel: string;
    eventRateHint?: string;
    topTools: Array<{
        toolName: string;
        count: number;
    }>;
    subagentTypes: Array<{
        label: string;
        count: number;
        isCompaction?: boolean;
    }>;
    tokens: {
        cacheReadTokens: number;
        cacheWriteTokens: number;
        inputTokens: number;
        outputTokens: number;
    };
    eventMix: Array<{
        eventType: string;
        count: number;
    }>;
    activeAgent?: {
        name: string;
        currentTool?: string | null;
        task?: string | null;
    } | null;
};
type SessionAgent = {
    id: string;
    sessionId: string;
    name: string;
    type: "main" | "subagent";
    subagentType?: string | null;
    status: AgentStatus;
    task?: string | null;
    currentTool?: string | null;
    startedAt: string;
    updatedAt?: string | null;
    endedAt?: string | null;
    model?: string | null;
    cost?: number | null;
    label?: string | null;
    children?: SessionAgent[];
};
type SessionEvent = {
    id: string;
    sessionId: string;
    agentId?: string | null;
    agentLabel?: string | null;
    project?: string | null;
    eventType: string;
    status: AgentStatus;
    toolName?: string | null;
    title: string;
    summary?: string | null;
    createdAt: string;
    rawData?: string | null;
    metadata?: Array<{
        label: string;
        value: string;
    }>;
    detail?: EventDetail;
};
type SessionEventGroup = {
    id: string;
    title: string;
    durationLabel?: string;
    events: SessionEvent[];
};
type SessionEventFacets = {
    statuses: string[];
    eventTypes: string[];
    toolNames: string[];
    agents: Array<{
        id: string;
        label: string;
    }>;
};
type EventFilterSelection = {
    query?: string;
    from?: string;
    to?: string;
    statuses: string[];
    eventTypes: string[];
    toolNames: string[];
    agents: Array<{
        id: string;
        label: string;
    }>;
    sessions?: Array<{
        id: string;
        label: string;
    }>;
};
type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};
type EventDetailField = {
    key: string;
    label: string;
    value: JsonValue;
};
type EventDetail = {
    summary?: {
        headline: string;
        bullets?: string[];
    };
    fields: EventDetailField[];
};
type ConversationMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool";
    author: string;
    createdAt: string;
    content: string;
    toolName?: string | null;
    model?: string | null;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
    } | null;
    blocks?: ConversationContentBlock[];
};
type ConversationContentBlock = {
    type: "text";
    text: string;
} | {
    type: "thinking";
    text: string;
} | {
    type: "tool_use";
    id: string;
    name: string;
    input: JsonValue;
} | {
    type: "tool_result";
    id: string;
    output: JsonValue;
    isError?: boolean;
};
type ConversationEnvelope = {
    id: string;
    type: "user";
    createdAt?: string;
    author?: string;
    content: ConversationContentBlock[];
} | {
    id: string;
    type: "assistant";
    createdAt?: string;
    author?: string;
    content: ConversationContentBlock[];
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
        cacheReadTokens?: number;
        cacheCreationTokens?: number;
    } | null;
    streaming?: boolean;
} | {
    id: string;
    type: "system";
    createdAt?: string;
    subtype?: string;
    sessionId?: string;
    model?: string;
    cwd?: string;
    tools?: string[];
    permissionMode?: string;
} | {
    id: string;
    type: "result";
    createdAt?: string;
    isError?: boolean;
    durationMs?: number;
    turns?: number;
    sessionId?: string;
    costUsd?: number;
    result?: string;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
    } | null;
} | {
    id: string;
    type: string;
    createdAt?: string;
    data: JsonValue;
};
type ConversationTranscript = {
    id: string;
    label: string;
    agentId?: string | null;
    agentLabel?: string | null;
    status?: AgentStatus | null;
    messages: ConversationMessage[];
    envelopes?: ConversationEnvelope[];
    totalMessages?: number;
    hasMoreHistory?: boolean;
    loadingHistory?: boolean;
    refreshing?: boolean;
    newMessagesAvailable?: boolean;
};
type RawDashboardEvent = {
    id: number | string;
    session_id: string;
    agent_id: string | null;
    event_type: string;
    tool_name: string | null;
    summary: string | null;
    data: string | null;
    created_at: string;
};
type RawTranscriptContent = {
    type: "text" | "tool_use" | "tool_result" | "thinking";
    text?: string;
    name?: string;
    id?: string;
    input?: Record<string, unknown> | {
        _truncated: string;
    };
    output?: string;
    is_error?: boolean;
};
type RawTranscriptMessage = {
    type: "user" | "assistant";
    timestamp: string | null;
    content: RawTranscriptContent[];
    model?: string;
    usage?: {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
    };
};
type SessionDetailRecord = {
    session: SessionRow & {
        cwd: string;
        endedAt?: string | null;
        summary?: string;
    };
    overview: SessionOverviewStats;
    agents: SessionAgent[];
    eventFacets: SessionEventFacets;
    activeEventFilters?: EventFilterSelection;
    eventGroups: SessionEventGroup[];
    transcripts: ConversationTranscript[];
    activeTranscriptId?: string;
    activeAgentId?: string;
};
type ActivityFeedRecord = {
    title: string;
    description?: string;
    live?: boolean;
    paused?: boolean;
    bufferedCount?: number;
    grouped?: boolean;
    filters: EventFilterSelection;
    availableFilters?: SessionEventFacets & {
        sessions?: FilterOption[];
    };
    groupedEvents: SessionEventGroup[];
    flatEvents: SessionEvent[];
    pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages?: number;
    };
};
type AnalyticsMetricPoint = {
    label: string;
    value: number;
};
type AnalyticsHeatmapWeek = Array<{
    date: string;
    count: number;
}>;
type AnalyticsCostBreakdown = {
    label: string;
    cost: number;
    color: string;
};

export { AGENT_STATUS, type ActivityFeedRecord, type ActivityItem, type AgentStatus, type AlwaysAllowRule, type AnalyticsCostBreakdown, type AnalyticsHeatmapWeek, type AnalyticsMetricPoint, type Approval, type ApprovalAction, CLI_TOOL_STATE, type CcArtifact, type CcCounts, type CcHookScript, type CcHookSource, type CcKeybindingGroup, type CcMarketplace, type CcMcpServer, type CcMemoryItem, type CcPlugin, type CcRoot, type CcScope, type CcSettingsSource, type CcStatusline, type CcTabKey, type CliTool, type CliToolState, type ConversationContentBlock, type ConversationEnvelope, type ConversationMessage, type ConversationTranscript, type DashboardHealthRecord, type DashboardLabelValue, type DashboardSeriesPoint, type EndpointConfig, type EventDetail, type EventDetailField, type EventFilterSelection, type FeatureFlag, type FilterField, type FilterOption, type Harness, type HeaderProps, type ImportHistoryItem, type Job, type JsonValue, type KanbanView, type LogEntry, type MaintenanceAction, type Metric, type NotificationPreference, type Pack, type PackContentItem, type PackDetail, type PackInstall, type PackInstallCommand, type PackInstallRun, type PackPostInstall, type PackUsage, type PaginationState, type PanelAction, type Plan, type PlanVersion, type PolicyOverride, type PullRequest, type PullRequestSession, type RawDashboardEvent, type RawTranscriptContent, type RawTranscriptMessage, type RelaySettings, type RunComposer, type RunMode, type RunSessionRecord, type RunStatus, type RunSummary, type RuntimePricingDraft, type RuntimePricingRule, SESSION_STATUS, type SandboxPolicy, type SavedConfig, type SavedConfigStatus, type SecurityKey, type SecurityPosture, type SessionAgent, type SessionControls, type SessionDetailRecord, type SessionEvent, type SessionEventFacets, type SessionEventGroup, type SessionOverviewStats, type SessionRow, type SessionStatus, type ShellConnectionEvent, type ShellConnectionSummary, type ShellLanguageOption, type ShellNavItem, type ShellRecord, type ShellUpdateStatus, type Skill, type SkillInvocation, type SubagentDispatch, type SystemStatusItem, TONE, type TabItem, type Tone, type ToolEvent, type ToolFacet, type WorkflowCompactionImpactData, type WorkflowComplexityItem, type WorkflowConcurrencyData, type WorkflowConcurrencyLane, type WorkflowData, type WorkflowEffectivenessItem, type WorkflowErrorPropagationData, type WorkflowModelDelegationData, type WorkflowOrchestrationData, type WorkflowOrchestrationEdge, type WorkflowPattern, type WorkflowPatternsData, type WorkflowSessionDrillIn, type WorkflowStats, type WorkflowToolFlowData };
