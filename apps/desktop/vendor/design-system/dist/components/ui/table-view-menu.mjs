import React from "react";
"use client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "../../chunk-547UMAL4.mjs";
import {
  Switch
} from "../../chunk-W3BLYIXH.mjs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../../chunk-M266NC23.mjs";
import {
  Button
} from "../../chunk-TT7DUYOP.mjs";
import {
  ToggleGroup,
  ToggleGroupItem
} from "../../chunk-6NQCPXX4.mjs";
import "../../chunk-XS6N43AI.mjs";
import "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/table-view-menu.tsx
import {
  AlignLeftIcon,
  ChevronDownIcon,
  LayoutGridIcon,
  ListOrderedIcon,
  RotateCcwIcon,
  Settings2Icon
} from "lucide-react";
function GroupByModeSelect({
  value,
  options,
  onChange
}) {
  const selected = options.find((option) => option.value === value);
  return /* @__PURE__ */ React.createElement("div", { className: "flex flex-col px-4 pb-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex h-9 items-center justify-between" }, /* @__PURE__ */ React.createElement("span", { className: "text-sm" }, "Group by"), /* @__PURE__ */ React.createElement(DropdownMenu, null, /* @__PURE__ */ React.createElement(DropdownMenuTrigger, { asChild: true }, /* @__PURE__ */ React.createElement(Button, { className: "h-7 text-xs", size: "sm", variant: "outline" }, selected?.label ?? value, /* @__PURE__ */ React.createElement(ChevronDownIcon, { className: "h-3.5 w-3.5" }))), /* @__PURE__ */ React.createElement(DropdownMenuContent, { align: "end" }, options.map((option) => /* @__PURE__ */ React.createElement(
    DropdownMenuItem,
    {
      key: option.value,
      onClick: () => onChange(option.value)
    },
    option.label
  ))))));
}
function ViewModeToggle({
  view,
  onChangeView
}) {
  return /* @__PURE__ */ React.createElement("div", { className: "px-4 pt-2 pb-4" }, /* @__PURE__ */ React.createElement(
    ToggleGroup,
    {
      className: "w-full",
      onValueChange: (value) => {
        if (value === "list" || value === "card") {
          onChangeView(value);
        }
      },
      type: "single",
      value: view,
      variant: "outline"
    },
    /* @__PURE__ */ React.createElement(ToggleGroupItem, { className: "h-7 flex-1 text-xs", value: "list" }, /* @__PURE__ */ React.createElement(AlignLeftIcon, { className: "h-3.5 w-3.5" }), "List"),
    /* @__PURE__ */ React.createElement(ToggleGroupItem, { className: "h-7 flex-1 text-xs", value: "card" }, /* @__PURE__ */ React.createElement(LayoutGridIcon, { className: "h-3.5 w-3.5" }), "Card")
  ));
}
function TableViewMenu({
  columns,
  onToggleColumn,
  groupByValue,
  groupByOptions,
  onChangeGroupBy,
  view,
  onChangeView,
  onResetView,
  onResetToStackRank,
  viewHeading = "View Options",
  columnsHeading = "Show/Hide Columns"
}) {
  const showViewToggle = view != null && onChangeView != null;
  const showGroupByMode = groupByValue != null && groupByOptions != null && groupByOptions.length > 0 && onChangeGroupBy != null;
  const showColumnVisibility = columns != null && columns.length > 0 && onToggleColumn != null;
  const showOptionsHeading = showViewToggle || showGroupByMode;
  const showOptionsDivider = showOptionsHeading && showColumnVisibility;
  return /* @__PURE__ */ React.createElement(Popover, null, /* @__PURE__ */ React.createElement(PopoverTrigger, { asChild: true }, /* @__PURE__ */ React.createElement(Button, { className: "h-8 shadow-none", size: "sm", variant: "outline" }, /* @__PURE__ */ React.createElement(Settings2Icon, null), "View")), /* @__PURE__ */ React.createElement(PopoverContent, { align: "end", className: "w-72 p-0" }, showOptionsHeading ? /* @__PURE__ */ React.createElement("div", { className: "px-4 pt-4 pb-2" }, /* @__PURE__ */ React.createElement("h4", { className: "font-semibold text-lg" }, viewHeading)) : null, showViewToggle ? /* @__PURE__ */ React.createElement(ViewModeToggle, { onChangeView, view }) : null, showGroupByMode ? /* @__PURE__ */ React.createElement(
    GroupByModeSelect,
    {
      onChange: onChangeGroupBy,
      options: groupByOptions,
      value: groupByValue
    }
  ) : null, showOptionsDivider ? /* @__PURE__ */ React.createElement("div", { className: "mx-4 border-t" }) : null, showColumnVisibility ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between px-4 pt-4 pb-2" }, /* @__PURE__ */ React.createElement("h4", { className: "font-semibold text-base" }, columnsHeading)), /* @__PURE__ */ React.createElement("div", { className: "flex flex-col divide-y px-4 pb-3" }, columns.map((column) => /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "flex cursor-pointer items-center justify-between py-3",
      key: column.id
    },
    /* @__PURE__ */ React.createElement("span", { className: "flex items-center gap-2 text-sm" }, column.icon, column.label),
    /* @__PURE__ */ React.createElement(
      Switch,
      {
        checked: column.visible,
        id: `col-${column.id}`,
        onCheckedChange: () => onToggleColumn(column.id)
      }
    )
  )))) : null, onResetToStackRank || onResetView ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "mx-4 border-t" }), /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-1 px-4 py-3" }, onResetToStackRank ? /* @__PURE__ */ React.createElement(
    Button,
    {
      className: "h-7 w-full justify-start gap-2 text-muted-foreground text-xs",
      onClick: onResetToStackRank,
      size: "sm",
      variant: "ghost"
    },
    /* @__PURE__ */ React.createElement(ListOrderedIcon, { className: "h-3.5 w-3.5" }),
    "Reset to stack rank"
  ) : null, onResetView ? /* @__PURE__ */ React.createElement(
    Button,
    {
      className: "h-7 w-full justify-start gap-2 text-muted-foreground text-xs",
      onClick: onResetView,
      size: "sm",
      variant: "ghost"
    },
    /* @__PURE__ */ React.createElement(RotateCcwIcon, { className: "h-3.5 w-3.5" }),
    "Reset view"
  ) : null)) : null));
}
export {
  TableViewMenu
};
//# sourceMappingURL=table-view-menu.mjs.map