import * as React from 'react';
import { ComponentProps } from 'react';
import { StatusIcon } from './status-icon.js';
import { User } from './user-select-popover.js';

type StatusMetadataOption = {
    value: string;
    label: string;
    iconStatus: ComponentProps<typeof StatusIcon>["status"];
};
type StatusMetadataSectionProps = {
    status: string;
    assignee: User | null;
    teamMembers: User[];
    onStatusChange: (status: string) => void;
    onAssigneeChange: (user: User | null) => void;
    options: StatusMetadataOption[];
    className?: string;
    layout?: "horizontal" | "vertical";
};
declare function StatusMetadataSection({ status, assignee, teamMembers, onStatusChange, onAssigneeChange, options, className, layout, }: Readonly<StatusMetadataSectionProps>): React.JSX.Element;

export { StatusMetadataSection, type StatusMetadataSectionProps };
