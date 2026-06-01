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

// components/ui/evaluation-section.tsx
var evaluation_section_exports = {};
__export(evaluation_section_exports, {
  EvaluationSection: () => EvaluationSection
});
module.exports = __toCommonJS(evaluation_section_exports);

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

// components/ui/progress.tsx
var React2 = __toESM(require("react"));
var import_radix_ui = require("radix-ui");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/progress.tsx
function Progress({
  className,
  value,
  ...props
}) {
  return /* @__PURE__ */ React2.createElement(
    import_radix_ui.Progress.Root,
    {
      "data-slot": "progress",
      className: cn(
        "bg-primary/20 relative h-2 w-full overflow-hidden rounded-full",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React2.createElement(
      import_radix_ui.Progress.Indicator,
      {
        "data-slot": "progress-indicator",
        className: "bg-primary h-full w-full flex-1 transition-all",
        style: { transform: `translateX(-${100 - (value || 0)}%)` }
      }
    )
  );
}

// components/ui/evaluation-section.tsx
var import_react = require("react");
function EvaluationSection({
  title = "Evaluation",
  defaultOpen = false,
  state,
  awaitingMessage = "Awaiting LLM Judges feedback",
  emptyMessage = "No judges have been evaluated yet",
  acceptedCount = 0,
  totalCount = 0,
  children
}) {
  const [isOpen, setIsOpen] = (0, import_react.useState)(defaultOpen);
  const acceptanceRate = totalCount > 0 ? Math.round(acceptedCount / totalCount * 100) : 0;
  return /* @__PURE__ */ React.createElement(
    CollapsibleSection,
    {
      onOpenChange: setIsOpen,
      open: isOpen,
      title
    },
    state === "awaiting" ? /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground text-sm" }, awaitingMessage) : null,
    state === "empty" ? /* @__PURE__ */ React.createElement("p", { className: "text-muted-foreground text-sm" }, emptyMessage) : null,
    state === "ready" ? /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-1.5" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between text-xs" }, /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground" }, acceptedCount, "/", totalCount, " judges accepted"), /* @__PURE__ */ React.createElement("span", { className: "font-medium" }, acceptanceRate.toFixed(0), "%")), /* @__PURE__ */ React.createElement(Progress, { className: "h-2", value: acceptanceRate })), /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, children)) : null
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EvaluationSection
});
//# sourceMappingURL=evaluation-section.js.map