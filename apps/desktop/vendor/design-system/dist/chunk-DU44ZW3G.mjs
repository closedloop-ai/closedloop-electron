import React from "react";
import {
  TABLE_DATE_PRESET_LABELS,
  TableDateFilterField,
  TableDatePreset
} from "./chunk-ASHTD3OK.mjs";
import {
  Checkbox
} from "./chunk-SF4RI47G.mjs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "./chunk-M266NC23.mjs";
import {
  Avatar,
  AvatarFallback,
  AvatarImage
} from "./chunk-ZI7L5RNU.mjs";
import {
  Button
} from "./chunk-TT7DUYOP.mjs";
import {
  cn
} from "./chunk-522NBUZJ.mjs";

// components/ui/filter-popover.tsx
import {
  CalendarIcon,
  CheckIcon,
  EyeOffIcon,
  ListFilterIcon,
  StarIcon,
  TagIcon,
  UsersIcon
} from "lucide-react";
import { useMemo, useState } from "react";
var DEFAULT_LABELS = {
  filterButton: "Filter",
  filterSearchPlaceholder: "Filter...",
  clearAll: "Clear all",
  loading: "Loading...",
  loadError: "Could not load members",
  noTags: "No tags created yet",
  addFilter: "Add filter",
  assignToMe: "Assigned to me",
  hideCompletedItems: "Hide completed items",
  favoritesOnly: "My Favorites",
  assignee: "Assignee",
  status: "Status",
  priority: "Priority",
  dates: "Dates",
  createdDate: "Date Created",
  updatedDate: "Updated Date",
  tags: "Tags",
  unassigned: "Unassigned"
};
var DEFAULT_DATE_PRESETS = [
  TableDatePreset.Last24h,
  TableDatePreset.Last7d,
  TableDatePreset.Last30d,
  TableDatePreset.Last3m
].map((value) => ({
  value,
  label: TABLE_DATE_PRESET_LABELS[value]
}));
function FilterPopover({ controller, viewModel }) {
  const [open, setOpen] = useState(false);
  const labels = useLabels(viewModel.labels);
  return /* @__PURE__ */ React.createElement(DropdownMenu, { onOpenChange: setOpen, open }, /* @__PURE__ */ React.createElement(DropdownMenuTrigger, { asChild: true }, /* @__PURE__ */ React.createElement(
    Button,
    {
      "aria-label": labels.filterButton,
      className: "h-8 shadow-none",
      size: "sm",
      variant: "outline"
    },
    /* @__PURE__ */ React.createElement(ListFilterIcon, null),
    labels.filterButton
  )), /* @__PURE__ */ React.createElement(FilterMenuContent, { controller, viewModel }));
}
function FilterMenuContent({
  controller,
  viewModel
}) {
  const labels = useLabels(viewModel.labels);
  const {
    filters,
    toggleAssignee,
    toggleAssignToMe,
    toggleHideCompletedItems,
    toggleFavoritesOnly,
    toggleStatus,
    togglePriority,
    setDateFilter,
    toggleTag
  } = controller;
  const assigneeTotal = filters.assigneeIds.length;
  const statusTotal = filters.statuses.length;
  const priorityTotal = filters.priorities.length;
  const datePresetOptions = viewModel.datePresets ?? DEFAULT_DATE_PRESETS;
  const tagOptions = viewModel.tagOptions ?? [];
  const showTags = viewModel.showTags ?? tagOptions.length > 0;
  return /* @__PURE__ */ React.createElement(DropdownMenuContent, { align: "start", className: "w-52" }, /* @__PURE__ */ React.createElement(DropdownMenuGroup, null, !viewModel.hideAssignee && viewModel.currentUser && /* @__PURE__ */ React.createElement(
    DropdownMenuItem,
    {
      onSelect: (event) => {
        event.preventDefault();
        toggleAssignToMe();
      }
    },
    /* @__PURE__ */ React.createElement(Avatar, { className: "size-5" }, viewModel.currentUser.avatarUrl && /* @__PURE__ */ React.createElement(AvatarImage, { src: viewModel.currentUser.avatarUrl }), /* @__PURE__ */ React.createElement(AvatarFallback, { className: "text-[10px]" }, getInitials(viewModel.currentUser.name))),
    /* @__PURE__ */ React.createElement("span", { className: cn(filters.assignToMe && "font-medium") }, labels.assignToMe),
    filters.assignToMe && /* @__PURE__ */ React.createElement(CheckIcon, { className: "ml-auto size-4" })
  ), /* @__PURE__ */ React.createElement(
    DropdownMenuItem,
    {
      onSelect: (event) => {
        event.preventDefault();
        toggleHideCompletedItems();
      }
    },
    /* @__PURE__ */ React.createElement(EyeOffIcon, { className: "size-4" }),
    /* @__PURE__ */ React.createElement("span", { className: cn(filters.hideCompletedItems && "font-medium") }, labels.hideCompletedItems),
    filters.hideCompletedItems && /* @__PURE__ */ React.createElement(CheckIcon, { className: "ml-auto size-4" })
  ), /* @__PURE__ */ React.createElement(
    DropdownMenuItem,
    {
      onSelect: (event) => {
        event.preventDefault();
        toggleFavoritesOnly();
      }
    },
    /* @__PURE__ */ React.createElement(StarIcon, { className: "size-4" }),
    /* @__PURE__ */ React.createElement("span", { className: cn(filters.favoritesOnly && "font-medium") }, labels.favoritesOnly),
    filters.favoritesOnly && /* @__PURE__ */ React.createElement(CheckIcon, { className: "ml-auto size-4" })
  )), /* @__PURE__ */ React.createElement(DropdownMenuSeparator, null), /* @__PURE__ */ React.createElement(DropdownMenuGroup, null, !viewModel.hideAssignee && /* @__PURE__ */ React.createElement(
    AssigneeSubmenu,
    {
      controller,
      labels,
      viewModel
    }
  ), /* @__PURE__ */ React.createElement(
    OptionsSubmenu,
    {
      count: statusTotal,
      icon: /* @__PURE__ */ React.createElement("span", { className: "inline-flex size-4 items-center justify-center" }, viewModel.statusOptions[0]?.icon),
      label: labels.status,
      options: viewModel.statusOptions,
      searchPlaceholder: labels.filterSearchPlaceholder,
      selectedValues: filters.statuses,
      submenuClassName: "w-60",
      onToggle: toggleStatus
    }
  ), /* @__PURE__ */ React.createElement(
    OptionsSubmenu,
    {
      count: priorityTotal,
      icon: /* @__PURE__ */ React.createElement("span", { className: "inline-flex size-4 items-center justify-center" }, viewModel.priorityOptions[0]?.icon),
      label: labels.priority,
      options: viewModel.priorityOptions,
      searchPlaceholder: labels.filterSearchPlaceholder,
      selectedValues: filters.priorities,
      submenuClassName: "w-56",
      onToggle: togglePriority
    }
  ), /* @__PURE__ */ React.createElement(
    DatesSubmenu,
    {
      controller,
      datePresetOptions,
      labels
    }
  ), showTags && /* @__PURE__ */ React.createElement(
    TagsSubmenu,
    {
      labels,
      options: tagOptions,
      selectedTagIds: filters.tagIds,
      toggleTag
    }
  )));
}
function AssigneeFilterContent({
  controller,
  viewModel
}) {
  const labels = useLabels(viewModel.labels);
  const [search, setSearch] = useState("");
  const filteredMembers = viewModel.teamMembers.filter(
    (member) => (member.searchText ?? member.label).toLowerCase().includes(search.toLowerCase())
  );
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
    SubMenuSearch,
    {
      onChange: setSearch,
      placeholder: labels.filterSearchPlaceholder,
      value: search
    }
  ), viewModel.teamMembersLoading && /* @__PURE__ */ React.createElement("div", { className: "p-4 text-center text-muted-foreground text-sm" }, labels.loading), viewModel.teamMembersError && /* @__PURE__ */ React.createElement("div", { className: "p-4 text-center text-muted-foreground text-sm" }, labels.loadError), !(viewModel.teamMembersLoading || viewModel.teamMembersError) && filteredMembers.map((member) => {
    const checked = controller.filters.assigneeIds.includes(member.id);
    return /* @__PURE__ */ React.createElement(
      FilterRow,
      {
        checked,
        key: member.id,
        onToggle: () => controller.toggleAssignee(member.id)
      },
      /* @__PURE__ */ React.createElement(OptionLeadingVisual, { option: member }),
      /* @__PURE__ */ React.createElement(
        "span",
        {
          className: cn(
            "min-w-0 flex-1 truncate",
            checked && "font-medium"
          )
        },
        member.label
      ),
      /* @__PURE__ */ React.createElement(OptionCount, { count: member.count })
    );
  }));
}
function StatusFilterContent({
  controller,
  viewModel
}) {
  return /* @__PURE__ */ React.createElement(
    OptionsFilterContent,
    {
      options: viewModel.statusOptions,
      searchPlaceholder: useLabels(viewModel.labels).filterSearchPlaceholder,
      selectedValues: controller.filters.statuses,
      onToggle: controller.toggleStatus
    }
  );
}
function PriorityFilterContent({
  controller,
  viewModel
}) {
  return /* @__PURE__ */ React.createElement(
    OptionsFilterContent,
    {
      options: viewModel.priorityOptions,
      searchPlaceholder: useLabels(viewModel.labels).filterSearchPlaceholder,
      selectedValues: controller.filters.priorities,
      onToggle: controller.togglePriority
    }
  );
}
function DateFilterContent({
  controller,
  field = TableDateFilterField.CreatedAt,
  datePresetOptions
}) {
  const currentPreset = controller.filters.date?.field === field ? controller.filters.date.preset : null;
  const presets = datePresetOptions ?? DEFAULT_DATE_PRESETS;
  return /* @__PURE__ */ React.createElement(React.Fragment, null, presets.map((preset) => {
    const selected = currentPreset === preset.value;
    return /* @__PURE__ */ React.createElement(
      DropdownMenuItem,
      {
        key: preset.value,
        onSelect: () => {
          if (currentPreset === preset.value) {
            controller.setDateFilter(null);
            return;
          }
          controller.setDateFilter({
            field,
            preset: preset.value
          });
        }
      },
      /* @__PURE__ */ React.createElement("span", { className: cn("flex-1", selected && "font-medium") }, preset.label),
      selected && /* @__PURE__ */ React.createElement(CheckIcon, { className: "ml-auto size-4" })
    );
  }));
}
function TagsFilterContent({
  controller,
  viewModel
}) {
  const labels = useLabels(viewModel.labels);
  const tagOptions = viewModel.tagOptions ?? [];
  if (tagOptions.length === 0) {
    return /* @__PURE__ */ React.createElement(DropdownMenuItem, { disabled: true }, labels.noTags);
  }
  return /* @__PURE__ */ React.createElement(React.Fragment, null, tagOptions.map((tag) => /* @__PURE__ */ React.createElement(
    FilterRow,
    {
      checked: controller.filters.tagIds.includes(tag.id),
      key: tag.id,
      onToggle: () => controller.toggleTag(tag.id)
    },
    /* @__PURE__ */ React.createElement(TagVisual, { option: tag }),
    /* @__PURE__ */ React.createElement("span", { className: "min-w-0 flex-1 truncate" }, tag.label),
    /* @__PURE__ */ React.createElement(OptionCount, { count: tag.count })
  )));
}
function OptionsSubmenu({
  count,
  icon,
  label,
  options,
  searchPlaceholder,
  selectedValues,
  submenuClassName,
  onToggle
}) {
  return /* @__PURE__ */ React.createElement(DropdownMenuSub, null, /* @__PURE__ */ React.createElement(DropdownMenuSubTrigger, null, icon, /* @__PURE__ */ React.createElement("span", { className: "flex-1" }, label), count > 0 && /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground text-xs" }, count)), /* @__PURE__ */ React.createElement(DropdownMenuPortal, null, /* @__PURE__ */ React.createElement(DropdownMenuSubContent, { className: submenuClassName }, /* @__PURE__ */ React.createElement(
    OptionsFilterContent,
    {
      options,
      searchPlaceholder,
      selectedValues,
      onToggle
    }
  ))));
}
function OptionsFilterContent({
  options,
  searchPlaceholder,
  selectedValues,
  onToggle
}) {
  const [search, setSearch] = useState("");
  const filteredOptions = options.filter(
    (option) => (option.searchText ?? option.label).toLowerCase().includes(search.toLowerCase())
  );
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
    SubMenuSearch,
    {
      onChange: setSearch,
      placeholder: searchPlaceholder,
      value: search
    }
  ), filteredOptions.map((option) => {
    const checked = selectedValues.includes(option.id);
    return /* @__PURE__ */ React.createElement(
      FilterRow,
      {
        checked,
        key: option.id,
        onToggle: () => onToggle(option.id)
      },
      /* @__PURE__ */ React.createElement(OptionLeadingVisual, { option }),
      /* @__PURE__ */ React.createElement("span", { className: cn("min-w-0 flex-1 truncate", checked && "font-medium") }, option.label),
      /* @__PURE__ */ React.createElement(OptionCount, { count: option.count })
    );
  }));
}
function AssigneeSubmenu({
  controller,
  viewModel,
  labels
}) {
  return /* @__PURE__ */ React.createElement(DropdownMenuSub, null, /* @__PURE__ */ React.createElement(DropdownMenuSubTrigger, null, /* @__PURE__ */ React.createElement(UsersIcon, { className: "size-4" }), /* @__PURE__ */ React.createElement("span", { className: "flex-1" }, labels.assignee), controller.filters.assigneeIds.length > 0 && /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground text-xs" }, controller.filters.assigneeIds.length)), /* @__PURE__ */ React.createElement(DropdownMenuPortal, null, /* @__PURE__ */ React.createElement(DropdownMenuSubContent, { className: "w-64" }, /* @__PURE__ */ React.createElement(AssigneeFilterContent, { controller, viewModel }))));
}
function DatesSubmenu({
  controller,
  datePresetOptions,
  labels
}) {
  return /* @__PURE__ */ React.createElement(DropdownMenuSub, null, /* @__PURE__ */ React.createElement(DropdownMenuSubTrigger, null, /* @__PURE__ */ React.createElement(CalendarIcon, { className: "size-4" }), /* @__PURE__ */ React.createElement("span", { className: "flex-1" }, labels.dates), controller.filters.date && /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground text-xs" }, "1")), /* @__PURE__ */ React.createElement(DropdownMenuPortal, null, /* @__PURE__ */ React.createElement(DropdownMenuSubContent, { className: "w-48" }, /* @__PURE__ */ React.createElement(
    DateFieldSubmenu,
    {
      controller,
      datePresetOptions,
      field: TableDateFilterField.CreatedAt,
      label: labels.createdDate
    }
  ), /* @__PURE__ */ React.createElement(
    DateFieldSubmenu,
    {
      controller,
      datePresetOptions,
      field: TableDateFilterField.UpdatedAt,
      label: labels.updatedDate
    }
  ))));
}
function DateFieldSubmenu({
  controller,
  datePresetOptions,
  field,
  label
}) {
  return /* @__PURE__ */ React.createElement(DropdownMenuSub, null, /* @__PURE__ */ React.createElement(DropdownMenuSubTrigger, null, /* @__PURE__ */ React.createElement(CalendarIcon, { className: "size-4" }), /* @__PURE__ */ React.createElement("span", { className: "flex-1" }, label)), /* @__PURE__ */ React.createElement(DropdownMenuPortal, null, /* @__PURE__ */ React.createElement(DropdownMenuSubContent, { className: "w-44" }, /* @__PURE__ */ React.createElement(
    DateFilterContent,
    {
      controller,
      datePresetOptions,
      field
    }
  ))));
}
function TagsSubmenu({
  labels,
  options,
  selectedTagIds,
  toggleTag
}) {
  return /* @__PURE__ */ React.createElement(DropdownMenuSub, null, /* @__PURE__ */ React.createElement(DropdownMenuSubTrigger, null, /* @__PURE__ */ React.createElement(TagIcon, { className: "size-4" }), /* @__PURE__ */ React.createElement("span", { className: "flex-1" }, labels.tags), selectedTagIds.length > 0 && /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground text-xs" }, selectedTagIds.length)), /* @__PURE__ */ React.createElement(DropdownMenuPortal, null, /* @__PURE__ */ React.createElement(DropdownMenuSubContent, { className: "w-56" }, options.length === 0 ? /* @__PURE__ */ React.createElement(DropdownMenuItem, { disabled: true }, labels.noTags) : options.map((tag) => /* @__PURE__ */ React.createElement(
    FilterRow,
    {
      checked: selectedTagIds.includes(tag.id),
      key: tag.id,
      onToggle: () => toggleTag(tag.id)
    },
    /* @__PURE__ */ React.createElement(TagVisual, { option: tag }),
    /* @__PURE__ */ React.createElement("span", { className: "min-w-0 flex-1 truncate" }, tag.label),
    /* @__PURE__ */ React.createElement(OptionCount, { count: tag.count })
  )))));
}
function SubMenuSearch({
  value,
  onChange,
  placeholder
}) {
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "px-2 pt-0.5 pb-1.5" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "h-6 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground",
      onChange: (event) => onChange(event.target.value),
      onKeyDown: (event) => event.stopPropagation(),
      placeholder,
      type: "text",
      value
    }
  )), /* @__PURE__ */ React.createElement(DropdownMenuSeparator, { className: "mt-0 mb-1" }));
}
function FilterRow({
  checked,
  onToggle,
  children
}) {
  return /* @__PURE__ */ React.createElement(
    DropdownMenuItem,
    {
      className: "gap-2",
      onSelect: (event) => {
        event.preventDefault();
        onToggle();
      }
    },
    /* @__PURE__ */ React.createElement(
      Checkbox,
      {
        checked,
        className: "[&_svg]:!text-current pointer-events-none"
      }
    ),
    children
  );
}
function OptionLeadingVisual({ option }) {
  if (option.avatarUrl) {
    return /* @__PURE__ */ React.createElement(Avatar, { className: "size-5" }, /* @__PURE__ */ React.createElement(AvatarImage, { src: option.avatarUrl }), /* @__PURE__ */ React.createElement(AvatarFallback, { className: "text-[10px]" }, getInitials(option.label)));
  }
  if (option.icon) {
    return /* @__PURE__ */ React.createElement("div", { className: "flex size-5 items-center justify-center" }, option.icon);
  }
  return null;
}
function TagVisual({ option }) {
  return /* @__PURE__ */ React.createElement("div", { className: "inline-flex min-w-0 items-center gap-2" }, /* @__PURE__ */ React.createElement(
    "span",
    {
      "aria-hidden": "true",
      className: "size-2.5 shrink-0 rounded-full border",
      style: { backgroundColor: option.color, borderColor: option.color }
    }
  ));
}
function OptionCount({ count }) {
  if (count === void 0) {
    return null;
  }
  return /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground text-xs" }, count);
}
function getInitials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}
function useLabels(labels) {
  return useMemo(
    () => ({
      ...DEFAULT_LABELS,
      ...labels
    }),
    [labels]
  );
}

export {
  FilterPopover,
  FilterMenuContent,
  AssigneeFilterContent,
  StatusFilterContent,
  PriorityFilterContent,
  DateFilterContent,
  TagsFilterContent
};
//# sourceMappingURL=chunk-DU44ZW3G.mjs.map