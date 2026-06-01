var React = require("react");
"use strict";
"use client";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// components/ui/filter-popover.tsx
var filter_popover_exports = {};
__export(filter_popover_exports, {
  AssigneeFilterContent: () => AssigneeFilterContent,
  DateFilterContent: () => DateFilterContent,
  FilterMenuContent: () => FilterMenuContent,
  FilterPopover: () => FilterPopover,
  PriorityFilterContent: () => PriorityFilterContent,
  StatusFilterContent: () => StatusFilterContent,
  TagsFilterContent: () => TagsFilterContent
});
module.exports = __toCommonJS(filter_popover_exports);

// components/ui/avatar.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/avatar.tsx
function Avatar({
  className,
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    import_radix_ui.Avatar.Root,
    {
      "data-slot": "avatar",
      className: cn(
        "relative flex size-8 shrink-0 overflow-hidden rounded-full",
        className
      ),
      ...props
    }
  );
}
function AvatarImage({
  className,
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    import_radix_ui.Avatar.Image,
    {
      "data-slot": "avatar-image",
      className: cn("aspect-square size-full", className),
      ...props
    }
  );
}
function AvatarFallback({
  className,
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    import_radix_ui.Avatar.Fallback,
    {
      "data-slot": "avatar-fallback",
      className: cn(
        "bg-muted flex size-full items-center justify-center rounded-full",
        className
      ),
      ...props
    }
  );
}

// components/ui/button.tsx
var React3 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");
var import_class_variance_authority = require("class-variance-authority");
var buttonVariants = (0, import_class_variance_authority.cva)(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline: "border border-input-border bg-input hover:bg-muted hover:text-foreground dark:bg-input dark:hover:bg-muted",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline"
      },
      size: {
        default: "h-9 px-4 gap-2 py-2 has-[>svg]:px-3 [&_svg:not([class*='size-'])]:size-4",
        sm: "h-8 rounded-md gap-2 px-3 has-[>svg]:px-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 rounded-md gap-2 px-6 has-[>svg]:px-4 [&_svg:not([class*='size-'])]:size-4",
        icon: "size-9 [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-10 [&_svg:not([class*='size-'])]:size-4"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);
function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}) {
  const Comp = asChild ? import_radix_ui2.Slot.Slot : "button";
  return /* @__PURE__ */ React3.createElement(
    Comp,
    {
      "data-slot": "button",
      className: cn(buttonVariants({ variant, size, className })),
      ...props
    }
  );
}

