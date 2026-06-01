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

// components/ui/collapsible-section.tsx
var collapsible_section_exports = {};
__export(collapsible_section_exports, {
  CollapsibleSection: () => CollapsibleSection
});
module.exports = __toCommonJS(collapsible_section_exports);

// components/ui/section-header.tsx
var import_lucide_react = require("lucide-react");
function SectionHeader({
  title,
  children,
  isOpen,
  onToggle
}) {
  const showToggle = onToggle !== void 0 && isOpen !== void 0;
  return /* @__PURE__ */ React.createElement("div", { className: "flex h-12 items-center gap-2 border-b py-2" }, showToggle ? /* @__PURE__ */ React.createElement(
    "button",
    {
      "aria-expanded": isOpen,
      className: "flex shrink-0 items-center gap-2",
      onClick: onToggle,
      type: "button"
    },
    /* @__PURE__ */ React.createElement("span", { className: "font-semibold text-lg" }, title),
    isOpen ? /* @__PURE__ */ React.createElement(import_lucide_react.ChevronDownIcon, { className: "h-4 w-4" }) : /* @__PURE__ */ React.createElement(import_lucide_react.ChevronRightIcon, { className: "h-4 w-4" })
  ) : /* @__PURE__ */ React.createElement("span", { className: "shrink-0 font-semibold text-lg" }, title), /* @__PURE__ */ React.createElement("div", { className: "min-w-0 flex-1" }), children ? /* @__PURE__ */ React.createElement("div", { className: "flex shrink-0 items-center gap-2" }, children) : null);
}

// components/ui/collapsible-section.tsx
function CollapsibleSection({
  title,
  open,
  onOpenChange,
  children,
  contentClassName = "space-y-4 pt-3 pb-3"
}) {
  return /* @__PURE__ */ React.createElement("div", { className: "bg-background" }, /* @__PURE__ */ React.createElement(
    SectionHeader,
    {
      isOpen: open,
      onToggle: () => onOpenChange(!open),
      title
    }
  ), open ? /* @__PURE__ */ React.createElement("div", { className: contentClassName }, children) : null);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CollapsibleSection
});
//# sourceMappingURL=collapsible-section.js.map