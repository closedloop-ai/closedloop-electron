import * as React from 'react';

type Column<T> = {
    key: keyof T | string;
    header: string;
    sortable?: boolean;
    render?: (item: T) => React.ReactNode;
    className?: string;
};
type SortOption = {
    label: string;
    value: string;
};
type FilterOption = {
    label: string;
    value: string;
};
type DataTableProps<T> = {
    data: T[];
    columns: Column<T>[];
    searchPlaceholder?: string;
    searchKey?: keyof T;
    sortOptions?: SortOption[];
    filterOptions?: FilterOption[];
    filterKey?: keyof T;
    onRowClick?: (item: T) => void;
    rowHref?: (item: T) => string | undefined;
    renderRowActions?: (item: T) => React.ReactNode;
    pageSize?: number;
    pageSizeOptions?: number[];
    onPageSizeChange?: (pageSize: number) => void;
    emptyMessage?: string;
};
declare function DataTable<T extends {
    id: string;
}>({ data, columns, searchPlaceholder, searchKey, sortOptions, filterOptions, filterKey, onRowClick, rowHref, renderRowActions, pageSize: initialPageSize, pageSizeOptions, onPageSizeChange, emptyMessage, }: DataTableProps<T>): React.JSX.Element;

export { type Column, DataTable, type FilterOption, type SortOption };
