import React from "react";
"use client";
import "../../../chunk-LZOMFHX3.mjs";

// components/ui/primitives/progress-ring.tsx
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
export {
  ProgressRing
};
//# sourceMappingURL=progress-ring.mjs.map