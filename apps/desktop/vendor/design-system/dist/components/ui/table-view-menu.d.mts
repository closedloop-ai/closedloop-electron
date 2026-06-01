import * as React from 'react';
import { ReactNode } from 'react';

type TableViewMode = "list" | "card";
type TableViewMenuColumn = {
    id: string;
    label: string;
    icon?: ReactNode;
    visible: boolean;
};
type TableViewMenuGroupOption = {
    value: string;
    label: string;
};
type TableViewMenuProps = Readonly<{
    columns?: TableViewMenuColumn[];
    onToggleColumn?: (columnId: string) => void;
    groupByValue?: string;
    groupByOptions?: TableViewMenuGroupOption[];
    onChangeGroupBy?: (value: string) => void;
    view?: TableViewMode;
    onChangeView?: (view: TableViewMode) => void;
    onResetView?: () => void;
    onResetToStackRank?: () => void;
    viewHeading?: string;
    columnsHeading?: string;
}>;
declare function TableViewMenu({ columns, onToggleColumn, groupByValue, groupByOptions, onChangeGroupBy, view, onChangeView, onResetView, onResetToStackRank, viewHeading, columnsHeading, }: TableViewMenuProps): React.JSX.Element;

export { TableViewMenu, type TableViewMenuColumn, type TableViewMenuGroupOption, type TableViewMenuProps, type TableViewMode };
