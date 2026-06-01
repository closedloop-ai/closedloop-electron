import * as React from 'react';

type ProgressRingProps = {
    value: number;
    color?: string;
    size?: number;
    strokeWidth?: number;
    label?: string;
};
declare function ProgressRing({ value, color, size, strokeWidth, label, }: ProgressRingProps): React.JSX.Element;

export { ProgressRing };
