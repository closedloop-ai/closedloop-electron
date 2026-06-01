import React from "react";
import "../../../chunk-LZOMFHX3.mjs";

// components/ui/primitives/line-chart.tsx
function LineChart({
  points,
  color = "#10b981",
  valueFormatter = (value) => value.toLocaleString(),
  label = "trend line"
}) {
  if (points.length === 0) {
    return /* @__PURE__ */ React.createElement("div", { className: "text-muted-foreground text-sm" }, "No data");
  }
  const width = 320;
  const height = 88;
  const padding = 8;
  const min = Math.min(...points.map((point) => point.value), 0);
  const max = Math.max(...points.map((point) => point.value), 0);
  const span = Math.max(max - min, 1e-4);
  const step = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const mapped = points.map((point, index) => {
    const x = padding + index * step;
    const y = height - padding - (point.value - min) / span * (height - padding * 2);
    return { ...point, x, y };
  });
  const polyline = mapped.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${mapped[0]?.x ?? padding},${height - padding} ${polyline} ${mapped.at(-1)?.x ?? padding},${height - padding}`;
  return /* @__PURE__ */ React.createElement(
    "svg",
    {
      "aria-label": label,
      className: "h-[88px] w-full overflow-visible",
      role: "img",
      viewBox: `0 0 ${width} ${height}`
    },
    /* @__PURE__ */ React.createElement("defs", null, /* @__PURE__ */ React.createElement(
      "linearGradient",
      {
        id: `line-fill-${label.replace(/\s+/g, "-")}`,
        x1: "0",
        x2: "0",
        y1: "0",
        y2: "1"
      },
      /* @__PURE__ */ React.createElement("stop", { offset: "0%", stopColor: color, stopOpacity: 0.35 }),
      /* @__PURE__ */ React.createElement("stop", { offset: "100%", stopColor: color, stopOpacity: 0.02 })
    )),
    /* @__PURE__ */ React.createElement(
      "polyline",
      {
        fill: `url(#line-fill-${label.replace(/\s+/g, "-")})`,
        points: area,
        stroke: "none"
      }
    ),
    /* @__PURE__ */ React.createElement(
      "polyline",
      {
        fill: "none",
        points: polyline,
        stroke: color,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2
      }
    ),
    mapped.map((point) => /* @__PURE__ */ React.createElement("g", { key: point.label }, /* @__PURE__ */ React.createElement("circle", { cx: point.x, cy: point.y, fill: color, r: 2.5 }), /* @__PURE__ */ React.createElement("title", null, `${point.label}: ${valueFormatter(point.value)}`)))
  );
}
export {
  LineChart
};
//# sourceMappingURL=line-chart.mjs.map