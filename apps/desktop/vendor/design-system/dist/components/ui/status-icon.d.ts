import * as React from 'react';

type StatusIconStatus = "backlog" | "todo" | "started" | "in-progress" | "in-review" | "executed" | "complete" | "wont-do" | "decorative";
interface StatusIconProps extends React.SVGAttributes<SVGSVGElement> {
    /** Named phase status */
    status: StatusIconStatus;
    /** Icon size in pixels (default 16) */
    size?: 16 | 20;
    /** Show spinning arc for AI/agent processing. Only applies to non-terminal statuses (backlog, todo, in-progress, in-review); ignored for complete and wont-do. */
    thinking?: boolean;
}
declare function StatusIcon({ status, size, thinking, className, ...props }: StatusIconProps): React.JSX.Element;

export { StatusIcon, type StatusIconProps, type StatusIconStatus };
