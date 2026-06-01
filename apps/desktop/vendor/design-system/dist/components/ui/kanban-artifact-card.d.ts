import * as React from 'react';
import { ReactNode } from 'react';

type KanbanArtifactCardProps = {
    title: string;
    subtitle?: string;
    icon?: ReactNode;
    kindLabel?: ReactNode;
    priorityLabel?: ReactNode;
    statusLabel?: ReactNode;
    assigneeLabel?: ReactNode;
    updatedLabel?: ReactNode;
    active?: boolean;
    variant?: "default" | "lane" | "drag-preview";
    className?: string;
    onClick?: () => void;
};
declare function KanbanArtifactCard({ title, subtitle, icon, kindLabel, priorityLabel, statusLabel, assigneeLabel, updatedLabel, active, variant, className, onClick, }: Readonly<KanbanArtifactCardProps>): React.JSX.Element;

export { KanbanArtifactCard, type KanbanArtifactCardProps };
