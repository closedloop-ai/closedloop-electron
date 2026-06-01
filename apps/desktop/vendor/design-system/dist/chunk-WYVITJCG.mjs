import {
  cn
} from "./chunk-522NBUZJ.mjs";

// components/ui/priority-icon.tsx
import * as React from "react";
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

export {
  PriorityIcon
};
//# sourceMappingURL=chunk-WYVITJCG.mjs.map