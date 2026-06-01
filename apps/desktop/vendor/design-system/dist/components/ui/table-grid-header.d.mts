import * as React from 'react';
import { ReactNode } from 'react';
import { SortDirection } from './sortable-column-header.mjs';

type TableGridHeaderColumn = {
    id: string;
    label: string;
    sortable?: boolean;
    className?: string;
};
type TableGridHeaderSortOption = {
    key: string;
    label: string;
};
type TableGridHeaderProps = {
    gridTemplateColumns: string;
    columns: readonly TableGridHeaderColumn[];
    sortBy: string | null;
    sortDir: SortDirection;
    onSort: (column: string, direction: SortDirection) => void;
    leadingLabel?: string;
    leadingSortKey?: string;
    leadingSortOptions?: readonly TableGridHeaderSortOption[];
    onClearSort?: () => void;
    showSelectAll?: boolean;
    allSelected?: boolean;
    someSelected?: boolean;
    onSelectAll?: (checked: boolean) => void;
    showRankSlot?: boolean;
    trailingCell?: ReactNode;
    className?: string;
};
declare function TableGridHeader({ gridTemplateColumns, columns, sortBy, sortDir, onSort, leadingLabel, leadingSortKey, leadingSortOptions, onClearSort, showSelectAll, allSelected, someSelected, onSelectAll, showRankSlot, trailingCell, className, }: TableGridHeaderProps): React.JSX.Element;

export { TableGridHeader, type TableGridHeaderColumn, type TableGridHeaderSortOption };
