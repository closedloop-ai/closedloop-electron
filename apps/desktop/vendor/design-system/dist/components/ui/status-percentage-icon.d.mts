import * as React from 'react';

interface StatusPercentageIconProps extends React.SVGAttributes<SVGSVGElement> {
    /** Completion percentage (0-100) */
    value: number;
    /** Icon size in pixels (default 16) */
    size?: 16 | 20;
    /** Show spinning arc for AI/agent processing. Ignored when value is 100 (complete state). */
    thinking?: boolean;
}
declare function StatusPercentageIcon({ value, size, thinking, className, ...props }: StatusPercentageIconProps): React.JSX.Element;

export { StatusPercentageIcon, type StatusPercentageIconProps };
