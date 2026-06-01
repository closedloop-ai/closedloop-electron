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

// components/ui/sortable-column-header.tsx
var sortable_column_header_exports = {};
__export(sortable_column_header_exports, {
  SortIndicator: () => SortIndicator,
  SortableColumnHeader: () => SortableColumnHeader,
  getNextSortDirection: () => getNextSortDirection
});
module.exports = __toCommonJS(sortable_column_header_exports);

// components/ui/table.tsx
var React2 = __toESM(require("react"));

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/table.tsx
function TableHead({ className, ...props }) {
  return /* @__PURE__ */ React2.createElement(
    "th",
    {
      "data-slot": "table-head",
      className: cn(
        "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      ),
      ...props
    }
  );
}

// components/ui/sortable-column-header.tsx
var import_lucide_react = require("lucide-react");
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
      import_lucide_react.ArrowUpDown,
      {
        className: cn("h-3.5 w-3.5 text-muted-foreground", className)
      }
    );
  }
  if (direction === "asc") {
    return /* @__PURE__ */ React.createElement(import_lucide_react.ArrowUp, { className: cn("h-3.5 w-3.5", className) });
  }
  return /* @__PURE__ */ React.createElement(import_lucide_react.ArrowDown, { className: cn("h-3.5 w-3.5", className) });
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SortIndicator,
  SortableColumnHeader,
  getNextSortDirection
});
//# sourceMappingURL=sortable-column-header.js.map