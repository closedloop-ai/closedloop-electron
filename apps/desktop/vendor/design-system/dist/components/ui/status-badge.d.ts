import * as React from 'react';
import { Priority } from '@repo/api/src/types/common';
import { DocumentStatus } from '@repo/api/src/types/document';
import { LoopCommand, LoopStatus, LoopErrorCode } from '@repo/api/src/types/loop';
import { WorkstreamState, WorkstreamType } from '@repo/api/src/types/workstream';

type StatusBadgeProps = {
    status: string;
    colorMap: Record<string, string>;
    defaultStyle?: string;
    className?: string;
};
declare function StatusBadge({ status, colorMap, defaultStyle, className, }: Readonly<StatusBadgeProps>): React.JSX.Element;
declare const previewDeploymentStateColors: Record<string, string>;
declare const artifactStatusColors: Record<DocumentStatus, string>;
declare const artifactStatusLabels: Record<DocumentStatus, string>;
declare function DocumentStatusBadge({ status, }: Readonly<{
    status: DocumentStatus;
}>): React.JSX.Element;
declare const PrdStatusBadge: typeof DocumentStatusBadge;
declare const ImplementationPlanStatusBadge: typeof DocumentStatusBadge;
declare const featureStatusColors: Record<DocumentStatus, string>;
declare const featureStatusLabels: Record<DocumentStatus, string>;
declare const FeatureStatusBadge: typeof DocumentStatusBadge;
declare const featurePriorityColors: Record<Priority, string>;
declare const featurePriorityLabels: Record<Priority, string>;
declare function FeaturePriorityBadge({ priority, }: Readonly<{
    priority: Priority;
}>): React.JSX.Element;
declare const workstreamStateColors: Record<WorkstreamState, string>;
declare function WorkstreamStateBadge({ state, }: Readonly<{
    state: WorkstreamState;
}>): React.JSX.Element;
declare const workstreamTypeColors: Record<WorkstreamType, string>;
declare function WorkstreamTypeBadge({ type, }: Readonly<{
    type: WorkstreamType;
}>): React.JSX.Element;
declare const loopStatusColors: Record<LoopStatus, string>;
declare const loopErrorCodeColors: Partial<Record<LoopErrorCode, string>>;
declare function LoopStatusBadge({ status, errorCode, ghostLoopUx, }: Readonly<{
    status: LoopStatus;
    errorCode?: LoopErrorCode;
    ghostLoopUx?: boolean;
}>): React.JSX.Element;
declare const loopCommandColors: Record<LoopCommand, string>;
declare function LoopCommandBadge({ command, }: Readonly<{
    command: LoopCommand;
}>): React.JSX.Element;

export { DocumentStatusBadge, FeaturePriorityBadge, FeatureStatusBadge, ImplementationPlanStatusBadge, LoopCommandBadge, LoopStatusBadge, PrdStatusBadge, StatusBadge, WorkstreamStateBadge, WorkstreamTypeBadge, artifactStatusColors, artifactStatusLabels, featurePriorityColors, featurePriorityLabels, featureStatusColors, featureStatusLabels, loopCommandColors, loopErrorCodeColors, loopStatusColors, previewDeploymentStateColors, workstreamStateColors, workstreamTypeColors };
