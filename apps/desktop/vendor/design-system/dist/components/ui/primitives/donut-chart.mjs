import React from "react";
"use client";
import {
  formatCompactNumber
} from "../../../chunk-UGNO5UUO.mjs";
import "../../../chunk-LZOMFHX3.mjs";

// components/ui/primitives/donut-chart.tsx
import { useId, useMemo } from "react";
function DonutChart({
  segments,
  formatTotal = formatCompactNumber,
  centerLabel = "total"
}) {
  const titleId = useId();
  const total = useMemo(
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
export {
  DonutChart
};
//# sourceMappingURL=donut-chart.mjs.map