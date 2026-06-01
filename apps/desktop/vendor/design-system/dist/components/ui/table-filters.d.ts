import { Priority } from '@repo/api/src/types/common';
import { DocumentStatus } from '@repo/api/src/types/document';
import { ReactNode } from 'react';

declare const TableDatePreset: {
    readonly Last24h: "LAST_24H";
    readonly Last7d: "LAST_7D";
    readonly Last30d: "LAST_30D";
    readonly Last3m: "LAST_3M";
    readonly Custom: "CUSTOM";
};
type TableDatePreset = (typeof TableDatePreset)[keyof typeof TableDatePreset];
declare const TABLE_DATE_PRESET_LABELS: Record<TableDatePreset, string>;
declare const TableDateFilterField: {
    readonly CreatedAt: "CREATED_AT";
    readonly UpdatedAt: "UPDATED_AT";
};
type TableDateFilterField = (typeof TableDateFilterField)[keyof typeof TableDateFilterField];
type TableDateFilter = {
    field: TableDateFilterField;
    preset: TableDatePreset;
    startDate?: Date;
    endDate?: Date;
};
type TableFiltersState = {
    assigneeIds: string[];
    assignToMe: boolean;
    hideCompletedItems: boolean;
    favoritesOnly: boolean;
    statuses: DocumentStatus[];
    priorities: Priority[];
    date: TableDateFilter | null;
    tagIds: string[];
};
type TableFilterCategory = "assignee" | "status" | "priority" | "date" | "hideCompleted" | "favorites" | "tags";
type TableFilterChip = {
    category: TableFilterCategory;
    label: string;
};
type TableFilterCurrentUser = {
    id: string;
    name: string;
    avatarUrl?: string;
};
type TableFilterOption<TValue extends string = string> = {
    id: TValue;
    label: string;
    count?: number;
    icon?: ReactNode;
    avatarUrl?: string;
    color?: string;
    searchText?: string;
};
type TableFilterDatePresetOption = {
    value: TableDatePreset;
    label: string;
};
type TableFilterLabels = {
    filterButton?: string;
    filterSearchPlaceholder?: string;
    clearAll?: string;
    loading?: string;
    loadError?: string;
    noTags?: string;
    addFilter?: string;
    assignToMe?: string;
    hideCompletedItems?: string;
    favoritesOnly?: string;
    assignee?: string;
    status?: string;
    priority?: string;
    dates?: string;
    createdDate?: string;
    updatedDate?: string;
    tags?: string;
    unassigned?: string;
};
type TableFiltersController = {
    filters: TableFiltersState;
    toggleAssignee: (id: string) => void;
    toggleAssignToMe: () => void;
    toggleHideCompletedItems: () => void;
    toggleFavoritesOnly: () => void;
    toggleStatus: (status: DocumentStatus) => void;
    togglePriority: (priority: Priority) => void;
    setDateFilter: (date: TableDateFilter | null) => void;
    toggleTag: (tagId: string) => void;
    clearCategoryFilter: (category: TableFilterCategory) => void;
    clearAllFilters: () => void;
    activeChips: TableFilterChip[];
};
type TableFiltersViewModel = {
    currentUser?: TableFilterCurrentUser | null;
    teamMembers: TableFilterOption[];
    teamMembersLoading?: boolean;
    teamMembersError?: string | null;
    statusOptions: TableFilterOption<DocumentStatus>[];
    priorityOptions: TableFilterOption<Priority>[];
    tagOptions?: TableFilterOption[];
    hideAssignee?: boolean;
    showTags?: boolean;
    datePresets?: TableFilterDatePresetOption[];
    labels?: TableFilterLabels;
};

export { TABLE_DATE_PRESET_LABELS, type TableDateFilter, TableDateFilterField, TableDatePreset, type TableFilterCategory, type TableFilterChip, type TableFilterCurrentUser, type TableFilterDatePresetOption, type TableFilterLabels, type TableFilterOption, type TableFiltersController, type TableFiltersState, type TableFiltersViewModel };
