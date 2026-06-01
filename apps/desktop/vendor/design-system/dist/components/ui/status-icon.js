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

// components/ui/status-icon.tsx
var status_icon_exports = {};
__export(status_icon_exports, {
  StatusIcon: () => StatusIcon
});
module.exports = __toCommonJS(status_icon_exports);
var React2 = __toESM(require("react"));

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/internal/status-icon-shared.tsx
var React = __toESM(require("react"));
var CENTER = 10;
var RADIUS = 9;
var STROKE_WIDTH = 2;
var CIRCUMFERENCE = 2 * Math.PI * RADIUS;
var INNER_PATH_RADIUS = 3;
var INNER_STROKE_WIDTH = INNER_PATH_RADIUS * 2;
var INNER_CIRCUMFERENCE = 2 * Math.PI * INNER_PATH_RADIUS;
var ICON_STROKE_WIDTH = 1.66;
function FilledCheckCircle({ fill }) {
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: CENTER, cy: CENTER, r: RADIUS + STROKE_WIDTH / 2, fill }), /* @__PURE__ */ React.createElement(
    "path",
    {
      d: "M6.5 10.5L9.5 13.5L14 7.5",
      stroke: "var(--background)",
      strokeWidth: ICON_STROKE_WIDTH,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      fill: "none"
    }
  ));
}
function FilledXCircle({ fill }) {
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: CENTER, cy: CENTER, r: RADIUS + STROKE_WIDTH / 2, fill }), /* @__PURE__ */ React.createElement(
    "path",
    {
      d: "M7 7L13 13M13 7L7 13",
      stroke: "var(--background)",
      strokeWidth: ICON_STROKE_WIDTH,
      strokeLinecap: "round",
      fill: "none"
    }
  ));
}

// components/ui/status-icon.tsx
var STATUS_LABELS = {
  backlog: "Backlog",
  todo: "To do",
  started: "In Progress",
  "in-progress": "In progress",
  "in-review": "In review",
  executed: "Executed",
  complete: "Complete",
  "wont-do": "Won't do",
  decorative: "Status"
};
function getStatusConfig(status) {
  switch (status) {
    case "backlog": {
      return { percentage: 0, color: "var(--progress)", dashed: true, filled: false, icon: null };
    }
    case "todo": {
      return { percentage: 0, color: "var(--progress)", dashed: false, filled: false, icon: null };
    }
    case "started": {
      return { percentage: 25, color: "var(--progress-foreground)", dashed: false, filled: false, icon: null };
    }
    case "in-progress": {
      return { percentage: 48.5, color: "var(--progress-foreground)", dashed: false, filled: false, icon: null };
    }
    case "in-review": {
      return { percentage: 73.5, color: "var(--progress-foreground)", dashed: false, filled: false, icon: null };
    }
    case "executed": {
      return { percentage: 100, color: "var(--progress-foreground)", dashed: false, filled: false, icon: null };
    }
    case "complete": {
      return { percentage: 100, color: "var(--success)", dashed: false, filled: true, icon: "check" };
    }
    case "wont-do": {
      return { percentage: 100, color: "var(--foreground)", dashed: false, filled: true, icon: "x" };
    }
    default: {
      return { percentage: 48.5, color: "var(--muted-foreground)", dashed: false, filled: false, icon: null, trackColor: "var(--muted-foreground)", strokeWidth: 1.5 };
    }
  }
}
function StatusIcon({
  status,
  size = 16,
  thinking = false,
  className,
  ...props
}) {
  const config = getStatusConfig(status);
  const defaultLabel = STATUS_LABELS[status];
  if (config.filled) {
    return /* @__PURE__ */ React2.createElement(
      "svg",
      {
        role: "img",
        "aria-label": defaultLabel,
        "data-slot": "status-icon",
        width: size,
        height: size,
        viewBox: "0 0 20 20",
        fill: "none",
        className: cn("shrink-0", className),
        ...props
      },
      config.icon === "check" && /* @__PURE__ */ React2.createElement(FilledCheckCircle, { fill: config.color }),
      config.icon === "x" && /* @__PURE__ */ React2.createElement(FilledXCircle, { fill: config.color })
    );
  }
  const sw = config.strokeWidth ?? STROKE_WIDTH;
  const outerOffset = CIRCUMFERENCE * (1 - config.percentage / 100);
  const innerOffset = INNER_CIRCUMFERENCE * (1 - config.percentage / 100);
  const spinnerDash = CIRCUMFERENCE * 0.25;
  const spinnerGap = CIRCUMFERENCE - spinnerDash;
  const hasArc = config.percentage > 0;
  return /* @__PURE__ */ React2.createElement(
    "svg",
    {
      role: "img",
      "aria-label": defaultLabel,
      "data-slot": "status-icon",
      width: size,
      height: size,
      viewBox: "0 0 20 20",
      fill: "none",
      className: cn("shrink-0", className),
      ...props
    },
    /* @__PURE__ */ React2.createElement(
      "circle",
      {
        cx: CENTER,
        cy: CENTER,
        r: RADIUS,
        stroke: config.trackColor ?? "var(--progress)",
        strokeWidth: sw,
        fill: "none",
        strokeDasharray: config.dashed ? "3 3" : void 0
      }
    ),
    !thinking && hasArc && /* @__PURE__ */ React2.createElement(
      "circle",
      {
        cx: CENTER,
        cy: CENTER,
        r: RADIUS,
        stroke: config.color,
        strokeWidth: sw,
        strokeLinecap: "round",
        fill: "none",
        strokeDasharray: CIRCUMFERENCE,
        strokeDashoffset: outerOffset,
        transform: `rotate(-90 ${CENTER} ${CENTER})`,
        className: "transition-all duration-300 ease-in-out"
      }
    ),
    thinking && /* @__PURE__ */ React2.createElement(
      "circle",
      {
        cx: CENTER,
        cy: CENTER,
        r: RADIUS,
        stroke: "var(--thinking)",
        strokeWidth: sw,
        strokeLinecap: "round",
        fill: "none",
        strokeDasharray: `${spinnerDash} ${spinnerGap}`,
        className: "animate-spin origin-center"
      }
    ),
    hasArc && /* @__PURE__ */ React2.createElement(
      "circle",
      {
        cx: CENTER,
        cy: CENTER,
        r: INNER_PATH_RADIUS,
        stroke: config.color,
        strokeWidth: INNER_STROKE_WIDTH,
        fill: "none",
        strokeDasharray: INNER_CIRCUMFERENCE,
        strokeDashoffset: innerOffset,
        transform: `rotate(-90 ${CENTER} ${CENTER})`,
        className: "transition-all duration-300 ease-in-out"
      }
    )
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  StatusIcon
});
//# sourceMappingURL=status-icon.js.map