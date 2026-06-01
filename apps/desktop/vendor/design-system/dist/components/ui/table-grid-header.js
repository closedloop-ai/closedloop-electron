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

// components/ui/table-grid-header.tsx
var table_grid_header_exports = {};
__export(table_grid_header_exports, {
  TableGridHeader: () => TableGridHeader
});
module.exports = __toCommonJS(table_grid_header_exports);

// components/ui/checkbox.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
var import_lucide_react = require("lucide-react");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/checkbox.tsx
function Checkbox({
  className,
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    import_radix_ui.Checkbox.Root,
    {
      "data-slot": "checkbox",
      className: cn(
        "group/checkbox peer border-input-border bg-input dark:bg-input data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 rounded-[4px] border transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React2.createElement(
      import_radix_ui.Checkbox.Indicator,
      {
        "data-slot": "checkbox-indicator",
        className: "grid place-content-center text-current transition-none"
      },
      /* @__PURE__ */ React2.createElement(import_lucide_react.CheckIcon, { className: "size-3 group-data-[state=indeterminate]/checkbox:hidden", strokeWidth: 3 }),
      /* @__PURE__ */ React2.createElement(import_lucide_react.MinusIcon, { className: "hidden size-3 group-data-[state=indeterminate]/checkbox:block", strokeWidth: 3 })
    )
  );
}

// components/ui/dropdown-menu.tsx
var React3 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");
var import_lucide_react2 = require("lucide-react");
function DropdownMenu({
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(import_radix_ui2.DropdownMenu.Root, { "data-slot": "dropdown-menu", ...props });
}
function DropdownMenuTrigger({
  id: idProp,
  ...props
}) {
  const stableId = React3.useId();
  const id = idProp ?? stableId;
  return /* @__PURE__ */ React3.createElement(
    import_radix_ui2.DropdownMenu.Trigger,
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
  return /* @__PURE__ */ React3.createElement(import_radix_ui2.DropdownMenu.Portal, null, /* @__PURE__ */ React3.createElement(
    import_radix_ui2.DropdownMenu.Content,
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
function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}) {
  return /* @__PURE__ */ React3.createElement(
    import_radix_ui2.DropdownMenu.Item,
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

// components/ui/table.tsx
var React4 = __toESM(require("react"));

// components/ui/sortable-column-header.tsx
var import_lucide_react3 = require("lucide-react");
function getNextSortDirection(isActive, currentDirection) {
  if (!isActive) {
    return "desc";
  }
  return currentDirection === "desc" ? "asc" : "desc";
}
function SortIndicator({
  isActive,
  direction,
  className
}) {
  if (!isActive) {
    return /* @__PURE__ */ React.createElement(
      import_lucide_react3.ArrowUpDown,
      {
        className: cn("h-3.5 w-3.5 text-muted-foreground", className)
      }
    );
  }
  if (direction === "asc") {
    return /* @__PURE__ */ React.createElement(import_lucide_react3.ArrowUp, { className: cn("h-3.5 w-3.5", className) });
  }
  return /* @__PURE__ */ React.createElement(import_lucide_react3.ArrowDown, { className: cn("h-3.5 w-3.5", className) });
}

// components/ui/table-grid-header.tsx
function TableGridHeader({
  gridTemplateColumns,
  columns,
  sortBy,
  sortDir,
  onSort,
  leadingLabel = "Name",
  leadingSortKey,
  leadingSortOptions,
  onClearSort,
  showSelectAll,
  allSelected,
  someSelected,
  onSelectAll,
  showRankSlot = false,
  trailingCell,
  className
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn(
        "sticky top-0 z-10 grid h-10 min-w-fit border-b bg-background",
        className
      ),
      style: { gridTemplateColumns }
    },
    showRankSlot ? /* @__PURE__ */ React.createElement("div", null) : null,
    /* @__PURE__ */ React.createElement("div", { className: "flex min-w-0 items-center py-2 pr-3 pl-4" }, showSelectAll ? /* @__PURE__ */ React.createElement(
      Checkbox,
      {
        checked: getSelectAllState(allSelected, someSelected),
        className: "mr-2",
        onCheckedChange: (checked) => onSelectAll?.(checked === true)
      }
    ) : null, /* @__PURE__ */ React.createElement(
      LeadingHeaderControl,
      {
        label: leadingLabel,
        onClearSort,
        onSort,
        sortBy,
        sortDir,
        sortKey: leadingSortKey,
        sortOptions: leadingSortOptions
      }
    )),
    columns.map((column) => /* @__PURE__ */ React.createElement(
      "div",
      {
        className: cn(
          "flex h-10 min-w-0 items-center border-l px-3 py-2",
          column.className
        ),
        key: column.id
      },
      column.sortable ? /* @__PURE__ */ React.createElement(
        "button",
        {
          className: "flex flex-1 items-center gap-1 overflow-hidden hover:text-foreground",
          onClick: () => onSort(column.id, getNextSortDirection(sortBy === column.id, sortDir)),
          type: "button"
        },
        /* @__PURE__ */ React.createElement("span", { className: "truncate font-medium text-muted-foreground text-xs" }, column.label),
        /* @__PURE__ */ React.createElement(
          SortIndicator,
          {
            className: "h-3 w-3",
            direction: sortDir,
            isActive: sortBy === column.id
          }
        )
      ) : /* @__PURE__ */ React.createElement("span", { className: "truncate font-medium text-muted-foreground text-xs" }, column.label)
    )),
    trailingCell ?? /* @__PURE__ */ React.createElement("div", { className: "h-10 border-l" })
  );
}
function LeadingHeaderControl({
  label,
  sortKey,
  sortOptions,
  sortBy,
  sortDir,
  onSort,
  onClearSort
}) {
  if (sortOptions?.length) {
    const isActive = sortOptions.some((option) => option.key === sortBy);
    return /* @__PURE__ */ React.createElement(DropdownMenu, null, /* @__PURE__ */ React.createElement(DropdownMenuTrigger, { asChild: true }, /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "flex items-center gap-1 hover:text-foreground",
        type: "button"
      },
      /* @__PURE__ */ React.createElement("span", { className: "font-medium text-muted-foreground text-xs" }, label),
      /* @__PURE__ */ React.createElement(
        SortIndicator,
        {
          className: "h-3 w-3",
          direction: sortDir,
          isActive
        }
      )
    )), /* @__PURE__ */ React.createElement(DropdownMenuContent, { align: "start" }, sortOptions.map((option) => /* @__PURE__ */ React.createElement(
      DropdownMenuItem,
      {
        key: option.key,
        onClick: () => {
          if (sortBy !== option.key) {
            onSort(option.key, "asc");
          } else if (sortDir === "asc") {
            onSort(option.key, "desc");
          } else {
            onClearSort?.();
          }
        }
      },
      /* @__PURE__ */ React.createElement("span", { className: "flex-1 text-sm" }, option.label),
      /* @__PURE__ */ React.createElement(
        SortIndicator,
        {
          className: "h-3 w-3",
          direction: sortDir,
          isActive: sortBy === option.key
        }
      )
    ))));
  }
  if (sortKey) {
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "flex items-center gap-1 hover:text-foreground",
        onClick: () => onSort(sortKey, getNextSortDirection(sortBy === sortKey, sortDir)),
        type: "button"
      },
      /* @__PURE__ */ React.createElement("span", { className: "font-medium text-muted-foreground text-xs" }, label),
      /* @__PURE__ */ React.createElement(
        SortIndicator,
        {
          className: "h-3 w-3",
          direction: sortDir,
          isActive: sortBy === sortKey
        }
      )
    );
  }
  return /* @__PURE__ */ React.createElement("span", { className: "font-medium text-muted-foreground text-xs" }, label);
}
function getSelectAllState(allSelected, someSelected) {
  if (allSelected) {
    return true;
  }
  if (someSelected) {
    return "indeterminate";
  }
  return false;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TableGridHeader
});
//# sourceMappingURL=table-grid-header.js.map