import * as React from 'react';

type ModelUsageRow = {
    model: string;
    sessions: string;
    input: string;
    output: string;
    cache: string;
    cost: string;
};
type ModelUsageTableProps = {
    rows: ModelUsageRow[];
};
declare function ModelUsageTable({ rows }: Readonly<ModelUsageTableProps>): React.JSX.Element;

export { type ModelUsageRow, ModelUsageTable };
