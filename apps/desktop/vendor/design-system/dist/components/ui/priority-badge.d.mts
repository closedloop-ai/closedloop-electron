import * as class_variance_authority_types from 'class-variance-authority/types';
import * as React from 'react';
import { VariantProps } from 'class-variance-authority';

declare const priorityBadgeVariants: (props?: ({
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT" | null | undefined;
} & class_variance_authority_types.ClassProp) | undefined) => string;
type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
declare const priorityLabels: Record<Priority, string>;
interface PriorityBadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children">, VariantProps<typeof priorityBadgeVariants> {
    /** The priority level to display */
    priority: Priority;
}
/**
 * PriorityBadge displays a color-coded badge for project priority levels
 */
declare function PriorityBadge({ priority, className, ...props }: PriorityBadgeProps): React.JSX.Element;

export { type Priority, PriorityBadge, type PriorityBadgeProps, priorityBadgeVariants, priorityLabels };
