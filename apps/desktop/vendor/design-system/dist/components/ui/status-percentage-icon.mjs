"use client";
import {
  CENTER,
  CIRCUMFERENCE,
  FilledCheckCircle,
  INNER_CIRCUMFERENCE,
  INNER_PATH_RADIUS,
  INNER_STROKE_WIDTH,
  RADIUS,
  STROKE_WIDTH
} from "../../chunk-TQBNQE2F.mjs";
import {
  cn
} from "../../chunk-522NBUZJ.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/status-percentage-icon.tsx
import * as React from "react";
function StatusPercentageIcon({
  value,
  size = 16,
  thinking = false,
  className,
  ...props
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const defaultLabel = `${Math.round(clamped)}% complete`;
  if (clamped >= 100) {
    return /* @__PURE__ */ React.createElement(
      "svg",
      {
        role: "img",
        "aria-label": defaultLabel,
        "data-slot": "status-percentage-icon",
        width: size,
        height: size,
        viewBox: "0 0 20 20",
        fill: "none",
        className: cn("shrink-0", className),
        ...props
      },
      /* @__PURE__ */ React.createElement(FilledCheckCircle, { fill: "var(--success)" })
    );
  }
  const outerOffset = CIRCUMFERENCE * (1 - clamped / 100);
  const innerOffset = INNER_CIRCUMFERENCE * (1 - clamped / 100);
  const spinnerDash = CIRCUMFERENCE * 0.25;
  const spinnerGap = CIRCUMFERENCE - spinnerDash;
  return /* @__PURE__ */ React.createElement(
    "svg",
    {
      role: "img",
      "aria-label": defaultLabel,
      "data-slot": "status-percentage-icon",
      width: size,
      height: size,
      viewBox: "0 0 20 20",
      fill: "none",
      className: cn("shrink-0", className),
      ...props
    },
    /* @__PURE__ */ React.createElement(
      "circle",
      {
        cx: CENTER,
        cy: CENTER,
        r: RADIUS,
        stroke: "var(--progress)",
        strokeWidth: STROKE_WIDTH,
        fill: "none"
      }
    ),
    !thinking && clamped > 0 && /* @__PURE__ */ React.createElement(
      "circle",
      {
        cx: CENTER,
        cy: CENTER,
        r: RADIUS,
        stroke: "var(--progress-foreground)",
        strokeWidth: STROKE_WIDTH,
        strokeLinecap: "round",
        fill: "none",
        strokeDasharray: CIRCUMFERENCE,
        strokeDashoffset: outerOffset,
        transform: `rotate(-90 ${CENTER} ${CENTER})`,
        className: "transition-all duration-300 ease-in-out"
      }
    ),
    thinking && /* @__PURE__ */ React.createElement(
      "circle",
      {
        cx: CENTER,
        cy: CENTER,
        r: RADIUS,
        stroke: "var(--thinking)",
        strokeWidth: STROKE_WIDTH,
        strokeLinecap: "round",
        fill: "none",
        strokeDasharray: `${spinnerDash} ${spinnerGap}`,
        className: "animate-spin origin-center"
      }
    ),
    clamped > 0 && /* @__PURE__ */ React.createElement(
      "circle",
      {
        cx: CENTER,
        cy: CENTER,
        r: INNER_PATH_RADIUS,
        stroke: "var(--progress-foreground)",
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
export {
  StatusPercentageIcon
};
//# sourceMappingURL=status-percentage-icon.mjs.map