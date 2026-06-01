import * as React from 'react';
import { ReactNode, ComponentProps } from 'react';
import { PriorityIcon } from './priority-icon.js';
import { StatusIcon } from './status-icon.js';

type ArtifactRowProps = {
    title: string;
    slug: string;
    typeIcon: ReactNode;
    typeLabel: string;
    status: ComponentProps<typeof StatusIcon>["status"];
    statusLabel: string;
    priority?: ComponentProps<typeof PriorityIcon>["priority"] | null;
    assignee?: ReactNode;
    href?: string | null;
    depth?: number;
    onDetach?: () => void;
    className?: string;
};
declare function ArtifactRow({ title, slug, typeIcon, typeLabel, status, statusLabel, priority, assignee, href, depth, onDetach, className, }: Readonly<ArtifactRowProps>): React.JSX.Element;

export { ArtifactRow };
