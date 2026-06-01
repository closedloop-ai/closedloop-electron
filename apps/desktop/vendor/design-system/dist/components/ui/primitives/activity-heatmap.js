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

// components/ui/primitives/activity-heatmap.tsx
var activity_heatmap_exports = {};
__export(activity_heatmap_exports, {
  ActivityHeatmap: () => ActivityHeatmap
});
module.exports = __toCommonJS(activity_heatmap_exports);

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/primitives/activity-heatmap.tsx
function cellColor(count, max) {
  if (count === 0) {
    return "rgb(24,24,32)";
  }
  const t = Math.log(count + 1) / Math.log(Math.max(max, 1) + 1);
  const stops = [
    [24, 24, 32],
    [45, 67, 140],
    [59, 130, 246],
    [139, 92, 246],
    [196, 181, 253]
  ];
  const scaled = t * (stops.length - 1);
  const low = Math.min(Math.floor(scaled), stops.length - 2);
  const fraction = scaled - low;
  const [r1, g1, b1] = stops[low];
  const [r2, g2, b2] = stops[low + 1];
  const r = Math.round(r1 + (r2 - r1) * fraction);
  const g = Math.round(g1 + (g2 - g1) * fraction);
  const b = Math.round(b1 + (b2 - b1) * fraction);
  return `rgb(${r},${g},${b})`;
}
function ActivityHeatmap({
  weeks,
  className
}) {
  const maxCount = Math.max(
    1,
    ...weeks.flatMap((week) => week.map((cell) => cell.count))
  );
  const monthLabels = weeks.reduce(
    (labels, week, index) => {
      const firstCell = week[0];
      if (!firstCell) {
        return labels;
      }
      const label = (/* @__PURE__ */ new Date(`${firstCell.date}T12:00:00`)).toLocaleString(
        "en-US",
        { month: "short" }
      );
      if (labels.at(-1)?.label !== label) {
        labels.push({ column: index, label });
      }
      return labels;
    },
    []
  );
  return /* @__PURE__ */ React.createElement("div", { className: cn("space-y-3", className) }, /* @__PURE__ */ React.createElement("div", { className: "relative ml-8 h-4" }, monthLabels.map((item) => /* @__PURE__ */ React.createElement(
    "span",
    {
      className: "absolute text-[10px] text-muted-foreground",
      key: `${item.label}-${item.column}`,
      style: { left: item.column * 16 }
    },
    item.label
  ))), /* @__PURE__ */ React.createElement("div", { className: "flex gap-[3px]" }, /* @__PURE__ */ React.createElement("div", { className: "mr-1 flex w-7 flex-col gap-[3px]" }, [
    { key: "sun", label: "Sun" },
    { key: "mon", label: "" },
    { key: "tue", label: "Tue" },
    { key: "wed", label: "" },
    { key: "thu", label: "Thu" },
    { key: "fri", label: "" },
    { key: "sat", label: "" }
  ].map((item) => /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "flex h-[13px] items-center justify-end pr-1.5 text-[9px] text-muted-foreground",
      key: item.key
    },
    item.label
  ))), weeks.map((week) => /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "flex flex-col gap-[3px]",
      key: week[0]?.date ?? "week"
    },
    week.map((cell) => /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "rounded-[2px] border border-white/5",
        key: cell.date,
        style: {
          width: 13,
          height: 13,
          backgroundColor: cellColor(cell.count, maxCount)
        },
        title: `${cell.date}: ${cell.count.toLocaleString()} events`
      }
    ))
  ))), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2 text-[11px] text-muted-foreground" }, /* @__PURE__ */ React.createElement("span", null, "Less"), [0, 0.25, 0.5, 0.75, 1].map((value) => {
    const count = Math.round(value * maxCount);
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "rounded-[2px] border border-white/5",
        key: value,
        style: {
          width: 13,
          height: 13,
          backgroundColor: cellColor(count, maxCount)
        }
      }
    );
  }), /* @__PURE__ */ React.createElement("span", null, "More")));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ActivityHeatmap
});
//# sourceMappingURL=activity-heatmap.js.map