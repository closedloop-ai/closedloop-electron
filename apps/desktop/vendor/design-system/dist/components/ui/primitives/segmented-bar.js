var React = require("react");
"use strict";
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

// components/ui/primitives/segmented-bar.tsx
var segmented_bar_exports = {};
__export(segmented_bar_exports, {
  SegmentedBar: () => SegmentedBar
});
module.exports = __toCommonJS(segmented_bar_exports);

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/primitives/segmented-bar.tsx
function SegmentedBar({
  segments,
  total,
  className
}) {
  return /* @__PURE__ */ React.createElement("div", { className: cn("space-y-3", className) }, /* @__PURE__ */ React.createElement("div", { className: "flex h-2 w-full overflow-hidden rounded-full bg-muted/50" }, segments.map((segment) => {
    const pct = total > 0 ? segment.value / total * 100 : 0;
    if (pct <= 0) {
      return null;
    }
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        className: cn(
          segment.colorClassName,
          "opacity-85 transition-opacity hover:opacity-100"
        ),
        key: segment.key,
        style: { width: `${pct}%` },
        title: `${segment.label}: ${segment.value.toLocaleString()} (${pct.toFixed(1)}%)`
      }
    );
  })), /* @__PURE__ */ React.createElement("div", { className: "grid gap-2 sm:grid-cols-2 xl:grid-cols-4" }, segments.map((segment) => {
    const pct = total > 0 ? segment.value / total * 100 : 0;
    return /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2", key: segment.key }, /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cn(
          "block size-2 rounded-full",
          segment.colorClassName
        )
      }
    ), /* @__PURE__ */ React.createElement("span", { className: "text-[11px] text-muted-foreground" }, segment.label), /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cn(
          "ml-auto font-mono text-xs",
          segment.textClassName
        )
      },
      segment.value.toLocaleString(),
      pct > 0 ? /* @__PURE__ */ React.createElement("span", { className: "ml-1 text-[10px] text-muted-foreground" }, pct >= 1 ? Math.round(pct) : pct.toFixed(1), "%") : null
    ));
  })));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SegmentedBar
});
//# sourceMappingURL=segmented-bar.js.map