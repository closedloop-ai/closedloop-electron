import * as React from 'react';

type LineChartPoint = {
    label: string;
    value: number;
};
type LineChartProps = {
    points: LineChartPoint[];
    color?: string;
    valueFormatter?: (value: number) => string;
    label?: string;
};
declare function LineChart({ points, color, valueFormatter, label, }: LineChartProps): React.JSX.Element;

export { LineChart };
