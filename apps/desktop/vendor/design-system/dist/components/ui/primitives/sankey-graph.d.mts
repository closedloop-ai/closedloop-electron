import * as React from 'react';

type SankeyFlow = {
    source: string;
    target: string;
    value: number;
};
type SankeyNodeTotal = {
    id: string;
    value: number;
};
type SankeyGraphProps = {
    flows: SankeyFlow[];
    totals: SankeyNodeTotal[];
    palette?: Record<string, string>;
    ariaLabel?: string;
    emptyMessage?: string;
    labelFormatter?: (id: string) => string;
};
declare function SankeyGraph({ flows, totals, palette, ariaLabel, emptyMessage, labelFormatter, }: SankeyGraphProps): React.JSX.Element;

export { SankeyGraph };
