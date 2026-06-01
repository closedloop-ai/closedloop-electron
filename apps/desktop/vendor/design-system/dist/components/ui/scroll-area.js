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

// components/ui/scroll-area.tsx
var scroll_area_exports = {};
__export(scroll_area_exports, {
  ScrollArea: () => ScrollArea,
  ScrollBar: () => ScrollBar
});
module.exports = __toCommonJS(scroll_area_exports);
var React = __toESM(require("react"));
var import_radix_ui = require("radix-ui");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/scroll-area.tsx
function ScrollArea({
  className,
  children,
  scrollbars = "vertical",
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    import_radix_ui.ScrollArea.Root,
    {
      "data-slot": "scroll-area",
      className: cn("relative", className),
      ...props
    },
    /* @__PURE__ */ React.createElement(
      import_radix_ui.ScrollArea.Viewport,
      {
        "data-slot": "scroll-area-viewport",
        className: "focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1"
      },
      children
    ),
    (scrollbars === "vertical" || scrollbars === "both") && /* @__PURE__ */ React.createElement(ScrollBar, { orientation: "vertical" }),
    (scrollbars === "horizontal" || scrollbars === "both") && /* @__PURE__ */ React.createElement(ScrollBar, { orientation: "horizontal" }),
    scrollbars === "both" && /* @__PURE__ */ React.createElement(import_radix_ui.ScrollArea.Corner, null)
  );
}
function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    import_radix_ui.ScrollArea.ScrollAreaScrollbar,
    {
      "data-slot": "scroll-area-scrollbar",
      orientation,
      className: cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" && "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" && "h-2.5 flex-col border-t border-t-transparent",
        className
      ),
      ...props
    },
    /* @__PURE__ */ React.createElement(
      import_radix_ui.ScrollArea.ScrollAreaThumb,
      {
        "data-slot": "scroll-area-thumb",
        className: "bg-border relative flex-1 rounded-full"
      }
    )
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ScrollArea,
  ScrollBar
});
//# sourceMappingURL=scroll-area.js.map