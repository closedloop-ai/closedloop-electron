import * as React from 'react';
import { ReactNode } from 'react';

type EvaluationSectionProps = {
    title?: string;
    defaultOpen?: boolean;
    state: "awaiting" | "empty" | "ready";
    awaitingMessage?: string;
    emptyMessage?: string;
    acceptedCount?: number;
    totalCount?: number;
    children?: ReactNode;
};
declare function EvaluationSection({ title, defaultOpen, state, awaitingMessage, emptyMessage, acceptedCount, totalCount, children, }: Readonly<EvaluationSectionProps>): React.JSX.Element;

export { EvaluationSection };
