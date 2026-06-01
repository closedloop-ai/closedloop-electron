// components/ui/internal/status-icon-shared.tsx
import * as React from "react";
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

export {
  CENTER,
  RADIUS,
  STROKE_WIDTH,
  CIRCUMFERENCE,
  INNER_PATH_RADIUS,
  INNER_STROKE_WIDTH,
  INNER_CIRCUMFERENCE,
  FilledCheckCircle,
  FilledXCircle
};
//# sourceMappingURL=chunk-TQBNQE2F.mjs.map