import * as React from 'react';
import { ReactNode } from 'react';

type ComputeTargetSystemCheckState = "idle" | "success" | "warning" | "loading" | "disabled";
type ComputeTargetSystemCheckProps = {
    summary?: string;
    description?: ReactNode;
    state?: ComputeTargetSystemCheckState;
    actionLabel?: string;
    onAction?: () => Promise<void> | void;
    actionDisabled?: boolean;
    content?: ReactNode;
    fallback?: ReactNode;
    defaultOpen?: boolean;
    title?: string;
    checkedAtLabel?: string;
    failureCount?: number;
    hasResult?: boolean;
    isEligible?: boolean;
    isLoading?: boolean;
    targetName?: string;
};
declare function ComputeTargetSystemCheck({ summary, description, state, actionLabel, onAction, actionDisabled, content, fallback, defaultOpen, title, checkedAtLabel, failureCount, hasResult, isEligible, isLoading, targetName, }: Readonly<ComputeTargetSystemCheckProps>): React.JSX.Element;

export { ComputeTargetSystemCheck, type ComputeTargetSystemCheckState };
