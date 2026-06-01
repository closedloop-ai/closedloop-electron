import * as React from 'react';

type DonutSegment = {
    label: string;
    value: number;
    color: string;
};
type DonutChartProps = {
    segments: DonutSegment[];
    formatTotal?: (total: number) => string;
    centerLabel?: string;
};
declare function DonutChart({ segments, formatTotal, centerLabel, }: DonutChartProps): React.JSX.Element;

export { DonutChart };
