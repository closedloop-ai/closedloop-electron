import React from "react";
// components/ui/primitives/sparkline.tsx
import { useMemo } from "react";
function Sparkline({
  values,
  width = 80,
  height = 20,
  className,
  stroke = "currentColor"
}) {
  const points = useMemo(() => {
    const clean = values.map(
      (value) => typeof value === "number" && Number.isFinite(value) ? value : null
    ).filter((value) => value !== null);
    if (clean.length < 2) {
      return null;
    }
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const range = max - min || 1;
    const step = width / (clean.length - 1);
    return clean.map((value, index) => {
      const x = index * step;
      const y = height - (value - min) / range * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }, [height, values, width]);
  if (!points) {
    return null;
  }
  return /* @__PURE__ */ React.createElement(
    "svg",
    {
      "aria-hidden": "true",
      className,
      height,
      viewBox: `0 0 ${width} ${height}`,
      width
    },
    /* @__PURE__ */ React.createElement(
      "polyline",
      {
        fill: "none",
        points,
        stroke,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: "1.5"
      }
    )
  );
}

export {
  Sparkline
};
//# sourceMappingURL=chunk-3VJLNCQH.mjs.map