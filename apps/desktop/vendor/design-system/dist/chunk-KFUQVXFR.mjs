import React from "react";
import {
  TableHead
} from "./chunk-PWY5AK4F.mjs";
import {
  cn
} from "./chunk-522NBUZJ.mjs";

// components/ui/sortable-column-header.tsx
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
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
      ArrowUpDown,
      {
        className: cn("h-3.5 w-3.5 text-muted-foreground", className)
      }
    );
  }
  if (direction === "asc") {
    return /* @__PURE__ */ React.createElement(ArrowUp, { className: cn("h-3.5 w-3.5", className) });
  }
  return /* @__PURE__ */ React.createElement(ArrowDown, { className: cn("h-3.5 w-3.5", className) });
}
function SortableColumnHeader({
  column,
  label,
  sortBy,
  sortDir,
  onSort,
  className
}) {
  const isActive = sortBy === column;
  function handleClick() {
    onSort(column, getNextSortDirection(isActive, sortDir));
  }
  return /* @__PURE__ */ React.createElement(TableHead, { className }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "inline-flex items-center gap-1 hover:text-foreground",
      onClick: handleClick,
      type: "button"
    },
    label,
    /* @__PURE__ */ React.createElement(SortIndicator, { direction: sortDir, isActive })
  ));
}

export {
  getNextSortDirection,
  SortIndicator,
  SortableColumnHeader
};
//# sourceMappingURL=chunk-KFUQVXFR.mjs.map