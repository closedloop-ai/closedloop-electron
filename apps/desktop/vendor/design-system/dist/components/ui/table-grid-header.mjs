import React from "react";
"use client";
import {
  SortIndicator,
  getNextSortDirection
} from "../../chunk-KFUQVXFR.mjs";
import "../../chunk-PWY5AK4F.mjs";
import {
  Checkbox
} from "../../chunk-SF4RI47G.mjs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../../chunk-M266NC23.mjs";
import {
  cn
} from "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

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
export {
  TableGridHeader
};
//# sourceMappingURL=table-grid-header.mjs.map