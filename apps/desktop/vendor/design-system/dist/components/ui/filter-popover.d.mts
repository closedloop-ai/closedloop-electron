import * as React from 'react';
import { TableFiltersController, TableFiltersViewModel, TableDateFilterField, TableFilterDatePresetOption } from './table-filters.mjs';
import '@repo/api/src/types/common';
import '@repo/api/src/types/document';

type FilterPopoverProps = {
    controller: TableFiltersController;
    viewModel: TableFiltersViewModel;
};
declare function FilterPopover({ controller, viewModel }: FilterPopoverProps): React.JSX.Element;
declare function FilterMenuContent({ controller, viewModel, }: FilterPopoverProps): React.JSX.Element;
declare function AssigneeFilterContent({ controller, viewModel, }: FilterPopoverProps): React.JSX.Element;
declare function StatusFilterContent({ controller, viewModel, }: FilterPopoverProps): React.JSX.Element;
declare function PriorityFilterContent({ controller, viewModel, }: FilterPopoverProps): React.JSX.Element;
declare function DateFilterContent({ controller, field, datePresetOptions, }: {
    controller: TableFiltersController;
    field?: TableDateFilterField;
    datePresetOptions?: TableFilterDatePresetOption[];
}): React.JSX.Element;
declare function TagsFilterContent({ controller, viewModel, }: FilterPopoverProps): React.JSX.Element;

export { AssigneeFilterContent, DateFilterContent, FilterMenuContent, FilterPopover, PriorityFilterContent, StatusFilterContent, TagsFilterContent };
