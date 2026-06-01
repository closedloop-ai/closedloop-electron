import * as React from 'react';
import { SessionAgent, SessionOverviewStats, SessionEventFacets, SessionEventGroup, EventFilterSelection } from './types.js';
import 'lucide-react';

type SessionSummaryMetric = {
    label: string;
    value: string;
    detail?: string;
};
type SessionMetadataField = {
    label: string;
    value: string;
};
type SessionModelUsageRow = {
    model: string;
    inputTokens: string;
    outputTokens: string;
    cacheReadTokens: string;
    cacheWriteTokens: string;
    estimatedCost: string;
};
type SessionToolInvocationRow = {
    toolName: string;
    count: string;
    firstSeenAt: string;
    lastSeenAt: string;
};
type SessionErrorDetailRow = {
    id: string;
    eventType: string;
    createdAt: string;
    summary: string;
    rawData?: string | null;
};
type SessionSummaryMetricsProps = {
    metrics: SessionSummaryMetric[];
};
type SessionMetadataPanelProps = {
    metadata: SessionMetadataField[];
    details?: SessionMetadataField[];
};
type SessionModelUsageTableProps = {
    rows: SessionModelUsageRow[];
};
type SessionToolInvocationsPanelProps = {
    rows: SessionToolInvocationRow[];
};
type SessionErrorDetailsPanelProps = {
    errors: SessionErrorDetailRow[];
};
type JsonPanelProps = {
    title: string;
    description?: string;
    value?: string | null;
    emptyMessage?: string;
};
type SessionAgentsSectionProps = {
    agents: SessionAgent[];
    activeAgentId?: string;
};
type SessionTimelineSectionProps = {
    facets: SessionEventFacets;
    groups: SessionEventGroup[];
    activeFilters?: EventFilterSelection;
};
type SessionOverviewSectionProps = {
    stats: SessionOverviewStats;
};
declare function SessionSummaryMetrics({ metrics, }: SessionSummaryMetricsProps): React.JSX.Element;
declare function SessionMetadataPanel({ metadata, details, }: SessionMetadataPanelProps): React.JSX.Element;
declare function SessionAttributionPanel({ value, }: {
    value?: string | null;
}): React.JSX.Element;
declare function SessionModelUsageTable({ rows, }: SessionModelUsageTableProps): React.JSX.Element;
declare function SessionToolInvocationsPanel({ rows, }: SessionToolInvocationsPanelProps): React.JSX.Element;
declare function SessionErrorDetailsPanel({ errors, }: SessionErrorDetailsPanelProps): React.JSX.Element;
declare function SessionAgentsSection({ agents, activeAgentId, }: SessionAgentsSectionProps): React.JSX.Element;
declare function SessionTimelineSection({ facets, groups, activeFilters, }: SessionTimelineSectionProps): React.JSX.Element;
declare function SessionOverviewSection({ stats, }: SessionOverviewSectionProps): React.JSX.Element;
declare function JsonPanel({ title, description, value, emptyMessage, }: JsonPanelProps): React.JSX.Element;

export { JsonPanel, SessionAgentsSection, SessionAttributionPanel, type SessionErrorDetailRow, SessionErrorDetailsPanel, type SessionMetadataField, SessionMetadataPanel, type SessionModelUsageRow, SessionModelUsageTable, SessionOverviewSection, type SessionSummaryMetric, SessionSummaryMetrics, SessionTimelineSection, type SessionToolInvocationRow, SessionToolInvocationsPanel };
