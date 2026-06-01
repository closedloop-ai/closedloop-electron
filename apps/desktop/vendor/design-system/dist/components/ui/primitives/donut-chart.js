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

// components/ui/primitives/donut-chart.tsx
var donut_chart_exports = {};
__export(donut_chart_exports, {
  DonutChart: () => DonutChart
});
module.exports = __toCommonJS(donut_chart_exports);
var import_react = require("react");

// components/ui/utils.ts
function formatCompactNumber(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}
var SIMPLE_TUI_TAGS = {
  "local-command-caveat": "caveat",
  "local-command-stdout": "stdout",
  "local-command-stderr": "stderr",
  "system-reminder": "system-reminder",
  "persisted-output": "persisted-output"
};
var COMMAND_TUI_TAGS = [
  "command-name",
  "command-message",
  "command-args"
];
var KNOWN_TUI_TAG_RE = new RegExp(
  `<(?:${[...Object.keys(SIMPLE_TUI_TAGS), ...COMMAND_TUI_TAGS].join("|")})\\b`
);

// components/ui/primitives/donut-chart.tsx
function DonutChart({
  segments,
  formatTotal = formatCompactNumber,
  centerLabel = "total"
}) {
  const titleId = (0, import_react.useId)();
  const total = (0, import_react.useMemo)(
    () => segments.reduce((sum, segment) => sum + segment.value, 0),
    [segments]
  );
  if (total <= 0) {
    return /* @__PURE__ */ React.createElement("div", { className: "text-muted-foreground text-xs" }, "No data");
  }
  const radius = 52;
  const center = 64;
  const stroke = 18;
  const circumference = 2 * Math.PI * radius;
  let offset = circumference / 4;
  return /* @__PURE__ */ React.createElement("div", { className: "flex w-full items-center justify-center gap-6" }, /* @__PURE__ */ React.createElement(
    "svg",
    {
      "aria-labelledby": titleId,
      className: "shrink-0",
      height: 128,
      role: "img",
      viewBox: "0 0 128 128",
      width: 128
    },
    /* @__PURE__ */ React.createElement("title", { id: titleId }, "Monitor donut chart"),
    /* @__PURE__ */ React.createElement(
      "circle",
      {
        cx: center,
        cy: center,
        fill: "none",
        r: radius,
        stroke: "hsl(var(--muted))",
        strokeWidth: stroke
      }
    ),
    segments.map((segment) => {
      const dash = segment.value / total * circumference;
      const gap = circumference - dash;
      const currentOffset = offset;
      offset -= dash;
      return /* @__PURE__ */ React.createElement(
        "circle",
        {
          cx: center,
          cy: center,
          fill: "none",
          key: segment.label,
          r: radius,
          stroke: segment.color,
          strokeDasharray: `${dash} ${gap}`,
          strokeDashoffset: currentOffset,
          strokeLinecap: "round",
          strokeWidth: stroke
        },
        /* @__PURE__ */ React.createElement("title", null, `${segment.label}: ${formatCompactNumber(segment.value)} (${Math.round(segment.value / total * 100)}%)`)
      );
    }),
    /* @__PURE__ */ React.createElement(
      "text",
      {
        className: "fill-foreground",
        fontSize: 11,
        textAnchor: "middle",
        x: center,
        y: center - 6
      },
      formatTotal(total)
    ),
    /* @__PURE__ */ React.createElement(
      "text",
      {
        className: "fill-muted-foreground",
        fontSize: 9,
        textAnchor: "middle",
        x: center,
        y: center + 10
      },
      centerLabel
    )
  ), /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, segments.map((segment) => /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2 text-xs", key: segment.label }, /* @__PURE__ */ React.createElement(
    "span",
    {
      className: "h-2.5 w-2.5 shrink-0 rounded-sm",
      style: { backgroundColor: segment.color }
    }
  ), /* @__PURE__ */ React.createElement("span", { className: "text-muted-foreground" }, segment.label), /* @__PURE__ */ React.createElement("span", { className: "ml-auto pl-4 text-right" }, /* @__PURE__ */ React.createElement("span", { className: "font-medium text-foreground" }, formatCompactNumber(segment.value)), /* @__PURE__ */ React.createElement("span", { className: "ml-2 text-muted-foreground" }, Math.round(segment.value / total * 100), "%"))))));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DonutChart
});
//# sourceMappingURL=donut-chart.js.map