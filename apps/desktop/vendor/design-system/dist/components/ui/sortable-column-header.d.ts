import * as React from 'react';

type SortDirection = "asc" | "desc";
type SortableColumnHeaderProps<TColumn extends string> = {
    column: TColumn;
    label: string;
    sortBy: TColumn | null;
    sortDir: SortDirection;
    onSort: (column: TColumn, direction: SortDirection) => void;
    className?: string;
};
type SortIndicatorProps = {
    isActive: boolean;
    direction: SortDirection;
    className?: string;
};
declare function getNextSortDirection(isActive: boolean, currentDirection: SortDirection): SortDirection;
declare function SortIndicator({ isActive, direction, className, }: SortIndicatorProps): React.JSX.Element;
declare function SortableColumnHeader<TColumn extends string>({ column, label, sortBy, sortDir, onSort, className, }: SortableColumnHeaderProps<TColumn>): React.JSX.Element;

export { type SortDirection, SortIndicator, SortableColumnHeader, getNextSortDirection };
