import * as React from 'react';
import { TableFiltersController, TableFiltersViewModel } from './table-filters.js';
import '@repo/api/src/types/common';
import '@repo/api/src/types/document';

type ActiveFiltersBarProps = {
    controller: TableFiltersController;
    viewModel: TableFiltersViewModel;
};
declare function ActiveFiltersBar({ controller, viewModel, }: ActiveFiltersBarProps): React.JSX.Element;

export { ActiveFiltersBar };
