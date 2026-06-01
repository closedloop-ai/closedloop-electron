import { ActivityItem, AlwaysAllowRule, Approval, CliTool, FeatureFlag, FilterField, Job, LogEntry, Metric, PackDetail, PackInstallRun, Pack, Plan, PolicyOverride, PullRequestSession, PullRequest, EndpointConfig, RelaySettings, ImportHistoryItem, MaintenanceAction, NotificationPreference, RuntimePricingDraft, RuntimePricingRule, SystemStatusItem, SandboxPolicy, SavedConfigStatus, SavedConfig, SecurityKey, SecurityPosture, DashboardSeriesPoint, SessionOverviewStats, SessionRow, ShellRecord, Skill, SubagentDispatch, TabItem, ToolEvent, ToolFacet, WorkflowData, WorkflowSessionDrillIn } from './types.js';
import 'lucide-react';
import 'react';

declare const tabs: TabItem[];
declare const metrics: Metric[];
declare const series: DashboardSeriesPoint[];
declare const filters: FilterField[];
declare const sessions: SessionRow[];
declare const sessionControls: {
    title: string;
    countLabel: string;
    isLive: true;
    liveLabel: string;
    offlineLabel: string;
    searchPlaceholder: string;
    searchValue: string;
    directoryValue: string;
    directoryOptions: {
        value: string;
        label: string;
    }[];
    harnessValue: string;
    harnessOptions: {
        value: string;
        label: string;
    }[];
    statusValue: string;
    statusOptions: {
        value: string;
        label: string;
    }[];
    sortValue: string;
    sortOptions: {
        value: string;
        label: string;
    }[];
    sortDescending: true;
    refreshLabel: string;
};
declare const sessionsPagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
};
declare const activities: ActivityItem[];
declare const activityFeedFilters: {
    query: string;
    from: string;
    to: string;
    statuses: string[];
    eventTypes: string[];
    toolNames: string[];
    agents: {
        id: string;
        label: string;
    }[];
    sessions: {
        id: string;
        label: string;
    }[];
};
declare const activityFeedFacets: {
    statuses: string[];
    eventTypes: string[];
    toolNames: string[];
    agents: {
        id: string;
        label: string;
    }[];
    sessions: {
        value: string;
        label: string;
    }[];
};
declare const activityFeedEvents: {
    id: string;
    sessionId: string;
    agentId: string;
    agentLabel: string;
    project: string;
    eventType: string;
    status: string;
    toolName: string;
    title: string;
    summary: string;
    createdAt: string;
    metadata: {
        label: string;
        value: string;
    }[];
    detail: {
        fields: {
            key: string;
            label: string;
            value: string;
        }[];
    };
}[];
declare const runSessionRecord: {
    handle: {
        id: string;
        title: string;
        promptPreview: string;
        status: "running";
        mode: "conversation";
        cwd: string;
        model: string;
        permissionMode: string;
        startedAt: string;
        sessionId: string;
    };
    transcript: {
        id: string;
        label: string;
        agentLabel: string;
        status: "working";
        totalMessages: number;
        hasMoreHistory: true;
        newMessagesAvailable: true;
        messages: ({
            id: string;
            role: "user";
            author: string;
            createdAt: string;
            content: string;
            blocks?: undefined;
        } | {
            id: string;
            role: "assistant";
            author: string;
            createdAt: string;
            content: string;
            blocks: ({
                type: "text";
                text: string;
                id?: undefined;
                name?: undefined;
                input?: undefined;
                output?: undefined;
            } | {
                type: "tool_use";
                id: string;
                name: string;
                input: {
                    command: string;
                };
                text?: undefined;
                output?: undefined;
            } | {
                type: "tool_result";
                id: string;
                output: string;
                text?: undefined;
                name?: undefined;
                input?: undefined;
            })[];
        } | {
            id: string;
            role: "assistant";
            author: string;
            createdAt: string;
            content: string;
            blocks: ({
                type: "thinking";
                text: string;
            } | {
                type: "text";
                text: string;
            })[];
        })[];
        envelopes: ({
            id: string;
            type: "system";
            createdAt: string;
            model: string;
            cwd: string;
            permissionMode: string;
            sessionId: string;
            author?: undefined;
            content?: undefined;
            usage?: undefined;
            streaming?: undefined;
            durationMs?: undefined;
            turns?: undefined;
            costUsd?: undefined;
            result?: undefined;
        } | {
            id: string;
            type: "user";
            author: string;
            createdAt: string;
            content: {
                type: "text";
                text: string;
            }[];
            model?: undefined;
            cwd?: undefined;
            permissionMode?: undefined;
            sessionId?: undefined;
            usage?: undefined;
            streaming?: undefined;
            durationMs?: undefined;
            turns?: undefined;
            costUsd?: undefined;
            result?: undefined;
        } | {
            id: string;
            type: "assistant";
            author: string;
            createdAt: string;
            content: ({
                type: "text";
                text: string;
                id?: undefined;
                name?: undefined;
                input?: undefined;
            } | {
                type: "tool_use";
                id: string;
                name: string;
                input: {
                    command: string;
                };
                text?: undefined;
            })[];
            usage: {
                outputTokens: number;
                inputTokens?: undefined;
            };
            model?: undefined;
            cwd?: undefined;
            permissionMode?: undefined;
            sessionId?: undefined;
            streaming?: undefined;
            durationMs?: undefined;
            turns?: undefined;
            costUsd?: undefined;
            result?: undefined;
        } | {
            id: string;
            type: "user";
            author: string;
            createdAt: string;
            content: {
                type: "tool_result";
                id: string;
                output: string;
            }[];
            model?: undefined;
            cwd?: undefined;
            permissionMode?: undefined;
            sessionId?: undefined;
            usage?: undefined;
            streaming?: undefined;
            durationMs?: undefined;
            turns?: undefined;
            costUsd?: undefined;
            result?: undefined;
        } | {
            id: string;
            type: "assistant";
            author: string;
            createdAt: string;
            streaming: true;
            content: ({
                type: "thinking";
                text: string;
            } | {
                type: "text";
                text: string;
            })[];
            usage: {
                inputTokens: number;
                outputTokens: number;
            };
            model?: undefined;
            cwd?: undefined;
            permissionMode?: undefined;
            sessionId?: undefined;
            durationMs?: undefined;
            turns?: undefined;
            costUsd?: undefined;
            result?: undefined;
        } | {
            id: string;
            type: "result";
            createdAt: string;
            durationMs: number;
            turns: number;
            costUsd: number;
            result: string;
            model?: undefined;
            cwd?: undefined;
            permissionMode?: undefined;
            sessionId?: undefined;
            author?: undefined;
            content?: undefined;
            usage?: undefined;
            streaming?: undefined;
        })[];
    };
    followUp: string;
    tokenUsage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
        contextWindow: number;
    };
    result: {
        durationLabel: string;
        turns: number;
        costUsd: number;
    };
};
declare const shellRecord: ShellRecord;
declare const runtimePricingDraft: RuntimePricingDraft;
declare const runtimePricingRules: RuntimePricingRule[];
declare const runtimeNotifications: NotificationPreference[];
declare const runtimeSystemStatus: SystemStatusItem[];
declare const runtimeMaintenanceActions: MaintenanceAction[];
declare const runtimeImportHistory: ImportHistoryItem[];
declare const cliTools: CliTool[];
declare const settingsMetrics: Metric[];
declare const jobs: Job[];
declare const approvals: Approval[];
declare const securityKeys: SecurityKey[];
declare const featureFlags: FeatureFlag[];
declare const savedConfigs: SavedConfig[];
declare const savedConfigStatus: SavedConfigStatus;
declare const logs: LogEntry[];
declare const plans: Plan[];
declare const toolFacets: ToolFacet[];
declare const toolEvents: ToolEvent[];
declare const skills: Skill[];
declare const subagentDispatches: SubagentDispatch[];
declare const pullRequests: PullRequest[];
declare const pullRequestSessions: PullRequestSession[];
declare const packs: Pack[];
declare const packDetail: PackDetail;
declare const relayEndpoints: EndpointConfig[];
declare const relaySettings: RelaySettings;
declare const policyOverrides: PolicyOverride[];
declare const alwaysAllowRules: AlwaysAllowRule[];
declare const securityPosture: SecurityPosture[];
declare const sandboxPolicy: SandboxPolicy;
declare const packInstallRun: PackInstallRun;
declare const sessionOverviewStats: SessionOverviewStats;
declare const sessionConversationTranscript: {
    id: string;
    label: string;
    agentId: string;
    agentLabel: string;
    status: string;
    totalMessages: number;
    hasMoreHistory: boolean;
    refreshing: boolean;
    messages: ({
        id: string;
        role: string;
        author: string;
        createdAt: string;
        content: string;
        blocks: {
            type: string;
            text: string;
        }[];
        model?: undefined;
        usage?: undefined;
        toolName?: undefined;
    } | {
        id: string;
        role: string;
        author: string;
        createdAt: string;
        content: string;
        model: string;
        usage: {
            inputTokens: number;
            outputTokens: number;
        };
        blocks: {
            type: string;
            text: string;
        }[];
        toolName?: undefined;
    } | {
        id: string;
        role: string;
        author: string;
        toolName: string;
        createdAt: string;
        content: string;
        blocks: ({
            type: string;
            id: string;
            name: string;
            input: {
                file_path: string;
                offset: number;
                limit: number;
            };
            output?: undefined;
        } | {
            type: string;
            id: string;
            output: string;
            name?: undefined;
            input?: undefined;
        })[];
        model?: undefined;
        usage?: undefined;
    })[];
    newMessagesAvailable?: undefined;
} | {
    id: string;
    label: string;
    agentId: string;
    agentLabel: string;
    status: string;
    totalMessages: number;
    newMessagesAvailable: boolean;
    messages: {
        id: string;
        role: string;
        author: string;
        createdAt: string;
        content: string;
        blocks: {
            type: string;
            text: string;
        }[];
    }[];
    hasMoreHistory?: undefined;
    refreshing?: undefined;
};
declare const sessionEventFacets: {
    statuses: string[];
    eventTypes: string[];
    toolNames: string[];
    agents: {
        id: string;
        label: string;
    }[];
};
declare const sessionEventFilters: {
    query: string;
    from: string;
    to: string;
    statuses: string[];
    eventTypes: string[];
    toolNames: string[];
    agents: {
        id: string;
        label: string;
    }[];
};
declare const workflowData: WorkflowData;
declare const workflowSessionDrillIn: WorkflowSessionDrillIn;

export { activities, activityFeedEvents, activityFeedFacets, activityFeedFilters, alwaysAllowRules, approvals, cliTools, featureFlags, filters, jobs, logs, metrics, packDetail, packInstallRun, packs, plans, policyOverrides, pullRequestSessions, pullRequests, relayEndpoints, relaySettings, runSessionRecord, runtimeImportHistory, runtimeMaintenanceActions, runtimeNotifications, runtimePricingDraft, runtimePricingRules, runtimeSystemStatus, sandboxPolicy, savedConfigStatus, savedConfigs, securityKeys, securityPosture, series, sessionControls, sessionConversationTranscript, sessionEventFacets, sessionEventFilters, sessionOverviewStats, sessions, sessionsPagination, settingsMetrics, shellRecord, skills, subagentDispatches, tabs, toolEvents, toolFacets, workflowData, workflowSessionDrillIn };
