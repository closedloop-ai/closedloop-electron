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

// components/ui/priority-icon.tsx
var priority_icon_exports = {};
__export(priority_icon_exports, {
  PriorityIcon: () => PriorityIcon
});
module.exports = __toCommonJS(priority_icon_exports);
var React = __toESM(require("react"));

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/priority-icon.tsx
function PriorityIcon({
  priority,
  size = 16,
  className,
  ...props
}) {
  if (priority === "URGENT") {
    return /* @__PURE__ */ React.createElement(
      "svg",
      {
        width: size,
        height: size,
        viewBox: "0 0 16 16",
        fill: "none",
        className: cn("shrink-0", className),
        ...props
      },
      /* @__PURE__ */ React.createElement(
        "rect",
        {
          x: 1,
          y: 0,
          width: 14,
          height: 16,
          rx: 1.5,
          fill: "currentColor"
        }
      ),
      /* @__PURE__ */ React.createElement(
        "rect",
        {
          x: 7,
          y: 3,
          width: 2,
          height: 7,
          rx: 1,
          style: { fill: "var(--background, #fff)" }
        }
      ),
      /* @__PURE__ */ React.createElement(
        "rect",
        {
          x: 7,
          y: 11.5,
          width: 2,
          height: 2,
          rx: 1,
          style: { fill: "var(--background, #fff)" }
        }
      )
    );
  }
  const activeCount = ACTIVE_BAR_COUNT[priority] ?? 3;
  return /* @__PURE__ */ React.createElement(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 16 16",
      fill: "none",
      className: cn("shrink-0", className),
      ...props
    },
    /* @__PURE__ */ React.createElement(
      "rect",
      {
        x: 1,
        y: 10,
        width: 3,
        height: 6,
        rx: 1.5,
        fill: "currentColor",
        opacity: activeCount >= 1 ? 1 : 0.3
      }
    ),
    /* @__PURE__ */ React.createElement(
      "rect",
      {
        x: 6.5,
        y: 6,
        width: 3,
        height: 10,
        rx: 1.5,
        fill: "currentColor",
        opacity: activeCount >= 2 ? 1 : 0.3
      }
    ),
    /* @__PURE__ */ React.createElement(
      "rect",
      {
        x: 12,
        y: 0,
        width: 3,
        height: 16,
        rx: 1.5,
        fill: "currentColor",
        opacity: activeCount >= 3 ? 1 : 0.3
      }
    )
  );
}
var ACTIVE_BAR_COUNT = { LOW: 1, MEDIUM: 2, HIGH: 3 };
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PriorityIcon
});
//# sourceMappingURL=priority-icon.js.map