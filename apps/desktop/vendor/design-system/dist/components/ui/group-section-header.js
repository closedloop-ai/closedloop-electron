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

// components/ui/group-section-header.tsx
var group_section_header_exports = {};
__export(group_section_header_exports, {
  GroupSectionHeader: () => GroupSectionHeader
});
module.exports = __toCommonJS(group_section_header_exports);

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/group-section-header.tsx
var import_lucide_react = require("lucide-react");
function GroupSectionHeader({
  icon,
  label,
  count,
  isOpen,
  onToggle,
  className
}) {
  return /* @__PURE__ */ React.createElement(
    "button",
    {
      className: cn(
        "flex w-full items-center gap-2.5 border-b bg-muted/50 py-2.5 pr-4 pl-[18px] font-medium text-sm hover:bg-accent/50",
        className
      ),
      onClick: onToggle,
      type: "button"
    },
    isOpen ? /* @__PURE__ */ React.createElement(import_lucide_react.ChevronDownIcon, { className: "h-4 w-4 shrink-0 text-muted-foreground" }) : /* @__PURE__ */ React.createElement(import_lucide_react.ChevronRightIcon, { className: "h-4 w-4 shrink-0 text-muted-foreground" }),
    icon,
    /* @__PURE__ */ React.createElement("span", null, label),
    /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground text-xs" }, count)
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GroupSectionHeader
});
//# sourceMappingURL=group-section-header.js.map