// components/ui/checkbox.tsx
var React4 = __toESM(require("react"));
var import_radix_ui3 = require("radix-ui");
var import_lucide_react = require("lucide-react");
function Checkbox({
  className,
  ...props
}) {
  return /* @__PURE__ */ React4.createElement(
    import_radix_ui3.Checkbox.Root,
    {
      "data-slot": "checkbox",
      className: cn(
        "group/checkbox peer border-input-border bg-input dark:bg-input data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 rounded-[4px] border transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React4.createElement(
      import_radix_ui3.Checkbox.Indicator,
      {
        "data-slot": "checkbox-indicator",
        className: "grid place-content-center text-current transition-none"
      },
      /* @__PURE__ */ React4.createElement(import_lucide_react.CheckIcon, { className: "size-3 group-data-[state=indeterminate]/checkbox:hidden", strokeWidth: 3 }),
      /* @__PURE__ */ React4.createElement(import_lucide_react.MinusIcon, { className: "hidden size-3 group-data-[state=indeterminate]/checkbox:block", strokeWidth: 3 })
    )
  );
}

// components/ui/dropdown-menu.tsx
var React5 = __toESM(require("react"));
var import_radix_ui4 = require("radix-ui");
var import_lucide_react2 = require("lucide-react");
function DropdownMenu({
  ...props
}) {
  return /* @__PURE__ */ React5.createElement(import_radix_ui4.DropdownMenu.Root, { "data-slot": "dropdown-menu", ...props });
}
function DropdownMenuPortal({
  ...props
}) {
  return /* @__PURE__ */ React5.createElement(import_radix_ui4.DropdownMenu.Portal, { "data-slot": "dropdown-menu-portal", ...props });
}
function DropdownMenuTrigger({
  id: idProp,
  ...props
}) {
  const stableId = React5.useId();
  const id = idProp ?? stableId;
  return /* @__PURE__ */ React5.createElement(
    import_radix_ui4.DropdownMenu.Trigger,
    {
      "data-slot": "dropdown-menu-trigger",
      ...props,
      id
    }
  );
}
function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}) {
  return /* @__PURE__ */ React5.createElement(import_radix_ui4.DropdownMenu.Portal, null, /* @__PURE__ */ React5.createElement(
    import_radix_ui4.DropdownMenu.Content,
    {
      "data-slot": "dropdown-menu-content",
      sideOffset,
      className: cn(
        "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md",
        className
      ),
      ...props
    }
  ));
}
function DropdownMenuGroup({
  ...props
}) {
  return /* @__PURE__ */ React5.createElement(import_radix_ui4.DropdownMenu.Group, { "data-slot": "dropdown-menu-group", ...props });
}
function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}) {
  return /* @__PURE__ */ React5.createElement(
    import_radix_ui4.DropdownMenu.Item,
    {
      "data-slot": "dropdown-menu-item",
      "data-inset": inset,
      "data-variant": variant,
      className: cn(
        "focus:!bg-muted focus:text-foreground data-[highlighted]:!bg-muted hover:!bg-muted hover:text-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:hover:!bg-destructive/8 data-[variant=destructive]:focus:!bg-destructive/8 data-[variant=destructive]:data-[highlighted]:!bg-destructive/8 dark:data-[variant=destructive]:hover:!bg-destructive/8 dark:data-[variant=destructive]:focus:!bg-destructive/8 dark:data-[variant=destructive]:data-[highlighted]:!bg-destructive/8 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:transition-colors hover:[&_svg:not([class*='text-'])]:text-current focus:[&_svg:not([class*='text-'])]:text-current data-[highlighted]:[&_svg:not([class*='text-'])]:text-current relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      ),
      ...props
    }
  );
}
function DropdownMenuSeparator({
  className,
  ...props
}) {
  return /* @__PURE__ */ React5.createElement(
    import_radix_ui4.DropdownMenu.Separator,
    {
      "data-slot": "dropdown-menu-separator",
      className: cn("bg-border -mx-1 my-1 h-px", className),
      ...props
    }
  );
}
function DropdownMenuSub({
  ...props
}) {
  return /* @__PURE__ */ React5.createElement(import_radix_ui4.DropdownMenu.Sub, { "data-slot": "dropdown-menu-sub", ...props });
}
function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}) {
  return /* @__PURE__ */ React5.createElement(
    import_radix_ui4.DropdownMenu.SubTrigger,
    {
      "data-slot": "dropdown-menu-sub-trigger",
      "data-inset": inset,
      className: cn(
        "focus:bg-muted focus:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground [&_svg:not([class*='text-'])]:text-muted-foreground flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      ),
      ...props
    },
    children,
    /* @__PURE__ */ React5.createElement(import_lucide_react2.ChevronRightIcon, { className: "ml-auto size-4" })
  );
}
function DropdownMenuSubContent({
  className,
  ...props
}) {
  return /* @__PURE__ */ React5.createElement(
    import_radix_ui4.DropdownMenu.SubContent,
    {
      "data-slot": "dropdown-menu-sub-content",
      className: cn(
        "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-md border p-1 shadow-lg",
        className
      ),
      ...props
    }
  );
}

// components/ui/filter-popover.tsx
var import_lucide_react3 = require("lucide-react");
var import_react = require("react");

// components/ui/table-filters.ts
var TableDatePreset = {
  Last24h: "LAST_24H",
  Last7d: "LAST_7D",
  Last30d: "LAST_30D",
  Last3m: "LAST_3M",
  Custom: "CUSTOM"
};
var TABLE_DATE_PRESET_LABELS = {
  [TableDatePreset.Last24h]: "Last 24 hours",
  [TableDatePreset.Last7d]: "Last 7 days",
  [TableDatePreset.Last30d]: "Last 30 days",
  [TableDatePreset.Last3m]: "Last 3 months",
  [TableDatePreset.Custom]: "Custom range"
};
var TableDateFilterField = {
  CreatedAt: "CREATED_AT",
  UpdatedAt: "UPDATED_AT"
};

// components/ui/filter-popover.tsx
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
  const [open, setOpen] = (0, import_react.useState)(false);
  const labels = useLabels(viewModel.labels);
  return /* @__PURE__ */ React.createElement(DropdownMenu, { onOpenChange: setOpen, open }, /* @__PURE__ */ React.createElement(DropdownMenuTrigger, { asChild: true }, /* @__PURE__ */ React.createElement(
    Button,
    {
      "aria-label": labels.filterButton,
      className: "h-8 shadow-none",
      size: "sm",
      variant: "outline"
    },
    /* @__PURE__ */ React.createElement(import_lucide_react3.ListFilterIcon, null),
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
    filters.assignToMe && /* @__PURE__ */ React.createElement(import_lucide_react3.CheckIcon, { className: "ml-auto size-4" })
  ), /* @__PURE__ */ React.createElement(
    DropdownMenuItem,
    {
      onSelect: (event) => {
        event.preventDefault();
        toggleHideCompletedItems();
      }
    },
    /* @__PURE__ */ React.createElement(import_lucide_react3.EyeOffIcon, { className: "size-4" }),
    /* @__PURE__ */ React.createElement("span", { className: cn(filters.hideCompletedItems && "font-medium") }, labels.hideCompletedItems),
    filters.hideCompletedItems && /* @__PURE__ */ React.createElement(import_lucide_react3.CheckIcon, { className: "ml-auto size-4" })
  ), /* @__PURE__ */ React.createElement(
    DropdownMenuItem,
    {
      onSelect: (event) => {
        event.preventDefault();
        toggleFavoritesOnly();
      }
    },
    /* @__PURE__ */ React.createElement(import_lucide_react3.StarIcon, { className: "size-4" }),
    /* @__PURE__ */ React.createElement("span", { className: cn(filters.favoritesOnly && "font-medium") }, labels.favoritesOnly),
    filters.favoritesOnly && /* @__PURE__ */ React.createElement(import_lucide_react3.CheckIcon, { className: "ml-auto size-4" })
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
  const [search, setSearch] = (0, import_react.useState)("");
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
      selected && /* @__PURE__ */ React.createElement(import_lucide_react3.CheckIcon, { className: "ml-auto size-4" })
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
  const [search, setSearch] = (0, import_react.useState)("");
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
  return /* @__PURE__ */ React.createElement(DropdownMenuSub, null, /* @__PURE__ */ React.createElement(DropdownMenuSubTrigger, null, /* @__PURE__ */ React.createElement(import_lucide_react3.UsersIcon, { className: "size-4" }), /* @__PURE__ */ React.createElement("span", { className: "flex-1" }, labels.assignee), controller.filters.assigneeIds.length > 0 && /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground text-xs" }, controller.filters.assigneeIds.length)), /* @__PURE__ */ React.createElement(DropdownMenuPortal, null, /* @__PURE__ */ React.createElement(DropdownMenuSubContent, { className: "w-64" }, /* @__PURE__ */ React.createElement(AssigneeFilterContent, { controller, viewModel }))));
}
function DatesSubmenu({
  controller,
  datePresetOptions,
  labels
}) {
  return /* @__PURE__ */ React.createElement(DropdownMenuSub, null, /* @__PURE__ */ React.createElement(DropdownMenuSubTrigger, null, /* @__PURE__ */ React.createElement(import_lucide_react3.CalendarIcon, { className: "size-4" }), /* @__PURE__ */ React.createElement("span", { className: "flex-1" }, labels.dates), controller.filters.date && /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground text-xs" }, "1")), /* @__PURE__ */ React.createElement(DropdownMenuPortal, null, /* @__PURE__ */ React.createElement(DropdownMenuSubContent, { className: "w-48" }, /* @__PURE__ */ React.createElement(
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
  return /* @__PURE__ */ React.createElement(DropdownMenuSub, null, /* @__PURE__ */ React.createElement(DropdownMenuSubTrigger, null, /* @__PURE__ */ React.createElement(import_lucide_react3.CalendarIcon, { className: "size-4" }), /* @__PURE__ */ React.createElement("span", { className: "flex-1" }, label)), /* @__PURE__ */ React.createElement(DropdownMenuPortal, null, /* @__PURE__ */ React.createElement(DropdownMenuSubContent, { className: "w-44" }, /* @__PURE__ */ React.createElement(
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
  return /* @__PURE__ */ React.createElement(DropdownMenuSub, null, /* @__PURE__ */ React.createElement(DropdownMenuSubTrigger, null, /* @__PURE__ */ React.createElement(import_lucide_react3.TagIcon, { className: "size-4" }), /* @__PURE__ */ React.createElement("span", { className: "flex-1" }, labels.tags), selectedTagIds.length > 0 && /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground text-xs" }, selectedTagIds.length)), /* @__PURE__ */ React.createElement(DropdownMenuPortal, null, /* @__PURE__ */ React.createElement(DropdownMenuSubContent, { className: "w-56" }, options.length === 0 ? /* @__PURE__ */ React.createElement(DropdownMenuItem, { disabled: true }, labels.noTags) : options.map((tag) => /* @__PURE__ */ React.createElement(
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
  return (0, import_react.useMemo)(
    () => ({
      ...DEFAULT_LABELS,
      ...labels
    }),
    [labels]
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AssigneeFilterContent,
  DateFilterContent,
  FilterMenuContent,
  FilterPopover,
  PriorityFilterContent,
  StatusFilterContent,
  TagsFilterContent
});
//# sourceMappingURL=filter-popover.js.map