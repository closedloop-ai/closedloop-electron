import * as React from 'react';

type SparklineProps = {
    values: Array<number | null | undefined>;
    width?: number;
    height?: number;
    className?: string;
    stroke?: string;
};
declare function Sparkline({ values, width, height, className, stroke, }: SparklineProps): React.JSX.Element | null;

export { Sparkline };
