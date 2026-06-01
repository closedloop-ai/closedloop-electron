import * as React from 'react';

type UserUsageRow = {
    id: string;
    label: string;
    sessions: string;
    input: string;
    output: string;
    cost: string;
    href?: string;
    active?: boolean;
};
type UserUsageTableProps = {
    rows: UserUsageRow[];
    onToggleUser?: (userId: string) => void;
};
declare function UserUsageTable({ rows, onToggleUser, }: Readonly<UserUsageTableProps>): React.JSX.Element;

export { type UserUsageRow, UserUsageTable };
