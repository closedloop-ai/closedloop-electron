import * as React from 'react';

type Segment = {
    key: string;
    label: string;
    value: number;
    colorClassName: string;
    textClassName?: string;
};
type SegmentedBarProps = {
    segments: Segment[];
    total: number;
    className?: string;
};
declare function SegmentedBar({ segments, total, className, }: SegmentedBarProps): React.JSX.Element;

export { SegmentedBar };
