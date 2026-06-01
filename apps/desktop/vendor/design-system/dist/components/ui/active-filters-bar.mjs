import React from "react";
"use client";
import {
  FilterChip
} from "../../chunk-XTJNTM4A.mjs";
import {
  AssigneeFilterContent,
  DateFilterContent,
  FilterMenuContent,
  PriorityFilterContent,
  StatusFilterContent,
  TagsFilterContent
} from "../../chunk-DU44ZW3G.mjs";
import "../../chunk-ASHTD3OK.mjs";
import "../../chunk-SF4RI47G.mjs";
import {
  DropdownMenu,
  DropdownMenuTrigger
} from "../../chunk-M266NC23.mjs";
import "../../chunk-ZI7L5RNU.mjs";
import {
  Button
} from "../../chunk-TT7DUYOP.mjs";
import "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/active-filters-bar.tsx
import { PlusIcon } from "lucide-react";
var DEFAULT_LABELS = {
  addFilter: "Add filter",
  clearAll: "Clear all"
};
function ActiveFiltersBar({
  controller,
  viewModel
}) {
  const labels = {
    ...DEFAULT_LABELS,
    ...viewModel.labels
  };
  const visibleChips = controller.activeChips.filter(
    (chip) => (!viewModel.hideAssignee || chip.category !== "assignee") && ((viewModel.showTags ?? true) || chip.category !== "tags")
  );
  return /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-1 px-4 pb-2" }, visibleChips.map((chip) => /* @__PURE__ */ React.createElement(
    FilterChip,
    {
      dropdownClassName: chip.category === "assignee" ? "w-64" : void 0,
      key: chip.category,
      label: chip.label,
      onRemove: () => controller.clearCategoryFilter(chip.category)
    },
    chip.category !== "hideCompleted" && chip.category !== "favorites" && /* @__PURE__ */ React.createElement(
      ChipDropdownContent,
      {
        category: chip.category,
        controller,
        viewModel
      }
    )
  )), /* @__PURE__ */ React.createElement(DropdownMenu, null, /* @__PURE__ */ React.createElement(DropdownMenuTrigger, { asChild: true }, /* @__PURE__ */ React.createElement(
    "button",
    {
      "aria-label": labels.addFilter,
      className: "inline-flex items-center self-stretch rounded-md border px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground",
      type: "button"
    },
    /* @__PURE__ */ React.createElement(PlusIcon, { className: "size-3.5" })
  )), /* @__PURE__ */ React.createElement(FilterMenuContent, { controller, viewModel })), /* @__PURE__ */ React.createElement(
    Button,
    {
      className: "h-auto px-2 py-1 text-xs",
      onClick: controller.clearAllFilters,
      variant: "ghost"
    },
    labels.clearAll
  ));
}
function ChipDropdownContent({
  category,
  controller,
  viewModel
}) {
  switch (category) {
    case "assignee":
      return /* @__PURE__ */ React.createElement(AssigneeFilterContent, { controller, viewModel });
    case "status":
      return /* @__PURE__ */ React.createElement(StatusFilterContent, { controller, viewModel });
    case "priority":
      return /* @__PURE__ */ React.createElement(PriorityFilterContent, { controller, viewModel });
    case "date":
      return /* @__PURE__ */ React.createElement(DateFilterContent, { controller });
    case "tags":
      return /* @__PURE__ */ React.createElement(TagsFilterContent, { controller, viewModel });
    default:
      return null;
  }
}
export {
  ActiveFiltersBar
};
//# sourceMappingURL=active-filters-bar.mjs.map