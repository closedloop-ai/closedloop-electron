var React = require("react");
"use strict";
"use client";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// components/ui/group-header-row.tsx
var group_header_row_exports = {};
__export(group_header_row_exports, {
  GroupHeaderRow: () => GroupHeaderRow
});
module.exports = __toCommonJS(group_header_row_exports);

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/group-header-row.tsx
var import_lucide_react = require("lucide-react");
function GroupHeaderRow({
  title,
  count,
  isOpen,
  onToggle,
  className
}) {
  return /* @__PURE__ */ React.createElement(
    "button",
    {
      className: cn(
        "flex h-12 w-full cursor-pointer items-center gap-1 border-b bg-background px-1 text-left hover:bg-muted/50",
        className
      ),
      onClick: onToggle,
      type: "button"
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex shrink-0 items-center justify-center p-1.5" }, isOpen ? /* @__PURE__ */ React.createElement(import_lucide_react.ChevronDownIcon, { className: "h-5 w-5 text-muted-foreground" }) : /* @__PURE__ */ React.createElement(import_lucide_react.ChevronRightIcon, { className: "h-5 w-5 text-muted-foreground" })),
    /* @__PURE__ */ React.createElement("span", { className: "font-medium text-foreground text-sm" }, title),
    /* @__PURE__ */ React.createElement("span", { className: "ml-1 text-muted-foreground text-xs" }, "(", count, ")")
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GroupHeaderRow
});
//# sourceMappingURL=group-header-row.js.map