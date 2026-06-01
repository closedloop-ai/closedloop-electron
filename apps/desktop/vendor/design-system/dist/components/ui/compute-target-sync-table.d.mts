import * as React from 'react';

type ComputeTargetSyncRow = {
    id: string;
    machineName: string;
    ownerLabel: string;
    online: boolean;
    lastSyncLabel: string;
    lastSeenLabel: string;
};
type ComputeTargetSyncTableProps = {
    rows: ComputeTargetSyncRow[];
};
declare function ComputeTargetSyncTable({ rows, }: Readonly<ComputeTargetSyncTableProps>): React.JSX.Element;

export { type ComputeTargetSyncRow, ComputeTargetSyncTable };
