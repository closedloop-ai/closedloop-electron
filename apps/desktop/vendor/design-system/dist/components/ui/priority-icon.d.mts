import * as React from 'react';

type PriorityLevel = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
interface PriorityIconProps extends React.SVGAttributes<SVGSVGElement> {
    /** The priority level to render */
    priority: PriorityLevel;
    /** Icon size in pixels (default 16) */
    size?: number;
}
declare function PriorityIcon({ priority, size, className, ...props }: PriorityIconProps): React.JSX.Element;

export { PriorityIcon, type PriorityIconProps, type PriorityLevel };
