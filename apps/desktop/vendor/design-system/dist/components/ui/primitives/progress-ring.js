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

// components/ui/primitives/progress-ring.tsx
var progress_ring_exports = {};
__export(progress_ring_exports, {
  ProgressRing: () => ProgressRing
});
module.exports = __toCommonJS(progress_ring_exports);
function ProgressRing({
  value,
  color = "hsl(var(--primary))",
  size = 72,
  strokeWidth = 8,
  label
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = clamped / 100 * circumference;
  const gap = circumference - filled;
  const center = size / 2;
  return /* @__PURE__ */ React.createElement(
    "svg",
    {
      "aria-label": label ?? `${clamped.toFixed(0)} percent`,
      className: "shrink-0",
      height: size,
      role: "img",
      viewBox: `0 0 ${size} ${size}`,
      width: size
    },
    /* @__PURE__ */ React.createElement(
      "circle",
      {
        cx: center,
        cy: center,
        fill: "none",
        r: radius,
        stroke: "hsl(var(--muted))",
        strokeWidth
      }
    ),
    /* @__PURE__ */ React.createElement(
      "circle",
      {
        cx: center,
        cy: center,
        fill: "none",
        r: radius,
        stroke: color,
        strokeDasharray: `${filled} ${gap}`,
        strokeLinecap: "round",
        strokeWidth,
        transform: `rotate(-90 ${center} ${center})`
      }
    ),
    /* @__PURE__ */ React.createElement(
      "text",
      {
        className: "fill-foreground",
        fontSize: size * 0.22,
        fontWeight: "600",
        textAnchor: "middle",
        x: center,
        y: center + size * 0.03
      },
      clamped.toFixed(0),
      "%"
    )
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ProgressRing
});
//# sourceMappingURL=progress-ring.js.map